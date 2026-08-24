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
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ⚠️⚠️ İKİNCİ KURAL: **KATALOĞUN SAHİP OLDUĞU SAYI BURAYA YAZILMAZ.**
 *
 * Minimum/maksimum miktar, fiyat, garanti günü, paket içeriği ve düşüş
 * oranı KATALOGDA yaşar ve sayfada zaten katalogdan basılır (başlıktaki
 * "Minimum sipariş …", fiyat tablosu, varyant açıklaması, paket rozetleri).
 * Aynı sayıyı bir de buraya yazmak, iki ayrı gerçek kaynağı olması demektir
 * ve ikisi er geç ayrışır.
 *
 * Bu teorik bir endişe değil: `/yardim` sayfasındaki "ara miktar seçilemez,
 * hazır paketlerden birini seçin" cevabı, serbest miktar slider'ı geldiği
 * gün YANLIŞA DÖNDÜ ve haftalarca öyle kaldı. Hiçbir test kırılmadı, hiçbir
 * hata düşmedi — sayfa sadece yalan söylemeye başladı.
 *
 * Bu yüzden metinlerde sayı yerine İLİŞKİ anlatılır: "minimum sipariş
 * miktarı diğer hizmetlere göre yüksektir", "birim fiyatı katalogdaki en
 * yüksek olandır". Sayının kendisi sayfanın gösterdiği yerden okunur.
 * `tests/unit/seo-service-pages.test.ts` bunu tarayıp kilitler.
 *
 * ⚠️ ÜÇÜNCÜ KURAL: **VAAT ETMEDİĞİMİZ ŞEYİ YAZMA.** Telafi garantisi
 * yalnızca katalogda `refillDays` tanımlı hizmetlerde vardır. "Düşerse
 * yeniden yükleriz" cümlesini garanti tanımlı OLMAYAN bir hizmete yazmak,
 * müşteriye satmadığımız bir şeyi satmaktır.
 */

export interface ServiceCopy {
  /** Sayfanın H1'i — arama niyetiyle birebir örtüşmeli. */
  heading: string
  /** `<title>` — şablon " · Medya 333" eklediği için 48 karakteri aşmamalı. */
  title: string
  /** `<meta name="description">` — 120-170 karakter. */
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
  // ══════════════════════════════════════════════════════════════════════
  // INSTAGRAM
  // ══════════════════════════════════════════════════════════════════════

  'instagram-takipci': {
    heading: 'Instagram Takipçi Satın Al',
    title: 'Instagram Takipçi Satın Al — Gerçek Kullanıcılar',
    description:
      'Instagram takipçi hizmeti: işlemler gerçek kişilerin hesaplarıyla, elle yürütülür. '
      + 'Türk ve yabancı seçenekleri, KDV dahil net fiyat, serbest miktar seçimi.',
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
      'Miktarı alt ve üst sınır arasında serbestçe belirleyebilirsiniz; birim fiyat miktar '
        + 'arttıkça kademeli olarak düşer ve seçtiğiniz anda net tutarı görürsünüz. Sipariş '
        + 'vermeden önce profilinizin herkese açık olduğundan emin olun — gizli hesaplara '
        + 'işlem yapılamaz.',
    ],
    faq: [
      {
        q: 'Takipçi düşüşü olur mu?',
        a: 'Bir miktar düşüş her hesapta olağandır. Bu hizmette profiliniz düzenli olarak '
          + 'takip edilir ve yaşanan düşüş telafi edilir; geçerli oran ve süre, fiyat '
          + 'tablosundaki paket açıklamasında ve hizmet detaylarında yazılıdır.',
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
      'Instagram reel ve video görüntülenme hizmeti. Birim maliyeti en düşük hizmettir; '
      + 'KDV dahil net fiyat ve adım adım sipariş takibi ile.',
    body: [
      'Görüntülenme hizmeti video ve reel içeriklerine uygulanır. Birim maliyeti '
        + 'katalogdaki en düşük hizmettir; bu yüzden minimum sipariş miktarı da diğer '
        + 'hizmetlere göre belirgin biçimde yüksektir.',
      'Görüntülenme sayısı, bir içeriğin ne kadar yayıldığının en görünür göstergesidir ve '
        + 'profilinize ilk kez gelen birinin içeriğe verdiği ilk tepkiyi etkiler. Beğeni ve '
        + 'yorumdan farklı olarak görüntülenme, izleyicinin hesabıyla ilişkilendirilmez; '
        + 'yani kimin izlediği görünmez.',
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
        a: 'Tahmini başlangıç süresi hizmet detaylarında ve sipariş özetinde gösterilir. '
          + 'Süreç başladıktan sonra ilerlemeyi sipariş takip sayfasından adım adım '
          + 'izleyebilirsiniz.',
      },
      {
        q: 'Fotoğraf gönderisine görüntülenme alabilir miyim?',
        a: 'Hayır. Instagram görüntülenmeyi yalnızca video ve reel içeriklerinde sayar; '
          + 'karesel fotoğraf gönderilerinde böyle bir sayaç yoktur. O gönderiler için '
          + 'beğeni veya yorum hizmetine bakabilirsiniz.',
      },
    ],
  },

  'instagram-yorum': {
    heading: 'Instagram Yorum Satın Al',
    title: 'Instagram Yorum Satın Al — Türk Hesaplardan',
    description:
      'Instagram gönderi yorumu: Türk hesaplardan, gerçek kişiler tarafından yazılır. '
      + 'Düşük miktarlardan itibaren sipariş verebilirsiniz. KDV dahil net fiyat.',
    body: [
      'Yorum, katalogdaki hizmetler içinde birim fiyatı en yüksek olanıdır ve bunun somut bir '
        + 'sebebi vardır: yorum sayılabilir bir iş değil, yazılan bir metindir. Her yorumu '
        + 'gerçek bir kişi yazar, bu yüzden hizmet elle ve yavaş ilerler.',
      'Buna karşılık en küçük sipariş miktarı da düşüktür; sayı değil, gönderinin altındaki '
        + 'konuşmanın canlı görünmesi amaçlandığı için az sayıda yorum çoğu zaman yeterlidir. '
        + 'Yorumların içeriğiyle ilgili özel bir isteğiniz varsa sipariş sonrası bizimle '
        + 'iletişime geçin; genel yorumlar dışında yönlendirme yapılabilir.',
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
      {
        q: 'Yorumları sonradan silebilir miyim?',
        a: 'Evet. Gelen yorumlar sizin gönderinizde durur; beğenmediğiniz birini Instagram '
          + 'üzerinden istediğiniz zaman silebilirsiniz. Silinen yorum yeniden yazılmaz.',
      },
    ],
  },

