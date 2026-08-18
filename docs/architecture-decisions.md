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
