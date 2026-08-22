# VERCEL ENVIRONMENT VARIABLE MATRİSİ — İlk Production Deploy

> **Hedef:** Ödeme, Instagram, Telegram, YouTube ve fatura entegrasyonları
> OLMADAN uygulamayı Vercel'de güvenle ayağa kaldırmak.
>
> ⚠️ Bu belgede **hiçbir secret değeri yoktur** ve mevcut sırlarınız
> yazdırılmamıştır. Yalnızca *hangi* sırrın gerektiği ve *nasıl üretileceği*
> yazılıdır.
>
> Kaynak: `src/env.ts` şeması + kodda gerçek kullanım taraması
> (yorum satırları çıkarılarak `env.X` / `process.env.X` referansları).

---

## 0) Sayım ve iki kritik bulgu

`.env.example` **49 anahtar** listeliyor. Bunların 44'ü `src/env.ts` şemasından
geçiyor, 5'i (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SHADOW_DATABASE_URL`,
`TEST_DATABASE_URL`, `SKIP_ENV_VALIDATION`) şema dışında okunuyor.
`NODE_ENV` ile birlikte şemada **45 anahtar** var.

Kod taraması sonucu:

| | Sayı |
|---|---|
| Kodda **gerçekten okunan** | **27** |
| Şemada tanımlı ama **hiç okunmayan (ölü)** | **18** |

### ⛔ BULGU 1 — `APP_ENV=production` ile uygulama AÇILMIYOR

Boot kapısı canlı aşamada ödeme yapılandırmasını **blocker** sayıyor. PayTR
credential'ı olmadan **her kombinasyon** bir blocker'a çarpıyor:

| Deneme | Sonuç |
|---|---|
| `PAYMENT_PROVIDER=mock` | ⛔ `MOCK_PAYMENT` |
| `PAYMENT_PROVIDER=paytr` + credential yok | ⛔ `PROVIDER_CREDENTIALS_MISSING` |
| `PAYMENT_ENVIRONMENT=sandbox` | ⛔ `PAYMENT_SANDBOX` |

**Gerçek boot testiyle doğrulandı** (üretim derlemesi, `APP_ENV=production`,
PayTR credential yok):

```
ÜRETİM YAPILANDIRMA HATASI — uygulama açılmadı:
  • [PROVIDER_CREDENTIALS_MISSING] PayTR seçili ama eksik değişken(ler):
    PAYTR_MERCHANT_ID, PAYTR_MERCHANT_KEY, PAYTR_MERCHANT_SALT.
[boot] Uygulama açılmadı. Süreç sonlandırılıyor.
```

**Çözüm: ilk deploy'da `APP_ENV=staging` kullanın.** Aynı yapılandırma
`staging` ile sorunsuz açıldı (4 uyarı, blocker yok), `/api/health` `healthy`,
ana sayfa 200 döndü.

Bu bir kaçış kapısı **değildir** — dürüst bir tanımdır. Ödeme yokken site
gerçekten canlı değildir. `APP_ENV=staging` üç şey yapar:

1. Ödeme bulguları blocker yerine **uyarı** olur → uygulama açılır.
2. `robots.txt` tüm siteyi kapatır (`Disallow: /`) → yarım sistem
   Google'a düşmez.
3. `PAYMENT_ENVIRONMENT=production` **açılamaz** (`STAGE_REAL_PAYMENT` her
   aşamada blocker) → yanlışlıkla gerçek tahsilat imkânsız.

PayTR onayı geldiğinde tek yapılacak: credential'ları girip
`APP_ENV=production` + `PAYMENT_ENVIRONMENT=production` yapmak. Kod değişmez.

### ⛔ BULGU 2 — `REDIS_URL` Vercel'de ZORUNLUDUR (APP_ENV ne olursa olsun)

`src/server/ratelimit.ts:192`:

```ts
if (!isRedisEnabled() && env.NODE_ENV === 'production') throw new RedisRequiredError()
```

Vercel'de `NODE_ENV` **her zaman** `production`'dır — Preview'da bile. Redis
yoksa rate limit'ten geçen her uç patlar.

