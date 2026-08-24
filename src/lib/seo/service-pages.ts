/**
 * ⭐ HİZMET AÇILIŞ SAYFALARI — SLUG VE EDİTORYAL METİN
 *
 * Sihirbaz derin bağlantıları (`/?p=instagram&s=takipci`) ana sayfaya
 * canonical'lanır; bu doğru bir karardı ama sonucu şuydu: 22 hizmetin
 * hiçbirinin arama motoruna sunulacak KENDİ sayfası yoktu. Bu modül o
 * sayfaların adresini ve içeriğini tanımlar.
 *
 * ⚠️ EN BÜYÜK RİSK: KAPI SAYFASI (doorway / thin content).
 *
 * Aynı şablona yalnızca katalog verisi doldurup 22 sayfa üretmek, Google'ın
 * "doorway pages" olarak adlandırdığı ve CEZALANDIRDIĞI şeydir. Sayfaların
 * birbirinden GERÇEKTEN farklı, insan tarafından yazılmış bir bölümü olmak
 * zorundadır.
 *
 * Bu yüzden buradaki kural sert: **editoryal metni olmayan hizmetin sayfası
 * `noindex` alır ve sitemap'e GİRMEZ.** Sayfa çalışır, kullanıcı gezebilir,
 * ama metni yazılana kadar Google'a "bunu indeksle" denmez. Böylece sistem
 * kendi kendini sınırlar: içerik üretmeden indeks şişirmek mümkün değildir.
 */

export interface ServiceCopy {
  /** Sayfanın H1'i — arama niyetiyle birebir örtüşmeli. */
  heading: string
  /** `<title>` — 60 karakteri aşmamalı. */
  title: string
  /** `<meta name="description">` — 150-160 karakter. */
  description: string
  /**
   * Sayfanın ÖZGÜN gövdesi. Her paragraf o hizmete özeldir; şablon
   * doldurma DEĞİLDİR. Buradaki metin sayfanın indekslenme hakkıdır.
   */
  body: string[]
  /** Bu hizmete ÖZGÜ sorular — genel SSS `/yardim`'da durur. */
  faq: Array<{ q: string; a: string }>
}

/** `platform.slug` + `service.slug` → sayfa adresi parçası. */
export function serviceSlug(platformSlug: string, serviceSlug: string): string {
  return `${platformSlug}-${serviceSlug}`
}

/** Adresi tekrar (platform, hizmet) ikilisine çözer. */
export function parseServiceSlug(
  slug: string,
  platforms: ReadonlyArray<{ slug: string; services: ReadonlyArray<{ slug: string }> }>,
): { platformSlug: string; serviceSlug: string } | null {
  for (const p of platforms) {
    for (const s of p.services) {
      if (serviceSlug(p.slug, s.slug) === slug) {
        return { platformSlug: p.slug, serviceSlug: s.slug }
      }
    }
  }
  return null
}

/**
 * ⚠️ ELLE YAZILMIŞ METİNLER. Katalogdan türetilmez, türetilemez.
 *
 * Anahtar: `${platformSlug}-${serviceSlug}`. Listede olmayan hizmetin
 * sayfası açılır ama `noindex` olur — bkz. `isIndexable`.
 */
