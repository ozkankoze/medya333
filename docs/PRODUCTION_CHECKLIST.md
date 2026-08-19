# Medya 333 — Üretim Kontrol Listesi

> **CANLI ALAN ADI: `https://www.medya333.com`**
>
> Bu belge **canlıya çıkış** içindir. Her kutu işaretlenmeden dağıtım yapılmaz.
> ⚠️ Şu an **canlıya çıkılamaz** — açık PRODUCTION BLOCKER'lar için § 0'a bakın.
>
> Sıra: **PRE-DEPLOY (§1–9) → DEPLOY (§11–13) → POST-DEPLOY (§14) → PAYMENT (§15)**

---

## 0 · PRODUCTION BLOCKER (canlıya çıkışı ENGELLEYEN eksikler)

Bunlar kodla "varmış gibi" gösterilmedi. Gerçekten yoklar.

| # | Eksik | Etki | Ne gerekiyor |
|---|---|---|---|
| B1 | **Gerçek merchant credential yok** | Hiçbir tahsilat yapılamaz | iyzico veya PayTR üye iş yeri onayı + canlı anahtarlar |
| B2 | **Transactional e-posta sağlayıcısı yok** | Müşteriye **hiçbir e-posta gitmiyor**: sipariş, ödeme, işlem başladı, tamamlandı ve takip linki gönderilemiyor | Resend hesabı + `RESEND_API_KEY` + `EMAIL_PROVIDER=resend` |
| B3 | **`www.medya333.com` DNS ve TLS bağlı değil** | Ödeme callback'leri, `__Secure-` çerezler ve e-posta teslimi çalışmaz | DNS (§2) + TLS (§3) + `APP_BASE_URL=https://www.medya333.com` |
| B4 | **Yönetilen PostgreSQL ve Redis yok** | Veri kalıcılığı ve rate limit garantisi yok | Yedeklemeli PostgreSQL 16 + Redis 7 |
| B5 | **Hata izleme (Sentry) bağlı değil** | Canlı hatalar yalnızca konteyner log'unda; kimse haberdar olmaz | `@sentry/nextjs` kurulumu + `SENTRY_DSN` (§10) |
| B6 | **Yedekleme doğrulanmadı** | Yedek alınıyor olsa bile geri yüklenebilirliği bilinmiyor | Yönetilen PostgreSQL + geri yükleme provası (§6) |

`assertProductionReady()` B1, B3 ve B4'ü **boot'ta yakalar ve uygulamayı
açmaz**. B2, B5 ve B6 uyarı üretir; iş kararı sizindir.

> ⚠️ **Faz 9 notu — bu ortamdan doğrulanamayanlar.** Sandbox'tan DNS çözümü,
> TLS el sıkışması ve gerçek e-posta teslimi test EDİLEMEZ. Bu maddeler
> "yapıldı" olarak işaretlenmemiş, **PENDING** olarak bırakılmıştır. Kod
> tarafı hazır olsa bile, doğrulanmamış bir dış servis tamamlanmış sayılmaz.

> ⚠️ **B2 hakkında (Faz 8):** sağlayıcı yokken sistem artık "gönderildi"
> DEMİYOR. `ResendMailProvider` bağlı değilse her bildirim denemesi
> `Notification.status = 'FAILED'` olarak kaydedilir ve sunucu log'una
> `[mail:FAILED] … reason=EMAIL_PROVIDER_NOT_CONFIGURED` düşer. Yani eksik
> ortam, sessiz bir başarısızlığa değil **görünür bir sayaca** dönüşür.
> `EMAIL_PROVIDER=console` canlıda **boot'u durdurur** — çünkü console
> sağlayıcısı teslim etmediği hâlde başarı döndürür.

---

## 1 · DOMAIN

Canonical adres: **`https://www.medya333.com`**

Dört varyantın tamamı tek adrese inmelidir:

| Girilen | Beklenen sonuç |
|---|---|
| `http://medya333.com` | 301 → `https://www.medya333.com` |
| `http://www.medya333.com` | 301 → `https://www.medya333.com` |
| `https://medya333.com` | 301 → `https://www.medya333.com` |
| `https://www.medya333.com` | 200 |

- [ ] Dört varyant da doğrulandı (`curl -sIL <adres> | grep -i '^HTTP\|^location'`)
- [ ] Yönlendirme **ters vekilde / CDN'de** yapılıyor (uygulama katmanında değil —
      uygulamanın host'a göre dallanması gerekmez ve gerekmemelidir)
