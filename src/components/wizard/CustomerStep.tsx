'use client'

import { useId } from 'react'
import Link from 'next/link'
import { FieldError, FieldHint, Input, Label } from '@/components/ui/input'
import { LEGAL_DOCUMENTS } from '@/lib/legal'
import { cn } from '@/lib/utils'

/**
 * MÜŞTERİ BİLGİLERİ + SÖZLEŞME ONAYLARI
 *
 * Asgari veri toplanır: ad, soyad, e-posta. Telefon İSTEĞE BAĞLIDIR.
 * (KVKK veri minimizasyonu — sipariş için gerekmeyen alan istenmez.)
 *
 * ÜÇ ONAY AYRI AYRI verilir; "hepsini kabul ediyorum" tek kutusu YOKTUR.
 * Hangi metnin hangi sürümünün kabul edildiği siparişe snapshot'lanır.
 */

export interface CustomerFormValue {
  firstName: string
  lastName: string
  email: string
  phone: string
  note: string
  acceptedTerms: boolean
  acceptedRefund: boolean
  acceptedPrivacy: boolean
}

export const EMPTY_CUSTOMER: CustomerFormValue = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  note: '',
  acceptedTerms: false,
  acceptedRefund: false,
  acceptedPrivacy: false,
}

export type CustomerFieldErrors = Partial<Record<keyof CustomerFormValue, string>>

