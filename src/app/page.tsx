import { OrderWizard } from '@/components/wizard/OrderWizard'
import { getSessionUser } from '@/server/auth'
import { getCatalog } from '@/server/catalog'

/**
 * ANA SAYFA = SİPARİŞ SİHİRBAZI
 *
 * Sihirbaz bu sayfanın İÇİNDE yaşar. Kullanıcı sipariş tamamlanana kadar
 * `/` adresinden ayrılmaz — ayrı bir /siparis route'u YOKTUR.
 *
 * Katalog sunucuda tek seferde okunur ve istemciye gömülür; platform → hizmet →
 * varyant geçişlerinde ağ isteği olmaz.
 */
export default async function HomePage() {
  const [catalog, user] = await Promise.all([getCatalog(), getSessionUser()])
  const platformCount = catalog.platforms.length
  const serviceCount = catalog.platforms.reduce((n, p) => n + p.services.length, 0)

  return (
    <>
      <section className="mx-auto max-w-6xl px-5 pt-16 pb-12 sm:pt-24 sm:pb-16">
        <div className="flex flex-col gap-6">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-ink-200 bg-white px-3.5 py-1.5 text-caption font-medium text-ink-600">
            <span className="size-1.5 rounded-full bg-success-600" aria-hidden />
            Gerçek kullanıcılar · Bot ve sahte hesap yok
          </span>

          <h1 className="max-w-3xl text-balance text-h1 text-ink-900 sm:text-display">
            Social Media Growth, Simplified.
          </h1>

          <p className="max-w-xl text-pretty text-lg leading-relaxed text-ink-600">
            Gerçek kullanıcılarla sosyal medya hesabınızı büyütmek için profesyonel tanıtım
            hizmetleri. Hedefinizi seçin, fiyatı anında görün, siparişinizi adım adım takip edin.
          </p>

          {/* SAHTE SOSYAL KANIT YOK.
              Bu sayılar katalogdan TÜRETİLİR — "10.000+ müşteri" gibi
              doğrulanamayan iddialar bilinçli olarak kullanılmaz.
              Gerçek sipariş verisi oluştuğunda gerçek sosyal kanıt eklenebilir. */}
          <dl className="mt-2 flex flex-wrap gap-x-10 gap-y-4">
            <Stat value={String(platformCount)} label="Platform" />
            <Stat value={String(serviceCount)} label="Hizmet" />
            <Stat value="KDV dahil" label="Tüm fiyatlar" />
          </dl>
        </div>
      </section>

      <section aria-label="Sipariş oluştur">
        <OrderWizard catalog={catalog} sessionEmail={user?.email ?? null} />
      </section>

      <section className="border-t border-ink-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:grid-cols-3">
          <Trust
            title="Gerçek kullanıcılar"
            body="Tüm hizmetler gerçek kişiler tarafından manuel olarak gerçekleştirilir. Bot, sahte hesap veya otomatik etkileşim sistemi kullanılmaz."
          />
          <Trust
            title="Şeffaf fiyatlandırma"
            body="Gördüğünüz fiyat ödediğiniz fiyattır. Tüm tutarlar KDV dahildir; ödeme adımında sürpriz ekleme yapılmaz."
          />
          <Trust
            title="Uçtan uca takip"
            body="Hesap açmadan da sipariş numaranız ve e-postanızla siparişinizin her adımını izleyebilirsiniz."
          />
        </div>
      </section>
    </>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd className="text-h2 leading-none text-ink-900">{value}</dd>
      <dd className="mt-1 text-caption text-ink-500">{label}</dd>
    </div>
  )
}

function Trust({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="text-h3 text-ink-900">{title}</h2>
      <p className="mt-2 text-small leading-relaxed text-ink-600">{body}</p>
    </div>
  )
}
