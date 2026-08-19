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

**Faz 4'ten devreden teknik borç** (Faz 5'te kapanmadı)
- Operatör paneli sayfa yenilemesiyle çalışır; kuyrukta otomatik yenileme yok.
- Kuyrukta sayfalama yok (limit 100).
- Bildirim yok: müşteriye "işleminiz başladı/tamamlandı" e-postası gitmiyor.
- SLA/gecikme alarmı yok.
- Telafi kaydı yeni bir fulfillment üretmez; aynı kayıt üzerinde ilerler.

---

## ADR-018 — Sabit Paket Fiyatı: `quantity × unitPrice` Terk Edildi

**Bağlam.** Gerçek satış fiyatları miktarın fonksiyonu değil, miktar–fiyat
EŞLEŞMESİDİR: 500 takipçi 324,90 ₺, 1.000 takipçi 599,90 ₺. Bu tabloyu birim
fiyatla ifade etmek imkânsızdır — `32490 / 500 = 64,98` kuruş tam sayı değildir
ve para birimimiz tam sayı kuruştur (Faz 0 kuralı #1). Birim fiyatı yuvarlayıp
miktarla çarpsaydık 500 × 65 = 325,00 ₺ çıkardı: müşteriye söz verdiğimiz
fiyattan 10 kuruş fazla.

**Karar.** `PricingMode` üçüncü bir değer kazandı: `PACKAGE`.

```
PACKAGE  →  goodsMinor = tier.packagePriceMinor          // OKUNUR
FLAT_TIER→  goodsMinor = tier.unitPriceMinor × quantity  // hesaplanır
```

`packagePriceMinor` yeni ve **nullable** bir sütundur; mevcut kademeler
etkilenmez. `PACKAGE` kademesinde `unitPriceMinor` 0'dır ve HİÇBİR yerde
gösterilmez — "1 × 0,00 ₺" yazmak yanıltıcı olurdu. Kırılım satırı
"Paket fiyatı" der, `nextTier` ipucu üretilmez (sabit pakette "biraz daha ekle,
birim fiyat düşsün" anlamsızdır).

**Sonuç.** 63 fiyat noktasının tamamı kuruşu kuruşuna doğrulanabilir hale geldi;
`tests/unit/catalog-prices.test.ts` beklenen değerleri seed'den DEĞİL brief'ten
elle alarak karşılaştırır — aksi halde yanlış girilmiş bir fiyat kendi kendini
onaylardı.

---

## ADR-019 — Hazır Miktar Kilidi (`presetOnly`)

**Bağlam.** 500 → 324,90 ₺ tanımlıysa 501 için bir fiyat YOKTUR. Slider'lı
serbest miktar bu katalogda anlamsızdır ve `NO_PRICING_RULE` hatası üretirdi.

**Karar.** `ServiceVariant.presetOnly` (varsayılan `false`, geriye dönük
uyumlu). `true` olduğunda:

1. **İstemci** — slider ve sayı kutusu HİÇ render edilmez; kullanıcı 7.342
   yazabileceği bir alan görmez, yalnızca fiyatlı miktar kartları görür.
2. **Sunucu** — `validateQuantity` aynı saf fonksiyonda listeyi kontrol eder ve
   `QUANTITY_NOT_ALLOWED` fırlatır. Arayüz atlansa da API kabul etmez.
3. **Admin doğrulayıcı** — boşluk taraması ARALIK üzerinde değil HAZIR MİKTAR
   listesi üzerinde yapılır: 501–999 "boşluk" değildir, çünkü seçilemez.

Varyant değiştiğinde miktar sıkıştırılmaz, **en yakın hazır miktara oturtulur** —
sıkıştırmak yine geçersiz bir sayı bırakabilirdi.

---

## ADR-020 — Demo Katalog Silinmedi, Pasifleştirildi

**Bağlam.** Faz 0-4'ün örnek hizmetleri (TikTok/YouTube/X/Facebook/Telegram
hizmetleri, "Standart/Premium" varyantları, "Profil Tanıtımı") uydurma
fiyatlardır ve canlıda müşteriye gösterilemez. Ama bu satırlara test ve geliştirme
sırasında oluşmuş siparişler, ödemeler ve fulfillment kayıtları bağlıdır
(`Order.serviceId`, `OrderItem.serviceVariantId`, `appliedPricingRuleId`).

**Karar.** Seed'e `deactivateStaleCatalog` adımı eklendi: gerçek katalogda yer
almayan platform/hizmet/varyant/fiyat kademeleri `isActive = false` yapılır,
**silinmez**. Public snapshot ve `resolvePrice` zaten yalnızca aktif kayıtları
görür, dolayısıyla pasif katalog ne listelenir ne sipariş edilir; geçmiş kayıtlar
ise okunabilir kalır.

Pasifleştirilen varyantların `isDefault` bayrağı da düşürülür — aksi halde aynı
hizmette iki "varsayılan" varyant kalır ve sihirbaz hangisini açacağını kayıt
sırasına göre seçerdi. (Bu hatayı `database.test.ts` yakaladı.)

Admin katalog ekranı **varsayılan olarak pasifleri de listeler**: gizlenen bir
kaydı geri açmak imkânsız olurdu.

---

## Faz 5 Uygulama Özeti

**Gerçek katalog — yalnızca Instagram**

| Hizmet | Varyant(lar) | Fiyat noktası | Model |
|---|---|---|---|
| Takipçi | Yabancı Takipçi · Türk Takipçi | 10 + 8 | preset paket |
| Beğeni | Türk Beğeni | 10 | preset paket |
| Görüntülenme | Video İzlenme | 9 | preset paket |
| Yorum | Türk Yorum | 7 | preset paket |
| Kaydetme | Kaydetme | 7 | preset paket |
| Paylaşım | Paylaşım | 7 | preset paket |
| Keşfet Paketi | Instagram Keşfet Paketi | 1 | sabit paket |
| Aylık Türk Beğeni + Yorum | Paket 1 · 2 · 3 · 4 | 4 | sabit paket |
| | **TOPLAM** | **63** | |

Kaydetme ve Paylaşım fiyatları birebir aynıdır ve tek sabitten (`PAYLASIM_KAYDETME`)
okunur — iki kopya zamanla ayrışırdı. `1.000.000` TÜRK takipçi paketi YOKTUR;
bir birim testi bunun eklenmediğini ayrıca doğrular.

**Şema değişikliği (migration 5, tamamen eklemeli)**
- `PricingMode` += `PACKAGE`
- `PricingRule.packagePriceMinor Int?`
- `ServiceVariant.description`, `.packageItems String[]`, `.presetOnly Boolean`
- `Order.pricingMode` — sipariş anındaki fiyat modeli snapshot'ı

**KDV.** Değişmedi. Tüm fiyatlar KDV DAHİL girilir, vergi brütten geriye
ayrıştırılır. 249,00 ₺ → 207,50 matrah + 41,50 KDV. 63 fiyat noktasının
tamamında `matrah + KDV = toplam` özdeşliği test edilir.

**Müşteri arayüzü**
- `presetOnly` varyantta fiyatlı miktar kartları (slider yok)
- tek seçenekli sabit pakette miktar seçici yerine **paket kartı** + içerik listesi
- varyant açıklaması ve paket içeriği DB'den gelir; hiçbir metin arayüzde sabit değil

**Admin**
- `/yonetim/katalog` — platform → hizmet → varyant zinciri, aktif/pasif anahtarı
- `/yonetim/katalog/[id]` — fiyat düzenleme (TL girişi → tam sayı kuruş),
  doğrulama raporu, fiyat simülatörü, **kim/ne zaman/eski→yeni** denetim listesi
- Simülatör müşteri motorunun BİREBİR aynısını çağırır; ayrı bir "admin hesabı"
  yoktur, olsaydı panelde doğru görünen fiyat müşteride farklı çıkabilirdi.

---

## ADR-021 — Türev Fiyat Seed'de Hesaplanır, Çalışma Zamanında Değil

**Bağlam.** Facebook ve TikTok fiyatları Instagram karşılığının %125'i, YouTube
Beğeni ise Instagram Türk Beğeni'nin %300'ü olarak tanımlandı. İki uygulama yolu
vardı: (a) çalışma zamanında "Instagram fiyatını oku ve çarp", (b) çarpımı bir kez
yapıp sonucu gerçek `PricingRule` satırı olarak yazmak.

**Karar.** (b). Türev fiyatlar seed'de hesaplanır ve DB'ye **gerçek kademe** olarak
yazılır.

Gerekçe:
- Instagram fiyatı yarın değişirse Facebook/TikTok fiyatı **sessizce kaymaz**.
  Runtime çarpımıyla, tek bir Instagram düzenlemesi üç platformun fiyatını aynı
  anda değiştirirdi — admin bunu görmeden.
- Admin her platformun fiyatını **ayrı ayrı** yönetebilir; türev fiyat başlangıç
  değeridir, kalıcı bir bağ değil.
- Fiyat çözümleme yolu tek kalır: `PricingRule` → `calculatePrice`. İkinci bir
  "hesaplanmış fiyat" kod yolu yoktur.

**Yuvarlama.** Çarpım tam sayı kuruş aritmetiğiyle, **en yakın kuruşa** yapılır:

```
4990 × 125 / 100 = 6237,5  →  6238     (49,90 ₺ → 62,38 ₺)
```

`applyBasisPoints(minor, 12_500)` — Faz 0'dan beri KDV hesabında kullanılan aynı
`divRoundHalfUp` yardımcısı. Kayan nokta kullanılmaz: %125 (5/4) ikilik tabanda
tam temsil edildiği için bu katsayıda tesadüfen doğru sonuç verirdi, ama katsayı
%115 olsaydı beş fiyat noktası sessizce bir kuruş aşağı kayardı. Bir birim testi
bu farkı açıkça gösterir.

**Determinizm.** Seed tekrar çalıştırıldığında türev fiyatlar bit düzeyinde aynı
kalır; bir entegrasyon testi 109 türev kademeyi seed öncesi/sonrası karşılaştırır.

---

## ADR-022 — Garanti Süresi Tahmin Edilmez

**Bağlam.** Faz 5'te tüm varyantlar `refillDays = null` ile bırakılmıştı: ürün
açıklamaları telafiden söz ediyordu ama hiçbir gün sayısı verilmemişti. Faz 5.1
yalnızca Instagram Takipçi için 365 gün bildirdi.

**Karar.** `refillDays` **yalnızca açıkça verilen** süreyle doldurulur.

| Hizmet | refillDays | Neden |
|---|---|---|
| Instagram Yabancı/Türk Takipçi | **365** | açıkça belirtildi |
| YouTube Abone / İzlenme / Beğeni | `null` | süre verilmedi |
| Facebook / TikTok (tümü) | `null` | süre verilmedi |

⚠️ Açıklamada "düşüşler telafi edilir" yazması bir SÜRE anlamına gelmez. YouTube
İzlenme açıklaması ücretsiz telafiden söz eder ama gün sayısı vermez; bir birim
testi tam olarak bunu kilitler.

**Snapshot zinciri (Faz 4'ten değişmedi).** Gün sayısı fulfillment AÇILIRKEN
katalogdan kopyalanır; `guaranteeEndsAt` ise COMPLETED anında hesaplanır:

```
ödeme doğrulandı → Fulfillment READY   (guaranteeDays = 365, guaranteeEndsAt = null)
… manuel operasyon …
operatör "Tamamla" dedi → guaranteeEndsAt = completedAt + 365 gün
```

Katalogdaki süre sonradan 30 güne indirilse bile tamamlanmış siparişin garantisi
365 gün kalır — bir entegrasyon testi katalogu değiştirip snapshot'ın sabit
kaldığını doğrular.

---

## ADR-023 — Katalog ile Adapter Ayrışamaz

**Bağlam.** `PlatformAdapter.supportedTargetTypes` Faz 0'dan beri tanımlıydı ama
**hiçbir yerde kontrol edilmiyordu**. Instagram adapter'ı `['PROFILE','POST']`
diyordu; katalogdaki "Görüntülenme" hizmeti ise `VIDEO` hedefi kullanıyordu. Kod
tesadüfen çalışıyordu (`parseTarget` POST ve VIDEO'yu aynı ele alıyor), ama
katalog ile adapter sessizce ayrışmıştı.

**Karar.** İki değişiklik:

1. Instagram adapter'ı `VIDEO`'yu da destekler olarak işaretlendi — reel/tv
   bağlantıları gerçekten çözümleniyor, liste eksikti.
2. `createService` / `updateService` artık `assertTargetTypeSupported` çağırır:
   adapter'ın desteklemediği bir hedef tipi **kaydedilemez**
   (`UNSUPPORTED_TARGET_TYPE`, 400).

Bu, Faz 5.1'de üç yeni platform eklenirken önemliydi: TikTok adapter'ı `POST`
desteklemez (içerik zaten videodur), dolayısıyla TikTok beğeni/yorum/paylaşım
hizmetleri `VIDEO` hedefi kullanır. Guard olmasaydı yanlış hedef tipiyle bir
hizmet eklenip müşteri hedefini giremediğinde ancak canlıda fark edilirdi.

---

## Faz 5.1 Uygulama Özeti

**Şema değişikliği YOK.** Yeni migration yazılmadı: `ServiceVariant.refillDays`
Faz 0'dan beri mevcuttu, yeni platformlar mevcut `Platform` modelini kullanıyor.
Faz 5.1 tamamen **veri ve doğrulama** fazıdır.

**Katalog**

| Platform | Hizmet | Varyant | Fiyat noktası | Kaynak |
|---|---|---|---|---|
| Instagram | 8 | 12 | 63 | gerçek liste (Faz 5) |
| YouTube | 3 | 4 | 27 | gerçek liste (Faz 5.1) |
| Facebook | 5 | 6 | 51 | Instagram × %125 |
| TikTok | 6 | 7 | 58 | Instagram × %125 |
| **TOPLAM** | **22** | **29** | **199** | |

**Facebook/TikTok'a KOPYALANMAYANLAR**
- `Keşfet Paketi` ve `Aylık Türk Beğeni + Yorum Paketi` — Instagram'a özgü
  kurgulardır; başka platformda karşılığı yoktur.
- **Facebook Kaydetme** — Facebook'ta kaydetme özel bir işlemdir ve gönderide
  herkese açık bir sayaç YOKTUR. Ölçülemeyen bir teslim, Faz 4'ün metrik tabanlı
  ilerleme modeliyle de bağdaşmaz. TikTok'ta ise favori sayısı videonun üzerinde
  herkese açık göründüğü için Kaydetme hizmeti VARDIR.

**YouTube üst sınırları**
- Türk Abone: 100 / 250 / 500. Maksimum 500; 501 ve 1.000 hem arayüzde seçilemez
  hem sunucuda `QUANTITY_NOT_ALLOWED` ile reddedilir.
- Yabancı Abone: "maksimum 1 Milyon" bilgisi müşteriye ANLATILIR ama 1.000.000
  için fiyat verilmediğinden **seçilebilir bir paket üretilmedi**.

**Türev açıklamalar.** Instagram takipçi açıklamasındaki "her gün takip edilir ve
düşüş aynı gün yüklenir" telafi vaadi Facebook/TikTok'a kopyalanmadı: o
platformlarda garanti süresi verilmedi ve karşılığı olmayan bir söz verilemez.
Yalnızca bileşim bilgisi ("Takipçiler Türk'tür, düşüş oranı %1-%5") taşındı.

---

**Faz 5.1'den devreden teknik borç** Faz 6 listesinde birleştirildi.

---

## ADR-024 — Katalog Arayüzü Katalogdan Üretilir, Metinde Bile

**Bağlam.** Ana sayfada hizmetleri tanıtmak için en kolay yol, platform ve
hizmet adlarını JSX'e yazmaktı. Ama katalog Faz 5.1'de bir gecede 1 platformdan
4 platforma çıktı; sabitlenmiş bir liste o gün sessizce yanlışa dönerdi.

**Karar.** Müşteri yüzeyindeki HİÇBİR katalog bilgisi kodda yazılı değildir:

- Hizmet keşfi (`ServiceExplorer`) tamamen `catalog/snapshot`tan render edilir.
- Hero cümlesindeki platform adları bile katalogdan birleştirilir
  (`"Instagram, TikTok, YouTube ve Facebook hesaplarınız için…"`).
- Hero sayaçları (`4 Platform · 22 Hizmet`) katalogdan sayılır.
- Garanti rozetleri `refillDays` doluysa gösterilir, null ise HİÇ gösterilmez.
- SEO açıklaması bilinçli olarak hizmet SAYMAZ — katalog değiştiğinde meta
  metninin yanlışa dönmesi imkânsızdır.

⚠️ Kart başına ayrı API isteği YOKTUR: sayfa tek snapshot'ı sunucuda okur, hem
keşif hem sihirbaz aynı veriyi kullanır. `ServiceExplorer` ve kabuk bileşenleri
SUNUCU bileşenidir; aç-kapa için `<details>` kullanılır, JS bundle büyümez.

---

## ADR-025 — Mobil Fiyat Çubuğu Sihirbaza Girmeden Gösterilmez

**Bağlam.** Alta yapışan fiyat çubuğu Faz 0'dan beri sayfa açılır açılmaz
görünüyordu. Faz 6'da ana sayfaya keşif bölümü eklenince sorun görünür hâle
geldi: kullanıcı hizmetleri okurken 390px'lik ekranın altında **pasif** bir
"Siparişi Oluştur" düğmesi ve "Başlamak için bir platform seçin" uyarısı
duruyordu — hem içerik alanını yiyor hem de ekranda ikinci bir CTA gürültüsü
yaratıyordu.

**Karar.** Çubuk yalnızca kullanıcı bir platform seçtikten SONRA belirir.
Ana sayfada asıl çağrı zaten platform kartlarıdır.

**Ek olarak** ekran görüntüsü denetiminde çıkan gerçek bir dokunma hatası
düzeltildi: kaydırma sonrası çubuk, hedef onay kutusunu ÖRTÜYORDU — kullanıcı
kutuyu görüyor ama dokunamıyordu. Sihirbazdaki etkileşimli öğelere
`scroll-margin-bottom: 9rem` verildi (`.wizard-scope`), böylece
`scrollIntoView` her zaman çubuğun üstünde bırakır.

---

## ADR-026 — Müşteri Yüzeyinde Teknik Dil Yok

**Bağlam.** Faz 6 testleri müşteri metinlerini kelime bazlı tarayınca iki
sızıntı çıktı:

1. Hedef doğrulanamadığında gösterilen mesaj: *"Instagram hesap bilgileri
   **resmî API** üzerinden alınamıyor."*
2. Sipariş zaman çizelgesinde: *"**mock** ödemesi doğrulandı."* — yani ödeme
   SAĞLAYICISININ ADI müşteriye görünüyordu.

**Karar.** Müşteriye giden her metin sade Türkçedir:

| Önce | Sonra |
|---|---|
| "resmî API üzerinden alınamıyor" | "profil bilgilerini otomatik olarak alamıyoruz" |
| "`${provider}` ödemesi doğrulandı." | "Ödemeniz doğrulandı." |

Sağlayıcı bilgisi `PaymentEvent` ve `AuditLog`'da zaten durur; operasyonel bir
ayrıntıdır ve müşteri yüzeyine çıkmaz. Ayrıca `EVENT_LABELS` genişletildi:
"Güncelleme" gibi anlamsız yedek etiketler yerine `PAYMENT_INITIATED`,
`NOTE_ADDED`, `GUEST_CLAIMED` gibi olaylar kendi Türkçe adlarıyla görünür.

---

## Faz 6 Uygulama Özeti

**Yeni bileşen ve sayfalar**

| Dosya | Ne yapar |
|---|---|
| `components/layout/SiteHeader.tsx` | Hizmetler / Sipariş Takip / Yardım + CTA · JS'siz mobil menü (`<details>`) |
| `components/layout/SiteFooter.tsx` | 4 kolonlu alt bilgi, yasal metinler tek kaynaktan |
| `components/home/ServiceExplorer.tsx` | Katalogdan üretilen platform → hizmet keşfi |
| `app/yardim/page.tsx` | SSS — garanti süreleri ve platform adları katalogdan |

**Sipariş sihirbazı**
- Adımlar `01`, `02` … biçiminde numaralanır; tamamlanan adım onay işaretine döner
  ve ekran okuyucuya "Adım 3 — tamamlandı" olarak duyurulur.
- Varyant kartlarında açıklama + `refillDays`'ten üretilen
  **"365 Gün Telafi Garantisi"** rozeti.
- Hazır paket kartlarında "Paket fiyatı · KDV dahil" ve gerçek fiyattan türetilen
  **"En avantajlı"** işareti (birim maliyeti en düşük paket).
- Fiyat özetinde artık **Ara toplam (matrah)** ve **KDV (%20)** satırları var;
  KDV EKLENMEZ, brütten ayrıştırılır — toplam değişmez.
- Derin bağlantı: `/?p=instagram&s=takipci#siparis` sihirbazı doğru adımdan açar.
  ⚠️ İstemci tarafı gezinmede bileşen yeniden mount OLMADIĞI için adres çubuğunu
  ilk render'da okumak yetmiyordu; `useSearchParams` ile her gezinmede uygulanır.

**Müşteri ekranları**
- `/hesabim`: karşılama, gerçek sayaçlar (aktif/tamamlanan/toplam), hesap
  bilgileri, aktif · tamamlanan · geçmiş sipariş grupları.
- Sipariş detayı: garanti kartı — **"365 Gün Telafi Garantisi"** ve tamamlanma
  sonrası **"Garanti bitiş: 18 Ağustos 2027"**. Değer sipariş SNAPSHOT'ından
  gelir; katalog sonradan değişse eski sipariş etkilenmez.
- Ödeme başarı ekranına "Hesabıma git" bağlantısı eklendi.
- `/siparis-takip`: "Sipariş numaranızı bulamıyor musunuz?" yardım kartı;
  güvenlik modeli (numara TEK BAŞINA yetmez) aynen korundu.

**Erişilebilirlik**
- "İçeriğe geç" atlama bağlantısı (ilk Tab).
- Tek `h1`, anlamlı başlık hiyerarşisi, `aria-labelledby` boşa işaret etmiyor.
- Mobilde `sr-only` atlama bağlantısı dışında 44px altında dokunma hedefi YOK.
- Focus ring, `aria-live`, `aria-invalid`, `prefers-reduced-motion` korundu.

**SEO**
`Medya 333 | Sosyal Medya Hizmetleri` + Türkçe açıklama, OpenGraph ve Twitter
kartı, `tr_TR` locale, canonical. Açıklama katalog saymaz (bkz. ADR-024).

---

## ADR-027 — Üretim Kapısı `NODE_ENV`'e Değil, Aşamaya Bakar

**Bağlam.** Faz 7'de açılış kapısı (`assertProductionReady`) yazıldığında koşul
`NODE_ENV === 'production'` idi. Kapı ilk kez çalıştırıldığında **E2E paketinin
tamamı düştü**: `next start` `NODE_ENV`'i her zaman `production` yapar, dolayısıyla
mock ödeme + `http://127.0.0.1` adresiyle çalışan E2E sunucusu kapıya takıldı.

Bu, testin bulduğu bir test hatası değil, **kavram hatasıydı**: `NODE_ENV`
*derleme kipini* söyler ("optimize edilmiş bundle"), *dağıtım aşamasını* değil
("gerçek müşteriler, gerçek para"). Staging de, E2E de, yerel önizleme de üretim
derlemesi çalıştırır.

**Karar.** Ayrı bir `APP_ENV` değişkeni eklendi: `production | staging | e2e`.
Kapı `NODE_ENV === 'production' && APP_ENV === 'production'` iken serttir.

**Varsayılanın yönü kritik.** İki seçenek vardı:

| Varsayılan | Unutulursa ne olur |
|---|---|
| `development` | **Canlıda kapı sessizce kapalı kalır** — mock ödemeyle yayına çıkılır |
| `production` | Staging'de gereksiz yere blocker alınır — gürültülü ama zararsız |

İkincisi seçildi: **fail-closed**. `APP_ENV` tanımsızsa canlı varsayılır. Yanlış
yapılandırmanın maliyeti simetrik değildir; sessiz başarısızlık, gürültülü
başarısızlıktan pahalıdır.

**Kaçış kapısına dönüşmesin diye.** `APP_ENV=staging` yazıp gerçek kart çekmek
mümkün olmamalıdır. Bu yüzden aşamadan **bağımsız**, her ortamda blocker kalan
tek bir kural var:

```
APP_ENV ≠ production  &&  PAYMENT_ENVIRONMENT = production  →  STAGE_REAL_PAYMENT
```

Yani kapıyı gevşetmenin bedeli, gerçek tahsilattan vazgeçmektir. İkisini birden
alamazsınız.

**Sonuç.** `playwright.config.ts` içinde `APP_ENV: 'e2e'`; canlıda `production`
(veya hiç). Boot log'unun ilk satırı hangi aşamada açıldığını yazar:
`[boot] APP_ENV=e2e canli=hayır bulgu=6`.

---

## ADR-028 — Rate Limit Tablosu Bir Envanter Değil, Bir Söz

**Bağlam.** Faz 7'de uç bazlı rate limit envanteri çıkarılırken `RATE_LIMITS`
tablosundaki 21 kuralın **üçünün hiçbir yerden çağrılmadığı** görüldü:

| Kural | Durum |
|---|---|
| `admin.refund.user` (20/saat) | Tanımlı, çağrılmıyor — **para iadesi yalnızca genel 100/dk limitindeydi** |
| `payments.init.order` (5/dk) | Tanımlı, çağrılmıyor — sipariş bazlı eksen yoktu |
| `media.proxy.ip` (60/dk) | Tanımlı, **karşılık gelen uç hiç yok** |

Bu, denetimin en sinsi bulgusudur: belge de, kod da "korunuyor" der; koruma
yoktur. Tablo okunduğunda güvence hissi verir, çalıştığında hiçbir şey yapmaz.

**Karar.**
1. `admin.refund.user` → `POST /admin/orders/{no}/refund` içine bağlandı.
   Genel yönetim limiti (100/dk) para iadesi için fazla cömerttir; iade geri
   alınamaz ve her deneme sağlayıcıya gerçek bir işlem yollar.
2. `payments.init.order` → `POST /payments/create` içine bağlandı. Yalnızca IP
   ekseni, dağıtık IP'lerden **aynı siparişte** ödeme oturumu açmayı engellemez.
3. `media.proxy.ip` → **silindi.** Karşılığı olmayan kural, ileride bir uç
   yazıldığında "zaten korunuyor" yanılsaması üretir.

**Kalıcı hale getirme.** `tests/unit/production-audit.test.ts` artık tabloyu
tarayıp her anahtarın en az bir çağrı yeri olduğunu doğruluyor. Kullanılmayan
bir kural eklemek testi kırar.

**İlgili yan etki.** `adminHandler` handler'ın dönüşünü JSON'a sarıyordu; kendi
başlıklarıyla 429 döndürebilmek için `NextResponse` dönüşleri artık olduğu gibi
geçiriliyor (aksi halde cevap ikinci kez sarılır ve durum kodu 200'e düşerdi).

---

## Faz 7 Uygulama Özeti

**Amaç:** yeni özellik değil; canlıya çıkış öncesi güvenlik, stabilite,
yapılandırma, dağıtım ve gözlemlenebilirlik denetimi.

**Eklenen dosyalar**

| Dosya | İş |
|---|---|
| `src/server/production-guard.ts` | Açılış kapısı: 13 bulgu kodu, blocker/warning ayrımı, **sır DEĞERİ asla yazılmaz** |
| `src/instrumentation.ts` | Süreç açılışında kapıyı çalıştırır; aşamayı log'un ilk satırına yazar |
| `src/app/robots.ts` | `/api/`, `/yonetim/`, `/panel/`, `/hesabim`, `/siparisler/`, `/odeme/` taramaya kapalı |
| `src/app/sitemap.ts` | Katalogdan üretilir; katalog okunamazsa statik sayfalara düşer, **boş dönmez** |
| `src/app/icon.svg` | Mevcut `Mark` bileşeninin SVG'si — yeni logo TASARLANMADI |
| `docs/PRODUCTION_CHECKLIST.md` | Blocker listesi, env tablosu (secret sınıflaması), deploy/rollback/yedekleme |
| `docs/SECURITY_MATRIX.md` | 5 rol × uç yetki matrisi + uç bazlı rate limit envanteri |

**Denetimde bulunan ve düzeltilen GERÇEK eksikler**

1. **CSP hiç yoktu.** Faz 0'daki yorum "Faz 4'te eklenecek" diyordu; eklenmemişti.
   Tam politika yazıldı; `frame-src`/`form-action` yalnızca ödeme sağlayıcısının
   3DS alan adlarına açık, `frame-ancestors 'none'`, `object-src 'none'`,
   **`unsafe-eval` yok**.
2. **`robots.txt` / `sitemap.xml` / favicon yoktu.** Yönetim ve hesap yolları
   arama motorlarına açıktı.
3. **Açılış kapısı yoktu.** Yalnızca ödeme anında çalışan `assertPaymentConfig`
   vardı; mock sağlayıcıyla canlıya çıkmak mümkündü.
4. **Ölü rate limit kuralları** (ADR-028).
5. **Aşama/derleme karışıklığı** (ADR-027).
6. **İstek kimliği yoktu.** `X-Request-Id` + `error.requestId` eklendi; beklenmeyen
   hata mesajı müşteriye iç detay değil, destek ekibine iletilecek bir kod veriyor.

**Denetlenip TEMİZ çıkanlar (değişiklik gerekmedi)**

- Ham SQL'in tamamı parametreli tagged template; `$queryRawUnsafe` yok.
- Şemada ve kodda PAN/CVV alanı yok; kart verisi hiç DB'ye ulaşmıyor.
- 5 migration'ın hiçbirinde `DROP TABLE`/`DROP COLUMN`/veri kaybı yok.
- Oturum çerezi `httpOnly` + `sameSite=lax` + şemaya göre `secure`/`__Secure-`.
- Seed demo veri EKLEMİYOR; eski katalog silinmiyor, pasifleştiriliyor (ADR-020).
- Webhook: imza + tekrar + tutar/para birimi/sipariş eşleşmesi + eşzamanlılık.

**Doğrulama sonuçları**

```
tsc --noEmit                 0 hata
next build                   başarılı
vitest                       707 passed (24 dosya)
playwright                   181 passed · 3 skipped (desktop + mobile)
scripts/screenshots.mjs      6 genişlikte yatay taşma = 0px
curl -I (üretim derlemesi)   CSP · HSTS · XCTO · XFO · Referrer · Permissions · COOP servis ediliyor
```

**Kapının canlı kanıtı.** Kapı yazıldıktan sonra sandbox yapılandırmasıyla
`NODE_ENV=production` sunucu başlatıldığında süreç **açılmadı** ve beş blocker'ı
adlarıyla listeledi — sır değeri yazmadan. Bu, birim testin değil, gerçek
sürecin verdiği kanıttır.

---

## Sonraki Faz — Faz 8 (onay bekliyor)

Faz 7 kapsamı tamamlandı. Yeni faza kendiliğinden geçilmez.

### ⚠️ CANLIYA ÇIKIŞ DEĞERLENDİRMESİ: HAZIR DEĞİL

Kod tarafı hazırdır. Hazır olmayan şey **ortamdır** ve bunların hiçbiri kodla
"varmış gibi" gösterilmedi:

| # | Blocker | Neden kodla çözülemez |
|---|---|---|
| B1 | Gerçek merchant bilgisi yok | Sahte credential üretmek = ödeme almadan sipariş onaylamak |
| B2 | E-posta sağlayıcısı yok (`ConsoleMailProvider`) | Müşteriye takip linki GİTMİYOR; sahte SMTP eklenmedi |
| B3 | Alan adı + TLS bağlı değil | `__Secure-` çerezler ve callback'ler HTTPS ister |
| B4 | Yönetilen PostgreSQL + Redis yok | Yedek/replica/erişim politikası altyapı kararıdır |
| B5 | Hata izleme (Sentry) yok | DSN olmadan Sentry entegre etmek boş bağımlılık olur |

### Kalan teknik borç

- **Operatör kuyruğunda sayfalama yok.** 50'den fazla açık iş olduğunda en yeni
  sipariş ilk sayfada görünmüyor. Cursor tabanlı sayfalama gerekir.
- Ters proxy `X-Forwarded-For`'u istemciden geleni **ezerek** yazmalıdır; aksi
  halde rate limit kimliği taklit edilebilir.
- Garanti süresi yalnızca Instagram Takipçi'de tanımlı.
- Admin panelinde hizmet/varyant oluşturma ve fiyat kademesi ekleme formu yok.
- Rol atama arayüzü yok; roller DB'den veriliyor.
- OG görseli (`og:image`) üretilmedi — gerçek marka görseli bekleniyor.
- `Logo` hâlâ wordmark; gerçek marka asset'i geldiğinde yalnızca o dosya değişir.
- Prisma WASM şema motoru diff alamıyor; migration'lar elle yazılıyor.
