'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TargetConfirmCard, type TargetPreviewData } from '@/components/primitives/TargetConfirmCard'
import { withUnit } from '@/lib/units'
import { calculatePrice, PricingError, type PriceBreakdown } from '@/lib/pricing'
import { parseTarget } from '@/lib/platforms/parse'
import type { CatalogSnapshot } from '@/server/catalog/snapshot'
import {
  ORDER_CREATED_STORAGE_KEY,
  type CreatedOrderPayload,
} from '@/app/siparis-olusturuldu/OrderCreatedScreen'
import {
  CustomerStep,
  EMPTY_CUSTOMER,
  validateCustomer,
  type CustomerFieldErrors,
  type CustomerFormValue,
} from './CustomerStep'
import { MobilePriceBar, PriceSummaryCard } from './PriceSummary'
import { PlatformTile } from './PlatformMark'
import {
  StepHeading,
  StepPlatform,
  StepQuantity,
  StepService,
  StepTarget,
  SummaryRow,
  VariantPicker,
} from './steps'

/**
 * SİPARİŞ SİHİRBAZI — TEK SAYFA
 *
 * Hiçbir adımda sayfa yönlendirmesi yoktur. Adım durumu `history.replaceState`
 * ile URL'ye yazılır: geri tuşu çalışır, link paylaşılabilir, reklam kampanyası
 * doğrudan 3. adıma düşürebilir — ama RSC yeniden fetch edilmez.
 *
 * FİYAT: `calculatePrice` TARAYICIDA çalışır (sunucudakiyle AYNI fonksiyon).
 * Slider hareketinde 0 ms. Sunucu, sipariş anında fiyatı yeniden hesaplayıp
 * otorite olarak yazar.
 *
 * HEDEF: `parseTarget` de saf ve izomorfiktir — anlık geri bildirim verir.
 * Ardından `/api/v1/targets/resolve` çağrılır; başarısız olursa akış DURMAZ,
 * UNVERIFIED'a düşer ve kullanıcıdan onay istenir (Instagram fallback akışı).
 */

const DEBOUNCE_MS = 600

