# Medya 333 — Faz 11

Sosyal medya tanıtım hizmetleri sipariş platformu.
**Faz 0** (iskelet + sihirbaz) + **Faz 1** (gerçek DB, katalog/pricing API, admin CRUD, Redis)
+ **Faz 2** (sipariş oluşturma, misafir takibi, hesap, admin sipariş yönetimi)
+ **Faz 3** (ödeme altyapısı: iyzico/PayTR adapter, webhook, iade)
+ **Faz 4** (fulfillment: operasyon kuyruğu, manuel ilerleme, garanti/telafi)
+ **Faz 5** (gerçek Instagram kataloğu: 8 hizmet · 12 varyant · **63 gerçek fiyat noktası**)
+ **Faz 5.1** (YouTube · Facebook · TikTok · Instagram takipçi garantisi 365 gün —
  toplam **4 platform · 22 hizmet · 29 varyant · 199 fiyat noktası**)
+ **Faz 6** (müşteri deneyimi: hizmet keşfi, premium kabuk, garanti görünümü, Yardım, SEO)
+ **Faz 7** (production readiness: üretim açılış kapısı, CSP ve güvenlik başlıkları,
  robots/sitemap/favicon, istek kimliği, yetki matrisi, rate limit envanteri,
  dağıtım ve yedekleme kontrol listesi)
+ **Faz 8** (operasyon: sağlayıcı-bağımsız e-posta + idempotent bildirim katmanı,
  cursor tabanlı iş kuyruğu, arama/filtre/sıralama, katalog CRUD arayüzü,
  sağlık ucu, operasyon el kitabı)
+ **Faz 9** (canlıya çıkış hazırlığı: üretim alan adı standardı, çalışma zamanı
  canonical/OG, Sentry iskeleti + PII temizliği, bildirim paneli, rol yönetimi,
  liveness/readiness ayrımı, DNS/SPF/DKIM/DMARC ve yedekleme kontrol listeleri)
