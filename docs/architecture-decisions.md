# Mimari Kararlar — v1.1 (Faz 0 Onayı)

Bu belge, **Mimari v1.0** dokümanına Faz 0'da eklenen/kesinleşen kararları kaydeder.
v1.0'daki diğer tüm kararlar aynen geçerlidir.

---

## Sabitlenen Kararlar

| # | Konu | Karar | Durum |
|---|---|---|---|
| 1 | Ödeme | iyzico **ve** PayTR. `PaymentProvider` arayüzü; sağlayıcılar birbirinden tamamen bağımsız | 🔒 Değişmez |
| 2 | Instagram hedefi | Scraping **YOK**. Resmî/izinli API varsa zengin veri; yoksa normalize + kullanıcı onayı fallback'i | 🔒 |
| 3 | Yasal metinler | 5 route + placeholder içerik. Gerçek metinler hukukçu tarafından yazılacak | 🔒 |
| 4 | KDV | Gösterilen tüm fiyatlar **KDV DAHİL**. Checkout'ta ekleme yok. DB'de subtotal/taxRate/taxAmount/total ayrı + **snapshot** | 🔒 |
| 5 | Fatura | MVP'de entegrasyon yok. `Order` üzerinde alanlar hazır | 🔒 |
| 6 | Auth / Dil / Para | Auth.js v5 + misafir siparişi · Türkçe · TRY | 🔒 |

---

## ADR-001 — KDV Dahil Fiyatlandırma

**Karar.** `PricingRule.unitPriceMinor` **brüt (KDV dahil)** birim fiyattır.
Vergi, ödenecek toplamdan geriye ayrıştırılır:

```
listSubtotalMinor = unitPrice × quantity + setupFee     (KDV dahil, indirim öncesi)
discountMinor     = kampanya + kupon                     (KDV dahil)
totalMinor        = listSubtotal − discount              (ÖDENEN, KDV dahil)

taxAmountMinor    = round(totalMinor × taxRateBp / (10000 + taxRateBp))
subtotalMinor     = totalMinor − taxAmountMinor          (net matrah)
```

Doğrulama: `249,00 ₺` brüt, %20 KDV → KDV `41,50 ₺`, matrah `207,50 ₺`
(`207,50 × 1,20 = 249,00` ✓). `tests/unit/pricing.test.ts` bu eşitliği 100–3000
arası tüm miktarlarda kontrol eder.

**Gerekçe.**
- B2C'de yasal ve alışkanlık olarak doğru olan budur; checkout'ta sürpriz artış
  dönüşümü düşüren en bilinen sürtünmedir.
- Vergiyi **girdi** yerine **türetilmiş** değer yapmak, gösterilen fiyatın her
  zaman ödenen fiyat olmasını garanti eder.

**Snapshot.** `Order.taxRateBp` sipariş anında yazılır. KDV oranı sonradan
değişse bile geçmiş siparişlerin vergi hesabı **değişmez** — muhasebe ve iade
tutarlılığı için zorunlu.

**Sonuç.** `TaxRate` modeli eklendi (`KDV20` varsayılan, `KDV10` hazır).
`extractTaxFromGross()` tek yuvarlama noktasıdır.

---

## ADR-002 — Instagram Hedef Fallback Akışı

**Karar.** Hiçbir koşulda scraping yapılmaz — ne kendi kodumuzla ne üçüncü
parti scraping API'siyle.

**Akış.**

```
Kullanıcı URL/handle girer
  → lib/platforms/parse.ts (SAF, ağsız) normalize eder
  → kullanıcı adı / gönderi kodu çıkarılır
  → kanonik URL üretilir            https://www.instagram.com/medya333/
  → adapter.resolve()
      ├─ resmî API varsa       → VERIFIED   (avatar, isim, takipçi + rozet)
      └─ yoksa                 → UNVERIFIED (kanonik URL + onay kutusu)
  → kullanıcı "Bu hedefin doğru olduğunu onaylıyorum" işaretler
  → Target.userConfirmed = true, TARGET_CONFIRMED olayı yazılır
  → sipariş devam eder
```

`PRIVATE` ve `NOT_FOUND` akışı **durdurur**; `UNVERIFIED` durdurmaz.

**İleriye açıklık.** Meta App Review onayı alınırsa `instagramAdapter.resolve()`
içindeki resmî API dalı açılır ve `capabilities.followerCount` true olur.
**Çağıran kod, UI ve şema değişmez** — UI zaten `capabilities` bayraklarına göre
render ediyor. Bu, kararın "ileride resmî API eklemeye engel olmaması"
gereksiniminin teknik karşılığıdır.