/**
 * Idempotency anahtarı: tarayıcı sekmesi başına ÜRETİLİR ve sipariş başarıyla
 * oluşana kadar SABİT KALIR. Böylece "Sipariş Oluştur"a iki kez basmak,
 * ağ zaman aşımından sonra tekrar denemek veya sayfayı yenilemeden geri gelmek
 * ikinci bir sipariş AÇMAZ.
 */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `ord-${crypto.randomUUID()}`
  return `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
}

export function OrderWizard({
  catalog,
  sessionEmail,
}: {
  catalog: CatalogSnapshot
  /** Oturum açmış kullanıcının e-postası — varsa form kilitlenir */
  sessionEmail?: string | null
}) {
  const router = useRouter()

  // --- Seçimler ---
  const [platformSlug, setPlatformSlug] = useState<string | null>(null)
  const [serviceId, setServiceId] = useState<string | null>(null)
  const [variantId, setVariantId] = useState<string | null>(null)
  const [rawTarget, setRawTarget] = useState('')
  const [quantity, setQuantity] = useState<number | null>(null)
  const [targetConfirmed, setTargetConfirmed] = useState(false)

  // --- Müşteri bilgileri + onaylar ---
  const [customer, setCustomer] = useState<CustomerFormValue>(() => ({
    ...EMPTY_CUSTOMER,
    email: sessionEmail ?? '',
  }))
  const [customerErrors, setCustomerErrors] = useState<CustomerFieldErrors>({})

  // --- Gönderim ---
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [created, setCreated] = useState(false)
  const idempotencyKey = useRef<string>(newIdempotencyKey())

  // --- Hedef çözümleme ---
  const [targetData, setTargetData] = useState<TargetPreviewData | null>(null)
  const [targetError, setTargetError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const platform = useMemo(
    () => catalog.platforms.find((p) => p.slug === platformSlug) ?? null,
    [catalog, platformSlug],
  )
  const service = useMemo(
    () => platform?.services.find((s) => s.id === serviceId) ?? null,
    [platform, serviceId],
  )
  const visibleVariants = service?.variants ?? []
  const variant = useMemo(
    () => visibleVariants.find((v) => v.id === variantId) ?? null,
    [visibleVariants, variantId],
  )

  /**
   * --- URL'den ÖN SEÇİM (derin bağlantı) ---
   *
   * Ana sayfadaki hizmet keşfi `/?p=instagram&s=takipci#siparis` bağlantıları
   * üretir. Bu istemci tarafı bir gezinmedir: sihirbaz YENİDEN MOUNT OLMAZ,
   * dolayısıyla adres çubuğunu yalnızca ilk render'da okumak YETMEZ —
   * `useSearchParams` ile her gezinmede yeniden uygulanır.
   */
  const searchParams = useSearchParams()
  const appliedQuery = useRef<string | null>(null)

  useEffect(() => {
    const key = searchParams.toString()
    if (appliedQuery.current === key) return
    appliedQuery.current = key
    if (!key) return

    const q = new URLSearchParams(key)
    const p = catalog.platforms.find((x) => x.slug === q.get('p'))
    if (!p) return
    setPlatformSlug(p.slug)

    const svc = p.services.find((x) => x.slug === q.get('s'))
    if (!svc) return
    setServiceId(svc.id)

    const v =
      svc.variants.find((x) => x.slug === q.get('v')) ??
      svc.variants.find((x) => x.isDefault) ??
      svc.variants[0]
    if (!v) return
    setVariantId(v.id)

    const wanted = Number(q.get('q'))
    const valid = Number.isInteger(wanted) && v.presetQuantities.includes(wanted)
    setQuantity(valid ? wanted : (v.presetQuantities[0] ?? v.minQuantity))
  }, [searchParams, catalog])

  // --- URL senkronu (navigasyon YOK) ---
  useEffect(() => {
    // İlk uygulama turu tamamlanmadan adres çubuğunu EZME.
    if (appliedQuery.current === null) return

    const params = new URLSearchParams()
    if (platformSlug) params.set('p', platformSlug)
    if (service) params.set('s', service.slug)
    if (variant && visibleVariants.length > 1) params.set('v', variant.slug)
    if (quantity) params.set('q', String(quantity))
    const qs = params.toString()
    // Hash KORUNUR: `#siparis` silinirse tarayıcının kaydırma hedefi kaybolur.
    const hash = window.location.hash
    appliedQuery.current = qs
    window.history.replaceState(null, '', `${qs ? `/?${qs}` : '/'}${hash}`)
  }, [platformSlug, service, variant, quantity, visibleVariants.length])

  // --- Platform seçimi: alt seçimleri sıfırla ---
  const selectPlatform = useCallback(
    (slug: string) => {
      setPlatformSlug(slug)
      setServiceId(null)
      setVariantId(null)
      setQuantity(null)
      setRawTarget('')
      setTargetData(null)
      setTargetError(null)
      setTargetConfirmed(false)
    },
    [],
  )

  const selectService = useCallback(
    (id: string) => {
      const svc = platform?.services.find((s) => s.id === id)
      setServiceId(id)
      const def = svc?.variants.find((v) => v.isDefault) ?? svc?.variants[0]
      setVariantId(def?.id ?? null)
      setQuantity(def ? (def.presetQuantities[0] ?? def.minQuantity) : null)
      setRawTarget('')
      setTargetData(null)
      setTargetError(null)
      setTargetConfirmed(false)
    },
    [platform],
  )

  const selectVariant = useCallback(
    (id: string) => {
      const v = visibleVariants.find((x) => x.id === id)
      setVariantId(id)
      if (v && quantity != null) {
        // ⚠️ Hazır miktarlı varyantta sıkıştırmak YETMEZ: 7.342 sonucu yine
        // seçilemez bir miktar olurdu. En yakın hazır miktara oturtulur.
        if (v.presetOnly && v.presetQuantities.length > 0) {
          const nearest = v.presetQuantities.reduce((best, p) =>
            Math.abs(p - quantity) < Math.abs(best - quantity) ? p : best,
          )
          setQuantity(nearest)
        } else {
          setQuantity(Math.min(v.maxQuantity, Math.max(v.minQuantity, quantity)))
        }
      }
    },
    [visibleVariants, quantity],
  )

  // --- Hedef: anlık parse + debounce'lu sunucu çözümlemesi ---
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!service || !platform) return
    if (timer.current) clearTimeout(timer.current)

    const input = rawTarget.trim()
    if (!input) {
      setTargetData(null)
      setTargetError(null)
      setChecking(false)
      return
    }

    // 1) SAF parse — anında, ağsız
    const parsed = parseTarget(platform.slug, input, service.targetType)
    if (!parsed.ok) {
      setTargetData(null)
      setTargetError(parsed.reason)
      setChecking(false)
      return
    }
    setTargetError(null)
    setChecking(true)

    // 2) Sunucu çözümlemesi — başarısız olursa UNVERIFIED'a düşer, akış durmaz
    timer.current = setTimeout(async () => {
      const fallback: TargetPreviewData = {
        status: 'UNVERIFIED',
        normalized: parsed.normalized,
        canonicalUrl: parsed.canonicalUrl,
        handle: parsed.handle ?? null,
        // ⚠️ Ağ hatası dahi olsa metin bir ARIZA gibi okunmaz; kullanıcıya
        //    yapması gereken tek şey söylenir. Onay kutusu zaten zorunludur.
        message: 'Hedefinizi kontrol edin, doğruluğundan emin olun.',
      }

      try {
        const res = await fetch('/api/v1/targets/resolve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            platformSlug: platform.slug,
            serviceId: service.id,
            input,
          }),
        })
        if (!res.ok) throw new Error(String(res.status))
        const json = (await res.json()) as TargetPreviewData & { canProceed?: boolean }
        setTargetData(json)
      } catch {
        setTargetData(fallback)
      } finally {
        setChecking(false)
      }
      setTargetConfirmed(false)
    }, DEBOUNCE_MS)

    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [rawTarget, service, platform])

  // --- FİYAT: izomorfik, 0 ms ---
  const { breakdown, priceError } = useMemo(() => {
    if (!variant || quantity == null) return { breakdown: null, priceError: null }
    try {
      return {
        breakdown: calculatePrice({
          quantity,
          tiers: variant.tiers,
          constraints: {
            minQuantity: variant.minQuantity,
            maxQuantity: variant.maxQuantity,
            quantityStep: variant.quantityStep,
          presetQuantities: variant.presetQuantities,
          presetOnly: variant.presetOnly,
          },
          taxRateBp: catalog.taxRateBp,
        }),
        priceError: null,
      }
    } catch (e) {
      return { breakdown: null, priceError: e instanceof PricingError ? e.message : 'Fiyat hesaplanamadı.' }
    }
  }, [variant, quantity, catalog.taxRateBp])

  // --- İlerleme kapıları ---
  const targetBlocked =
    targetData?.status === 'PRIVATE' || targetData?.status === 'NOT_FOUND' || targetData?.status === 'INVALID'
  const needsConfirm = targetData?.status === 'UNVERIFIED'
  const targetReady = Boolean(targetData) && !targetBlocked && (!needsConfirm || targetConfirmed)
  const summaryReady = Boolean(breakdown) && targetReady
  const customerValid = Object.keys(validateCustomer(customer)).length === 0
  const canContinue = summaryReady && customerValid && !submitting && !created

  // --------------------------------------------------------------------------
  // SİPARİŞ OLUŞTURMA
  //
  // Buradan sunucuya HİÇBİR FİYAT ALANI gönderilmez; yalnızca `clientTotalMinor`
  // "ekranda gördüğüm tutar" kontrolü için gider. Sunucu fiyatı sıfırdan
  // hesaplar; uyuşmazsa PRICE_CHANGED döner ve kullanıcıya yeni özet gösterilir.
  // --------------------------------------------------------------------------
  const submitOrder = useCallback(async () => {
    if (!variant || !service || !platform || !breakdown || !targetData) return

    const errs = validateCustomer(customer)
    setCustomerErrors(errs)
    if (Object.keys(errs).length > 0) {
      document.getElementById('step-customer')?.scrollIntoView({ block: 'center' })
      return
    }

    const targetId = targetData.targetId
    if (!targetId) {
      setSubmitError(
        'Hedef doğrulama servisine şu anda ulaşılamıyor. Lütfen birkaç saniye sonra tekrar deneyin.',
      )
      return
    }

    setSubmitting(true)
    setSubmitError(null)

    try {
      const res = await fetch('/api/v1/orders', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey.current,
        },
        body: JSON.stringify({
          serviceVariantId: variant.id,
          quantity: breakdown.quantity,
          targetId,
          targetConfirmed,
          customerFirstName: customer.firstName.trim(),
          customerLastName: customer.lastName.trim(),
          guestEmail: customer.email.trim().toLowerCase(),
          ...(customer.phone.trim() ? { guestPhone: customer.phone.trim().replace(/\s/g, '') } : {}),
          ...(customer.note.trim() ? { customerNote: customer.note.trim() } : {}),
          clientTotalMinor: breakdown.totalMinor,
          acceptedTerms: true,
          acceptedRefund: true,
          acceptedPrivacy: true,
        }),
      })

      const json = (await res.json()) as {
        orderNo?: string
        totalMinor?: number
        trackingToken?: string | null
        error?: { code: string; message: string }
      }

      if (!res.ok || !json.orderNo) {
        // Fiyat değiştiyse: yeni fiyat zaten izomorfik motorla yeniden
        // hesaplanacak; kullanıcıya özeti kontrol etmesi söylenir.
        setSubmitError(json.error?.message ?? 'Sipariş oluşturulamadı. Lütfen tekrar deneyin.')
        return
      }

      const payload: CreatedOrderPayload = {
        orderNo: json.orderNo,
        totalMinor: json.totalMinor ?? breakdown.totalMinor,
        trackingToken: json.trackingToken ?? null,
        email: customer.email.trim().toLowerCase(),
        summary: `${platform.name} · ${service.name} — ${withUnit(breakdown.quantity, service.unitLabel)}`,
      }

      // ⚠️ Takip token'ı URL'e KOYULMAZ — tarayıcı geçmişine, sunucu erişim
      // kayıtlarına ve Referer başlığına düşmesin diye sessionStorage kullanılır.
      try {
        sessionStorage.setItem(ORDER_CREATED_STORAGE_KEY, JSON.stringify(payload))
      } catch {
        /* özel mod / kapalı depolama: aşağıdaki yönlendirme takip sayfasına düşer */
      }

      setCreated(true)
      router.push('/siparis-olusturuldu')
    } catch {
      setSubmitError('Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.')
    } finally {
      setSubmitting(false)
    }
  }, [variant, service, platform, breakdown, targetData, targetConfirmed, customer, router])

  /**
   * MOBİL: yeni adım açıldığında ona kaydır.
   * Mobilde açılan adım ekranın altında kaldığı için kullanıcı ilerlediğini
   * fark etmiyordu. Masaüstünde sayfa zaten tek ekrana sığdığı için yapılmaz.
   */
  const serviceRef = useRef<HTMLElement>(null)
  const targetRef = useRef<HTMLElement>(null)
  const quantityRef = useRef<HTMLElement>(null)
  const customerRef = useRef<HTMLElement>(null)

  const scrollToStep = useCallback((el: HTMLElement | null) => {
    if (!el) return
    if (typeof window === 'undefined' || window.innerWidth >= 1024) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.scrollIntoView({ block: 'start' })
      return
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  useEffect(() => {
    if (platformSlug) scrollToStep(serviceRef.current)
  }, [platformSlug, scrollToStep])

  useEffect(() => {
    if (serviceId) scrollToStep(targetRef.current)
  }, [serviceId, scrollToStep])

  useEffect(() => {
    if (targetReady) scrollToStep(quantityRef.current)
  }, [targetReady, scrollToStep])

  /**
   * Varyant kartlarındaki "+%x" farkı için taban birim fiyat.
   * Sabit paket kademelerinde birim fiyat olmadığından 0 döner ve fark
   * gösterilmez (bkz. VariantPicker).
   */
  const baselineUnit = useMemo(() => {
    const units = visibleVariants.flatMap((v) => v.tiers.map((t) => t.unitPriceMinor)).filter((u) => u > 0)
    return units.length > 0 ? Math.min(...units) : 0
  }, [visibleVariants])

  const continueHint = !platform
    ? 'Başlamak için bir platform seçin'
    : !service
      ? 'Bir hizmet seçin'
      : !targetData
        ? 'Hedefinizi girin'
        : targetBlocked
          ? 'Bu hedefe hizmet verilemiyor'
          : needsConfirm && !targetConfirmed
            ? 'Devam etmek için hedefi onaylayın'
            : !customer.firstName.trim() || !customer.lastName.trim() || !customer.email.trim()
              ? 'Bilgilerinizi girin'
              : !customerValid
                ? 'Devam etmek için onayları işaretleyin'
                : 'Ödeme bir sonraki adımda alınacak'

  return (
    <div className="wizard-scope mx-auto grid max-w-6xl gap-8 px-5 pb-36 lg:grid-cols-[minmax(0,1fr)_360px] lg:pb-20">
      {/* ------------------------------- SOL: adımlar ------------------------------ */}
      {/* ⚠️ `min-w-0` — grid sütunları varsayılan `min-width:auto` alır ve
          içeriğinden daralamaz. Slider dar ekranda sütunu genişletip yatay
          kaydırma üretiyordu. */}
        <div className="flex min-w-0 flex-col gap-10">
        <section aria-labelledby="step-platform" className="scroll-mt-20">
          <StepHeading id="step-platform" step={1} title="Platform seçin" done={Boolean(platform)} active={!platform} />
          <StepPlatform platforms={catalog.platforms} value={platformSlug} onChange={selectPlatform} />
        </section>

        {platform && (
          <section ref={serviceRef} aria-labelledby="step-service" className="animate-in scroll-mt-20">
            <StepHeading id="step-service" step={2} title="Hizmet seçin" done={Boolean(service)} active={Boolean(platform) && !service} />
            <StepService services={platform.services} value={serviceId} onChange={selectService} />

            {/* Tek varyant varsa seçici HİÇ gösterilmez */}
            {service && visibleVariants.length > 1 && (
              <div className="mt-5">
                <p className="mb-2.5 text-small font-medium text-ink-700">Paket</p>
                <VariantPicker
                  variants={visibleVariants}
                  value={variantId}
                  onChange={selectVariant}
                  baselineUnitPrice={baselineUnit}
                />
              </div>
            )}
          </section>
        )}

        {service && platform && (
          <section ref={targetRef} aria-labelledby="step-target" className="animate-in scroll-mt-20">
            <StepHeading id="step-target" step={3} title="Hedefinizi girin" done={targetReady} active={Boolean(service) && !targetReady} />
            <StepTarget
              service={service}
              platform={platform}
              value={rawTarget}
              onChange={setRawTarget}
              error={targetError}
              checking={checking}
            />
            {targetData && (
              <div className="mt-4">
                <TargetConfirmCard
                  data={targetData}
                  confirmed={targetConfirmed}
                  onConfirmChange={setTargetConfirmed}
                  platformName={platform.name}
                  platformSlug={platform.slug}
                  brandColor={platform.brandColor}
                />
              </div>
            )}
          </section>
        )}

        {/* Miktar adımı hedef HAZIR olmadan açılmaz — brief'teki sıra korunur:
            Platform → Hizmet → Hedef → Doğrulama → Miktar → Fiyat */}
        {variant && service && quantity != null && targetReady && (
          <section ref={quantityRef} aria-labelledby="step-quantity" className="animate-in scroll-mt-20">
            <StepHeading id="step-quantity" step={4} title="Miktar belirleyin" done={Boolean(breakdown)} active={targetReady} />
            <StepQuantity
              variant={variant}
              value={quantity}
              onChange={setQuantity}
              nextTierHint={breakdown?.nextTier ?? null}
              // ⚠️ Kademenin ilan ettiği değil, GERÇEKTE ÖDENEN birim fiyat.
              //    Çapa tavanı devredeyken ikisi farklıdır.
              unitPriceMinor={breakdown?.effectiveUnitPriceMinor ?? null}
              totalMinor={breakdown?.totalMinor ?? null}
              unitLabel={service.unitLabel}
            />
            {priceError && <p className="mt-3 text-small text-danger-700">{priceError}</p>}
          </section>
        )}

        {breakdown && service && platform && variant && targetReady && (
          <section aria-labelledby="step-review" className="animate-in scroll-mt-20">
            <StepHeading id="step-review" step={5} title="Sipariş özeti" active />
            <div className="rounded-[--radius-card] border border-ink-200 bg-white p-6 shadow-[--shadow-card]">
              <div className="flex items-center gap-3 pb-4">
                <PlatformTile
                  slug={platform.slug}
                  name={platform.name}
                  brandColor={platform.brandColor}
                  iconUrl={platform.iconUrl}
                />
                <div>
                  <p className="text-body font-semibold text-ink-900">
                    {platform.name} · {service.name}
                  </p>
                  {visibleVariants.length > 1 && (
                    <p className="text-small text-ink-500">{variant.customerLabel}</p>
                  )}
                </div>
              </div>
              <div className="divide-y divide-ink-200 border-t border-ink-200">
                <SummaryRow
                  label="Hedef"
                  value={
                    <span className="font-mono text-caption">
                      {targetData?.handle ? `@${targetData.handle}` : (targetData?.normalized ?? '—')}
                    </span>
                  }
                />
                <SummaryRow label="Miktar" value={withUnit(breakdown.quantity, service.unitLabel)} />
                <SummaryRow
                  label="Doğrulama"
                  value={
                    targetData?.status === 'VERIFIED' ? (
                      <Badge tone="success">Doğrulandı</Badge>
                    ) : targetConfirmed ? (
                      <Badge tone="info">Kullanıcı onayladı</Badge>
                    ) : (
                      <Badge tone="warning">Onay bekliyor</Badge>
                    )
                  }
                />
              </div>
            </div>
          </section>
        )}

        {/* Adım 6: müşteri bilgileri + 3 zorunlu onay.
            Özet HAZIR olmadan açılmaz — kullanıcı ne sipariş ettiğini
            görmeden bilgi girmez. */}
        {summaryReady && (
          <section ref={customerRef} aria-labelledby="step-customer" className="animate-in scroll-mt-20">
            <StepHeading
              id="step-customer"
              step={6}
              title="Bilgileriniz"
              done={customerValid}
              hint="Hesap açmanıza gerek yok"
            />
            <CustomerStep
              value={customer}
              onChange={(next) => {
                setCustomer(next)
                if (Object.keys(customerErrors).length > 0) setCustomerErrors(validateCustomer(next))
              }}
              errors={customerErrors}
              emailLocked={Boolean(sessionEmail)}
            />

            {submitError && (
              <div
                role="alert"
                className="mt-5 rounded-[--radius-control] border border-danger-600/30 bg-danger-100 p-4 text-small text-danger-700"
              >
                {submitError}
              </div>
            )}

            {/* Mobilde alt çubuk zaten var; masaüstünde sağ kart. Buradaki
                buton yalnızca uzun formda "aşağıda kaybolma" sorununu çözer. */}
            <div className="mt-6 lg:hidden">
              <p className="text-caption leading-relaxed text-ink-500">
                Siparişi oluşturduğunuzda ödeme henüz alınmaz; siparişiniz
                <strong> ödeme bekleniyor </strong>
                durumunda kaydedilir.
              </p>
            </div>
          </section>
        )}
      </div>

      {/* ------------------------- SAĞ: sticky fiyat kartı ------------------------- */}
      <aside className="hidden lg:block">
        <div className="sticky top-24">
          <PriceSummaryCard
            breakdown={breakdown}
            etaMinutes={variant?.estimatedStartMinutes ?? null}
            onContinue={() => void submitOrder()}
            continueLabel={submitting || created ? 'Oluşturuluyor…' : 'Siparişi Oluştur'}
            disabled={!canContinue}
            hint={continueHint}
            indicative={!targetReady}
            unitLabel={service?.unitLabel ?? 'adet'}
          />
          <p className="mt-4 flex items-start gap-2 px-1 text-caption leading-relaxed text-ink-500">
            <LockIcon />
            Ödeme 3D Secure ile korunur. Kart bilgileriniz bizim sunucumuza hiçbir zaman ulaşmaz.
          </p>
        </div>
      </aside>

      {/**
       * ----------------------------- Mobil alt çubuk -----------------------------
       * ⚠️ Kullanıcı sihirbaza GİRMEDEN gösterilmez. Ana sayfayı okurken
       * ekranın altında pasif bir "Siparişi Oluştur" çubuğu durması hem
       * gereksiz CTA gürültüsü hem de 390px'lik ekranda içerik kaybıdır.
       */}
      {platform && (
      <MobilePriceBar
        breakdown={breakdown}
        onContinue={() => void submitOrder()}
        continueLabel={submitting || created ? 'Oluşturuluyor…' : 'Siparişi Oluştur'}
        disabled={!canContinue}
        indicative={!targetReady}
        hint={continueHint}
      />
      )}
    </div>
  )
}

function LockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="mt-0.5 shrink-0"
      aria-hidden
    >
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 1 1 8 0v3" strokeLinecap="round" />
    </svg>
  )
}