  'instagram-kaydetme': {
    heading: 'Instagram Kaydetme Satın Al',
    title: 'Instagram Kaydetme Satın Al — Gönderi Kaydı',
    description:
      'Instagram gönderi kaydetme hizmeti. Kaydetme, kullanıcının içeriği sonra dönmek üzere '
      + 'sakladığı sinyaldir. Gerçek kişilerce yapılır, KDV dahil net fiyat.',
    body: [
      'Kaydetme, bir kullanıcının gönderinizi kendi koleksiyonuna eklemesidir. Beğeniden '
        + 'farklı olarak herkese açık bir sayaç değildir: kaç kişinin kaydettiğini yalnızca '
        + 'gönderi sahibi, kendi içerik istatistiklerinde görür.',
      'Bu yüzden kaydetme bir gösteriş metriği değildir; işe yaradığı yer başkadır. Tarif, '
        + 'rehber, liste, fiyat listesi, etkinlik duyurusu gibi "sonra lazım olacak" içeriklerde '
        + 'kaydedilme oranı, içeriğin gerçekten değerli bulunduğunun en güçlü göstergesidir. '
        + 'Kendi istatistiklerinizde hangi gönderilerin kaydedildiğini takip etmek, ne tür '
        + 'içerik üretmeniz gerektiğini beğeni sayısından daha net söyler.',
      'Hizmet gönderi bazlıdır ve gönderinin herkese açık olması gerekir. Sipariş sırasında '
        + 'gönderinin adresini girersiniz.',
    ],
    faq: [
      {
        q: 'Kaydetme sayısını nereden görebilirim?',
        a: 'Gönderinizin altındaki "İstatistikleri gör" bağlantısından. Kaydetme sayısı '
          + 'gönderide herkese açık olarak görünmez; yalnızca siz görürsünüz.',
      },
      {
        q: 'Kaydetme mi beğeni mi almalıyım?',
        a: 'İkisi farklı işe yarar. Beğeni gönderinin altında herkese görünür ve sosyal kanıt '
          + 'oluşturur; kaydetme görünmez ama içeriğin değerli bulunduğunu gösterir. Bilgi '
          + 'veren içeriklerde kaydetme, gösterime dayalı içeriklerde beğeni daha anlamlıdır.',
      },
      {
        q: 'Bu hizmette telafi garantisi var mı?',
        a: 'Bu hizmet için garanti tanımlı değildir; garanti kapsamındaki hizmetlerde süre '
          + 'hizmet detaylarında açıkça yazar. Garantisi olmayan bir hizmette böyle bir '
          + 'rozet göstermiyoruz.',
      },
    ],
  },

  'instagram-paylasim': {
    heading: 'Instagram Paylaşım Satın Al',
    title: 'Instagram Paylaşım Satın Al — Gönderi Paylaşımı',
    description:
      'Instagram gönderi paylaşım hizmeti: gönderiniz gerçek kullanıcılar tarafından '
      + 'paylaşılır. Gönderi bağlantısını girin, KDV dahil net fiyatı anında görün.',
    body: [
      'Paylaşım, bir kullanıcının gönderinizi kendi hikâyesine veya bir başkasına iletmesidir. '
        + 'Beğeni ve yorumdan farkı şudur: beğeni gönderinin altında kalır, paylaşım ise '
        + 'gönderiyi sizin takipçi çemberinizin DIŞINA taşır.',
      'Bu yüzden paylaşım, yeni kitleye ulaşmayı hedefleyen içeriklerde anlamlıdır — duyuru, '
        + 'kampanya, etkinlik çağrısı gibi yayılması istenen gönderiler. Yalnızca mevcut '
        + 'takipçilerinize seslenen rutin bir paylaşımda ise katkısı sınırlı kalır.',
      'Hizmet gönderi bazlıdır. Gönderinin herkese açık olması ve paylaşıma kapatılmamış '
        + 'olması gerekir; hesap ayarlarınızda hikâyede yeniden paylaşıma izin verilmiyorsa '
        + 'işlem yapılamaz.',
    ],
    faq: [
      {
        q: 'Paylaşım sayısını kim görebilir?',
        a: 'Kaydetmede olduğu gibi, paylaşım sayısı da gönderinin altında herkese açık '
          + 'görünmez. Kendi gönderi istatistiklerinizde görürsünüz.',
      },
      {
        q: 'Gönderim hikâyelerde mi paylaşılacak?',
        a: 'Paylaşım, gönderinin başka kullanıcılara iletilmesi veya hikâyede yeniden '
          + 'paylaşılması şeklinde gerçekleşir. Hesap ayarlarınızda hikâyede yeniden '
          + 'paylaşıma izin verilmiş olması gerekir.',
      },
    ],
  },