---

## ADR-003 — Fatura Alanları, Entegrasyon Yok

`Order` üzerine eklendi: `invoiceStatus`, `invoiceProvider`, `invoiceId`,
`invoiceNumber`, `invoiceUrl`, `invoicedAt`, `invoiceError`.
Varsayılan `NOT_REQUIRED`. `INVOICE_PROVIDER=none`.

**Gerekçe.** Alanları sonradan eklemek, canlıda veri taşıyan bir tabloya
migration demek. Şimdi eklemek sıfır maliyetli; `OrderEventType.INVOICE_ISSUED`
de hazır bekliyor.

---

## ADR-004 — Yasal Sayfalar: Route Sabit, İçerik Değişken

Beş route oluşturuldu:

| Route | Başlık |
|---|---|
| `/kvkk-gizlilik` | KVKK ve Gizlilik Politikası |
| `/kullanim-kosullari` | Kullanım Koşulları |
| `/satis-sozlesmesi` | Hizmet / Mesafeli Satış Sözleşmesi |
| `/iptal-iade` | İptal ve İade Politikası |
| `/cerez-politikasi` | Çerez Politikası |

Ortak `(legal)/layout.tsx` her sayfanın üstüne **"Taslak metin — hukuk danışmanı
tarafından güncellenecek"** rozeti basar. Bölüm başlıkları hazır; hukukçu yalnızca
paragrafları doldurur. Route'lar sabit olduğu için checkout onay kutularındaki
linkler metin değişince kırılmaz.

---

## ADR-005 — Prisma 7 + Driver Adapter