const NAME_RE = /^[\p{L}\p{M}'\- .]{2,60}$/u
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_RE = /^(\+90|0)?5\d{9}$/

/** İstemci tarafı doğrulama — sunucudaki Zod şemasıyla AYNI kuralları uygular. */
export function validateCustomer(v: CustomerFormValue): CustomerFieldErrors {
  const e: CustomerFieldErrors = {}
  if (!NAME_RE.test(v.firstName.trim())) e.firstName = 'Adınızı girin (en az 2 karakter).'
  if (!NAME_RE.test(v.lastName.trim())) e.lastName = 'Soyadınızı girin (en az 2 karakter).'
  if (!EMAIL_RE.test(v.email.trim())) e.email = 'Geçerli bir e-posta adresi girin.'
  if (v.phone.trim() && !PHONE_RE.test(v.phone.trim().replace(/\s/g, ''))) {
    e.phone = 'Geçerli bir cep telefonu girin (5XX XXX XX XX).'
  }
  if (!v.acceptedTerms) e.acceptedTerms = 'Hizmet / Satış Sözleşmesi’ni onaylamanız gerekir.'
  if (!v.acceptedRefund) e.acceptedRefund = 'İptal ve iade koşullarını onaylamanız gerekir.'
  if (!v.acceptedPrivacy) e.acceptedPrivacy = 'KVKK / Gizlilik metnini onaylamanız gerekir.'
  return e
}

export function isCustomerComplete(v: CustomerFormValue): boolean {
  return Object.keys(validateCustomer(v)).length === 0
}

export function CustomerStep({
  value,
  onChange,
  errors,
  emailLocked,
}: {
  value: CustomerFormValue
  onChange: (next: CustomerFormValue) => void
  errors: CustomerFieldErrors
  /** Oturum açmış kullanıcıda e-posta hesaptan gelir, düzenlenemez */
  emailLocked?: boolean
}) {
  const uid = useId()
  const set = <K extends keyof CustomerFormValue>(key: K, v: CustomerFormValue[K]) =>
    onChange({ ...value, [key]: v })

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-[--radius-card] border border-ink-200 bg-white p-6 shadow-[--shadow-card]">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${uid}-first`}>Ad</Label>
            <Input
              id={`${uid}-first`}
              name="given-name"
              autoComplete="given-name"
              className="mt-1.5"
              value={value.firstName}
              invalid={!!errors.firstName}
              onChange={(e) => set('firstName', e.target.value)}
            />
            {errors.firstName && <FieldError className="mt-1.5">{errors.firstName}</FieldError>}
          </div>

          <div>
            <Label htmlFor={`${uid}-last`}>Soyad</Label>
            <Input
              id={`${uid}-last`}
              name="family-name"
              autoComplete="family-name"
              className="mt-1.5"
              value={value.lastName}
              invalid={!!errors.lastName}
              onChange={(e) => set('lastName', e.target.value)}
            />
            {errors.lastName && <FieldError className="mt-1.5">{errors.lastName}</FieldError>}
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor={`${uid}-email`}>E-posta</Label>
            <Input
              id={`${uid}-email`}
              type="email"
              inputMode="email"
              autoComplete="email"
              className="mt-1.5"
              value={value.email}
              disabled={emailLocked}
              invalid={!!errors.email}
              onChange={(e) => set('email', e.target.value)}
            />
            {errors.email ? (
              <FieldError className="mt-1.5">{errors.email}</FieldError>
            ) : (
              <FieldHint className="mt-1.5">
                Sipariş numaranız ve takip bağlantınız bu adrese gönderilir.
              </FieldHint>
            )}
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor={`${uid}-phone`}>
              Telefon <span className="font-normal text-ink-500">(isteğe bağlı)</span>
            </Label>
            <Input
              id={`${uid}-phone`}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="5XX XXX XX XX"
              className="mt-1.5"
              value={value.phone}
              invalid={!!errors.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
            {errors.phone && <FieldError className="mt-1.5">{errors.phone}</FieldError>}
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor={`${uid}-note`}>
              Sipariş notu <span className="font-normal text-ink-500">(isteğe bağlı)</span>
            </Label>
            <textarea
              id={`${uid}-note`}
              rows={2}
              maxLength={1000}
              className={cn(
                'mt-1.5 w-full rounded-[--radius-control] border border-ink-200 bg-white px-3.5 py-2.5',
                'text-body text-ink-900 placeholder:text-ink-400',
                'focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500',
              )}
              value={value.note}
              onChange={(e) => set('note', e.target.value)}
            />
          </div>
        </div>

        <p className="mt-4 text-caption leading-relaxed text-ink-500">
          Bilgileriniz yalnızca siparişinizin yürütülmesi için işlenir. Kart bilgileriniz
          sunucularımıza hiçbir zaman ulaşmaz.
        </p>
      </div>

      {/* ------------------------------- Onaylar ------------------------------- */}
      <fieldset className="rounded-[--radius-card] border border-ink-200 bg-white p-6 shadow-[--shadow-card]">
        <legend className="px-1 text-small font-medium text-ink-800">Onaylar</legend>

        <div className="mt-2 flex flex-col gap-4">
          <ConsentCheckbox
            id={`${uid}-terms`}
            checked={value.acceptedTerms}
            onChange={(c) => set('acceptedTerms', c)}
            error={errors.acceptedTerms}
            href={LEGAL_DOCUMENTS.terms.href}
            linkText={LEGAL_DOCUMENTS.terms.title}
            suffix="’ni okudum ve kabul ediyorum."
          />
          <ConsentCheckbox
            id={`${uid}-refund`}
            checked={value.acceptedRefund}
            onChange={(c) => set('acceptedRefund', c)}
            error={errors.acceptedRefund}
            href={LEGAL_DOCUMENTS.refund.href}
            linkText={LEGAL_DOCUMENTS.refund.title}
            suffix="’nı okudum ve kabul ediyorum."
          />
          <ConsentCheckbox
            id={`${uid}-privacy`}
            checked={value.acceptedPrivacy}
            onChange={(c) => set('acceptedPrivacy', c)}
            error={errors.acceptedPrivacy}
            href={LEGAL_DOCUMENTS.privacy.href}
            linkText={LEGAL_DOCUMENTS.privacy.title}
            suffix="’ni okudum, kişisel verilerimin işlenmesini kabul ediyorum."
          />
        </div>
      </fieldset>
    </div>
  )
}

function ConsentCheckbox({
  id,
  checked,
  onChange,
  error,
  href,
  linkText,
  suffix,
}: {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  error?: string
  href: string
  linkText: string
  suffix: string
}) {
  return (
    <div>
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          aria-invalid={!!error || undefined}
          onChange={(e) => onChange(e.target.checked)}
          className={cn(
            'mt-0.5 size-5 shrink-0 cursor-pointer rounded-[6px] border accent-brand-600',
            error ? 'border-danger-600' : 'border-ink-300',
          )}
        />
        <label htmlFor={id} className="cursor-pointer text-small leading-relaxed text-ink-700">
          <Link
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-700 underline underline-offset-2"
            onClick={(e) => e.stopPropagation()}
          >
            {linkText}
          </Link>
          {suffix}
        </label>
      </div>
      {error && <FieldError className="ml-8 mt-1.5">{error}</FieldError>}
    </div>
  )
}