+ **Faz 10** (üretim altyapısı: dağıtım damgasıyla ortam izolasyonu, seed üretim
  kapısı, standalone Docker imajı + imaj denetim scripti, ortam ayrımı doğrulama
  aracı, ölçülmüş N+1 kanıtı, kuyrukta objektif bekleme süresi, web manifest,
  üretim runbook'u ve canlıya çıkış kontrol listesi)
+ **Faz 11** (Vercel dağıtım hazırlığı: güvenilir proxy modeliyle istemci IP
  çözümleme — **rate limit sahtecilik açığı kapatıldı**, serverless bağlantı
  havuzu sınırı, mod bazlı boot davranışı, canlı olmayan ortamların
  indekslenmemesi, okuma/yazma ayrımlı duman testi ve Vercel dağıtım belgesi).

**CANLI ALAN ADI: `https://www.medya333.com`**

> ⚠️ **CANLIYA ÇIKIŞ DURUMU: HAZIR DEĞİL.** Kod tarafı hazırdır; ancak
> **hiçbir dış servis bağlı değildir**: merchant bilgisi (PayTR onayı
> bekleniyor), e-posta sağlayıcısı, DNS/TLS, yönetilen PostgreSQL + Redis,
> hata izleme ve doğrulanmış yedekleme.
>
> Bunların hiçbiri kodla "varmış gibi" gösterilmemiştir. Altı açık madde:
> [`docs/PRODUCTION_CHECKLIST.md` § 0](docs/PRODUCTION_CHECKLIST.md).
>
> **Faz 11 — Vercel:** Uygulama Vercel'e **dağıtılabilir hâle getirildi**;
> ancak Vercel projesi, uzak Git deposu, yönetilen PostgreSQL/Redis ve
> alan adı geçişi **henüz yok**. Dağıtım adımları ve denetim bulguları:
> [`docs/VERCEL_DEPLOYMENT.md`](docs/VERCEL_DEPLOYMENT.md).
>
> **Faz 11'de kapatılan gerçek güvenlik açığı:** rate limit kimliği
> `x-forwarded-for`'un **en soldaki** (istemcinin yazdığı) değerinden
> okunuyordu. Saldırgan her istekte farklı bir sahte IP göndererek giriş,
> kayıt ve sipariş limitlerini **tamamen atlatabilirdi**. Artık güven modeli
> `TRUSTED_PROXY` ile açıkça seçiliyor ve zincirin **en sağdaki** değeri
> kullanılıyor (ADR-046, 21 regresyon testi).
>
> **Faz 10'da ölçülen gerçek:** `www.medya333.com` şu anda bir **Wix
> sitesine** işaret ediyor; alan adının SPF kaydı yalnızca Google'ı içeriyor ve
> **DKIM / DMARC kaydı yok**. Yani bugün Resend üzerinden gönderilen bir
> e-posta SPF'ten geçmez. Ayrıntı ve yapılacaklar:
> [`docs/PRODUCTION_RUNBOOK.md` § 9](docs/PRODUCTION_RUNBOOK.md).
>
> Adım adım canlıya çıkış: [`docs/PRODUCTION_RUNBOOK.md`](docs/PRODUCTION_RUNBOOK.md) ·
> Kontrol listesi: [`docs/LAUNCH_CHECKLIST.md`](docs/LAUNCH_CHECKLIST.md) ·
> Ortam ayrımı: [`docs/ENVIRONMENTS.md`](docs/ENVIRONMENTS.md)

> **İş modeli:** Hizmetler **gerçek kullanıcılar** tarafından **manuel** gerçekleştirilir.
> Bu sistem bot, sahte hesap veya otomatik sosyal medya etkileşimi ÜRETMEZ.
> Platform entegrasyonları yalnızca hedef doğrulama/önizleme amaçlıdır; scraping kullanılmaz.
> **Fulfillment yalnızca insanın yaptığı işin KAYDIDIR** — sistem hiçbir koşulda
> işi kendi başlatmaz, ilerletmez veya tamamlamaz.

---

## Hızlı Başlangıç

```bash
npm install
cp .env.example .env          # AUTH_SECRET, IP_HASH_SALT, ORDER_TOKEN_SECRET üretin
docker compose up -d          # Postgres + Redis

npm run db:generate
npm run db:migrate            # ilk kurulumda migration'ı uygular
npm run db:seed
npm run dev                   # http://localhost:3000
```

`openssl rand -base64 48` → AUTH_SECRET, ORDER_TOKEN_SECRET · `openssl rand -hex 24` → IP_HASH_SALT

---

## Komutlar

| Komut | Açıklama |
|---|---|
| `npm run dev` / `build` / `start` | Geliştirme · üretim derlemesi · üretim sunucusu |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest — unit + entegrasyon |
| `npm run test:unit` / `test:integration` | Ayrı ayrı |
| `npm run test:e2e` | Playwright (önce `npm run build` gerekir) |
| `npm run verify` | typecheck + test + build (CI kapısı) |
| `npm run db:generate` / `db:migrate` / `db:deploy` / `db:seed` / `db:reset` | Prisma |
| `npm run db:validate-pricing` | Tüm fiyat tablolarını doğrular (boşluk/çakışma) |
| `node scripts/screenshots.mjs <url>` | 12 ekranın görüntüsünü alır, 6 genişlikte yatay taşma ölçer |
| `npm run db:stamp -- --stage=<aşama>` | ⭐ Veritabanını bir ortama damgalar (yanlış-ortam koruması) |
| `npm run db:stamp:check` | Mevcut damgayı gösterir |
| `npm run env:check -- <a> <b>` | ⭐ İki ortamın paylaştığı sırları bildirir (değer yazdırmaz) |
| `./scripts/verify-image.sh <imaj>` | ⭐ Üretim imajını denetler (sır/dev bağımlılığı/root/source map) |
| `SMOKE_BASE_URL=<url> npm run test:smoke` | ⭐ Duman testi — **hiçbir kayıt oluşturmaz**, canlıya karşı da çalışır |
| `npm run migrate:wasm` | ⚠️ Engine indirilemeyen ortamlarda migration (aşağı bkz.) |

### Üretim belgeleri

| Belge | İçerik |
|---|---|
| [`docs/VERCEL_DEPLOYMENT.md`](docs/VERCEL_DEPLOYMENT.md) | ⭐ **Vercel dağıtımı** — denetim bulguları, ortam matrisi, DNS hedefi, rollback |
| [`docs/PRODUCTION_RUNBOOK.md`](docs/PRODUCTION_RUNBOOK.md) | ⭐ **Adım adım canlıya çıkış** — 14 adım, her biri READY / PENDING / BLOCKED |
| [`docs/LAUNCH_CHECKLIST.md`](docs/LAUNCH_CHECKLIST.md) | ⭐ **Kontrol listesi** — 12 grup; yapıldı mı sorusunun cevabı |
| [`docs/ENVIRONMENTS.md`](docs/ENVIRONMENTS.md) | ⭐ **Ortam ayrımı** — development / staging / production matrisi, dağıtım damgası |
| [`docs/PRODUCTION_CHECKLIST.md`](docs/PRODUCTION_CHECKLIST.md) | Canlıya çıkış: blocker'lar, env tablosu, deploy/rollback/yedekleme adımları |
| [`docs/SECURITY_MATRIX.md`](docs/SECURITY_MATRIX.md) | 5 rol × uç yetki matrisi + uç bazlı rate limit envanteri |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | **Operasyon el kitabı** — sipariş bulma, atama, ilerleme, tamamlama, telafi, fiyat değiştirme |
| [`.env.example`](.env.example) | Gruplanmış ortam değişkenleri: APPLICATION · DATABASE · REDIS · AUTH · EMAIL · PAYMENT · MONITORING |
| [`Dockerfile`](Dockerfile) · [`docker-compose.production.yml`](docker-compose.production.yml) | ⭐ Üretim imajı — sırsız, dev bağımlılığısız, non-root, sağlık uçlu |
| [`docs/architecture-decisions.md`](docs/architecture-decisions.md) | ADR'ler ve faz uygulama özetleri |

### ⚠️ Üretim alan adı: `https://www.medya333.com`

Tüm **sunucu tarafı** adresler tek bir çalışma zamanı değişkeninden üretilir:

```
APP_BASE_URL=https://www.medya333.com
NEXT_PUBLIC_SITE_URL=https://www.medya333.com   # aynı değer
```

`APP_BASE_URL`den üretilenler: ödeme callback'leri · e-posta bağlantıları ·
sipariş takip linkleri · `canonical` · `og:url` · `robots.txt` · `sitemap.xml` ·
**oturum çerezinin `Secure` / `__Secure-` kararı**.

> ⚠️ **Neden `NEXT_PUBLIC_SITE_URL` değil?** Next.js `NEXT_PUBLIC_` değişkenlerini
> DERLEME sırasında koda gömer. Aynı imaj farklı bir ortama konduğunda canonical
> ve OG adresleri yanlış olur; değişken derleme anında tanımsızsa **canlıda
> `http://localhost:3000` yayınlanır**. Hiçbir hata alınmaz, hiçbir test kırılmaz —
> sadece sessizce yanlış olur. Faz 9'da bu iki yer (metadata ve çerez şeması)
> çalışma zamanına taşındı.

İkisi farklıysa boot `BASE_URL_MISMATCH` uyarısı verir.

### ⚠️ E-posta sağlayıcısı: `EMAIL_PROVIDER`

| Değer | Davranış |
|---|---|
| `resend` | Gerçek gönderim. `RESEND_API_KEY` olmadan **seçilemez**. |
| `none` | Gönderim YAPILMAZ ve **başarılı sayılmaz** — bildirim kaydı `FAILED`. Canlı varsayılanı. |
| `console` | Yalnızca geliştirme. **Canlıda boot'u durdurur** (teslim etmediği hâlde başarı döndürür). |

**Kural:** eksik yapılandırma sessiz bir başarısızlığa değil, görünür bir
sayaca dönüşür. `Notification.status = 'FAILED'` sayısı, "müşteriye e-posta
gitmiyor" demenin ölçülebilir hâlidir.

### ⚠️ Aşama değişkeni: `APP_ENV`

`next start` `NODE_ENV`'i **her zaman** `production` yapar — staging ve E2E de
üretim derlemesi çalıştırır. Bu yüzden "gerçekten canlıyız" kararı `APP_ENV`'den
okunur (`src/server/production-guard.ts`).

- Tanımsız → `production` varsayılır (**fail-closed**): canlıda yazmayı unutmak
  kapıyı gevşetmez.
- `staging` / `e2e` → blocker'lar uyarıya düşer, üretim derlemesi mock ödeme ve
  HTTP adresle açılabilir.
- Kaçış kapısı **değildir**: `APP_ENV ≠ production` iken
  `PAYMENT_ENVIRONMENT=production` **açılamaz** (`STAGE_REAL_PAYMENT`).

### Kısıtlı ağlarda migration

`prisma migrate`, Rust `schema-engine` binary'sini `binaries.prisma.sh`'ten indirir.
Bu adresin engellendiği ortamlarda `npm run migrate:wasm create <isim>` komutu,
Prisma'nın **resmî** `@prisma/schema-engine-wasm` paketini driver adapter ile
doğrudan sürerek aynı SQL'i üretir. Normal ortamlarda `npm run db:migrate` kullanın.

---

## Mimari Kuralları

| Katman | Kural |
|---|---|
| `src/lib/` | Saf, ağsız, DB'siz, **izomorfik** — pricing, state machine, parse tek yerde |
| `src/server/` | `import \'server-only\'` — sır sızıntısı derleme hatası olur |
| `src/components/` | Prisma bilmez |

**Değişmez kurallar**

1. Para = **tam sayı kuruş** (`Int`). Float/Decimal yok.
2. **Fiyatlar KDV DAHİL.** Vergi brütten geriye ayrıştırılır; oran sipariş anında snapshot'lanır.
3. Fiyat **asla istemciden gelmez** — `resolvePrice()` DB'den yeniden hesaplar.
4. `order.status = x` ataması yasak — yalnızca state machine üzerinden.
5. Kod tabanında `if (platform === \'instagram\')` **hiçbir yerde geçmez**.
6. Sorgular kullanıcıya kapsamlanır: `where: { id, userId }` (IDOR).
7. **Üretimde Redis zorunlu** — yoksa boot'ta hata.
8. **ÖDEME ALINMADAN FULFILLMENT YOK.** `PENDING_PAYMENT` sipariş aktif iş
   kuyruğunda görünmez; `PROCESSING`'e geçiş iki bağımsız kapıdan da reddedilir.
9. **Sipariş numarası tek başına erişim vermez** — e-posta eşleşmesi ya da
   imzalı takip token'ı şarttır.
10. **Ödeme tutarının tek kaynağı `Order.totalMinor`.** Ödeme servisi tutar
    parametresi ALMAZ; istemci gövdesindeki `amount` alanları yok sayılır.
11. **Ödeme sonucunun tek otoritesi doğrulanmış sunucu bildirimidir.**
    Tarayıcının success URL'ine dönmesi kanıt değildir; `PAID` yalnızca imzası
    doğrulanmış webhook ile yazılır.
12. **Kart verisi hiçbir yerde saklanmaz/loglanmaz** — sağlayıcı yanıtları
    `redactProviderPayload`'dan geçmeden DB'ye veya log'a yazılamaz.
13. **FULFILLMENT OTOMATİK BAŞLAMAZ / TAMAMLANMAZ.** Sistemin üretebileceği tek
    fulfillment durumu `READY`'dir (`AUTO_CREATABLE_STATUSES`).
    `PROCESSING · STARTED · PARTIAL · COMPLETED · FAILED` yalnızca `actorUserId`
    dolu bir aksiyonla yazılabilir (`assertManualActor`).
14. **İlerleme yüzdesi backend'de hesaplanır.** İstemci `percent`/`remaining`
    gönderemez; şemada bu alanlar yoktur. `deliveredQuantity > requestedQuantity`
    veri katmanında imkânsızdır.
15. **Metrik düşüşü hata değildir** — `METRIC_DECREASED` event'i yazılır,
    teslim sayısı geri alınmaz, operasyon durmaz.
16. **Telafi (replacement) tamamen manueldir.** `DROP_DETECTED → REVIEW_REQUIRED
    → APPROVED` zincirinde onay `ADMIN+` ister; otomatik telafi yoktur.
17. **FİYAT UYDURULMAZ.** Katalogdaki fiyatlar gerçek satış fiyatlarıdır;
    yuvarlanmaz, birim fiyata çevrilmez, yeniden hesaplanmaz. Listede olmayan
    miktar/paket ÜRETİLMEZ.
18. **Sabit pakette `quantity × unitPrice` YAPILMAZ.** `PricingMode.PACKAGE`
    kademesinde tutar `packagePriceMinor` alanından olduğu gibi okunur
    (32490 / 500 = 64,98 kuruş — bölmek kuruş kaybıdır).
19. **Hazır miktar kilidi.** `presetOnly` varyantta yalnızca
    `presetQuantities` içindeki miktarlar seçilebilir; 7.342 hem arayüzde
    seçilemez hem sunucuda `QUANTITY_NOT_ALLOWED` ile reddedilir.
20. **Pasif katalog satılmaz ama SİLİNMEZ.** Pasif kayıt public katalogda
    görünmez ve sipariş edilemez; geçmiş sipariş/ödeme/fulfillment bozulmaz.
21. **GARANTİ SÜRESİ TAHMİN EDİLMEZ.** Yalnızca açıkça verilen süre girilir
    (Instagram Takipçi → 365 gün). Açıklamada "telafi edilir" yazması bir
    süre ANLAMINA GELMEZ; süre verilmemişse `refillDays = null` kalır.
22. **Türev fiyat DB'ye yazılır, çalışma zamanında hesaplanmaz.**
    Facebook/TikTok = Instagram × %125, YouTube Beğeni = Instagram × %300.
    Çarpım seed'de tam sayı kuruş aritmetiğiyle bir kez yapılır; Instagram
    fiyatı sonradan değişirse diğer platformlar SESSİZCE kaymaz.
23. **Katalog ile adapter ayrışamaz.** `Service.targetType`, platformun
    adapter'ının desteklediği bir tip olmalıdır (`UNSUPPORTED_TARGET_TYPE`).
24. **ARAYÜZDE KATALOG SABİTLENMEZ.** Platform adları, hizmet listesi,
    açıklamalar, fiyatlar ve garanti rozetleri katalog snapshot'ından üretilir —
    hero cümlesindeki platform adları dahil.
25. **SAHTE SOSYAL KANIT YOK.** Sayaçlar yalnızca gerçek katalog/veritabanı
    verisinden gelir; "10.000+ mutlu müşteri", yıldız, sahte aciliyet yoktur.
26. **Müşteri yüzeyinde teknik terim yok.** Adapter, API, sağlayıcı adı ve iç
    enum müşteriye gösterilmez; hedef doğrulama mesajları sade Türkçedir.

---

## API

### Public
| Metod | Yol | Not |
|---|---|---|
| GET | `/api/v1/catalog/snapshot` | Tüm katalog · 120/dk/IP · yalnızca customer-facing alanlar |
| POST | `/api/v1/pricing/quote` | Otorite fiyat · 30/dk/IP |
| POST | `/api/v1/coupons/validate` | Kupon + indirimli otorite fiyat · 10/dk/IP |
| POST | `/api/v1/targets/resolve` | Hedef çözümleme · 10/dk/IP |
| POST | `/api/v1/orders` | **Sipariş oluşturma** · `Idempotency-Key` zorunlu · 5/dk/IP |
| POST | `/api/v1/orders/lookup` | Misafir sorgusu (orderNo + e-posta) · 5/saat/IP **ve** 5/saat/sipariş |
| GET | `/api/v1/orders/[orderNo]` | Detay — `?t=token` veya oturum; aksi halde 404 |
| POST | `/api/v1/orders/[orderNo]/send-link` | Takip linkini kayıtlı e-postaya yollar · cevap her zaman aynı |
| POST | `/api/v1/me/claim-guest-orders` | Misafir siparişlerini hesaba bağlar (doğrulama şart) |
| POST | `/api/v1/auth/register` | Kayıt · 3/saat/IP |
| POST | `/api/v1/auth/login` | Giriş · 5/dk/IP · veritabanı oturumu |
| POST | `/api/v1/auth/logout` | Oturum satırını DB'den siler |
| POST | `/api/v1/payments/create` | Ödeme başlatma · `Idempotency-Key` zorunlu · 10/dk/IP |
| GET | `/api/v1/payments/[orderNo]/status` | Durum yoklama — YALNIZCA okur |
| POST | `/api/v1/payments/webhooks/iyzico` | Sağlayıcı bildirimi · auth YOK, imza VAR |
| POST | `/api/v1/payments/webhooks/paytr` | Sağlayıcı bildirimi · cevap gövdesi `OK` |

### Admin (`requireRole` + audit log + 100/dk/kullanıcı)
`/api/v1/admin/platforms` · `/platforms/[id]` · `/platforms/reorder` ·
`/services` · `/services/[id]` · `/variants` · `/variants/[id]` ·
`/pricing-rules` · `/pricing-rules/[id]` · `/pricing/validate` · `/pricing/simulate` ·
`/orders` · `/orders/[orderNo]` · `/orders/[orderNo]/status` · `/orders/[orderNo]/refund`

**Katalog (Faz 5)** — mevcut admin uçları `packagePriceMinor`, `presetOnly`,
`packageItems` ve `description` alanlarını kabul eder; fiyat modeli
`FLAT_TIER | GRADUATED | PACKAGE`.

**Fulfillment (Faz 4)**

| Metod | Yol | Rol |
|---|---|---|
| GET | `/api/v1/admin/fulfillments` | `SUPPORT+` — kuyruk + gerçek DB sayaçları |
| GET | `/api/v1/admin/fulfillments/[id]` | `SUPPORT+` — detay + event geçmişi |
| POST | `/api/v1/admin/fulfillments/[id]/assign` | `OPERATOR+` (başkasına atama `ADMIN+`) |
| POST | `/api/v1/admin/fulfillments/[id]/start` | `OPERATOR+` **manuel** başlatma |
| POST | `/api/v1/admin/fulfillments/[id]/progress` | `OPERATOR+` **manuel** ilerleme |
| POST | `/api/v1/admin/fulfillments/[id]/complete` | `OPERATOR+` **manuel** tamamlama |
| POST | `/api/v1/admin/fulfillments/[id]/fail` | `OPERATOR+` |
| POST | `/api/v1/admin/fulfillments/[id]/note` | `SUPPORT+` (müşteri notu) · `OPERATOR+` (iç not) |
| POST | `/api/v1/admin/fulfillments/[id]/replacement` | `OPERATOR+` açar · onay `ADMIN+` |

Rol: katalog okuma `SUPPORT+`, katalog yazma `ADMIN+`,
sipariş okuma `SUPPORT+`, sipariş durum değişikliği `OPERATOR+`,
fulfillment okuma `SUPPORT+`, fulfillment operasyonu `OPERATOR+` **ve atanmış olmak**
(`ADMIN+` atama şartından muaf), telafi onayı `ADMIN+`,
**iade `SUPERADMIN`** (para iadesi geri alınamaz).

### Sayfalar
`/` sihirbaz · `/siparis-olusturuldu` başarı ekranı · `/siparis-takip` misafir takibi ·
`/siparisler/[orderNo]` sipariş detayı · `/hesabim` müşteri paneli · `/giris` · `/kayit` ·
`/yardim` sık sorulan sorular ·
`/odeme/sonuc/[orderNo]` ödeme sonucu (doğrulanıyor → alındı/başarısız) ·
`/yonetim/fulfillment` operasyon kuyruğu · `/yonetim/fulfillment/[id]` operasyon detayı ·
`/yonetim/katalog` katalog yönetimi · `/yonetim/katalog/[id]` varyant + fiyat + simülatör

---

## Test Kapsamı

```
tests/unit/pricing.test.ts            30  kademe, KDV, kupon, boşluk/çakışma
tests/unit/transitions.test.ts        17  sipariş state machine bütünlüğü
tests/unit/parse.test.ts              22  6 platform + generic fallback
tests/unit/schema.test.ts             29  şema/enum senkronu + çerez tek kaynak
tests/unit/tier-step.test.ts           7  TIER_BOUNDARY_UNREACHABLE
tests/unit/payment-status.test.ts     20  ödeme state machine + yapılandırma kapısı
tests/unit/payment-contracts.test.ts  23  iyzico/PayTR imza ve istek SÖZLEŞMESİ
tests/unit/payment-redact.test.ts     10  kart/secret arındırma
tests/unit/fulfillment-status.test.ts 36  fulfillment state machine, progress, garanti
tests/unit/catalog-prices.test.ts     96  ⭐ 63 GERÇEK Instagram fiyat noktası birebir
tests/unit/catalog-expansion.test.ts  65  ⭐ YouTube 27 nokta + FB/TikTok × %125 + garanti
tests/unit/production-guard.test.ts   20  ⭐ Faz 7: açılış kapısı, aşama, sır sızdırmama
tests/unit/production-audit.test.ts   37  ⭐ Faz 7+8: KAYNAK KODU taraması (sır/SQL/başlık/RL/OFFSET/audit)
tests/unit/notifications.test.ts      29  ⭐ Faz 8: şablon güvenliği, TL→kuruş, ayırıcı belirsizliği
tests/unit/docker.test.ts             24  ⭐ Faz 10: imaj tarifi — sır/dev bağımlılığı/non-root/healthcheck
tests/unit/env-separation.test.ts     11  ⭐ Faz 10: paylaşılan sır tespiti (değer sızdırmadan)
tests/unit/mail-contract.test.ts      14  ⭐ Faz 10: sağlayıcı sözleşmesi — GERÇEK GÖNDERİM YOK
tests/unit/waiting.test.ts            18  ⭐ Faz 10: bekleme süresi + "gecikti" yasağı + SLA iskeleti
tests/unit/migration-lint.test.ts      4  ⭐ Faz 10: migration SQL denetimi
tests/unit/client-ip.test.ts          21  ⭐ Faz 11: İP SAHTECİLİĞİ — rate limit bypass regresyon testi
tests/unit/robots-rules.test.ts        9  ⭐ Faz 11: canlı / canlı-olmayan robots dalları
tests/integration/database.test.ts    30  migration, seed, FK, unique, cascade
tests/integration/api.test.ts         40  katalog, pricing, kupon, admin
tests/integration/orders.test.ts      31  sipariş, idempotency, fulfillment kapısı
tests/integration/orders-api.test.ts  29  route güvenliği, brute force, roller
tests/integration/payments.test.ts    36  webhook doğrulama, yarış, iade, PII
tests/integration/payments-api.test.ts 26 ödeme uçları: sahiplik, CSRF, yetki
tests/integration/fulfillment.test.ts 59  otomatik READY, manuel geçişler, yarış, telafi
tests/integration/fulfillment-api.test.ts 21 fulfillment uçları: yetki matrisi
tests/integration/catalog.test.ts     27  katalog CRUD, cache, sızıntı, pasif katalog
tests/integration/redis.test.ts        8  atomik rate limit, TTL, cache
tests/integration/production-chain.test.ts 6 ⭐ Faz 7: uçtan uca zincir + webhook 10× tekrar
tests/integration/operations.test.ts  28  ⭐ Faz 8: cursor sayfalama, arama/filtre, bildirim idempotency, health
tests/integration/launch.test.ts      24  ⭐ Faz 9: üretim alan adı, rol yükseltme engeli, bildirim paneli, manifest
tests/integration/deployment-stamp.test.ts 20 ⭐ Faz 10: ORTAM AYRIMI — staging canlı DB'ye bağlanamaz
tests/integration/nplus1.test.ts       8  ⭐ Faz 10: N+1 ÖLÇÜMÜ (iddia değil, sayım)
                                      ───
                                      935  (vitest)
tests/e2e/order-flow.spec.ts          31  sihirbaz akışı
tests/e2e/order-create.spec.ts        16  uçtan uca sipariş, takip, kayıt/giriş
tests/e2e/payment.spec.ts              9  ödeme akışı, webhook ucu
tests/e2e/api-security.spec.ts        12  API güvenlik yüzeyi
tests/e2e/fulfillment.spec.ts          5  ödeme → READY → manuel start/progress/complete
tests/e2e/catalog.spec.ts              7  admin katalog → fiyat → simülatör → müşteri → YouTube/TikTok
tests/e2e/experience.spec.ts          21  ⭐ Faz 6: keşif, garanti, paket, checkout, a11y, SEO
tests/e2e/operations.spec.ts          31  ⭐ Faz 8+9: sayfalama, arama, katalog CRUD, bildirim paneli,
                                          rol yönetimi, canonical/robots/sitemap, liveness, mobil
                                      ───
                                      246  (playwright, 2 proje · 241 passed, 5 skipped)

tests/smoke/smoke.spec.ts             22  ⭐ Faz 11: DAĞITIM DUMAN TESTİ (okuma — kayıt oluşturmaz)
                                      ───
                                       44  (playwright, 2 proje)

6 genişlikte (375 · 390 · 430 · 768 · 1024 · 1440) 9 ekran ölçüldü:
YATAY TAŞMA 0px  —  node scripts/screenshots.mjs <url>
```

Entegrasyon testleri `TEST_DATABASE_URL` varsa onu kullanır, yoksa
**Testcontainers** ile geçici PostgreSQL ayağa kaldırır (Docker gerekir).

---

## Gerçek Katalog (Faz 5 + 5.1)

Aktif platformlar: **Instagram · YouTube · Facebook · TikTok**.
Gerçek katalogda karşılığı olmayan platformlar (X, Telegram) ve Faz 0-4'ün demo
hizmetleri **pasifleştirilmiştir** (silinmemiştir).

### Instagram — 63 fiyat noktası

| # | Hizmet | Varyant | Nokta | Garanti | Hedef |
|---|---|---|---|---|---|
| 1 | Takipçi | Yabancı Takipçi | 10 | **365 gün** | profil |
| 1 | Takipçi | Türk Takipçi | 8 | **365 gün** | profil |
| 2 | Beğeni | Türk Beğeni | 10 | — | gönderi |
| 3 | Görüntülenme | Video İzlenme | 9 | — | video/reel |
| 4 | Yorum | Türk Yorum | 7 | — | gönderi |
| 5 | Kaydetme | Kaydetme | 7 | — | gönderi |
| 6 | Paylaşım | Paylaşım | 7 | — | gönderi |
| 7 | Keşfet Paketi | Instagram Keşfet Paketi | 1 | — | gönderi |
| 8 | Aylık Türk Beğeni + Yorum | Paket 1-4 | 4 | — | profil |

### YouTube — 27 fiyat noktası (Faz 5.1)

| Hizmet | Varyant | Nokta | Not |
|---|---|---|---|
| Abone | Türk Abone | 3 | maksimum **500** |
| Abone | Yabancı Abone | 7 | 1.000.000 için fiyat verilmedi → paket YOK |
| İzlenme | YouTube İzlenme | 7 | video hedefi |
| Beğeni | YouTube Beğeni | 10 | Instagram Türk Beğeni × **3** |

### Facebook (51) ve TikTok (58) — Instagram × %125 (Faz 5.1)

Takipçi (Yabancı + Türk) · Beğeni · Görüntülenme · Yorum · Paylaşım —
TikTok'ta ayrıca Kaydetme (favori sayısı herkese açıktır).
**Kopyalanmayanlar:** Keşfet Paketi ve Aylık Paket (Instagram'a özgü),
Facebook Kaydetme (herkese açık sayaç yok).

```
Facebook/TikTok fiyatı = round_half_up(Instagram_kuruş × 125 / 100)
49,90 ₺ → 4990 × 125 / 100 = 6237,5 → 6238 → 62,38 ₺
```

**TOPLAM: 4 platform · 22 hizmet · 29 varyant · 199 fiyat noktası**

Fiyatların tek kaynağı `prisma/seed/services.ts`; `catalog-prices.test.ts` (63) ve
`catalog-expansion.test.ts` (27 + türev) her noktayı brief'ten ELLE yazılmış
beklenen değerlerle karşılaştırır.

---

## Sonraki Faz

**Faz 10 — PAYTR PRODUCTION ACTIVATION (onay bekliyor).** Faz 9 kapsamı
tamamlandı; yeni faza kendiliğinden geçilmez.

Faz 9'un sonucu: **uygulama hazır, dış servisler bağlı değil.** PayTR onayı
beklendiği için ödeme adapter'ı, webhook davranışı ve credential yönetimi
DEĞİŞTİRİLMEDİ. Onay geldiğinde kod değişikliği gerekmez — yalnızca dört ortam
değişkeni girilir.

Canlıya çıkışı engelleyen altı madde `docs/PRODUCTION_CHECKLIST.md` § 0'da
listelidir; hiçbiri kodla "varmış gibi" gösterilmemiştir. Kalan teknik borç:
`docs/architecture-decisions.md`

### Ödeme sağlayıcısı yapılandırma

Gerçek merchant bilgisi geldiğinde YALNIZCA environment değişkenleri değişir;
kod değişmez:

```bash
PAYMENT_PROVIDER=iyzico          # veya paytr
PAYMENT_ENVIRONMENT=production   # sandbox | production
APP_BASE_URL=https://medya333.com
IYZICO_API_KEY=...
IYZICO_SECRET_KEY=...
IYZICO_BASE_URL=https://api.iyzipay.com
# veya
PAYTR_MERCHANT_ID=...
PAYTR_MERCHANT_KEY=...
PAYTR_MERCHANT_SALT=...
```

`PAYMENT_ENVIRONMENT=production` iken `PAYMENT_PROVIDER=mock` seçilirse
uygulama ödeme başlatmayı reddeder (`assertPaymentConfig`).