export const SERVICE_COPY: Readonly<Record<string, ServiceCopy>> = {
  'instagram-takipci': {
    heading: 'Instagram Takipçi Satın Al',
    title: 'Instagram Takipçi Satın Al — Gerçek Kullanıcılar',
    description:
      'Instagram takipçi hizmeti: işlemler gerçek kişilerin hesaplarıyla, elle yürütülür. '
      + 'Türk ve yabancı seçenekleri, KDV dahil net fiyat, 500 adetten itibaren serbest miktar.',
    body: [
      'Takipçi hizmetinde hedef, profilinizin takipçi sayısını artırmaktır. İşlemi yapan '
        + 'hesaplar gerçek kişilerin oluşturduğu hesaplardır; sistemimiz Instagram hesabınıza '
        + 'hiçbir otomatik istek göndermez, hesabınızın şifresini istemez ve hesabınıza '
        + 'erişmez. Bizden istenen tek şey herkese açık kullanıcı adınızdır.',
      'İki seçenek sunuyoruz. Türk takipçi, hedef kitlesi Türkiye olan hesaplar için '
        + 'anlamlıdır: gelen hesaplar Türkçe içerik üreten gerçek kişilerdir. Yabancı takipçi '
        + 'ise sayı odaklı hedeflerde tercih edilir ve birim fiyatı belirgin biçimde düşüktür. '
        + 'Hangisinin size uyduğundan emin değilseniz, hesabınızın mevcut takipçi profiline '
        + 'bakmanız yeterli: sonradan gelen kitle mevcut kitlenizle uyumsuzsa etkileşim '
        + 'oranınız düşer.',
      'Miktarı 500 ile 1.000.000 arasında serbestçe belirleyebilirsiniz; birim fiyat miktar '
        + 'arttıkça kademeli olarak düşer. Sipariş vermeden önce profilinizin herkese açık '
        + 'olduğundan emin olun — gizli hesaplara işlem yapılamaz.',
    ],
    faq: [
      {
        q: 'Takipçi düşüşü olur mu?',
        a: 'Düşüş oranı %1–%5 aralığındadır. Yabancı takipçi paketlerinde profiliniz her gün '
          + 'takip edilir ve yaşanan düşüş aynı gün yeniden yüklenir; bu telafi 365 gün boyunca geçerlidir.',
      },
      {
        q: 'Hesabımın şifresini vermem gerekir mi?',
        a: 'Hayır. Hiçbir hizmet için şifre istemiyoruz. Yalnızca herkese açık kullanıcı adınız '
          + 'yeterlidir. Sizden şifre isteyen bir mesaj alırsanız bu bizden gelmemiştir.',
      },
      {
        q: 'Gizli hesaba takipçi gönderilebilir mi?',
        a: 'Hayır. İşlemin yapılabilmesi için hesabınızın herkese açık olması gerekir. '
          + 'Sipariş sırasında hedefinizi doğrulamanız istenir.',
      },
    ],
  },

  'instagram-begeni': {
    heading: 'Instagram Beğeni Satın Al',
    title: 'Instagram Beğeni Satın Al — Türk Hesaplardan',
    description:
      'Instagram gönderi beğenisi: Türk hesaplardan, gerçek kişiler tarafından. '
      + 'Gönderi bağlantısını girin, miktarı seçin, KDV dahil net fiyatı anında görün.',
    body: [
      'Beğeni hizmeti tek bir gönderiye uygulanır: profilinizin tamamına değil, seçtiğiniz '
        + 'gönderi bağlantısına. Bu yüzden sipariş sırasında kullanıcı adınızı değil, '
        + 'gönderinin adresini girersiniz.',
      'Beğeniler Türk hesaplardan gelir. Yeni paylaşımın ilk saatlerinde gelen etkileşim, '
        + 'gönderinin kendi takipçilerinize gösterilme sırasını etkilediği için beğeni '
        + 'siparişini paylaşımdan hemen sonra vermek genelde daha anlamlıdır.',
      'Gönderinin herkese açık olması ve sipariş tamamlanana kadar silinmemesi gerekir. '
        + 'Arşive alınan veya gizlenen gönderilerde işlem yarıda kalır.',
    ],
    faq: [
      {
        q: 'Beğeniyi hangi gönderiye alacağımı nasıl belirtirim?',
        a: 'Gönderinin tarayıcıdaki tam adresini yapıştırmanız yeterli — örneğin '
          + 'instagram.com/p/… veya instagram.com/reel/… biçiminde.',
      },
      {
        q: 'Birden fazla gönderiye beğeni alabilir miyim?',
        a: 'Evet, ancak her gönderi için ayrı sipariş vermeniz gerekir; hizmet gönderi bazlıdır.',
      },
      {
        q: 'Gönderiyi sildiğimde ne olur?',
        a: 'İşlem tamamlanmadan gönderi silinir veya gizlenirse teslim edilemez. '
          + 'Bu durumda sipariş kaydınız üzerinden bizimle iletişime geçin.',
      },
    ],
  },

  'instagram-goruntulenme': {
    heading: 'Instagram Görüntülenme Satın Al',
    title: 'Instagram Görüntülenme Satın Al — Reel ve Video',
    description:
      'Instagram reel ve video görüntülenme hizmeti. 1.000 adetten başlar, '
      + 'birim maliyeti en düşük hizmettir. KDV dahil net fiyat, adım adım sipariş takibi.',
    body: [
      'Görüntülenme hizmeti video ve reel içeriklerine uygulanır. Birim maliyeti '
        + 'katalogdaki en düşük hizmettir; bu yüzden minimum sipariş miktarı da diğer '
        + 'hizmetlere göre yüksektir (1.000 adet).',
      'Görüntülenme sayısı, bir içeriğin ne kadar yayıldığının en görünür göstergesidir ve '
        + 'profilinize ilk kez gelen birinin içeriğe verdiği ilk tepkiyi etkiler. Beğeni ve '
        + 'yorumdan farklı olarak görüntülenme, izleyicinin hesabıyla ilişkilendirilmez.',
      'Sipariş için video ya da reel bağlantısını girmeniz yeterlidir. İçeriğin herkese açık '
        + 'olması gerekir.',
    ],
    faq: [
      {
        q: 'Reel ve normal video arasında fark var mı?',
        a: 'Hayır, ikisi de aynı hizmet kapsamındadır. Bağlantıyı yapıştırmanız yeterli.',
      },
      {
        q: 'Görüntülenme sayısı ne kadar sürede artar?',
        a: 'Tahmini başlangıç süresi sipariş özetinde gösterilir. Süreç başladıktan sonra '
          + 'ilerlemeyi sipariş takip sayfasından adım adım izleyebilirsiniz.',
      },
    ],
  },

  'instagram-yorum': {
    heading: 'Instagram Yorum Satın Al',
    title: 'Instagram Yorum Satın Al — Türk Hesaplardan',
    description:
      'Instagram gönderi yorumu: Türk hesaplardan, gerçek kişiler tarafından yazılır. '
      + '10 adetten itibaren sipariş verebilirsiniz. KDV dahil net fiyat.',
    body: [
      'Yorum, katalogdaki hizmetler içinde birim fiyatı en yüksek olanıdır ve bunun somut bir '
        + 'sebebi vardır: yorum sayılamaz bir iş değil, yazılan bir metindir. Her yorumu gerçek '
        + 'bir kişi yazar, bu yüzden hizmet elle ve yavaş ilerler.',
      'Minimum sipariş 10 yorumdur. Yorumların içeriğiyle ilgili özel bir isteğiniz varsa '
        + 'sipariş sonrası bizimle iletişime geçin; genel yorumlar dışında yönlendirme '
        + 'yapılabilir.',
      'Sipariş verebilmeniz için gönderinin herkese açık olması ve yorumlara kapatılmamış '
        + 'olması gerekir. Instagram\'ın yorum filtresi belirli kelimeleri engelliyorsa yazılan '
        + 'yorumların bir kısmı size görünmeyebilir; bu durumda gönderi ayarlarınızdaki filtreyi '
        + 'geçici olarak kapatmanız yeterlidir.',
    ],
    faq: [
      {
        q: 'Yorumların içeriğini ben belirleyebilir miyim?',
        a: 'Sipariş sonrası bizimle iletişime geçerek yönlendirme yapabilirsiniz. '
          + 'Varsayılan olarak gönderiyle uyumlu genel yorumlar yazılır.',
      },
      {
        q: 'Yorumlar neden diğer hizmetlerden pahalı?',
        a: 'Yorum sayılabilir bir işlem değil, yazılan bir metindir. Her yorumu gerçek bir kişi '
          + 'yazdığı için harcanan emek diğer hizmetlerin çok üzerindedir.',
      },
    ],
  },
}

/**
 * ⚠️ İNDEKSLENME HAKKI EDİTORYAL METNE BAĞLIDIR.
 *
 * Metni olmayan hizmetin sayfası açılır (kullanıcı sihirbazdan gelebilir)
 * ama `noindex` alır ve sitemap'e girmez. Bu, 22 şablon sayfayı Google'a
 * "içerik" diye sunmayı yapısal olarak imkânsız kılar.
 */
export function isIndexable(slug: string): boolean {
  return slug in SERVICE_COPY
}

export function copyFor(slug: string): ServiceCopy | null {
  return SERVICE_COPY[slug] ?? null
}

/** Sitemap'e girecek hizmet sayfası adresleri. */
export function indexableServiceSlugs(
  platforms: ReadonlyArray<{ slug: string; services: ReadonlyArray<{ slug: string }> }>,
): string[] {
  const out: string[] = []
  for (const p of platforms) {
    for (const s of p.services) {
      const slug = serviceSlug(p.slug, s.slug)
      if (isIndexable(slug)) out.push(slug)
    }
  }
  return out
}
