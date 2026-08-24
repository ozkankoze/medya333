import Link from 'next/link'
import { Logo } from '@/components/brand/Logo'
import { getSessionUser } from '@/server/auth'
import { LogoutButton } from './LogoutButton'

/**
 * ÜST MENÜ — KOYU YÜZEY
 *
 * ⚠️ BAŞLIK NEDEN KOYU? Marka logosu metalik altındır ve beyaz zeminde
 * kontrastı ~2:1'dir; açık bir başlıkta logo soluk ve ucuz görünüyordu.
 * Koyu yüzey logonun kendi zeminidir: altın burada parlar. Aynı zamanda
 * sayfanın geri kalanı (kırık beyaz) ile net bir "çerçeve" ilişkisi kurar.
 *
 * ⚠️ SUNUCU BİLEŞENİ — VE ÖYLE KALMALI. Oturum bilgisi istemciye JS olarak
 * taşınmaz ve menü için hiçbir client bundle eklenmez. Mobil açılır menü
 * `<details>` ile kurulur; React state'i, portal, focus-trap kütüphanesi
 * GEREKTİRMEZ. (Yalnızca "Çıkış" düğmesi client'tır; oturum satırını
 * SUNUCUDA silmek için bir isteğe ihtiyaç duyar.)
 *
 * ⚠️ "Scroll'da blur" için JS YAZILMADI. `backdrop-blur` sürekli açıktır ve
 *    kenarlık yarı saydamdır — scroll dinleyicisi eklemek her kaydırma
 *    karesinde React render'ı tetikler ve mobilde jank üretir.
 */

/**
 * ⚠️ "Hizmetler" ARTIK `/#hizmetler` DEĞİL, `/hizmetler`.
 * Ana sayfadaki keşif bölümü duruyor; ama menüdeki bağlantı arama
 * motorunun tarayabileceği GERÇEK sayfaya gider. Her sayfadan verilen bu
 * bağlantı, hizmet açılış sayfalarını "yetim" olmaktan çıkarır.
 */
const NAV = [
  { href: '/hizmetler', label: 'Hizmetler' },
  { href: '/siparis-takip', label: 'Sipariş Takip' },
  { href: '/yardim', label: 'Yardım' },
] as const

/** Koyu zeminde bağlantı: beyazın %70'i → tam beyaz. Altın SADECE alt çizgide. */
const LINK =
  'relative rounded-[--radius-control] px-3 py-2 text-small font-medium text-white/70 ' +
  'transition-colors duration-[--duration-fast] hover:text-white ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500'

const MOBILE_LINK =
  'flex items-center rounded-[--radius-control] px-3 py-3 text-small font-medium text-white/80 ' +
  'transition-colors duration-[--duration-fast] hover:bg-white/10 hover:text-white'

/**
 * ⚠️ BAŞLIKTAKİ CTA `buttonVariants` KULLANMAZ.
 * Ortak birincil düğme açık zemin için ayarlıdır (altın gradyan + koyu metin);
 * koyu başlıkta o gradyan "yüzen bir altın levha" gibi duruyordu. Buradaki
 * sürüm daha ince: altın dolgu, koyu metin, ama gölge yok.
 */
const CTA =
  'inline-flex h-10 items-center justify-center rounded-[--radius-control] px-4 text-small font-semibold ' +
  'bg-gradient-to-b from-gold-300 to-gold-500 text-ink-975 ' +
  'transition-[filter,transform] duration-[--duration-fast] ease-[--ease-out-soft] ' +
  'hover:brightness-110 active:scale-[0.985] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300'