- [ ] `APP_BASE_URL=https://www.medya333.com`
- [ ] `NEXT_PUBLIC_SITE_URL=https://www.medya333.com` (**aynı değer**)

> ⚠️ İkisi farklıysa boot `BASE_URL_MISMATCH` uyarısı verir: sayfa kaynağındaki
> adresler bir alan adını, e-posta ve ödeme callback'leri başka birini gösterir.

**DURUM: PENDING.** Alan adı bu ortamdan doğrulanamadı — DNS ve TLS henüz
bağlanmamıştır. Bkz. § 0 / B3.

---

## 2 · DNS

⚠️ **Aşağıdaki değerler TAHMİN EDİLMEMİŞTİR.** Hosting ve e-posta
sağlayıcınızın panelinden alınacak gerçek değerlerle doldurulur. Buraya
uydurma bir IP veya CNAME yazmak, "yapıldı" sanılan ama çalışmayan bir
yapılandırma üretir.

| Kayıt | Ad | Tip | Değer | Durum |
|---|---|---|---|---|
| Kök | `medya333.com` | A *veya* ALIAS | `<hosting sağlayıcısından>` | ☐ |
| www | `www.medya333.com` | CNAME *veya* A | `<hosting sağlayıcısından>` | ☐ |
| SPF | `medya333.com` | TXT | `v=spf1 include:<e-posta sağlayıcısı> ~all` | ☐ |
| DKIM | `<seçici>._domainkey.medya333.com` | TXT *veya* CNAME | `<e-posta sağlayıcısından>` | ☐ |
| DMARC | `_dmarc.medya333.com` | TXT | `v=DMARC1; p=none; rua=mailto:<adres>` | ☐ |
| CAA *(öneri)* | `medya333.com` | CAA | `0 issue "<sertifika otoritesi>"` | ☐ |