**Karar.** Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`).

**Gerekçe.** Prisma 7 Rust query engine'i kaldırdı; queryCompiler ve driver
adapter kullanılıyor. Sonuç: daha küçük deployment, serverless'te daha hızlı
soğuk başlangıç, çalışma zamanında binary bağımlılığı yok.

**Yan etki.** `prisma generate` / `migrate` hâlâ schema-engine binary'sini
indirir. Bu adresin engellendiği ortamlar için iki telafi eklendi:

1. `tests/unit/schema.test.ts` — saf TS parser ile relation bütünlüğü, enum
   senkronu ve para alanı tiplerini doğrular. `npm test` içinde her zaman çalışır.
2. `npm run gen:stub` — şemadan alan-farkında tip stub'ı üretir; tip kontrolü
   engine olmadan da mümkün olur.

---

## ADR-006 — Katalog Snapshot `unstable_cache` ile

**Karar.** `/api/v1/catalog/snapshot` route'u `force-dynamic`; önbellek
`unstable_cache` + `revalidateTag` ile yönetilir.

**Gerekçe.** Route seviyesinde ISR kullanılsaydı Next derleme sırasında route'u
prerender etmeye çalışır ve **veritabanına bağlanmayı denerdi** — Vercel/CI
derlemesi DB olmadan patlardı. Tag tabanlı önbellek hem bu sorunu çözer hem de
admin katalogda değişiklik yaptığında (`revalidateCatalog()`) yayılımı **anında**
yapar.

---

## Faz 0 Uygulama Özeti

### Değişmezler nerede yaşıyor

| Kural | Dosya | Test |
|---|---|---|
| Fiyat hesabı (tek kaynak) | `src/lib/pricing/calculate.ts` | 30 |
| Sipariş state machine | `src/lib/orders/transitions.ts` | 17 |
| Hedef parse | `src/lib/platforms/parse.ts` | 22 |
| Para aritmetiği | `src/lib/money.ts` | (pricing içinde) |
| Şema bütünlüğü | `prisma/schema.prisma` | 27 |

### Platform bağımsızlığı nasıl sağlandı

1. `Platform.adapterKey` slug'dan **bağımsız** → aynı adapter birden çok platformda.
2. Bilinmeyen `adapterKey` → `genericAdapter` → yeni platform **deploy'suz** çalışır.
3. Hedef girdisinin etiketi/placeholder/yardımı/örneği `Service` satırında →
   yeni hizmet **sıfır satır frontend**.
4. UI, adapter `capabilities` bayraklarına göre render eder → `followerCount:false`
   olan platformda takipçi alanı hiç çizilmez.
5. Kod tabanında platform adı geçen tek yer: `PARSE_SPECS` ve registry haritası.

### ServiceVariant sadeleştirmesi

| Görünür varyant | Kullanıcı deneyimi |
|---|---|
| 1 | **Hiçbir seçim gösterilmez** — doğrudan miktara geçilir |
| 2–3 | Segmented control: `customerLabel` + `tagline` + fiyat farkı + `badge` |
| 4+ | Kart listesi, `isDefault` ön seçili |

`internalName`, `slug`, ham `minQuantity`/`maxQuantity` **hiçbir zaman**
kullanıcıya gösterilmez; min/max slider sınırına dönüşür.

---

## Sonraki Faz — Faz 1

**Pricing + Katalog API'leri (4-5 gün)**

1. Katalog admin CRUD servisleri (`revalidateCatalog()` ile)
2. `/api/v1/coupons/validate`
3. `/api/v1/admin/pricing/simulate` ve `/validate` (çakışma + boşluk raporu)
4. Katalog SEO sayfaları (`/hizmetler`, `/hizmetler/[platform]`)
5. Redis'e geçiş (rate limit + adapter cache) — arayüz aynı kalır
6. Integration test: gerçek Postgres üzerinde `resolvePrice` uçtan uca

**Çıkış kriteri.** UI olmadan, DB'den gelen kademelerle doğru fiyat üretiliyor ve
admin fiyat tablosundaki çakışma/boşluk kaydetmeden önce raporlanıyor.

---

## ADR-007 — Credentials + Veritabanı Oturumu: Auth.js Sağlayıcısı Kullanılmıyor

**Durum:** Kabul edildi (Faz 2)

**Bağlam.** Faz 2 E2E testlerinde canlı derleme üzerinde şu hata çıktı:

```
[auth][error] UnsupportedStrategy: Signing in with credentials only supported
if JWT strategy is enabled.
```

Kaynak: `@auth/core/lib/utils/assert.js`

```js
if (hasCredentials) {
  const dbStrategy   = options.session?.strategy === "database"
  const onlyCredentials = !options.providers.some(p => p.type !== "credentials")
  if (dbStrategy && onlyCredentials) return new UnsupportedStrategy(...)
}
```

Yani Auth.js v5, Credentials sağlayıcısını veritabanı oturumuyla **tek
sağlayıcı olduğunda** reddediyor. Google OAuth yapılandırılmamışken —
ki ilk canlıya çıkışta olağan durum — e-posta/şifre girişi **tamamen
çalışmıyordu**. Hata yalnızca sunucu log'una düşüyor, kullanıcı
`/api/auth/error` sayfasına atılıyordu.

**Değerlendirilen seçenekler**

| Seçenek | Sonuç |
|---|---|
| JWT stratejisine geçmek | ❌ Oturumu anında iptal etme yeteneği kaybolur. Bloklanan kullanıcı token süresi (30 gün) dolana kadar içeride kalır. Mimari kararla çelişir. |
| `jwt.encode` ile oturum satırını elle yazmak | ❌ Denendi; assert sağlayıcı listesine baktığı için yine tetikleniyor. |
| Google'ı her zaman kayıtlı tutmak | ❌ Yapılandırılmamış bir "Google ile giriş" düğmesi gösterilir. |
| **Kendi giriş ucumuzu yazmak** | ✅ Seçildi. |

**Karar.** E-posta/şifre girişi `POST /api/v1/auth/login` üzerinden yapılır.
Oturum satırı `src/server/auth/session.ts` içinde **Auth.js'in kullandığı AYNI
`Session` tablosuna** yazılır ve **AYNI çereze** konur. `auth()` iki akış
arasında hiçbir fark görmez; Google akışı Auth.js'te olduğu gibi kalır.

**Sonuçlar**

- Mimari karar korundu: veritabanı oturumu + e-posta/şifre + Google + misafir.
- `destroyAllSessionsFor(userId)` ile "tüm cihazlardan çıkış" mümkün.
- Çerez adı/seçenekleri tek kaynaktan gelir: `src/server/auth/cookies.ts`.
  `middleware.ts` Edge runtime'da olduğu için isimleri elle taşır;
  `tests/unit/schema.test.ts` ikisinin ayrışmasını yakalar.
- CSRF: Auth.js token'ı yerine `assertSameOrigin()` + `SameSite=Lax` çerez.

---

## ADR-008 — `__Secure-` Öneki NODE_ENV'e Değil Site Şemasına Bağlı

**Durum:** Kabul edildi (Faz 2)

**Bağlam.** Çerez adı `NODE_ENV === 'production'` ile seçiliyordu. Tarayıcı
`__Secure-` önekli çerezi **yalnızca HTTPS üzerinden** kabul eder. Üretim
derlemesi HTTP üzerinde çalıştığında (yerel önizleme, E2E, staging) sunucu
çerezi yazıyor, tarayıcı sessizce atıyor, kullanıcı sonsuz giriş döngüsüne
düşüyordu. Hata mesajı yok — teşhisi en zor sınıftan bir hata.

**Karar.** Önek ve `secure` bayrağı `NEXT_PUBLIC_SITE_URL` şemasından türetilir
(`src/server/auth/cookies.ts`). Üretim HTTPS olduğu için davranış değişmez;
HTTP üzerindeki üretim derlemeleri çalışır hale gelir.

---

## ADR-009 — Takip Token'ı URL'de Taşınmaz

**Durum:** Kabul edildi (Faz 2)

**Bağlam.** Sipariş oluşturulduğunda başarı ekranı sihirbazın içinde
gösteriliyordu; bu hem pazarlama hero'sunu ekranın üstünde bırakıyor hem de
token'ı adres çubuğuna taşımayı gerektiriyordu.

**Karar.** Başarı ekranı kendi rotasındadır (`/siparis-olusturuldu`) ve veriyi
`sessionStorage`'dan okur. Takip token'ı **tarayıcı geçmişine, sunucu erişim
kayıtlarına ve `Referer` başlığına düşmez**. Token yalnızca e-postayla
gönderilen bağlantıda ve kullanıcının kendi tıklamasıyla URL'e girer.

Doğrudan `/siparis-olusturuldu` açılırsa `/siparis-takip`'e yönlendirilir.

---

## Faz 2 Uygulama Özeti

**Sipariş oluşturma**
- `POST /api/v1/orders` — 10 adımlı sunucu tarafı yeniden doğrulama.
  İstemciden gelen `unitPrice`/`subtotal`/`tax`/`total` **şemaya girmez**;
  `clientTotalMinor` yalnızca karşılaştırma içindir → uyuşmazsa `PRICE_CHANGED`.
- Idempotency: `Idempotency-Key` başlığı + `Order.idempotencyKey` UNIQUE +
  `requestHash` karşılaştırması. Aynı key + aynı gövde → aynı sipariş;
  aynı key + farklı gövde → 409.
- Sipariş `PENDING_PAYMENT` doğar. `DRAFT → PENDING_PAYMENT → PAID → …`

**Fulfillment kapısı (iki bağımsız katman)**
1. `TRANSITIONS` tablosunda `PENDING_PAYMENT → PROCESSING` yolu **yok**.
2. `transitionOrder()` içinde `FULFILLMENT_STATUSES × FULFILLMENT_ALLOWED_FROM`
   kontrolü — tabloya yeni bir yol eklense bile korur.

Admin varsayılan kuyruğu (`queue=active`) yalnızca ödenmiş siparişleri gösterir;
ödeme bekleyenler ayrı kovada ("Ödeme bekleniyor") durur.

**Misafir erişimi**
- Sipariş no: `M333-XXXXXXXX` (Crockford Base32, 8 karakter, modulo bias yok).
- Sorgu: orderNo + e-posta, sabit süreli karşılaştırma. "Bulunamadı" ile
  "eşleşmedi" **birebir aynı** cevabı döner.
- Rate limit iki eksende: IP başına **ve sipariş numarası başına** —
  IP değiştirerek tek siparişe e-posta tahmini yapılamaz.
- Takip token'ı: DB'de yalnızca HMAC hash'i tutulur.

**Guest → hesap devri**
- Yalnızca e-posta eşleşmesi **yetmez**. Ya `emailVerified` dolu olacak ya da
  e-postaya gönderilen tek kullanımlık claim token ibraz edilecek.
- Kayıt sırasında misafir siparişi varsa şifre gölge kayda bağlanır ama
  `isGuest` düşürülmez; devir ayrı ve doğrulanmış bir adımdır.

**Sözleşme onayları**
- Üç ayrı onay kutusu; "hepsini kabul ediyorum" tek kutusu yok.
- Kabul anı + **her metnin sürümü** siparişe snapshot'lanır
  (`consentTermsVersion`, `consentRefundVersion`, `consentPrivacyVersion`,
  `consentSnapshot`). Metin sonradan değişse bile hangi şartların kabul
  edildiği kanıtlanabilir.

**PII minimizasyonu**
- Public sipariş görünümü ad, soyad, telefon, tam e-posta ve IP döndürmez.
- Audit log'a PII yazılmaz; yalnızca yöntem/sayı/durum.
- Ham IP hiçbir yerde saklanmaz — tuzlanmış hash.

---

## Sonraki Faz — Faz 3

Ödeme: `PaymentProvider` adapter arayüzü, iyzico ve PayTR implementasyonları,
webhook doğrulama ve replay koruması (`PaymentEvent` zaten `@@unique([provider,
providerEventId])` taşıyor), `PENDING_PAYMENT → PAID` geçişinin ödeme
callback'ine bağlanması.

---

## ADR-010 — Ödeme Durum Makinesi: İsimler Neden Farklı

**Durum:** Kabul edildi (Faz 3)

Faz 3 tarifi kavramsal olarak şu durumları istedi:
`INITIATED · PENDING · SUCCESS · FAILED · CANCELLED · REFUNDED · PARTIALLY_REFUNDED`

Uygulanan enum bunları KARŞILAR ama iki yerde daha ayrıntılıdır:

| İstenen | Uygulanan | Gerekçe |
|---|---|---|
| PENDING | `PENDING` + `PENDING_3DS` | 3DS beklemesi ile genel sağlayıcı beklemesi farklı müşteri mesajı ve farklı zaman aşımı gerektirir. PayTR iframe'i açıkken 3DS'te olmayabilir. |
| SUCCESS | `AUTHORIZED` + `CAPTURED` | Ön provizyon (para bloke) ile tahsilat (para alındı) aynı şey değildir. **Siparişi `PAID` yapan TEK durum `CAPTURED`'dır** — `AUTHORIZED` yapmaz. |
| — | `CHARGEBACK` | Ters ibraz iade değildir; ayrı izlenmelidir. |

`PAYMENT_UNLOCKS_ORDER` kümesi tek elemanlıdır (`CAPTURED`) ve bir birim
testiyle bu şart kilitlenmiştir.

---

## ADR-011 — Mock Sağlayıcı: Gerçek Credential Olmadan Uçtan Uca Doğrulama

**Durum:** Kabul edildi (Faz 3)

**Bağlam.** Elimizde iyzico veya PayTR merchant/sandbox bilgisi YOK. Faz 3
kuralı 24 açıktı: sahte secret üretme, canlı uca istek atma, ödeme başarılı
varsayma. Ama "ödeme zinciri çalışıyor" iddiasının da kanıtlanması gerekiyordu.

**Karar.** Üçüncü bir adapter: `MockPaymentProvider`.

Yaptıkları:
- Dışarıya **hiçbir ağ isteği yapmaz**.
- Bildirimini gerçek sağlayıcılarla **aynı arayüz** üzerinden üretir.
- İmzayı **gerçekten hesaplar ve gerçekten doğrular** — webhook güvenlik yolu
  "test için atlanmış" değildir; imzasız bildirim reddedilir.
- Ödemeyi kendiliğinden başarılı **saymaz**; imzalı bildirim gelene kadar
  `PENDING` kalır.
- Anahtarı `ORDER_TOKEN_SECRET`'ten türer — uydurulmuş bir "merchant secret"
  değil, kendi mock'umuzun kendi anahtarı. Hiçbir sağlayıcı kimliği taklit
  edilmez.

**Kapı `PAYMENT_ENVIRONMENT`'tır, `NODE_ENV` değil.** İlk uygulamada kapı
`NODE_ENV !== 'production'` idi ve E2E'de patladı: sandbox/staging dağıtımları
da `next build` + `next start` ile çalışır, yani NODE_ENV=production'dır.
"Gerçek para dönüyor mu" sorusunun doğru cevabı `PAYMENT_ENVIRONMENT`'tır.
Ek olarak `assertPaymentConfig()` canlı ortamda mock seçimini tamamen reddeder.

---

## ADR-012 — `APP_BASE_URL`: Callback Adresleri Derlemeye Gömülemez

**Durum:** Kabul edildi (Faz 3)

**Bağlam.** Sağlayıcıya giden `callbackUrl` / `successUrl` başta
`NEXT_PUBLIC_SITE_URL`'den üretiliyordu. E2E'de ödeme akışı koptu: kullanıcı
`localhost:3000`'e yönlendi, oysa sunucu `127.0.0.1:3100`'deydi.

**Kök neden.** Next.js `NEXT_PUBLIC_` önekli değişkenleri **derleme sırasında**
koda gömer. Çalışma zamanında değiştirmek imkânsızdır. Aynı derleme imajı
staging'de ve canlıda kullanıldığında sağlayıcıya **yanlış callback adresi**
gider — ödeme bildirimi hiç ulaşmaz. Bu, canlıda "para alındı ama sipariş
ödenmemiş görünüyor" olarak ortaya çıkardı; teşhisi en zor sınıftan bir hata.

**Karar.** Sunucu tarafı adresler `APP_BASE_URL` (server-only, çalışma
zamanında okunur) üzerinden üretilir; yoksa `NEXT_PUBLIC_SITE_URL`'e düşülür.
`assertSameOrigin` da bunu kullanır.

---

## ADR-013 — Ödeme Dönüş Çerezi: Token URL'e Konmadan Sahiplik

**Durum:** Kabul edildi (Faz 3)

**Bağlam.** Misafir kullanıcı sağlayıcıdan döndüğünde sonuç sayfasının
"bu sipariş senin mi" sorusunu cevaplaması gerekir. En kolay yol takip
token'ını `successUrl`'e koymaktı — ama ADR-009 gereği token URL'e girmemeli.

**Karar.** Ödeme başlatılırken token, kısa ömürlü (2 saat) `httpOnly` çereze
yazılır. Sağlayıcı dönüşü üst düzey GET navigasyonu olduğu için `SameSite=Lax`
çerez tarayıcıca **gönderilir**. Token URL'e, geçmişe, `Referer`'a hiç girmez.

Çerez YALNIZCA yazıldığı sipariş için geçerlidir ve bir KOLAYLIKTIR: yazılamazsa
(istek bağlamı yok) akış düşmez, kullanıcı takip bağlantısıyla erişir.

---

## Faz 3 Uygulama Özeti

**Sağlayıcı mimarisi**
- `PaymentProvider` arayüzü: `createPayment` · `getPaymentStatus` ·
  `verifyWebhook` · `handleWebhook` · `refundPayment`.
- Üç adapter: `IyzicoPaymentProvider`, `PaytrPaymentProvider`,
  `MockPaymentProvider`. Domain kodunda `if (provider === 'paytr')` **yok**.
- Mevcut bir `Payment` HER ZAMAN kendi `provider` alanıyla işlenir; aktif
  sağlayıcı değişse bile eski ödemelerin bildirimleri doğru adapter'a gider.

**Tutar**
- `createPaymentForOrder` **tutar parametresi almaz**. Tek kaynak
  `Order.totalMinor`; `Payment.amountMinor` onun snapshot'ıdır.
- Webhook'ta tutar `Payment.amountMinor` ile karşılaştırılır. Uyuşmazsa ödeme
  işlenmez ve `payment.amount_mismatch` audit kaydı düşer.

**Webhook doğrulama zinciri (10 adım)**
imza → tekrar → referans → tutar → para birimi → sağlayıcı eşleşmesi →
durum geçişi → transaction + `FOR UPDATE` → PaymentEvent → OrderEvent.

- **iyzico bildirimi tutar taşımaz.** Bu yüzden `CAPTURED` iddiasında
  `getPaymentStatus` ile sunucudan **sorulur**; doğrulanamazsa ödeme
  başarılı sayılmaz.
- İmza geçersizse bile sağlayıcıya `ack` döneriz (PayTR "OK" almazsa saatlerce
  tekrar gönderir); ödeme İŞLENMEZ, olay `WEBHOOK_REJECTED` olarak kayıtlıdır.

**Yarış koşulları**
- Aynı bildirim N kez → `PaymentEvent` üzerindeki `@@unique([provider,
  providerEventId])` ilkini geçirir, kalanları `DUPLICATE` yapar.
- Eşzamanlı bildirimler → `SELECT … FOR UPDATE` + kilit sonrası durum
  yeniden okunur; yalnızca biri işler.
- Success redirect + webhook → redirect **hiçbir şey yazmaz**, tek yazar
  webhook'tur.
- Eşzamanlı iadeler → kilit alındıktan SONRA üst sınır yeniden hesaplanır.

**Aynı siparişe iki başarılı ödeme**
Normal akışta imkânsız (`createPaymentForOrder` reddeder). Sağlayıcı tarafında
gecikmiş ikinci tahsilat olursa: sipariş ikinci kez ileri taşınmaz, otomatik
fulfillment tetiklenmez, `getRefundSummary().needsReconciliation` **true** olur.

**İade**
- Üst sınır iki kapıda: ödemenin kalan iade edilebilir tutarı ve sipariş toplamı.
- Başarısız iade `refundedMinor`'ı ARTIRMAZ.
- Yetki `SUPERADMIN` — para iadesi geri alınamaz.

**Log ve PII**
`redactProviderPayload` yasaklı anahtarları atar, metne gömülü kart
numaralarını (Luhn kontrolüyle) maskeler, derinlik/uzunluk sınırlar.
`safeLogLine` aynı kuralları log satırına uygular.

---

## ADR-014 — Fulfillment'ın Kendi Durum Makinesi Var, Sipariş'e Zorla Eşitlenmez

**Bağlam.** Sipariş durumu müşteriye anlatılan hikâyedir; fulfillment durumu
operasyonun iç gerçeğidir. İkisini tek alanla yönetmek, "sipariş `PARTIAL`
ama operatör hâlâ çalışıyor" gibi durumları temsil edilemez kılar.

**Karar.** `Fulfillment.status` ayrı bir enum ve ayrı bir geçiş tablosudur
(`FULFILLMENT_TRANSITIONS`). Sipariş durumu, fulfillment ilerledikçe
**tek yönlü** olarak takip eder — asla tersi olmaz.

`syncOrderStatus` sipariş zincirini **adım adım** yürür
(`PROCESSING → STARTED → PARTIAL → COMPLETED`): sipariş makinesi
`PAID → STARTED` doğrudan geçişine izin vermez ve ara durumu atlayan bir
senkron denemesi sessizce başarısız olurdu. Senkron başarısız olsa bile
fulfillment aksiyonu geri alınmaz — operasyon kaydı tek gerçektir.

`COMPLETED` yalnızca `REVIEW_REQUIRED`'a gidebilir: **tamamlanmış iş geri alınmaz**,
sorun varsa incelemeye açılır.

---

## ADR-015 — Otomasyon Sınırı Kodda Üç Katmanla Kilitlenir

**Bağlam.** "Sistem işi kendi başlatmasın" bir yorum satırıyla korunamaz.
Yarın eklenecek bir cron, bir webhook dalı ya da bir test yardımcı fonksiyonu
kuralı farkında olmadan çiğneyebilir.

**Karar.** Kural üç bağımsız katmanda uygulanır:

1. **Üretilebilir durum kümesi.** `AUTO_CREATABLE_STATUSES = {READY}` —
   sistemin yaratabileceği tek fulfillment durumu.
2. **İnsan aktör zorunluluğu.** `MANUAL_ONLY_TRANSITIONS =
   {PROCESSING, STARTED, PARTIAL, COMPLETED, FAILED}` ve tek yazma noktasındaki
   `assertManualActor(to, actorUserId)`. `actorUserId === null` (yani sistem)
   bu durumlara **hiçbir yoldan** yazamaz — `AutomationNotAllowedError`.
3. **Servis katmanı yetkisi.** `assertCanOperate` rol + atama kontrolü yapar.

Webhook yalnızca `ensureFulfillmentForPaidOrder` çağırır; bu fonksiyon
`READY` dışında bir durum üretemez. `%100` teslim girildiğinde bile
`updateProgress` `COMPLETED` yazmaz — yalnızca `PARTIAL` işaretler.

---

## ADR-016 — İlerleme Metrikten Türetilir, İstemciden Alınmaz

**Bağlam.** Operatör panelinden "%50" göndermek kolay olurdu; ama o değer
istemcinin iddiasıdır ve müşteriye gösterilen ilerlemenin kaynağı olamaz.

**Karar.** `progress` uç noktasının şemasında `percent` ve `remaining`
alanları **yoktur**. Operatör yalnızca gözlemlediği ham metriği girer
(`currentMetric`) ya da doğrudan teslim adedini yazar.

```
delivered = clamp(currentMetric − initialMetric, 0, requestedQuantity)
percent   = round(delivered / requested × 100)      // backend
remaining = requested − delivered                    // backend
```

`initialMetric` işin **başlatıldığı anda dondurulur**; sonradan değişmez.
`deliveredQuantity > requestedQuantity` hem hesapta hem de yazma noktasında
imkânsızdır.

**Metrik düşerse** (takipçi kaybı) bu bir hata değildir: `METRIC_DECREASED`
event'i yazılır, teslim sayısı geri alınmaz, operasyon durmaz. Düşüş garanti
penceresi içindeyse operatör manuel telafi kaydı açabilir.

---

## ADR-017 — Müşteri Görünümü İç Duruma Bağlı Değil, Eşlenir

**Bağlam.** `FAILED` durumunu müşteriye "Başarısız" diye göstermek hem yanlış
(inceleme sürüyor) hem de gereksiz paniktir. Ayrıca operatör adı, iç not,
IP, maliyet ve sağlayıcı bilgisi müşteri yüzeyine hiç çıkmamalıdır.

**Karar.** `CUSTOMER_FULFILLMENT_VIEW` iç durumdan müşteri diline **eşleme**
tablosudur; müşteri yüzeyi enum'u hiç görmez.

| İç durum | Müşteriye |
|---|---|
| `READY` | Sıraya alındı — "Siparişiniz onaylandı ve işlem sırasına alındı." |
| `PROCESSING` | Hazırlanıyor |
| `STARTED` | Devam ediyor — "İşleminiz devam ediyor." |
| `PARTIAL` | Devam ediyor (kısmi teslim bilgisiyle) |
| `COMPLETED` | Tamamlandı |
| `FAILED` | **İnceleniyor** — teknik sebep gösterilmez |
| `REVIEW_REQUIRED` | İnceleniyor |

`toCustomerFulfillment()` yalnızca beyaz listedeki alanları taşır; iç alanlar
serileştirilmez. Bir birim testi, tüm müşteri metinlerini kelime bazlı
tarayarak `operator · internal · ip · maliyet · provider · audit · hata`
sızıntısını engeller.

**Polling.** İlk sürümde WebSocket/SSE **yok**. Müşteri kartı 20 saniyede bir
yoklar ve `polling: false` (terminal durum) geldiğinde **kendini durdurur**.

---

## Faz 4 Uygulama Özeti

**Yeni modeller**
- `Fulfillment` — `orderId @unique` (1 sipariş = 1 fulfillment; tekrar eden
  webhook ikinci kayıt AÇAMAZ), hedef snapshot'ı, istenen/teslim edilen adet,
  başlangıç/güncel metrik, atama, zaman damgaları, garanti penceresi, notlar.
- `FulfillmentEvent` — `fromStatus`/`toStatus`/`actorUserId`/`isCustomerVisible`
  ile tam denetim izi. `actorUserId === null` ⇒ sistem (yalnızca `CREATED`).
- `ReplacementCase` — `DROP_DETECTED → REVIEW_REQUIRED → APPROVED →
  REPLACEMENT_PROCESSING → COMPLETED | REJECTED`.

**Otomatik / manuel sınırı**

| Adım | Kim |
|---|---|
| Ödeme doğrulandı → sipariş `PAID` | 🤖 sistem (imzalı webhook) |
| Sipariş otomatik onayı (`ORDER_CONFIRMED`) | 🤖 sistem |
| Fulfillment kaydı + `READY` | 🤖 sistem |
| `READY → PROCESSING → STARTED` | 👤 operatör |
| İlerleme girişi | 👤 operatör |
| `→ COMPLETED` / `→ FAILED` | 👤 operatör |
| Telafi açma | 👤 operatör · onay 👤 `ADMIN+` |

**Ödenmemiş sipariş kuyrukta görünemez — iki kapı**
1. Fulfillment yalnızca doğrulanmış ödeme sonrası yaratılır.
2. Kuyruk sorgusu ayrıca `order.status ∈ PAID_ORDER_STATUSES` filtresi uygular.

**Yarış koşulları**
- Eşzamanlı 3 webhook → `Fulfillment.orderId` unique + P2002 yakalama ⇒
  tek kayıt, ikinciler mevcut kaydı döner.
- Eşzamanlı ilerleme güncellemesi → `SELECT … FOR UPDATE` ⇒ teslim adedi
  hiçbir zaman istenen adedi aşmaz.
- Aynı duruma tekrar geçiş → idempotent no-op, yeni event yazılmaz.

**Garanti**
`ServiceVariant.refillDays` **tamamlanma anında** `Fulfillment.guaranteeDays` /
`guaranteeEndsAt` olarak snapshot'lanır; sonradan katalog değişse bile
müşterinin hakkı değişmez. Pencere kapandıktan sonra sistem hiçbir otomatik
işlem yapmaz — süre dolmuşsa telafi kaydı açılamaz.

---

## Sonraki Faz — Faz 5 (onay bekliyor)

Faz 4 kapsamı tamamlandı. Yeni faza kendiliğinden geçilmez.

**Kalan teknik borç**
- Operatör paneli sayfa yenilemesiyle çalışır; kuyrukta otomatik yenileme yok.
- Kuyrukta sayfalama yok (limit 100). Hacim arttığında cursor tabanlı sayfalama gerekir.
- Bildirim yok: müşteriye "işleminiz başladı/tamamlandı" e-postası gitmiyor.
- SLA/gecikme uyarısı yok — `READY`'de bekleyen iş için eşik alarmı kurulmadı.
- Telafi kaydı yeni bir fulfillment üretmez; aynı kayıt üzerinde ilerler.
- Prisma WASM şema motoru mevcut veritabanına karşı diff alamıyor
  (`Column type 'char' could not be deserialized`); migration'lar elle yazılıyor.