**Doğrulandı** (Redis'siz üretim derlemesi):

| Uç | Sonuç |
|---|---|
| Ana sayfa `/` | **200** ← yanıltıcı, sayfa açılıyor |
| `/api/v1/catalog/snapshot` | **503** ← hizmet listesi ve fiyat GELMİYOR |
| `/api/health` | `{"status":"healthy", "redis":{"status":"disabled"}}` |

⚠️ **Tuzak:** sağlık ucu `healthy` diyor çünkü Redis "disabled" (yapılandırılmamış)
sayılıyor, "down" değil. Yani izleme yeşil görünürken site kullanılamaz durumda
olur. Redis'i atlamayın.

---

## 1) DEPLOY İÇİN ZORUNLU — 12 değişken

Bunlar olmadan build kırılır, boot durur veya site işlevsiz kalır.

| KEY | Değer | Prod/Preview ayrı? | Nereden? |
|---|---|---|---|
| `DATABASE_URL` 🔒 | Sağlayıcının **havuzlu (pooler)** bağlantı adresi | **EVET — ayrı veritabanı** | Neon / Supabase / Railway panelinden kopyalayın |
| `AUTH_SECRET` 🔒 | ≥32 karakter rastgele | **EVET — ayrı üretin** | `openssl rand -base64 48` |
| `ORDER_TOKEN_SECRET` 🔒 | ≥32 karakter rastgele, **`AUTH_SECRET`'tan FARKLI** | **EVET — ayrı üretin** | `openssl rand -base64 48` (ikinci kez çalıştırın) |
| `IP_HASH_SALT` 🔒 | ≥16 karakter rastgele | **EVET — ayrı üretin** | `openssl rand -hex 24` |
| `REDIS_URL` 🔒 | Yönetilen Redis bağlantı adresi | **EVET — ayrı instance/DB no** | Upstash / Redis Cloud panelinden |
| `APP_ENV` | Prod: `staging` *(PayTR gelene kadar)* · Preview: `staging` | evet ama şimdilik ikisi de `staging` | siz yazarsınız |
| `APP_BASE_URL` | Prod: `https://www.medya333.com` · Preview: Vercel'in verdiği URL | **EVET** | siz yazarsınız |
| `NEXT_PUBLIC_SITE_URL` | `APP_BASE_URL` ile **AYNI** | **EVET** | siz yazarsınız |
| `PAYMENT_PROVIDER` | `paytr` | hayır | siz yazarsınız |
| `PAYMENT_ENVIRONMENT` | `sandbox` | hayır | siz yazarsınız |
| `DATABASE_POOL_MAX` | **`1`** | hayır | siz yazarsınız |
| `MAIL_FROM` | `siparis@medya333.com` | hayır | siz yazarsınız |

🔒 = secret. Vercel'de "Sensitive" işaretleyin.

**Neden bu değerler?**

- **`APP_ENV=staging`** → Bulgu 1. PayTR onayı gelince `production` yapılır.
- **`PAYMENT_PROVIDER=paytr` + `PAYMENT_ENVIRONMENT=sandbox`** → `mock`
  seçmek `MOCK_PAYMENT` uyarısı üretir ve ileride canlıda kaza riski taşır;
  `paytr`/`sandbox` bileşimi "sağlayıcı seçildi, credential bekleniyor"
  demektir. Sipariş oluşturulabilir, ödeme adımı net bir hatayla reddedilir.
  Sahte tahsilat **yapılmaz**.
- **`DATABASE_POOL_MAX=1`** → her eşzamanlı Vercel fonksiyonu kendi havuzunu
  açar. Varsayılan 10 ile 50 örnek = 500 bağlantı → "too many connections".
- **`NEXT_PUBLIC_SITE_URL` derlemeye gömülür**, `APP_BASE_URL` çalışma
  zamanında okunur. Farklıysa boot `BASE_URL_MISMATCH` uyarısı verir.
- **`MAIL_FROM`** varsayılanı zaten `siparis@medya333.com`; açıkça yazmak
  varsayılana bağımlılığı kaldırır.

⚠️ **Preview için ayrı bir veritabanı şart.** Yanlışlıkla canlı `DATABASE_URL`
verilse bile **dağıtım damgası** uyuşmazlığı yakalar ve uygulama açılmaz —
ama bu bir güvenlik ağıdır, plan değildir.

---

## 2) OPSİYONEL — entegrasyon aktif edilirse gerekli

Şimdi **boş bırakın**. Her biri kendi entegrasyonu bağlanınca doldurulur.

| KEY | Kodda kullanılıyor mu? | Ne zaman gerekir? | Nereden? |
|---|---|---|---|
| `PAYTR_MERCHANT_ID` 🔒 | ✅ `payments/providers/paytr.ts` | PayTR onayı gelince | PayTR mağaza paneli |
| `PAYTR_MERCHANT_KEY` 🔒 | ✅ aynı | PayTR onayı gelince | PayTR mağaza paneli |
| `PAYTR_MERCHANT_SALT` 🔒 | ✅ aynı | PayTR onayı gelince | PayTR mağaza paneli |
| `RESEND_API_KEY` 🔒 | ✅ `mail/provider.ts` | E-posta bildirimi istenince | Resend → API Keys |
| `EMAIL_PROVIDER` | ✅ `mail/provider.ts` | Resend bağlanınca `resend` yapın | siz yazarsınız |
| `SENTRY_DSN` 🔒 | ✅ `observability.ts` *(durum raporu için)* | Hata izleme istenince | Sentry proje ayarları |
| `GOOGLE_CLIENT_ID` | ✅ `auth/config.ts` | Google ile giriş istenince | Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` 🔒 | ✅ `auth/config.ts` | Google ile giriş istenince | Google Cloud Console |
| `IYZICO_API_KEY` 🔒 | ✅ `payments/providers/iyzico.ts` | iyzico'ya geçilirse | iyzico paneli |
| `IYZICO_SECRET_KEY` 🔒 | ✅ aynı | iyzico'ya geçilirse | iyzico paneli |
| `IYZICO_BASE_URL` | ✅ aynı | iyzico'ya geçilirse | iyzico dokümanı |
| `SEED_ADMIN_EMAIL` | ✅ `prisma/seed/index.ts` | **Vercel'e GİRİLMEZ** | — |
| `SEED_ADMIN_PASSWORD` 🔒 | ✅ `prisma/seed/index.ts` | **Vercel'e GİRİLMEZ** | — |

⚠️ **`EMAIL_PROVIDER` tuzağı:** `resend` yazıp `RESEND_API_KEY` vermezseniz
canlı aşamada boot **durur** (`EMAIL_PROVIDER_KEY_MISSING`). Şimdilik hiç
yazmayın veya `none` yazın — sistem o zaman dürüst davranır: her bildirim
`FAILED` kaydedilir, panelde görünür, "gönderildi" **denmez**.

⚠️ **`SENTRY_DSN` tuzağı:** SDK projede **kurulu değil**. DSN girerseniz durum
`pending_sdk` olur ve **hiçbir olay gönderilmez** — hiçbir ekran "aktif"
göstermez. DSN'i SDK kurulmadan girmek yanıltıcıdır; boş bırakın.

⚠️ **`SEED_ADMIN_*` Vercel'e girilmez.** Seed canlıda zaten çalışmaz
(`prisma/seed/guard.ts`, fail-closed). Bu iki değişken yalnızca yerel/staging
seed komutunda kullanılır. Vercel'e yazmak, çalıştırılamayan bir yolun sırrını
platformda tutmak olur.

---

## 3) DEFAULT DEĞER VERİLEBİLİR — hiç girmeyin

Şemadaki varsayılan zaten doğru. **Vercel'e eklemeyin** — eklemek yalnızca
sürüklenme riski üretir.

| KEY | Varsayılan | Neden dokunmayın |
|---|---|---|
| `TRUSTED_PROXY` | `xff-rightmost` | Vercel `x-forwarded-for`'u üzerine yazar; en sağdaki değer = gerçek istemci. **`vercel` yazmanız gerekmez.** Yanlış değer rate limit'i atlatılabilir yapar |
| `DEFAULT_TAX_RATE_BP` | `2000` (%20) | Veritabanındaki `TaxRate` kaydı zaten önceliklidir |
| `AUTH_TRUST_HOST` | `true` | Vercel arkasında doğru değer |
| `NODE_ENV` | Vercel yazar | **Elle yazmayın** |
| `SENTRY_TRACES_SAMPLE_RATE` | `1` | SDK yokken anlamsız |

---

## 4) ŞİMDİLİK GEREKSİZ / BOŞ BIRAKILABİLİR

### 4a) ⚠️ ÖLÜ DEĞİŞKENLER — kodda HİÇ okunmuyor (18 adet)

Şemada tanımlı, `.env.example`'da listeli, ama hiçbir kod satırı okumuyor.
Girmenin **hiçbir etkisi yok**.

| KEY | Durum |
|---|---|
| `DIRECT_DATABASE_URL` | ⚠️ **Hiç okunmuyor.** `prisma.config.ts` `SHADOW_DATABASE_URL` kullanıyor. Migration için havuzsuz adresi `DATABASE_URL=... npm run db:deploy` şeklinde komuta verin |
| `AUTH_URL` | ⚠️ **Hiç okunmuyor.** `trustHost: true` olduğu için Auth.js adresi istekten türetir |
| `UPSTASH_REDIS_REST_URL` | Ölü — Redis'e ioredis ile TCP bağlanılıyor |
| `UPSTASH_REDIS_REST_TOKEN` | Ölü |
| `YOUTUBE_API_KEY` | Ölü — yalnızca **yorum** satırında geçiyor, adapter `unverified` dönüyor |
| `INSTAGRAM_BUSINESS_DISCOVERY_ENABLED` | ⚠️ **Yarı canlı.** `production-guard` okuyor (yarım yapılandırmada uyarı verir) ve `npm run ig:verify` okuyor. Ama adapter dalı hâlâ **yoruma alınmış** (`instagram/index.ts:55`) — bayrak açılsa bile profil verisi GELMEZ |
| `IG_ACCESS_TOKEN` 🔒 | ⚠️ **Yarı canlı.** Şema + guard + `ig:verify` okuyor; `resolveViaBusinessDiscovery` henüz YAZILMADI. **Facebook User access token** olmalı — `graph.instagram.com` token'ı business_discovery'yi desteklemez |
| `IG_USER_ID` | ⚠️ **Yarı canlı.** Kendi professional IG hesabımızın Business Account ID'si. Business Discovery çağrısı bu node ÜZERİNDEN yapılır; olmadan uç çağrılamaz. `npm run ig:verify` listeler |
| `IG_GRAPH_API_VERSION` | Varsayılan `v25.0`. Meta sürümleri ~2 yılda emekliye ayırır; ortamdan verilmesi deploy'suz yükseltme sağlar |
| `IG_APP_ID` · `IG_APP_SECRET` 🔒 | ⚠️ Yalnızca `ig:verify`'ın `debug_token` çağrısında (token son kullanma tarihi ölçümü) kullanılıyor. Uygulama akışında okunmuyor |
| `TELEGRAM_BOT_TOKEN` | Ölü |
| `X_BEARER_TOKEN` | Ölü |
| `INVOICE_PROVIDER` · `INVOICE_API_KEY` · `INVOICE_API_SECRET` | Ölü — fatura entegrasyonu yok |
| `SENTRY_ENVIRONMENT` | Ölü — SDK kurulunca kullanılacak |
| `SENTRY_TRACES_SAMPLE_RATE` | Ölü — SDK kurulunca kullanılacak |
| `NEXT_PUBLIC_SITE_NAME` | ⚠️ Ölü — hiçbir bileşen okumuyor |
| `NEXT_PUBLIC_PRICES_TAX_INCLUSIVE` | ⚠️ Ölü — hiçbir bileşen okumuyor |

> Bu değişkenler "gelecekte lazım olacak" diye şemada duruyor. Bilinçli bir
> tercih ama **Vercel'e girmeyin** — girilen ölü bir değişken, bağlı olmayan
> bir entegrasyonu bağlıymış gibi gösterir.

### 4b) YALNIZCA YEREL / CI — Vercel'e ASLA girilmez

| KEY | Neden |
|---|---|
| `SHADOW_DATABASE_URL` | Yalnızca `prisma migrate dev` (yerel) |
| `TEST_DATABASE_URL` | Yalnızca entegrasyon testleri |
| `SKIP_ENV_VALIDATION` | ⛔ **Vercel'e ASLA girmeyin.** Env doğrulamasını kapatır — eksik değişken build'i kırmak yerine çalışma zamanında patlar |

---

## 5) Kopyala-yapıştır: Production ortamı

```
APP_ENV=staging
APP_BASE_URL=https://www.medya333.com
NEXT_PUBLIC_SITE_URL=https://www.medya333.com
DATABASE_URL=<havuzlu adres — sağlayıcı panelinden>        [Sensitive]
DATABASE_POOL_MAX=1
REDIS_URL=<yönetilen redis adresi>                          [Sensitive]
AUTH_SECRET=<openssl rand -base64 48>                       [Sensitive]
ORDER_TOKEN_SECRET=<openssl rand -base64 48 — FARKLI>       [Sensitive]
IP_HASH_SALT=<openssl rand -hex 24>                         [Sensitive]
PAYMENT_PROVIDER=paytr
PAYMENT_ENVIRONMENT=sandbox
MAIL_FROM=siparis@medya333.com
```

## 6) Kopyala-yapıştır: Preview ortamı

Aynı 12 anahtar, **ama şu üçü farklı ve şu üç sır YENİDEN üretilmiş olmalı:**

```
APP_BASE_URL=<Vercel'in verdiği preview adresi>
NEXT_PUBLIC_SITE_URL=<aynı preview adresi>
DATABASE_URL=<AYRI bir preview veritabanı>                  [Sensitive]
REDIS_URL=<AYRI instance veya ayrı DB numarası>             [Sensitive]
AUTH_SECRET=<YENİDEN üretin — canlıdan kopyalamayın>        [Sensitive]
ORDER_TOKEN_SECRET=<YENİDEN üretin>                         [Sensitive]
IP_HASH_SALT=<YENİDEN üretin>                               [Sensitive]
```

**Neden ayrı sır?** Aynı `AUTH_SECRET` kullanılırsa preview'da üretilen bir
oturum çerezi **canlıda da geçerli** olur. Aynı `ORDER_TOKEN_SECRET` ise
preview'da üretilmiş bir misafir takip linki **canlı siparişleri açar**.

Doğrulama aracı:
```bash
npm run env:check -- .env.preview .env.production
```
Değer yazdırmaz, yalnızca paylaşılan anahtarların **adını** bildirir.

---

## 7) Deploy sırası

1. Managed PostgreSQL + Redis oluşturun (**fra1'e yakın** — `vercel.json`
   fonksiyonları orada çalışıyor).
2. Vercel'e § 5 ve § 6'daki değişkenleri girin.
3. **Migration'ı ayrı çalıştırın** (build'de değil) ve veritabanını damgalayın:
   ```bash
   npm ci
   DATABASE_URL="<havuzsuz-direct-adres>" npm run db:deploy
   DATABASE_URL="<havuzsuz-direct-adres>" npm run db:stamp -- --stage=staging
   ```
   ⚠️ Aşama `staging` olmalı — `APP_ENV=staging` ile eşleşmezse uygulama
   **açılmaz** (dağıtım damgası kontrolü).
4. Deploy edin. Boot log'unda görmeniz gerekenler:
   ```
   [boot] APP_ENV=staging canli=hayır bulgu=N
   [boot] veritabanı damgası: staging ✓
   ```
5. Doğrulayın:
   ```bash
   curl https://<url>/api/health        # database + redis "up" olmalı
   SMOKE_BASE_URL=https://<url> npm run test:smoke
   ```
6. Katalog boşsa staging kopyada seed çalıştırıp veriyi taşıyın
   (`docs/PRODUCTION_RUNBOOK.md` § 6). **Canlıda seed çalışmaz.**

⚠️ `/api/health` yeşil ama katalog gelmiyorsa **Redis'e bakın** — Bulgu 2.

---

## 8) PayTR onayı geldiğinde (bugün DEĞİL)

```
APP_ENV=production                  ← staging'den değişir
PAYMENT_ENVIRONMENT=production      ← sandbox'tan değişir
PAYTR_MERCHANT_ID=<panelden>        [Sensitive]
PAYTR_MERCHANT_KEY=<panelden>       [Sensitive]
PAYTR_MERCHANT_SALT=<panelden>      [Sensitive]
```

Ayrıca veritabanı damgasını da çevirin:
`npm run db:stamp -- --stage=production --force`

Ve `robots.txt` o anda siteyi taramaya açar — SEO tam o noktada başlar.