- [ ] DNS yayılması doğrulandı (`dig +short www.medya333.com`)
- [ ] SPF **tek kayıt** (birden çok SPF TXT kaydı SPF'i geçersiz kılar)
- [ ] DKIM seçicisi e-posta sağlayıcısının verdiği değerle birebir aynı
- [ ] DMARC ilk aşamada `p=none` — raporlar okunduktan sonra
      `p=quarantine` → `p=reject` sıkılaştırması yapılır

> ⚠️ **SPF/DKIM/DMARC olmadan gönderilen e-postalar spam'e düşer.** Sipariş
> onayı ve takip bağlantısı müşteriye ulaşmaz; sistem "gönderildi" der ama
> kimse görmez. Bu yüzden e-posta sağlayıcısını bağlamak (§ 9) DNS'siz
> tamamlanmış sayılmaz.

**DURUM: PENDING.**

---

## 3 · TLS

- [ ] Sertifika `www.medya333.com` **ve** `medya333.com` için geçerli
- [ ] HTTP → HTTPS yönlendirmesi açık
- [ ] HSTS başlığı canlıda görünüyor (`max-age=63072000; includeSubDomains; preload`)
- [ ] Otomatik yenileme çalışıyor ve **yenileme başarısızlığı alarm üretiyor**
- [ ] Zincir eksiksiz (`openssl s_client -connect www.medya333.com:443 -servername www.medya333.com`)

> ⚠️ HSTS `preload` listesine girmek **geri alınamaz** kabul edilmelidir.
> Alan adının tüm alt alan adları kalıcı olarak HTTPS'e bağlanır.

**DURUM: PENDING.**

---

## 4 · PRE-DEPLOY (altyapı ve ortam)

### Altyapı
- [ ] PostgreSQL 16 hazır, günlük otomatik yedek açık
- [ ] Redis 7 hazır (`maxmemory-policy noeviction` — rate limit sayaçları düşmemeli)
- [ ] Uygulama sunucusu Node.js 22+, en az 2 örnek (rate limit Redis'te ortak)
- [ ] TLS sertifikası kurulu, HTTP → HTTPS yönlendirmesi açık

### Environment
`.env.production` içinde aşağıdakiler **zorunlu**:

| Değişken | Tip | Not |
|---|---|---|
| `NODE_ENV=production` | otomatik | `next start` zaten böyle ayarlar |
| `APP_ENV=production` | zorunlu | **Aşama.** Boot kapısını sertleştiren asıl değişken. Yazılmazsa `production` varsayılır (fail-closed) |
| `DATABASE_URL` | **secret** | Havuzlu bağlantı |
| `DIRECT_DATABASE_URL` | opsiyonel | Migration için havuzsuz |
| `AUTH_SECRET` | **secret** | `openssl rand -base64 48` |
| `ORDER_TOKEN_SECRET` | **secret** | `AUTH_SECRET`'tan FARKLI olmalı |
| `IP_HASH_SALT` | **secret** | `openssl rand -hex 24` |
| `REDIS_URL` | **secret** | Yoksa boot FAIL |
| `APP_BASE_URL` | zorunlu | `https://medya333.com` — çalışma zamanı |
| `NEXT_PUBLIC_SITE_URL` | zorunlu | Derlemeye gömülür, aynı alan adı |
| `PAYMENT_PROVIDER` | zorunlu | `iyzico` \| `paytr` — **`mock` boot FAIL** |
| `PAYMENT_ENVIRONMENT=production` | zorunlu | `sandbox` boot FAIL |
| `IYZICO_API_KEY` / `IYZICO_SECRET_KEY` | **secret** | Sağlayıcı iyzico ise |
| `IYZICO_BASE_URL` | zorunlu | `https://api.iyzipay.com` (sandbox adresi boot FAIL) |
| `PAYTR_MERCHANT_ID/KEY/SALT` | **secret** | Sağlayıcı paytr ise |
| `MAIL_FROM` | zorunlu | Doğrulanmış gönderici adresi |
| `EMAIL_PROVIDER` | zorunlu | `resend` (gerçek) \| `none`. **`console` canlıda boot FAIL** |
| `RESEND_API_KEY` | **secret** | Yoksa e-posta GİTMEZ (B2); her deneme `FAILED` kaydedilir |
| `SENTRY_DSN` | opsiyonel | Yoksa uyarı |

> ⚠️ **`NODE_ENV` tek başına "canlıyım" demek DEĞİLDİR.** `next start` NODE_ENV'i
> her zaman `production` yapar; staging ve E2E de üretim derlemesi çalıştırır.
> Aşama kararı `APP_ENV`'den okunur (`src/server/production-guard.ts`).
> Staging/E2E için `APP_ENV=staging|e2e` yazılır — ama bu bir kaçış kapısı
> değildir: bu aşamalarda `PAYMENT_ENVIRONMENT=production` **açılamaz**
> (`STAGE_REAL_PAYMENT` blocker'ı her ortamda geçerlidir).

- [ ] Hiçbir secret `NEXT_PUBLIC_` önekiyle tanımlı değil
  (`tests/unit/production-audit.test.ts` bunu doğrular)
- [ ] Canlı sunucuda `APP_ENV` ya `production` ya da **hiç tanımlı değil**
- [ ] Secret'lar CI log'larında, imaj katmanlarında ve `.env` dosyası olarak
      repoda **yok**

### Doğrulama
```bash
npm ci
npm run typecheck        # 0 hata
npm run test             # unit + integration
npm run build            # üretim derlemesi
npx playwright test      # desktop + mobile
npm run db:validate-pricing
```

---

## 5 · DATABASE

- [ ] **Dağıtımdan ÖNCE yedek al** (`pg_dump -Fc`)
- [ ] `npx prisma migrate deploy` (⚠️ `migrate dev` DEĞİL — canlıda asla)
- [ ] Migration'lar **eklemelidir**: `DROP TABLE`, `DROP COLUMN`, `DELETE FROM`
      içermez. Faz 7 denetiminde 5 migration tarandı, veri kaybı yok.
- [ ] `npm run db:seed` — katalog ve KDV oranlarını yazar
- [ ] Seed'in demo veri yazmadığını doğrula: gerçek katalogda olmayan kayıtlar
      **pasifleştirilir**, yeni demo hizmet **oluşturulmaz**
- [ ] `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` ile ilk SUPERADMIN oluştur,
      **ardından şifreyi değiştir** ve bu değişkenleri ortamdan kaldır

### Migration sonrası
- [ ] Şema doğrulaması: `tests/integration/database.test.ts` yeşil
- [ ] **Yeni bir yedek daha al** (migration sonrası durum)

---

## 6 · YEDEKLEME (BACKUP)

> ⚠️ **DURUM: PENDING.** Bu bölümdeki hiçbir kutu işaretlenmemiştir çünkü
> yönetilen bir PostgreSQL örneği henüz yoktur (B4). Yedekleme "yapılandırıldı"
> sayılabilmesi için iki şart vardır: (1) otomatik yedek gerçekten alınıyor,
> (2) **o yedekten geri yükleme en az bir kez denendi**. İkincisi olmadan
> birincisi bir umuttur, bir yedek değil.

| Ne | Sıklık | Saklama | Test |
|---|---|---|---|
| PostgreSQL tam yedek (`pg_dump -Fc`) | günlük | 30 gün | ayda bir **geri yükleme provası** |
| PostgreSQL WAL / PITR | sürekli | 7 gün | çeyrekte bir |
| Dağıtım öncesi anlık yedek | her dağıtım | 7 gün | — |
| Uygulama imajı / git etiketi | her dağıtım | 90 gün | — |

- Uygulama yedeği ≠ veritabanı yedeği. İkisi ayrı saklanır.
- **Geri yükleme denenmemiş yedek, yedek değildir.**
- Yedekler şifreli ve uygulama sunucusundan farklı bir konumda tutulur.

### ⚠️ REDIS YEDEKLENMEZ — VE YEDEKLENMEMELİ

Redis bu sistemde **hiçbir verinin tek kaynağı değildir**. İçinde yalnızca
iki şey vardır:

| Ne | Kaybolursa |
|---|---|
| Rate limit sayaçları | Sayaçlar sıfırlanır; kullanıcı bir pencere boyunca daha cömert sınırlarla karşılaşır. Veri kaybı YOK. |
| Katalog cache | İlk istekte veritabanından yeniden kurulur. Veri kaybı YOK. |

Sipariş, ödeme, fulfillment ve katalog **yalnızca PostgreSQL'dedir**.
Redis'i yedeklemeye çalışmak yanlış bir güvenlik hissi verir: asıl risk
Redis'in kaybı değil, **PostgreSQL yedeğinin denenmemiş olmasıdır**.

- [ ] `maxmemory-policy` = **`noeviction`** doğrulandı
      (sayaçların atılması rate limit'i sessizce devre dışı bırakır)
- [ ] Redis'in kalıcılığı (RDB/AOF) **kapalı olabilir** — kararı bilinçli verin

### Erişim güvenliği ve şifreleme

- [ ] Üretim veritabanı **halka açık internetten erişilemiyor** (özel ağ / VPC
      veya IP beyaz listesi)
- [ ] Uygulama kullanıcısı yalnızca kendi şemasında yetkili; `SUPERUSER` değil
- [ ] Bağlantı **TLS zorunlu** (`sslmode=require` veya sağlayıcı eşdeğeri)
- [ ] **Yedekler şifreli** (sağlayıcı tarafında at-rest + aktarımda TLS)
- [ ] Yedeklere erişim, uygulama sunucusundan **ayrı** bir kimlikle
- [ ] Veritabanı parolası rotasyonu için bir plan var (kim, ne sıklıkla)

### Migration öncesi zorunlu adım

- [ ] **Her migration'dan ÖNCE anlık yedek alındı** (`pg_dump -Fc`)
- [ ] Yedeğin boyutu ve bitiş kodu kontrol edildi (0 byte yedek sık görülür)
- [ ] Migration `--dry-run` / staging üzerinde önce çalıştırıldı
- [ ] Geri dönüş planı yazılı: hangi migration, hangi yedek, kim onaylar

### Geri yükleme provası (ayda bir)

1. Yedeği **BOŞ** bir veritabanına geri yükle (canlıya değil!)
2. `npm run db:validate-pricing` çalıştır — katalog bütünlüğü
3. Rastgele 5 sipariş seç, `Order → Payment → Fulfillment` zincirini doğrula
4. Süreyi **kaydet**: "geri yükleme 40 dakika sürüyor" bilgisi, kriz anında
   verilecek kararı değiştirir
5. Prova veritabanını sil

---

## 7 · SECURITY

- [ ] HTTPS zorunlu, HSTS preload aktif (`max-age=63072000`)
- [ ] Güvenlik başlıkları canlıda görünüyor:
      `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`,
      `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`,
      `Cross-Origin-Opener-Policy`
- [ ] CSP `frame-src` listesi kullandığınız sağlayıcının 3DS alan adını içeriyor
- [ ] Oturum çerezi: `httpOnly`, `sameSite=lax`, `secure`, `__Secure-` önekli
- [ ] Admin/panel yolları `robots.txt` içinde disallow
- [ ] İlk SUPERADMIN şifresi değiştirildi
- [ ] Rate limit canlıda doğrulandı (Redis üzerinden, örnekler arası ortak)
- [ ] **Ters proxy / CDN `X-Forwarded-For` başlığını istemciden geleni EZEREK
      yazıyor** — aksi halde rate limit kimliği taklit edilebilir
- [ ] Yetki matrisi gözden geçirildi: `docs/SECURITY_MATRIX.md`
- [ ] Boot log'unun ilk satırı `canli=EVET` diyor (`[boot] APP_ENV=…`)

---

## 8 · REDIS

- [ ] `REDIS_URL` tanımlı (yoksa boot FAIL — bellek-içi yedek **yok**)
- [ ] Kalıcılık: rate limit için gerekmez, katalog cache için de gerekmez;
      yeniden başlatmada sayaçlar sıfırlanır (kabul edilebilir)
- [ ] `maxmemory-policy` **`noeviction`** — sayaçların atılması rate limit'i
      sessizce devre dışı bırakır
- [ ] Katalog cache invalidation çalışıyor: admin fiyat değiştirdiğinde public
      snapshot anında güncelleniyor

---

## 9 · EMAIL

Canlıda müşteriye e-posta gidebilmesi için ÜÇ şey birden gerekir: sağlayıcı
hesabı, API anahtarı ve **DNS doğrulaması** (§ 2). Üçünden biri eksikken
sistem "gönderildi" DEMEZ — her deneme `Notification.status = 'FAILED'`
olarak kaydedilir.

### Ortam

| Değişken | Değer | Not |
|---|---|---|
| `EMAIL_PROVIDER` | `resend` | `console` canlıda **boot'u durdurur** |
| `RESEND_API_KEY` | *(sır)* | Yoksa `EMAIL_PROVIDER=resend` boot'u durdurur |
| `MAIL_FROM` | `siparis@medya333.com` | Alan adı DNS'te doğrulanmış olmalı |

- [ ] Resend (veya eşdeğeri) hesabı açıldı
- [ ] Gönderici alan adı sağlayıcı panelinde **doğrulandı**
- [ ] SPF · DKIM · DMARC kayıtları yayında (§ 2)
- [ ] Gerçek bir test siparişiyle e-posta **teslim edildi** (spam klasörü dahil kontrol)
- [ ] `/yonetim/notifications` ekranında `FAILED` sayısı **0**

> ⚠️ **"Sağlayıcı bağlandı" ile "e-posta ulaşıyor" aynı şey değildir.**
> API 200 dönebilir ama SPF/DKIM yoksa mesaj spam'e düşer. Bu satır ancak
> gerçek bir gelen kutusunda e-postayı gördükten sonra işaretlenir.

**DURUM: PENDING** — sağlayıcı hesabı yok (B2).

---

---

## 10 · MONITORING

> ⚠️ **DURUM: HATA İZLEME BAĞLI DEĞİL (B5).** `@sentry/nextjs` bağımlılığı
> KURULMADI ve sahte bir entegrasyon yazılmadı. `SENTRY_DSN` verilse bile
> hiçbir olay gönderilmez; durum `pending_sdk` olur ve boot bunu uyarı olarak
> bildirir (`ERROR_TRACKING_SDK_MISSING`).

### Sentry bağlandığında yapılacaklar

Uygulama tarafı hazırdır: tüm hata yolları `server/observability.ts` içindeki
`reportError()` çağrısından geçer ve bağlam beyaz listeyle temizlenir.

1. `npm i @sentry/nextjs`
2. `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` ortama girilir
3. `server/observability.ts` → `SENTRY_SDK_INSTALLED = true`
4. `deliver()` içindeki yorumlu `Sentry.captureException` satırı açılır
5. SDK yapılandırmasında **zorunlu** ayarlar:
   - [ ] `sendDefaultPii: false` (varsayılan `true` DEĞİL)
   - [ ] `beforeSend` içinde `scrubMessage` + `scrubContext` uygulanır
   - [ ] `attachStacktrace` kapalı ya da yığın izi ayrıca temizlenir

### Sentry'ye ASLA gitmeyecek alanlar

`server/observability.ts` bunları **beyaz liste** ile zorlar — listede olmayan
her alan sessizce düşer:

parola · parola hash'i · oturum token'ı · misafir takip token'ı · CVV ·
kart numarası · merchant key/salt · API anahtarları · **ham IP** ·
gereksiz e-posta ve telefon

Serbest metin (hata mesajı) ayrıca kalıp bazlı maskelenir: bağlantı dizeleri,
`Bearer` token'ları, `anahtar=değer` biçimindeki sırlar, e-posta adresleri,
13–19 haneli kart benzeri diziler ve IPv4 adresleri.

- [ ] Uygulama log'ları toplanıyor (stdout → log toplayıcı)
- [ ] Log'lar **PII-safe**: kart verisi, CVV, secret, session token, Authorization
      başlığı yazılmıyor; e-posta maskeleniyor, IP hash'leniyor
- [ ] `X-Request-Id` / `requestId` alanı destek taleplerinde kullanılabiliyor
- [ ] **`/api/health` izleme sistemine bağlandı** (`unavailable` → 503)
      ⚠️ Sağlık ucu ödeme sağlayıcısını ÇAĞIRMAZ ve sır döndürmez
- [ ] **Bildirim başarısızlıkları izleniyor**: `Notification.status = 'FAILED'`
      sayısı artıyorsa müşteriye e-posta GİTMİYOR demektir
- [ ] İzlenecek olaylar:
      - `[payment.webhook] outcome=invalid_signature` → saldırı veya yanlış anahtar
      - `[boot:blocker]` → dağıtım hatası
      - `payment.amount_mismatch` audit kaydı → sağlayıcı/veri tutarsızlığı
      - `getRefundSummary().needsReconciliation` → çift tahsilat
- [ ] Uyarı eşiği: 5 dk içinde >10 `invalid_signature`

---

## 11–13 · DEPLOY

### 11 · Build

```bash
npx prisma generate
npm run build
npx prisma migrate deploy
npm run db:seed          # yalnızca ilk kurulum ve katalog güncellemelerinde
npm run start            # veya süreç yöneticiniz
```

### 12 · Start
- [ ] Boot log'unun ilk satırı: `[boot] APP_ENV=production canli=EVET`
- [ ] `[boot:blocker]` satırı **yok** (varsa süreç zaten açılmaz)
- [ ] `[boot:warning]` satırlarını oku ve kabul et

### 13 · Health check
- [ ] `GET /api/health/live` → `200 ok` (**liveness** — bağımlılığa bakmaz)
- [ ] `GET /api/health` → `{"status":"healthy"}` (**readiness** — DB + Redis)
- [ ] Orkestratör doğru bağlandı:
      `livenessProbe → /api/health/live` · `readinessProbe → /api/health`
- [ ] `GET /api/v1/catalog/snapshot` → 200 ve dolu katalog

> ⚠️ Liveness'a `/api/health` vermeyin. Veritabanı kısa süre erişilemez
> olduğunda orkestratör tüm örnekleri yeniden başlatır ve kısa bir kesinti
> kendini besleyen bir yeniden başlatma döngüsüne dönüşür.

---

## 14 · POST-DEPLOY

- [ ] Ana sayfa, katalog, sipariş sihirbazı canlıda açılıyor
- [ ] Gerçek bir misafir siparişi uçtan uca denendi (küçük tutar)
- [ ] Operatör panelinde iş göründü, manuel başlat/ilerleme/tamamla çalıştı
- [ ] Müşteri sipariş sayfasında garanti bilgisi doğru
- [ ] `sitemap.xml` ve `robots.txt` **`https://www.medya333.com`** gösteriyor
- [ ] Canonical ve `og:url` **`https://www.medya333.com/`** (localhost DEĞİL)
- [ ] `/yonetim/notifications` açılıyor; `FAILED` bildirim sayısı beklenen
- [ ] `/yonetim/kullanicilar` açılıyor ve rol değişikliği denetim kaydına düşüyor
- [ ] Sipariş takip e-postasındaki bağlantı `https://www.medya333.com` ile başlıyor
- [ ] OG etiketleri doğru (⚠️ `og:image` YOK — marka görseli gelmedi)
- [ ] Mobilde (390px) sipariş akışı denendi

---

## 15 · PAYMENT

> ⚠️ **BU FAZDA YAPILMADI.** PayTR başvurusu onaylanmadı; merchant credential
> bağlanmadı, gerçek ödeme başlatılmadı, adapter kodu ve webhook davranışı
> DEĞİŞTİRİLMEDİ.
>
> Onay geldiğinde **kod değişikliği gerekmez** — yalnızca aşağıdaki dört ortam
> değişkeni girilir ve bu bölüm işaretlenir:
>
> ```
> PAYMENT_PROVIDER=paytr
> PAYMENT_ENVIRONMENT=production
> PAYTR_MERCHANT_ID=…  PAYTR_MERCHANT_KEY=…  PAYTR_MERCHANT_SALT=…
> ```
>
> Ayrı bir faz olarak yürütülecektir: **FAZ 10 — PAYTR PRODUCTION ACTIVATION**.

- [ ] Sağlayıcı panelinde **canlı** üye iş yeri onaylı
- [ ] Webhook adresi sağlayıcıya tanımlı:
      - iyzico → `https://<alan-adı>/api/v1/payments/webhooks/iyzico`
      - PayTR → `https://<alan-adı>/api/v1/payments/webhooks/paytr`
- [ ] Webhook ucu **auth istemez, imza ister** — sağlayıcı IP'si beyaz listeye
      alınacaksa ters vekilde yapılır, uygulamada değil
- [ ] PayTR ucunun düz `OK` gövdesi döndüğü doğrulandı (aksi halde saatlerce
      tekrar gönderir)
- [ ] Küçük tutarlı **gerçek** bir test siparişi: ödeme → PAID → READY zinciri
- [ ] Test siparişinin iadesi yapıldı (iade yetkisi `SUPERADMIN`)
- [ ] `PAYMENT_ENVIRONMENT=production` ve `PAYMENT_PROVIDER≠mock` doğrulandı

---

## 16 · ROLLBACK

Uygulama ve veritabanı **ayrı** geri alınır.

### Uygulama (hızlı, güvenli)
1. Önceki imaja/sürüme dön
2. Süreçleri yeniden başlat
3. Sağlık kontrolü

Migration'lar **eklemeli** olduğu için eski uygulama sürümü yeni şemayla
çalışmaya devam eder — bu bilinçli bir tasarım kararıdır.

### Veritabanı (yavaş, dikkatli)
1. Uygulamayı **bakım moduna al** (trafiği kes)
2. Dağıtım öncesi yedeği geri yükle
3. ⚠️ Geri yükleme **veri kaybı** demektir: yedekten sonra alınan ödemeler ve
   yapılan operasyon kayıtları silinir
4. Ödeme sağlayıcı panelinden tahsilatları **mutabakat et**; DB'de olmayan
   ama sağlayıcıda tahsil edilmiş ödeme varsa elle iade et
5. Ancak bundan sonra trafiği aç

### Karar kuralı
- Yalnızca UI/mantık hatası → **uygulama rollback yeter**
- Şema/veri bozulması → önce trafiği kes, sonra DB rollback + mutabakat

---

## 17 · POST-LAUNCH (canlıyı engellemez, sırada)

**Faz 8'de KAPATILANLAR** ~~üstü çizili~~ olarak bırakıldı; hangi borcun ne
zaman kapandığı görünür kalsın diye.

- [x] ~~Operatör kuyruğunda sayfalama~~ → Faz 8: cursor tabanlı, 50 kayıt,
      en yeni ilk sayfada
- [x] ~~Müşteri bildirimleri~~ → Faz 8: 7 şablon + idempotent bildirim kaydı
      **(⚠️ gönderim için sağlayıcı gerekir — B2)**
- [x] ~~Admin panelinde hizmet/varyant oluşturma ve fiyat kademesi formu~~ → Faz 8
- [ ] Instagram dışındaki ürünlerde garanti süresi tanımlanması (`refillDays`)
- [ ] SLA / gecikme alarmı (`READY`'de bekleyen iş için eşik)
- [ ] Panelden rol atama (roller şu an yalnızca veritabanından veriliyor)
- [ ] Garanti bitişi yaklaşan siparişler için hatırlatma
- [ ] Kampanya ve kupon yönetim arayüzü
- [ ] `og:image` ve gerçek marka logosu
- [ ] Fatura entegrasyonu (alanlar hazır, sağlayıcı yok)
- [ ] Telafi kaydının kendi fulfillment'ını üretmesi