  'instagram-kesfet-paketi': {
    heading: 'Instagram Keşfet Paketi',
    title: 'Instagram Keşfet Paketi — Karma Etkileşim',
    description:
      'Tek bir gönderi için hazırlanmış karma etkileşim paketi: beğeni, yorum, görüntülenme, '
      + 'kaydetme ve paylaşım tek siparişte. Paket içeriği fiyat tablosunda yazılıdır.',
    body: [
      'Keşfet paketi, tek tek sipariş vermek yerine bir gönderiye beğeni, yorum, görüntülenme, '
        + 'kaydetme ve paylaşımı birlikte getiren hazır bir bileşimdir. Paketin içinde tam '
        + 'olarak neyin ne kadar olduğu aşağıdaki fiyat tablosunda madde madde yazılıdır.',
      'Bileşimin sebebi şudur: bir gönderiye yalnızca beğeni gelmesi, geri kalan hiçbir '
        + 'metriğin kıpırdamaması anlamına gelir ve bu dengesiz bir tabloya yol açar. Karma '
        + 'paket, gönderinin bütün etkileşim türlerinde aynı anda hareket etmesini sağlar.',
      'Paket tek bir gönderi içindir ve miktarı ayarlanamaz; hazır bileşimlerden birini '
        + 'seçersiniz. Farklı gönderiler için ayrı sipariş vermeniz gerekir. Adı "keşfet" '
        + 'olsa da bu bir yerleştirme vaadi değildir: Instagram\'ın keşfet sıralaması bizim '
        + 'kontrolümüzde olan bir şey değildir ve kimse böyle bir garanti veremez.',
    ],
    faq: [
      {
        q: 'Gönderim keşfete çıkacak mı?',
        a: 'Bunu kimse garanti edemez, biz de etmiyoruz. Keşfet sıralamasına Instagram karar '
          + 'verir ve kararını nasıl verdiğini açıklamaz. Bu paket gönderinin etkileşim '
          + 'tablosunu dengeli biçimde hareketlendirir; ötesi bir vaat değildir.',
      },
      {
        q: 'Paketteki miktarları değiştirebilir miyim?',
        a: 'Hayır. Paket hazır bir bileşimdir; içerikleri fiyat tablosunda yazdığı gibidir. '
          + 'Farklı miktarlar istiyorsanız hizmetleri tek tek sipariş edebilirsiniz.',
      },
      {
        q: 'Aynı paketi birden fazla gönderiye alabilir miyim?',
        a: 'Evet, ancak her gönderi için ayrı sipariş vermeniz gerekir. Paket tek gönderi '
          + 'için hazırlanmıştır.',
      },
    ],
  },

