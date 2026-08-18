# Medya 333 — Faz 5.1

Sosyal medya tanıtım hizmetleri sipariş platformu.
**Faz 0** (iskelet + sihirbaz) + **Faz 1** (gerçek DB, katalog/pricing API, admin CRUD, Redis)
+ **Faz 2** (sipariş oluşturma, misafir takibi, hesap, admin sipariş yönetimi)
+ **Faz 3** (ödeme altyapısı: iyzico/PayTR adapter, webhook, iade)
+ **Faz 4** (fulfillment: operasyon kuyruğu, manuel ilerleme, garanti/telafi)
+ **Faz 5** (gerçek Instagram kataloğu: 8 hizmet · 12 varyant · **63 gerçek fiyat noktası**)
+ **Faz 5.1** (YouTube · Facebook · TikTok · Instagram takipçi garantisi 365 gün —
  toplam **4 platform · 22 hizmet · 29 varyant · 199 fiyat noktası**).

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
| `npm run migrate:wasm` | ⚠️ Engine indirilemeyen ortamlarda migration (aşağı bkz.) |

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
tests/integration/database.test.ts    28  migration, seed, FK, unique, cascade
tests/integration/api.test.ts         34  katalog, pricing, kupon, admin
tests/integration/orders.test.ts      31  sipariş, idempotency, fulfillment kapısı
tests/integration/orders-api.test.ts  29  route güvenliği, brute force, roller
tests/integration/payments.test.ts    36  webhook doğrulama, yarış, iade, PII
tests/integration/payments-api.test.ts 26 ödeme uçları: sahiplik, CSRF, yetki
tests/integration/fulfillment.test.ts 57  otomatik READY, manuel geçişler, yarış, telafi
tests/integration/fulfillment-api.test.ts 21 fulfillment uçları: yetki matrisi
tests/integration/catalog.test.ts     18  katalog CRUD, cache, sızıntı, pasif katalog
tests/integration/redis.test.ts        8  atomik rate limit, TTL, cache
                                      ───
                                      662  (vitest)
tests/e2e/order-flow.spec.ts          31  sihirbaz akışı
tests/e2e/order-create.spec.ts        16  uçtan uca sipariş, takip, kayıt/giriş
tests/e2e/payment.spec.ts              9  ödeme akışı, webhook ucu
tests/e2e/api-security.spec.ts        12  API güvenlik yüzeyi
tests/e2e/fulfillment.spec.ts          5  ödeme → READY → manuel start/progress/complete
tests/e2e/catalog.spec.ts              7  admin katalog → fiyat → simülatör → müşteri → YouTube/TikTok
                                      ───
                                      142  (playwright, 2 proje · 139 passed, 3 skipped)
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

**Faz 6 — (onay bekliyor).** Faz 5.1 kapsamı tamamlandı; yeni faza kendiliğinden
geçilmez. Detay ve kalan teknik borç: `docs/architecture-decisions.md`

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