export async function SiteHeader() {
  const user = await getSessionUser()

  return (
    /**
     * ⚠️ BAŞLIK OPAK — yarı saydam DEĞİL. Yarı saydam denendi ve sayfanın
     * en üstünde başlığın arkasında koyu hero değil AÇIK gövde zemini
     * olduğu için başlık gri bir şerit gibi görünüp hero'nun siyahından
     * kopuyordu. Opak yüzey her kaydırma konumunda aynı rengi verir.
     */
    <header className="sticky top-0 z-40 bg-ink-975">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-5 sm:h-[4.5rem]">
        <Logo />

        {/* --------------------------- Masaüstü menü --------------------------- */}
        <nav aria-label="Ana menü" className="ml-8 hidden items-center gap-1 md:flex">
          {NAV.map((l) => (
            <Link key={l.href} href={l.href} className={LINK}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <Link href="/hesabim" className={`${LINK} hidden sm:inline-block`}>
                Siparişlerim
              </Link>
              <span className="hidden sm:inline-block">
                <LogoutButton onDark />
              </span>
              <Link href="/#siparis" className={`${CTA} hidden sm:inline-flex`}>
                Yeni Sipariş
              </Link>
            </>
          ) : (
            <>
              <Link href="/giris" className={`${LINK} hidden sm:inline-block`}>
                Giriş
              </Link>
              <Link href="/#siparis" className={`${CTA} hidden sm:inline-flex`}>
                Şimdi Başla
              </Link>
            </>
          )}

          {/* ----------------------------- Mobil menü ---------------------------- */}
          <details className="group relative md:hidden">
            {/**
             * ⚠️ Dokunma hedefi 44px'in ALTINA İNDİRİLMEZ (`size-11`).
             * WCAG 2.5.8 ve iOS insan arayüzü rehberi bunu ister; küçültmek
             * başlığı "daha zarif" yapar ama menüyü ıskalanır hâle getirir.
             */}
            <summary
              className="flex size-11 cursor-pointer list-none items-center justify-center rounded-[--radius-control] text-white/80 transition-colors duration-[--duration-fast] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500 [&::-webkit-details-marker]:hidden"
              aria-label="Menü"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden
              >
                {/* Açıkken çizgiler X'e dönüşür — durum her zaman okunabilir */}
                <path
                  d="M4 7h16"
                  className="origin-center transition-transform duration-[--duration-base] ease-[--ease-out-soft] group-open:translate-y-[5px] group-open:rotate-45"
                />
                <path
                  d="M4 12h16"
                  className="transition-opacity duration-[--duration-fast] group-open:opacity-0"
                />
                <path
                  d="M4 17h16"
                  className="origin-center transition-transform duration-[--duration-base] ease-[--ease-out-soft] group-open:-translate-y-[5px] group-open:-rotate-45"
                />
              </svg>
            </summary>

            <nav
              aria-label="Mobil menü"
              className="animate-in absolute right-0 top-full z-50 mt-2 w-[min(17rem,calc(100vw-2.5rem))] overflow-hidden rounded-[--radius-card] border border-white/10 bg-ink-975 p-2 shadow-[--shadow-drawer]"
            >
              {/* Altın hairline — markanın tek görsel imzası */}
              <span
                className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-500/70 to-transparent"
                aria-hidden
              />
              {NAV.map((l) => (
                <Link key={l.href} href={l.href} className={MOBILE_LINK}>
                  {l.label}
                </Link>
              ))}
              <div className="my-1.5 h-px bg-white/10" />
              {user ? (
                <>
                  <Link href="/hesabim" className={MOBILE_LINK}>
                    Siparişlerim
                  </Link>
                  <LogoutButton onDark />
                </>
              ) : (
                <Link href="/giris" className={MOBILE_LINK}>
                  Giriş yap
                </Link>
              )}
              <Link href="/#siparis" className={`${CTA} mt-2 h-11 w-full`}>
                {user ? 'Yeni Sipariş' : 'Şimdi Başla'}
              </Link>
            </nav>
          </details>
        </div>
      </div>

      {/* Başlığı sayfadan ayıran altın hairline — kenarlık yerine ışık çizgisi */}
      <span
        className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold-500/45 to-transparent"
        aria-hidden
      />
    </header>
  )
}