  'instagram-aylik-begeni-yorum-paketi': {
    heading: 'Instagram Aylık Beğeni + Yorum Paketi',
    title: 'Instagram Aylık Beğeni ve Yorum Paketi',
    description:
      'Bir kez ödeyin, bir ay boyunca her yeni paylaşımınıza beğeni, yorum ve görüntülenme '
      + 'gelsin. Paket içerikleri ve paylaşım hakkı fiyat tablosunda yazılıdır.',
    body: [
      'Bu paket tek tek sipariş vermeyi ortadan kaldırır. Bir kez ödersiniz; abonelik '
        + 'süresince yaptığınız her yeni paylaşıma, seçtiğiniz pakette belirtilen miktarlarda '
        + 'beğeni, yorum ve görüntülenme gelir. Her gönderi için yeniden sipariş açmanız '
        + 'gerekmez.',
      'Düzenli paylaşım yapan hesaplar için tasarlandı. Ayda birkaç gönderi paylaşan biri '
        + 'için tek tek sipariş daha hesaplıdır; sık paylaşan bir hesapta ise paket hem '
        + 'maliyeti hem de her seferinde sipariş açma zahmetini düşürür. Paket başına '
        + 'kaç paylaşım hakkınız olduğu ve her paylaşıma ne geleceği fiyat tablosundaki '
        + 'rozetlerde madde madde yazılıdır.',
      'Paket profil bazlıdır; sipariş sırasında gönderi adresi değil kullanıcı adınızı '
        + 'girersiniz. Profilinizin abonelik boyunca herkese açık kalması gerekir — gizlenen '
        + 'bir hesapta yeni paylaşımlar görülemez ve işlem yapılamaz.',
    ],
    faq: [
      {
        q: 'Her paylaşımım için ayrı sipariş vermem gerekecek mi?',
        a: 'Hayır. Paketin amacı tam olarak budur: bir kez ödersiniz, süre boyunca yaptığınız '
          + 'paylaşımlar pakette yazan haklar kapsamında işlenir.',
      },
      {
        q: 'Paylaşım hakkımı doldurmazsam ne olur?',
        a: 'Kullanılmayan hak bir sonraki aya devretmez. Paket, süre boyunca yaptığınız '
          + 'paylaşımları kapsar; hiç paylaşım yapmazsanız işlenecek bir gönderi olmaz.',
      },
      {
        q: 'Otomatik olarak yenilenir mi?',
        a: 'Hayır. Otomatik yenileme ve kayıtlı kart üzerinden tekrar tahsilat yapılmaz. '
          + 'Süre dolduğunda devam etmek isterseniz yeni bir sipariş verirsiniz.',
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════
  // TIKTOK
  // ══════════════════════════════════════════════════════════════════════

  'tiktok-takipci': {
    heading: 'TikTok Takipçi Satın Al',
    title: 'TikTok Takipçi Satın Al — Gerçek Kullanıcılar',
    description:
      'TikTok takipçi hizmeti: işlemler gerçek kişilerin hesaplarıyla yürütülür, şifre '
      + 'istenmez. Kullanıcı adınızı girin, miktarı seçin, KDV dahil net fiyatı görün.',
    body: [
      'TikTok takipçi hizmeti profil bazlıdır: sipariş sırasında bir video adresi değil, '
        + 'kullanıcı adınızı girersiniz. Hesabınızın herkese açık olması gerekir; gizli '
        + 'hesaplarda takip isteği onay beklediği için işlem tamamlanamaz.',
      'TikTok\'ta takipçi sayısının ağırlığı Instagram\'dakinden farklıdır. İçeriğin kime '
        + 'gösterileceğine büyük ölçüde "Sizin İçin" akışı karar verir ve bu akış takipçi '
        + 'sayısından çok videonun izlenme davranışına bakar. Yani takipçi sayısı burada '
        + 'erişimin motoru değil, profile gelen kişinin gördüğü güven işaretidir: sayfanıza '
        + 'düşen biri sizi takip etmeye değer bulup bulmayacağına bakarken ona bakar.',
      'Bu hizmette yabancı takipçi seçeneği sunuluyor. Türkiye odaklı bir kitle hedefliyorsanız '
        + 'içeriğinizin dilinin ve konusunun kitleyi zaten filtrelediğini unutmayın; takipçi '
        + 'sayısı ile izlenme oranı arasındaki denge, yalnız sayıyı büyütmekten daha önemlidir.',
    ],
    faq: [
      {
        q: 'TikTok kullanıcı adımı nereden bulurum?',
        a: 'Profilinizde @ işaretiyle başlayan addır. Sipariş sırasında yalnızca bu ad '
          + 'yeterlidir; şifrenizi istemiyoruz.',
      },
      {
        q: 'Bu hizmette Türk takipçi var mı?',
        a: 'Bu hizmette şu anda yabancı takipçi seçeneği sunuluyor. Aktif seçenekler her zaman '
          + 'aşağıdaki fiyat tablosunda görünür; orada olmayan bir seçeneği satmıyoruz.',
      },
      {
        q: 'Bu hizmette telafi garantisi var mı?',
        a: 'Bu hizmet için garanti tanımlı değildir. Garanti kapsamındaki hizmetlerde süre '
          + 'hizmet detaylarında ve fiyat tablosundaki açıklamada açıkça yazar.',
      },
    ],
  },

  'tiktok-begeni': {
    heading: 'TikTok Beğeni Satın Al',
    title: 'TikTok Beğeni Satın Al — Türk Hesaplardan',
    description:
      'TikTok video beğenisi: Türk hesaplardan, gerçek kişiler tarafından. Video '
      + 'bağlantısını girin, miktarı seçin, KDV dahil net fiyatı anında görün.',
    body: [
      'TikTok beğenisi tek bir videoya uygulanır. Sipariş sırasında profilinizin adını değil, '
        + 'videonun bağlantısını girersiniz — uygulamada videonun sağ tarafındaki paylaş '
        + 'düğmesinden "Bağlantıyı kopyala" ile alabilirsiniz.',
      'Beğeniler Türk hesaplardan gelir. TikTok\'ta beğeni oranının izlenmeye kıyasla anlamı, '
        + 'diğer platformlardakinden büyüktür: bir video çok izlenip az beğeni alıyorsa bu, '
        + 'insanların videoyu izleyip geçtiği anlamına gelir. Beğeni sayısı izlenmeyle birlikte '
        + 'düşünüldüğünde okunabilir bir bilgidir; tek başına büyütülmüş bir beğeni sayısı, '
        + 'düşük izlenmenin yanında tuhaf durur.',
      'Videonun herkese açık olması ve sipariş tamamlanana kadar silinmemesi gerekir. Taslak '
        + 'veya "yalnızca ben" olarak ayarlanmış videolara işlem yapılamaz.',
    ],
    faq: [
      {
        q: 'Video bağlantısını nasıl alırım?',
        a: 'Videoyu açın, sağdaki ok şeklindeki paylaş düğmesine dokunun ve "Bağlantıyı '
          + 'kopyala" seçeneğini kullanın. Kopyalanan adresi sipariş adımına yapıştırmanız '
          + 'yeterlidir.',
      },
      {
        q: 'Aynı anda birden fazla videoya alabilir miyim?',
        a: 'Her video için ayrı sipariş vermeniz gerekir; hizmet video bazlıdır.',
      },
      {
        q: 'Beğeni ile izlenmeyi birlikte almalı mıyım?',
        a: 'Genelde daha tutarlı bir tablo verir. Çok beğeni ama az izlenme dengesiz görünür; '
          + 'ikisini birlikte artırmak videonun doğal akışına daha yakın durur.',
      },
    ],
  },

  'tiktok-goruntulenme': {
    heading: 'TikTok İzlenme Satın Al',
    title: 'TikTok İzlenme Satın Al — Video Görüntülenme',
    description:
      'TikTok video izlenme hizmeti. Birim maliyeti en düşük hizmettir; video bağlantısını '
      + 'girmeniz yeterli. KDV dahil net fiyat ve adım adım sipariş takibi.',
    body: [
      'İzlenme, TikTok\'ta en görünür sayıdır: videonun sol altında herkese açık olarak durur '
        + 've bir kullanıcının videoyu izlemeye değer bulup bulmayacağına karar verirken ilk '
        + 'baktığı şeydir. Birim maliyeti katalogdaki en düşük hizmet olduğu için minimum '
        + 'sipariş miktarı da diğer hizmetlere göre yüksektir.',
      'İzlenmenin diğer metriklerden önemli bir farkı vardır: kimin izlediği hiçbir yerde '
        + 'görünmez, yani izleyici listesi diye bir şey yoktur. Beğeni ve yorum hesaba '
        + 'bağlanırken izlenme yalnızca bir sayaçtır.',
      'Sipariş için videonun bağlantısını girmeniz yeterlidir; video herkese açık olmalıdır. '
        + 'Video sipariş tamamlanmadan silinirse veya gizlenirse işlem yarıda kalır.',
    ],
    faq: [
      {
        q: 'İzlenme sayısı videonun yayılmasını sağlar mı?',
        a: 'Doğrudan bir yayılma vaadi vermiyoruz; TikTok\'un "Sizin İçin" akışının neye göre '
          + 'karar verdiğini kimse dışarıdan garanti edemez. İzlenme sayısı, videoyu gören '
          + 'kişinin izlemeye değer bulup bulmayacağına dair ilk izlenimi etkiler.',
      },
      {
        q: 'İzlenme ile beğeni arasındaki oran önemli mi?',
        a: 'Görünüş açısından evet. Yüksek izlenmenin yanında çok düşük beğeni, videoyu '
          + 'izleyenlerin ilgilenmediği izlenimi verir. İkisini birlikte düşünmek daha '
          + 'tutarlı bir tablo bırakır.',
      },
    ],
  },

  'tiktok-yorum': {
    heading: 'TikTok Yorum Satın Al',
    title: 'TikTok Yorum Satın Al — Türk Hesaplardan',
    description:
      'TikTok video yorumu: Türk hesaplardan, gerçek kişiler tarafından yazılır. '
      + 'Video bağlantısını girin, miktarı seçin. KDV dahil net fiyat.',
    body: [
      'TikTok\'ta yorum bölümü, videonun kendisi kadar izlenen bir alandır; birçok kullanıcı '
        + 'videoyu izlerken yorumları açar ve orada okuduğu şey videoya bakışını değiştirir. '
        + 'Bu yüzden yorum, TikTok\'ta diğer platformlardan daha görünür bir etkidir.',
      'Yorumları gerçek kişiler yazar; bu yüzden hizmet elle ve yavaş ilerler ve birim fiyatı '
        + 'sayılabilir hizmetlerin üzerindedir. Buna karşılık en küçük sipariş miktarı '
        + 'düşüktür: yorum bölümünde amaç yığın değil, konuşmanın başlamış görünmesidir.',
      'Videonun herkese açık olması ve yorumlara kapatılmamış olması gerekir. TikTok\'un '
        + 'yorum filtresi açıksa bazı yorumlar onayınıza düşebilir; bu durumda yorum '
        + 'ayarlarınızı gözden geçirmeniz yeterlidir.',
    ],
    faq: [
      {
        q: 'Yorumların içeriğini belirleyebilir miyim?',
        a: 'Sipariş sonrası bizimle iletişime geçerek yönlendirme yapabilirsiniz. Varsayılan '
          + 'olarak videoyla uyumlu genel yorumlar yazılır.',
      },
      {
        q: 'Yorum filtrem açıksa ne olur?',
        a: 'Filtre belirli kelimeleri engelliyorsa yazılan yorumların bir kısmı doğrudan '
          + 'görünmeyip onayınıza düşebilir. Yorum ayarlarınızdan filtreyi geçici olarak '
          + 'gevşetebilirsiniz.',
      },
      {
        q: 'Yorumları silebilir miyim?',
        a: 'Evet, kendi videonuzdaki her yorumu istediğiniz zaman silebilirsiniz. Silinen '
          + 'yorum yeniden yazılmaz.',
      },
    ],
  },

  'tiktok-kaydetme': {
    heading: 'TikTok Favori (Kaydetme) Satın Al',
    title: 'TikTok Favori ve Kaydetme Satın Al',
    description:
      'TikTok videonuzun favorilere eklenme sayısını artırın. Gerçek kişilerce yapılır, '
      + 'video bağlantısını girmeniz yeterlidir. KDV dahil net fiyat.',
    body: [
      'TikTok\'ta kaydetme, videonun yer imi simgesiyle favorilere eklenmesidir. Kullanıcının '
        + 'videoyu sonra tekrar bulmak üzere sakladığı anlamına gelir ve bu sayı videonun '
        + 'sağ tarafında herkese açık olarak görünür.',
      'Kaydedilme, bilgi veren içerikte anlamlı olan metriktir: tarif, nasıl yapılır anlatımı, '
        + 'liste, öneri videosu gibi tek izlemede tüketilmeyen içeriklerde insanlar videoyu '
        + 'gerçekten saklar. Eğlence odaklı, tek seferde izlenip geçilen bir videoda ise '
        + 'kaydetme sayısının düşük kalması normaldir; oraya kaydetme almak tabloyu '
        + 'tuhaflaştırır.',
      'Hizmet video bazlıdır ve videonun herkese açık olması gerekir. Sipariş sırasında '
        + 'videonun bağlantısını girersiniz.',
    ],
    faq: [
      {
        q: 'Kaydetme sayısı videoda görünür mü?',
        a: 'Evet. Instagram\'dan farklı olarak TikTok\'ta favori sayısı videonun sağ '
          + 'tarafındaki simgenin altında herkese açık görünür.',
      },
      {
        q: 'Hangi içerikte kaydetme almalıyım?',
        a: 'İnsanların sonra dönmek isteyeceği içeriklerde: tarif, anlatım, liste, öneri. '
          + 'Tek izlemede biten eğlence içeriğinde kaydetme sayısı doğal olarak düşüktür.',
      },
    ],
  },

  'tiktok-paylasim': {
    heading: 'TikTok Paylaşım Satın Al',
    title: 'TikTok Paylaşım Satın Al — Video Paylaşımı',
    description:
      'TikTok videonuzun paylaşılma sayısını artırın. Paylaşım, videoyu takipçi çemberinizin '
      + 'dışına taşıyan etkidir. Gerçek kişilerce yapılır, KDV dahil net fiyat.',
    body: [
      'Paylaşım, bir kullanıcının videonuzu başka birine göndermesi veya başka bir mecrada '
        + 'yeniden paylaşmasıdır. Sayısı videonun sağ tarafında herkese açık görünür ve '
        + 'TikTok\'ta "bu videoyu birine göstermeye değer buldum" anlamına gelen en güçlü '
        + 'işarettir.',
      'Bu yüzden paylaşım, birine anlatılacak türden içeriklerde anlamlıdır: şaşırtan bir '
        + 'bilgi, işe yarar bir öneri, duyurulması istenen bir kampanya. Kişisel günlük '
        + 'niteliğindeki bir videoda paylaşım sayısının düşük kalması beklenen bir şeydir.',
      'Hizmet video bazlıdır. Videonun herkese açık olması ve hesap ayarlarınızda indirme '
        + 'veya paylaşımın tamamen kapatılmamış olması gerekir.',
    ],
    faq: [
      {
        q: 'Videom nerede paylaşılacak?',
        a: 'Paylaşım, videonun TikTok içinde başka kullanıcılara iletilmesi biçiminde '
          + 'gerçekleşir. Videonuz sizin adınıza başka bir platforma yeniden yüklenmez.',
      },
      {
        q: 'Paylaşımı kapattıysam ne olur?',
        a: 'Hesap veya video ayarlarınızda paylaşım tamamen kapalıysa işlem yapılamaz. '
          + 'Sipariş öncesi bu ayarı açık bıraktığınızdan emin olun.',
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════
  // YOUTUBE
  // ══════════════════════════════════════════════════════════════════════

  'youtube-abone': {
    heading: 'YouTube Abone Satın Al',
    title: 'YouTube Abone Satın Al — Türk ve Yabancı',
    description:
      'YouTube kanal abonesi: gerçek kişilerin hesaplarıyla, kademeli olarak yüklenir. '
      + 'Türk ve yabancı seçenekleri, KDV dahil net fiyat, adım adım takip.',
    body: [
      'Abone hizmeti kanal bazlıdır: sipariş sırasında bir video adresi değil, kanalınızın '
        + 'adresini girersiniz. YouTube\'da abone, diğer platformlardaki takipçinin karşılığıdır '
        + 'ama işleyişi daha yavaştır ve bilinçli olarak öyle yürütülür.',
      'İki seçenek arasındaki fark hız ve ölçektir. Türk abone daha yavaş, günlük küçük '
        + 'miktarlarla ilerler ve toplam sipariş miktarı sınırlıdır; yabancı abone ise daha '
        + 'geniş ölçekte ve daha düzenli bir tempoyla yüklenir. Her iki seçeneğin günlük '
        + 'temposu, üst sınırı ve düşüş beklentisi fiyat tablosundaki açıklamada yazılıdır.',
      'Abone sayısının YouTube\'da ayrı bir pratik anlamı vardır: kanal menüsündeki bazı '
        + 'özellikler ve topluluk sekmesi belirli eşiklerde açılır. Ancak bunun için kanalın '
        + 'YouTube İş Ortağı Programı koşullarını da karşılaması gerekir ve o koşullar '
        + 'izlenme süresi gibi başka ölçütler de içerir; yalnız abone sayısı tek başına '
        + 'yeterli değildir.',
    ],
    faq: [
      {
        q: 'Kanal adresimi nereden alırım?',
        a: 'Kanal sayfanızı tarayıcıda açıp adres çubuğundaki bağlantıyı kopyalamanız '
          + 'yeterlidir. Şifrenizi veya kanal yönetim erişimini istemiyoruz.',
      },
      {
        q: 'Aboneler neden hemen gelmiyor?',
        a: 'Abone yüklemesi kasıtlı olarak kademelidir; günlük tempo fiyat tablosundaki '
          + 'seçenek açıklamasında yazar. Bir günde toplu artış, kanal için doğal görünmeyen '
          + 'bir tablo bırakır.',
      },
      {
        q: 'Para kazanma şartlarını karşılamama yeter mi?',
        a: 'Tek başına yetmez ve böyle bir vaat vermiyoruz. YouTube İş Ortağı Programı abone '
          + 'sayısının yanında izlenme süresi gibi başka ölçütler de arar ve başvuruyu '
          + 'YouTube kendi değerlendirir.',
      },
    ],
  },

  'youtube-izlenme': {
    heading: 'YouTube İzlenme Satın Al',
    title: 'YouTube İzlenme Satın Al — Video Görüntülenme',
    description:
      'YouTube video izlenme hizmeti. Video bağlantısını girmeniz yeterli; işlemler gerçek '
      + 'kişilerce yürütülür. KDV dahil net fiyat ve adım adım sipariş takibi.',
    body: [
      'İzlenme hizmeti tek bir videoya uygulanır; sipariş sırasında kanal adresinizi değil, '
        + 'videonun bağlantısını girersiniz. Videonun herkese açık veya liste dışı değil, '
        + 'herkese açık olması gerekir.',
      'YouTube\'da izlenme sayacının bir özelliği vardır: sayı anında değil, YouTube kendi '
        + 'doğrulamasını yaptıktan sonra güncellenir ve bu yüzden sayaç zaman zaman duraklamış '
        + 'gibi görünebilir. Bu bir aksaklık değil, platformun normal davranışıdır — ilk '
        + 'saatlerde sayacın yavaş ilerlemesi beklenen bir şeydir.',
      'İzlenme sayısı bir videoya ilk kez rastlayan kişinin videoyu açıp açmama kararında en '
        + 'etkili görünür işarettir. Ancak YouTube\'un öneri sisteminin izlenme SÜRESİNE de '
        + 'baktığını unutmayın: uzun bir videoda asıl belirleyici olan, izleyicinin ne kadar '
        + 'kaldığıdır.',
    ],
    faq: [
      {
        q: 'İzlenme sayısı neden hemen artmıyor?',
        a: 'YouTube izlenmeleri kendi doğrulamasından geçirdikten sonra sayaca yansıtır; bu '
          + 'yüzden sayaç duraklamış gibi görünebilir. Platformun normal davranışıdır.',
      },
      {
        q: 'Liste dışı (unlisted) videoya alabilir miyim?',
        a: 'Hayır. Videonun herkese açık olması gerekir. Liste dışı veya özel videolara '
          + 'işlem yapılamaz.',
      },
      {
        q: 'İzlenme süresi de artar mı?',
        a: 'Bu hizmet izlenme sayısına yöneliktir; belirli bir izlenme süresi taahhüdü '
          + 'vermiyoruz. İzlenme süresi büyük ölçüde videonun kendisine bağlıdır.',
      },
    ],
  },

  'youtube-begeni': {
    heading: 'YouTube Beğeni Satın Al',
    title: 'YouTube Beğeni Satın Al — Video Beğenisi',
    description:
      'YouTube video beğenisi: gerçek kullanıcı hesaplarıyla yapılır. Video bağlantısını '
      + 'girin, miktarı seçin, KDV dahil net fiyatı anında görün.',
    body: [
      'YouTube beğenisi tek bir videoya uygulanır ve videonun altında herkese açık görünür. '
        + 'Beğenmeme sayısı ise YouTube tarafından izleyicilerden gizlenmiştir; yalnızca kanal '
        + 'sahibi kendi istatistiklerinde görür. Yani dışarıdan bakan biri için görünen tek '
        + 'oran beğeni sayısıdır.',
      'Beğeninin YouTube\'daki asıl işlevi, videonun izleyici tarafından olumlu bulunduğunu '
        + 'gösteren görünür bir işaret olmasıdır. İzlenme sayısına kıyasla makul bir beğeni '
        + 'sayısı, videoya sonradan gelen birinin içeriği izlemeye değer bulmasını '
        + 'kolaylaştırır; izlenmeye göre aşırı yüksek bir beğeni ise tersine dikkat çeker.',
      'Videonun herkese açık olması ve beğenilerin gizlenmemiş olması gerekir. Sipariş '
        + 'sırasında videonun tarayıcıdaki tam adresini girersiniz.',
    ],
    faq: [
      {
        q: 'Beğeni sayısını gizlersem ne olur?',
        a: 'Kanal ayarlarınızda beğeni sayısı gizliyse işlem yapılır ama sayı izleyicilere '
          + 'görünmez; hizmetin görünür faydası ortadan kalkar. Sipariş öncesi bu ayarı '
          + 'kontrol etmenizi öneririz.',
      },
      {
        q: 'Shorts videolarına da alabilir miyim?',
        a: 'Evet. Bağlantıyı yapıştırmanız yeterlidir; uzun video ile Shorts arasında bu '
          + 'hizmet açısından fark yoktur.',
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════
  // FACEBOOK
  // ══════════════════════════════════════════════════════════════════════

  'facebook-takipci': {
    heading: 'Facebook Sayfa Takipçi Satın Al',
    title: 'Facebook Takipçi Satın Al — Sayfa Takipçisi',
    description:
      'Facebook sayfanıza gerçek kullanıcı takipçisi. Sayfa adresini girin, miktarı seçin, '
      + 'KDV dahil net fiyatı anında görün. Şifre istenmez.',
    body: [
      'Bu hizmet Facebook sayfaları içindir; kişisel profilinizin arkadaş sayısı değil, '
        + 'sayfanızın takipçi sayısı artar. Sipariş sırasında sayfanızın adresini girersiniz '
        + 've sayfanın herkese açık, yayında olması gerekir.',
      'Facebook\'ta takipçi ile beğenen ayrımına dikkat etmek gerekir. Facebook sayfalarda bu '
        + 'iki sayacı ayırdı: bir kullanıcı sayfayı beğenmeden de takip edebiliyor ve akışta '
        + 'sayfanın gönderilerini asıl gören kitle takipçilerdir. Bu yüzden sayfanın '
        + 'erişimi açısından anlamlı olan sayı takipçi sayısıdır.',
      'Sayfanızın adresinde sayı yerine bir isim görünüyorsa (özel kullanıcı adı '
        + 'tanımlanmışsa) o adresi kullanabilirsiniz; ikisi de aynı sayfaya çıkar.',
    ],
    faq: [
      {
        q: 'Kişisel profilime arkadaş ekleniyor mu?',
        a: 'Hayır. Bu hizmet sayfa takipçisi içindir. Kişisel profilinizin arkadaş listesine '
          + 'hiçbir ekleme yapılmaz.',
      },
      {
        q: 'Takipçi mi beğeni mi artıyor?',
        a: 'Sayfanın takipçi sayısı artar. Facebook bu iki sayacı ayırdığı için, gönderilerin '
          + 'akışta görüneceği kitleyi belirleyen sayı takipçi sayısıdır.',
      },
      {
        q: 'Bu hizmette telafi garantisi var mı?',
        a: 'Bu hizmet için garanti tanımlı değildir. Garanti kapsamındaki hizmetlerde süre '
          + 'hizmet detaylarında açıkça yazar; olmayan bir garantiyi ima etmiyoruz.',
      },
    ],
  },

  'facebook-begeni': {
    heading: 'Facebook Beğeni Satın Al',
    title: 'Facebook Beğeni Satın Al — Gönderi Beğenisi',
    description:
      'Facebook gönderi beğenisi: işlemi gerçek kişiler yapar, şifre istenmez. Gönderi '
      + 'bağlantısını girin, miktarı seçin, KDV dahil net fiyatı anında görün.',
    body: [
      'Facebook beğenisi tek bir gönderiye uygulanır: sayfanızın tamamına değil, bağlantısını '
        + 'verdiğiniz paylaşıma. Sayfa gönderisi de kişisel profil gönderisi de olabilir; tek '
        + 'şart paylaşımın gizlilik ayarının "Herkese Açık" olmasıdır. Yalnızca arkadaşlarla '
        + 'paylaşılmış bir gönderiye dışarıdan erişilemez.',
      'Facebook\'un akış sıralamasının bir özelliği, bir gönderiye günler boyunca dolaşım '
        + 'şansı vermesidir; içerik paylaşıldığı gün sönmez. Bu yüzden beğeni siparişini '
        + 'paylaşımdan hemen sonra vermek zorunda değilsiniz — birkaç gün önce paylaşılmış '
        + 'bir gönderi de anlamlı bir hedeftir.',
      'Sipariş sırasında gönderinin tarayıcıdaki tam adresi gerekir. Mobil uygulamada '
        + 'paylaşımın sağ üstündeki üç nokta menüsünden "Bağlantıyı kopyala" seçeneği bu '
        + 'adresi verir.',
    ],
    faq: [
      {
        q: 'Kişisel profilimdeki gönderiye de alabilir miyim?',
        a: 'Evet. Hizmet gönderi bazlıdır; sayfa gönderisi ile kişisel profil gönderisi '
          + 'arasında fark yoktur. Gönderinin gizlilik ayarının "Herkese Açık" olması yeterlidir.',
      },
      {
        q: 'Gönderi adresini nereden bulurum?',
        a: 'Masaüstünde gönderinin tarih satırına tıkladığınızda adres çubuğunda tam bağlantı '
          + 'görünür. Mobilde üç nokta menüsünden "Bağlantıyı kopyala" diyebilirsiniz.',
      },
      {
        q: 'Beğeniler zamanla düşer mi?',
        a: 'Beğeni, takipçi gibi zamanla eriyen bir sayı değildir; gönderi silinmediği veya '
          + 'gizlenmediği sürece kalır.',
      },
    ],
  },

  'facebook-goruntulenme': {
    heading: 'Facebook Görüntülenme Satın Al',
    title: 'Facebook Görüntülenme Satın Al — Video',
    description:
      'Facebook video görüntülenme hizmeti. Video bağlantısını girmeniz yeterli; birim '
      + 'maliyeti en düşük hizmettir. KDV dahil net fiyat, adım adım takip.',
    body: [
      'Görüntülenme hizmeti Facebook\'ta paylaşılmış video içeriklerine uygulanır; fotoğraf '
        + 'veya metin gönderilerinde görüntülenme diye bir sayaç yoktur. Birim maliyeti '
        + 'katalogdaki en düşük hizmet olduğu için minimum sipariş miktarı da yüksektir.',
      'Facebook video görüntülenmesini kendi eşiğine göre sayar: video birkaç saniye izlendikten '
        + 'sonra bir görüntülenme kabul edilir. Bu yüzden sayaç, videoyu baştan sona izleyen '
        + 'kişi sayısı değildir — Facebook bu ikisini kendi sayfa istatistiklerinizde ayrı '
        + 'gösterir ve orada gerçek izlenme süresini de görebilirsiniz.',
      'Videonun herkese açık olması gerekir. Sipariş sırasında videonun bağlantısını '
        + 'girersiniz; sipariş tamamlanmadan video silinirse işlem yarıda kalır.',
    ],
    faq: [
      {
        q: 'Fotoğraf gönderime görüntülenme alabilir miyim?',
        a: 'Hayır. Facebook görüntülenmeyi yalnızca videolarda sayar. Fotoğraf ve metin '
          + 'gönderileri için beğeni veya yorum hizmetine bakabilirsiniz.',
      },
      {
        q: 'Görüntülenme, videonun tamamının izlendiği anlamına mı gelir?',
        a: 'Hayır. Facebook video birkaç saniye izlendiğinde bunu bir görüntülenme sayar. '
          + 'Gerçek izlenme süresini sayfanızın kendi video istatistiklerinde görürsünüz.',
      },
    ],
  },

  'facebook-yorum': {
    heading: 'Facebook Yorum Satın Al',
    title: 'Facebook Yorum Satın Al — Türk Hesaplardan',
    description:
      'Facebook gönderi yorumu: Türk hesaplardan, gerçek kişiler tarafından yazılır. '
      + 'Gönderi bağlantısını girin, miktarı seçin. KDV dahil net fiyat.',
    body: [
      'Facebook\'ta yorum bölümü gönderinin hemen altında açık durur ve çoğu kullanıcı '
        + 'gönderiyi okurken yorumları da görür. Yorum, gönderinin altındaki konuşmayı '
        + 'başlatan ve gönderiye dönüp bakılmasını sağlayan etkidir.',
      'Yorumları gerçek kişiler yazar; bu yüzden hizmet elle ilerler ve birim fiyatı '
        + 'sayılabilir hizmetlerin üzerindedir. En küçük sipariş miktarı ise düşük tutulmuştur, '
        + 'çünkü yorum bölümünde amaç kalabalık değil, konuşmanın başlamış olmasıdır.',
      'Gönderinin herkese açık olması ve yorumlara kapatılmamış olması gerekir. Sayfanızda '
        + 'kelime engelleme filtresi tanımlıysa bazı yorumlar gizlenebilir; bu durumda '
        + 'sayfa ayarlarınızdaki filtreyi gözden geçirmeniz yeterlidir.',
    ],
    faq: [
      {
        q: 'Yorumların içeriğini belirleyebilir miyim?',
        a: 'Sipariş sonrası bizimle iletişime geçerek yönlendirme yapabilirsiniz. Varsayılan '
          + 'olarak gönderiyle uyumlu genel yorumlar yazılır.',
      },
      {
        q: 'Sayfamdaki kelime filtresi yorumları engeller mi?',
        a: 'Engelleyebilir. Filtreye takılan yorumlar gizlenir ve size görünmez. Sayfa '
          + 'ayarlarınızdan filtreyi geçici olarak gevşetebilirsiniz.',
      },
    ],
  },

  'facebook-paylasim': {
    heading: 'Facebook Paylaşım Satın Al',
    title: 'Facebook Paylaşım Satın Al — Gönderi Paylaşımı',
    description:
      'Facebook gönderinizin paylaşılma sayısını artırın. Paylaşım, gönderiyi kendi '
      + 'çevrenizin dışına taşıyan etkidir. Gerçek kişilerce yapılır, KDV dahil fiyat.',
    body: [
      'Paylaşım, bir kullanıcının gönderinizi kendi akışına yeniden paylaşmasıdır ve sayısı '
        + 'gönderinin altında herkese açık görünür. Facebook\'ta paylaşımın ağırlığı özellikle '
        + 'yüksektir: gönderi, paylaşan kişinin kendi arkadaş çevresine düşer ve oradan '
        + 'yayılmaya devam edebilir.',
      'Bu yüzden paylaşım, yayılması istenen içeriklerde anlamlıdır — duyuru, kampanya, '
        + 'etkinlik çağrısı, iş ilanı, kayıp ilanı gibi. Yalnızca mevcut takipçilerinize '
        + 'seslenen bir gönderide ise paylaşım sayısının katkısı sınırlı kalır.',
      'Gönderinin herkese açık olması gerekir; yalnızca arkadaşlarla paylaşılmış bir gönderi '
        + 'başkaları tarafından yeniden paylaşılamaz. Sipariş sırasında gönderinin adresini '
        + 'girersiniz.',
    ],
    faq: [
      {
        q: 'Gönderim kimin sayfasında paylaşılacak?',
        a: 'Paylaşım, gönderinin kullanıcıların kendi akışlarında yeniden paylaşılması '
          + 'biçiminde gerçekleşir. Belirli bir sayfa veya grup hedeflemesi yapılmaz.',
      },
      {
        q: 'Paylaşım sayısı gönderide görünür mü?',
        a: 'Evet. Facebook\'ta paylaşım sayısı beğeni ve yorum sayısının yanında herkese açık '
          + 'olarak görünür.',
      },
    ],
  },
}

/**
 * ⚠️ İNDEKSLENME HAKKI EDİTORYAL METNE BAĞLIDIR.
 *
 * Metni olmayan hizmetin sayfası açılır (kullanıcı sihirbazdan gelebilir)
 * ama `noindex` alır ve sitemap'e girmez. Bu, şablon sayfaları Google'a
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
