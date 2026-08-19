# ÜRETİM RUNBOOK — Medya 333

> Faz 10. Bu belge, uygulamayı **sıfırdan canlıya almanın** adım adım
> yordamıdır. Her adımın bir **STATUS**'ü vardır ve bu status ölçülmüş
> gerçeği yansıtır.
>
> | STATUS | Anlamı |
> |---|---|
> | `READY` | Kod tarafı hazır, doğrulandı, çalıştığı GÖRÜLDÜ. |
> | `PENDING` | Kod tarafı hazır ama **dış bir bileşen eksik** (sunucu, DNS erişimi, sağlayıcı hesabı). Doğrulanamadı. |
> | `BLOCKED` | Bir ön koşul yerine gelmeden **yapılamaz**. |
>
> ⚠️ Bu belgede tek bir gerçek sır, gerçek bağlantı adresi veya gerçek
> merchant bilgisi YOKTUR.
>
> ⚠️ **Sahte başarı yoktur.** Bir bileşen gerçekten bağlı değilse `READY`
> yazılmamıştır — bu ortamdan doğrulanamayan her şey `PENDING`'dir.

**Canlı alan adı:** `https://www.medya333.com`
**Staging alan adı:** *belirlenmedi — uydurulmadı.*

---

## Özet tablo

| # | Adım | STATUS |
|---|---|---|
| 1 | Sürüm dondurma ve ön kontroller | `READY` |
| 2 | Üretim imajının derlenmesi | `PENDING` |
| 3 | İmaj güvenlik denetimi | `PENDING` |
| 4 | Sunucu ve ortam dosyası | `PENDING` |
| 5 | Veritabanı: migration + damga | `PENDING` |
| 6 | Katalog verisi | `PENDING` |
| 7 | Yedekleme | `BLOCKED` |
| 8 | Redis | `PENDING` |
| 9 | E-posta ve DNS kayıtları | `BLOCKED` |
| 10 | Hata izleme | `PENDING` |
| 11 | DNS geçişi ve TLS | `PENDING` |
| 12 | İlk açılış ve duman testi | `PENDING` |
| 13 | Ödeme aktivasyonu | `BLOCKED` |
| 14 | Geri alma (rollback) | `READY` |

---

## 1) Sürüm dondurma ve ön kontroller — `READY`

Bu adım tamamen bu depo içinde yapılır ve **doğrulandı**.

```bash
npm ci
npm run typecheck          # ✓ hatasız
npm run test               # ✓ 33 dosya · 889 test
npm run build              # ✓ derleniyor
npm run env:check -- .env.staging .env.production   # ortam dosyaları varsa
```

Ek kontroller:

```bash
git rev-parse --short HEAD     # imaj etiketi olacak
git status --porcelain         # BOŞ olmalı — kirli ağaçtan imaj üretilmez
```

⚠️ **Kirli çalışma ağacından imaj üretmeyin.** Etiket bir commit'e karşılık
gelmiyorsa "hangi kod canlıda?" sorusunun cevabı yoktur ve geri alma
güvenilmez hâle gelir.

---

## 2) Üretim imajının derlenmesi — `PENDING`

> **Neden PENDING:** Bu geliştirme ortamında **Docker daemon yoktur**
> (`docker info` → `dial unix /var/run/docker.sock: no such file`). `Dockerfile`
> yazıldı ve statik olarak denetlendi (`tests/unit/docker.test.ts`, 24 test),
> **ama imaj hiç derlenmedi.** Derlendiği ilk seferde tarif doğrulanmalıdır.
>
> Doğrulanan kısım: `next build` standalone çıktısı bu ortamda üretildi ve
> `node server.js` ile **gerçekten çalıştırıldı** (adım 12'deki duman testi
> yerelde geçti).

```bash
TAG=$(git rev-parse --short HEAD)
docker build -t medya333:$TAG .
```

İmaj tarifinin garantileri:

| Kural | Nasıl sağlanıyor |
|---|---|
| Sır yok | `.dockerignore` → `.env*`, `*.pem`, `*.key`, `.git` bağlama girmez |
| Sır yok (2. hat) | Derleme, bağlamda veya `.next/standalone` içinde `.env` bulursa **KIRILIR** |
| Dev bağımlılığı yok | Çalışma katmanı yalnızca `.next/standalone` taşır; `typescript` izlemeden çıkarıldı |
| Non-root | `USER node` (uid 1000) |
| Sağlık ucu | `HEALTHCHECK` → `/api/health` |
| Source map | `productionBrowserSourceMaps: false` — public `.map` üretilmez |
| Aşama gömülü değil | `ENV APP_ENV` **yok**; aynı imaj staging ve canlıda çalışır |
| Tekrarlanabilir | Taban imaj sürümü sabit (`ARG NODE_VERSION`), `npm ci` |

⚠️ **`--build-arg` ile sır geçmeyin.** Build arg'lar `docker history` çıktısında
görünür.

---

## 3) İmaj güvenlik denetimi — `PENDING`

> **Neden PENDING:** Denetim scripti gerçek bir imaj ister; imaj derlenmedi.

```bash
./scripts/verify-image.sh medya333:$TAG
```

Script sekiz kontrol yapar ve bulunan sırrın **değerini yazmaz**:

1. `.env` dosyası var mı
2. Dosya sisteminde sır *kalıbı* var mı (`re_…`, `sk_live_…`, `postgres://u:p@…`, private key)
3. Katman geçmişinde sır ataması (`docker history`)
4. İmaj `ENV`'inde sır
5. `APP_ENV` gömülmüş mü
6. Dev bağımlılığı (vitest / playwright / typescript / prisma / eslint)
7. Root kullanıcı
8. Public source map

Çıkış kodu 0 değilse **dağıtmayın**.

---

## 4) Sunucu ve ortam dosyası — `PENDING`

> **Neden PENDING:** Üretim sunucusu sağlanmadı.

1. `.env.example` şablonundan `/etc/medya333/env` oluşturun.
2. İzin: `chmod 600 /etc/medya333/env`, sahibi deploy kullanıcısı.
3. Sırları **yeni üretin** — hiçbirini başka bir ortamdan kopyalamayın:
   ```bash
   openssl rand -base64 48   # AUTH_SECRET
   openssl rand -base64 48   # ORDER_TOKEN_SECRET  (AUTH_SECRET'tan FARKLI)
   openssl rand -hex 24      # IP_HASH_SALT
   ```
4. Zorunlu değerler:
   ```
   APP_ENV=production
   APP_BASE_URL=https://www.medya333.com
   NEXT_PUBLIC_SITE_URL=https://www.medya333.com
   ```
5. Ortam ayrımını doğrulayın:
   ```bash
   npm run env:check -- .env.staging /etc/medya333/env
   ```

⚠️ `APP_ENV` yazılmazsa uygulama **canlı** varsayar (fail-closed) — bu güvenli
taraftır ama açıkça yazın.

Ayrıntılı matris: `docs/ENVIRONMENTS.md`.

---

## 5) Veritabanı: migration + damga — `PENDING`

> **Neden PENDING:** Üretim veritabanı sağlanmadı.

⚠️ **Migration üretim imajından çalıştırılmaz.** Prisma CLI bir dev
bağımlılığıdır ve imajda bilerek yoktur; ayrıca şema değişikliği uygulamanın
yan etkisi olmamalıdır (iki örnek aynı anda açılırsa ikisi de migration'a
girerdi). Migration, repo checkout'u olan **ayrı bir bakım adımıdır**.

```bash
# Bakım makinesinde / CI job'ında
npm ci
DATABASE_URL="<canlı>" npm run db:deploy      # veya: npx tsx scripts/migrate-wasm.mts apply

# ⭐ VERİTABANINI DAMGALAYIN — bu adım atlanırsa yanlış-ortam koruması ÇALIŞMAZ
DATABASE_URL="<canlı>" npm run db:stamp -- --stage=production --label="<sunucu-adı>"
DATABASE_URL="<canlı>" npm run db:stamp:check
```

Beklenen çıktı:

```
Damga: production · <sunucu-adı>
```

⚠️ Damga, veritabanının hangi ortama ait olduğunu **veritabanının içinde**
saklar. Uygulama açılışta okur; uyuşmazlıkta **süreç açılmaz** (bkz. adım 12).

⚠️ Migration'lardan önce **yedek alın** (adım 7). Yedek yoksa geri dönüş yoktur.

---

## 6) Katalog verisi — `PENDING`

> **Neden PENDING:** Üretim veritabanı yok.

⚠️ **`npm run db:seed` canlıda ÇALIŞMAZ ve çalıştırılamaz.** Kapı davranışa
değil ortama bakar (`prisma/seed/guard.ts`); `APP_ENV=production` veya
tanımsızsa seed reddedilir. `SEED_ALLOW_PRODUCTION` gibi bir kaçış kapısı
**bilinçli olarak yoktur**.

Canlıda katalog nasıl kurulur?

1. Canlı veritabanının bir **kopyasını** alın.
2. Kopyayı `APP_ENV=staging` ile seed'leyin.
3. `pg_dump --data-only` ile yalnızca katalog tablolarını çıkarın:
   `Platform`, `Service`, `ServiceVariant`, `PricingRule`, `TaxRate`
4. SQL farkını **gözle inceleyin** — fiyat değişikliği gözden kaçmamalı.
5. Transaction içinde canlıya uygulayın.

⚠️ **Canlı veritabanında demo veri oluşturulmaz.** Seed zaten
`User`/`Order`/`Payment` üretmez (kupon ve `SEED_ADMIN_*` hariç) — ama canlıda
hiç çalıştırılmadığı için bu soru gündeme gelmez.

⚠️ İlk SUPERADMIN hesabı: `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` **canlı
ortamda boş bırakılır**. Yönetici hesabı, staging'de seed edilmiş bir kopyadan
taşınmaz; canlıda tek seferlik bir SQL ile açılır ve **ilk girişte şifre
değiştirilir**.

---

## 7) Yedekleme — `BLOCKED`

> **Neden BLOCKED:** Hiçbir yedekleme sistemi bağlı değildir. Sağlayıcı
> bilinmediği için sağlayıcıya özgü komut **uydurulmadı**.
>
> ⚠️ Yedek doğrulanmadan canlıya çıkmak, adım 5'i geri alınamaz hâle getirir.

Yedeklemenin **doğrulanmış** sayılması için gerekenler:

- [ ] Otomatik günlük yedek (yönetilen sağlayıcıda veya `pg_dump` + zamanlayıcı)
- [ ] Yedeğin **başka bir yerde** saklanması (aynı diskteki yedek yedek değildir)
- [ ] Saklama süresi kararı (ör. 30 gün) ve KVKK uyumu
- [ ] **Geri yükleme provası** — yedeğin boş bir veritabanına geri yüklendiği,
      migration durumunun tutarlı olduğu ve uygulamanın açıldığı GÖRÜLMELİ
- [ ] Geri yükleme süresinin (RTO) ve kabul edilen veri kaybının (RPO) yazılması

⚠️ **Geri yüklenmemiş bir yedek, yedek değildir.** Prova yapılmadan bu adım
`READY` işaretlenmemelidir.

⚠️ Geri yüklenen bir kopya kullanılacaksa **damgayı düzeltin**:
```bash
npm run db:stamp -- --stage=staging --force   # kopya staging'e alınıyorsa
```
Aksi hâlde `production` damgalı bir kopyaya staging bağlanamaz (doğru davranış).

---

## 8) Redis — `PENDING`

> **Neden PENDING:** Üretim Redis örneği sağlanmadı.

⚠️ **Redis CANLIDA ZORUNLUDUR.** Yoksa uygulama boot'ta durur
(`REDIS_REQUIRED`). Bellek-içi yedek **kasıtlı olarak yoktur**: tek süreçlik
bir sayaç, çok örnekli üretimde rate limit'i sessizce devre dışı bırakırdı.

Sunucu ayarları:

```
maxmemory-policy noeviction
appendonly yes
```

⚠️ `noeviction` bir tercih değil, gerekliliktir: rate limit sayaçlarının
bellek baskısıyla atılması, korumayı **sessizce** kapatır.

⚠️ **Redis kaynak-of-truth DEĞİLDİR.** Sipariş, ödeme ve fiyat yalnızca
PostgreSQL'dedir. Redis kaybı **veri kaybı değildir**; cache soğur, fiyatlar
veritabanından yeniden hesaplanır. Rate limit ise **fail-closed**'dır: Redis
erişilemezse üretimde istek reddedilir.

---

## 9) E-posta ve DNS kayıtları — `BLOCKED`

> **Neden BLOCKED:** Resend hesabı/anahtarı yok **ve** alan adının mevcut DNS
> kayıtları üçüncü parti gönderime izin vermiyor.

### Ölçülen mevcut durum (bu ortamdan DNS ile doğrulandı, 19 Ağustos 2026)

| Kayıt | Ölçülen değer | Sonuç |
|---|---|---|
| `medya333.com` NS | `ns0.wixdns.net`, `ns1.wixdns.net` | DNS **Wix**'te yönetiliyor |
| `medya333.com` A | `185.230.63.107/.171/.186` | Wix |
| `www.medya333.com` CNAME | `cdn3.wixdns.net` | **Şu an bir Wix sitesi yayında** |
| `medya333.com` MX | Google Workspace (`aspmx.l.google.com` ailesi) | e-posta ALMA çalışıyor |
| `medya333.com` TXT (SPF) | `v=spf1 include:_spf.google.com ~all` | ⚠️ **Resend YOK** |
| `_dmarc.medya333.com` | **kayıt yok** | ⚠️ DMARC tanımsız |
| `resend._domainkey` | **kayıt yok** | ⚠️ DKIM tanımsız |
| CAA | **kayıt yok** | bilgi |

### Yapılması gerekenler

1. Resend hesabı açın, alan adını ekleyin, panelin verdiği **DKIM** ve
   **return-path** kayıtlarını Wix DNS'ine girin.
2. SPF'i Resend'i içerecek şekilde güncelleyin. **Yeni bir SPF kaydı EKLEMEYİN**
   — bir alan adında yalnızca bir SPF TXT kaydı olabilir; ikincisi ikisini
   birden geçersiz kılar. Mevcut kaydı düzenleyin:
   ```
   v=spf1 include:_spf.google.com include:amazonses.com ~all
   ```
   ⚠️ Yukarıdaki `include:` değeri **örnektir**. Resend panelinin verdiği
   gerçek değeri kullanın; tahmin etmeyin.
3. DMARC ekleyin — önce gözlem modunda:
   ```
   _dmarc.medya333.com TXT  "v=DMARC1; p=none; rua=mailto:dmarc@medya333.com"
   ```
   Raporlar temiz göründükten sonra `p=quarantine` → `p=reject`.
4. `.env`e yazın:
   ```
   EMAIL_PROVIDER=resend
   RESEND_API_KEY=<panelden>
   MAIL_FROM=siparis@medya333.com
   ```
5. Doğrulayın: gerçek bir siparişle değil, **kendi adresinize** tek bir test
   maili ile.

⚠️ `EMAIL_PROVIDER=console` canlıda **boot'u durdurur**: teslim edilmediği
hâlde başarı döndürdüğü için sistem "gönderildi" sanardı.

⚠️ Sağlayıcı yoksa doğru değer `none`'dır. Sistem o zaman açıkça başarısız
olur: her bildirim `FAILED` yazılır ve panelde görünür — sessizce kaybolmaz.

---

## 10) Hata izleme — `PENDING`

> **Neden PENDING:** Monitoring sağlayıcısı credential'ı yok. **SDK bilerek
> kurulmadı** — credential olmadan SDK eklemek, hiçbir olay göndermeyen ama
> "kurulu" görünen bir entegrasyon üretirdi.

Mevcut durum: `errorTrackingState()` → `not_configured`.
`SENTRY_DSN` verilirse durum `pending_sdk` olur — **`active` olmaz**, çünkü
SDK yoktur ve hiçbir olay gönderilmez. Hiçbir ekran "aktif" göstermez.

Bağlamak için:

1. Sentry (veya eşdeğeri) projesi açın, DSN alın.
2. SDK'yı kurun ve `src/server/observability.ts` içindeki
   `SENTRY_SDK_INSTALLED` bayrağını `true` yapın.
3. `.env`: `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`, `SENTRY_TRACES_SAMPLE_RATE`.

⚠️ **PII filtresi bozulmamalıdır.** Bağlam alanları bir **izin listesiyle**
(deny-list değil) sınırlıdır; e-posta, telefon, IP, sipariş takip token'ı,
ödeme verisi ve merchant sırları redakte edilir. SDK bağlanırken bu katman
atlanmamalıdır — `reportError` tek giriş noktası olarak kalmalıdır.

⚠️ Source map'ler **public servis edilmez**. Sağlayıcıya derleme adımında
yüklenip imajdan silinir.

---

## 11) DNS geçişi ve TLS — `PENDING`

> **Neden PENDING:** Bu ortamdan TLS sertifikası **doğrulanamaz** ve DNS
> değişikliği yapılamaz. Tahmin edilmedi.

⚠️ **`www.medya333.com` şu anda bir Wix sitesine işaret ediyor** (adım 9'daki
ölçüm). Geçiş, mevcut yayındaki siteyi değiştirecektir — zamanlaması iş
kararıdır.

Sıra:

1. Uygulamayı yeni sunucuda **geçici bir adreste** ayağa kaldırın ve duman
   testini orada geçin (adım 12).
2. Reverse proxy'yi (Caddy/nginx/ALB) kurun:
   - TLS sertifikası (Let's Encrypt veya sağlayıcı)
   - HTTP → HTTPS yönlendirmesi
   - `medya333.com` → `www.medya333.com` yönlendirmesi (canonical `www`'dur)
   - Gerçek istemci IP'sinin uygulamaya iletilmesi
3. TTL'i düşürün (ör. 300 sn), sonra kaydı değiştirin.
4. Değişiklikten sonra doğrulayın:
   ```bash
   dig +short www.medya333.com
   openssl s_client -connect www.medya333.com:443 -servername www.medya333.com </dev/null 2>/dev/null | openssl x509 -noout -subject -dates -issuer
   ```
5. HSTS zaten uygulamadan gönderiliyor (`max-age=63072000; includeSubDomains; preload`).
   ⚠️ HSTS **geri alınması zordur**: yanlış bir TLS kurulumuyla yayına
   girerseniz tarayıcılar alan adını uzun süre HTTPS'e zorlar. TLS'in
   çalıştığından emin olmadan DNS'i çevirmeyin.

⚠️ `APP_BASE_URL` ile `NEXT_PUBLIC_SITE_URL` **aynı** olmalıdır; farklıysa boot
uyarı verir (`BASE_URL_MISMATCH`) ve sayfa kaynağı bir alan adını, e-postalar
başka birini gösterir.

---

## 12) İlk açılış ve duman testi — `PENDING`

> **Neden PENDING:** Üretim sunucusu yok. **Yerelde, üretim derlemesiyle
> (`node server.js`) çalıştırıldı ve aşağıdaki çıktılar GERÇEKTEN görüldü.**

```bash
docker run --env-file /etc/medya333/env -p 127.0.0.1:3000:3000 medya333:$TAG
```

Boot log'unda görülmesi gerekenler:

```
[boot] APP_ENV=production canli=EVET bulgu=N
[boot] veritabanı damgası: production ✓
```

⚠️ Aşağıdakilerden biri görünürse **süreç açılmaz ve kapanır** — bu doğru
davranıştır, container yeniden başlatma döngüsüne girer ve önceki sürüm ayakta
kalır:

| Bulgu | Anlamı |
|---|---|
| `DEPLOYMENT_STAMP_MISMATCH` | Yanlış ortamın veritabanına bağlanılıyor |
| `REDIS_REQUIRED` | Redis yok |
| `MOCK_PAYMENT` | Sahte ödeme sağlayıcısı |
| `PAYMENT_SANDBOX` | Canlıda sandbox |
| `STAGE_REAL_PAYMENT` | Canlı olmayan aşamada gerçek tahsilat |
| `BASE_URL_NOT_HTTPS` / `BASE_URL_LOCALHOST` | Taban adres yanlış |
| `PLACEHOLDER_SECRET` / `SECRET_REUSE` | Sır örnek değer veya tekrar kullanılmış |
| `EMAIL_CONSOLE_IN_PRODUCTION` | `console` sağlayıcısı canlıda |

Sağlık uçları (yerelde doğrulandı):

```bash
curl -s http://127.0.0.1:3000/api/health
# {"status":"healthy","checks":{"application":{"status":"up"},
#  "database":{"status":"up","latencyMs":35},"redis":{"status":"up","latencyMs":28}}}

curl -s http://127.0.0.1:3000/api/health/live     # ok
```

Duman testi (canlıda, gerçek ödeme AÇILMADAN):

- [ ] Ana sayfa açılıyor, katalog geliyor
- [ ] Bir hizmet seçilip miktar değişince fiyat **sunucudan** güncelleniyor
- [ ] Kayıt / giriş çalışıyor
- [ ] `__Secure-` önekli oturum çerezi `Secure; HttpOnly; SameSite=Lax`
- [ ] Sayfa kaynağında canonical ve `og:url` → `https://www.medya333.com`
- [ ] `/yonetim` giriş istiyor, CUSTOMER erişemiyor
- [ ] `/api/health` 200, `/api/health/live` 200
- [ ] `robots.txt` ve `sitemap.xml` doğru alan adını gösteriyor
- [ ] `manifest.webmanifest` doğru `start_url` veriyor
- [ ] Güvenlik başlıkları geliyor (CSP, HSTS, X-Frame-Options, …)
- [ ] Sayfa kaynağında hiçbir sır yok

---

## 13) Ödeme aktivasyonu — `BLOCKED`

> **Neden BLOCKED:** **PayTR başvurusu henüz onaylanmadı.** Merchant bilgisi
> yoktur ve **uydurulmadı**. Bu adım onay gelmeden yapılamaz.

⚠️ Bu faz boyunca ödeme entegrasyonuna **dokunulmadı**.

Onay geldiğinde **yalnızca ortam değişir, kod değişmez**:

```
PAYMENT_PROVIDER=paytr
PAYMENT_ENVIRONMENT=production
PAYTR_MERCHANT_ID=<panelden>
PAYTR_MERCHANT_KEY=<panelden>
PAYTR_MERCHANT_SALT=<panelden>
```

Sonra:

1. PayTR panelinde **callback/webhook adresini** kaydedin — uygulama bunu
   `APP_BASE_URL` üzerinden üretir (`NEXT_PUBLIC_SITE_URL`den **değil**).
2. Sağlayıcının test kartıyla **tek bir** uçtan uca işlem yapın.
3. Sipariş `PAID` oluyor, `Fulfillment` `READY` açılıyor ve **orada duruyor**
   mu — otomatik başlamamalı, otomatik tamamlanmamalı.
4. İade akışını sağlayıcı panelinden bir kez deneyin.

⚠️ Kart numarası (PAN) ve CVV **hiçbir koşulda** veritabanına yazılmaz; şemada
böyle bir alan yoktur ve bu bir testle kilitlidir.

⚠️ `PAYMENT_ENVIRONMENT=production`, `APP_ENV=production` olmadan
kullanılamaz (`STAGE_REAL_PAYMENT`, her aşamada blocker).

---

## 14) Geri alma (rollback) — `READY`

Yordam yazıldı ve mekanizmaları doğrulandı.

### Kod geri alma — dakikalar

```bash
docker run --env-file /etc/medya333/env medya333:<ÖNCEKİ_SHA>
```

İmaj etiketi commit SHA'sı olduğu için geri alma "önceki etiketi çalıştır"
kadar basittir. `latest` kullanmayın — geri alacak bir şey kalmaz.

### Veritabanı geri alma — dikkat

⚠️ **Migration'lar otomatik geri alınmaz.** Faz 10 migration'larının ikisi de
salt eklemelidir ve eski kod yeni şemayla **sorunsuz çalışır**:

| Migration | Geri alma |
|---|---|
| `20260819120000_deployment_stamp` | Gerekmez (yeni tablo, eski kod görmez) |
| `20260819140000_drop_redundant_index` | `CREATE INDEX "Order_idempotencyKey_idx" ON "Order"("idempotencyKey")` |

Veri kaybı gerektiren bir geri dönüş gerekiyorsa tek yol **yedekten geri
yüklemektir** (adım 7) — ve yedek doğrulanmadığı sürece bu yol **yoktur**.

### Sır rotasyonu

| Sır | Etki |
|---|---|
| `AUTH_SECRET` | Tüm oturumlar düşer; kullanıcılar yeniden giriş yapar |
| `ORDER_TOKEN_SECRET` | Dağıtılmış misafir takip linkleri geçersiz olur |
| `IP_HASH_SALT` | Rate limit geçmişi kopar (zararsız) |
| `RESEND_API_KEY` | Anında etkili |

### Acil durumda "bakımdayız"

Reverse proxy'de statik bir bakım sayfasına yönlendirin. Uygulamayı yarı
çalışır hâlde bırakmayın: yarım kalan bir ödeme akışı, kapalı bir siteden
daha pahalıdır.

---

## Ekler

- Ortam ayrımı ve damga: `docs/ENVIRONMENTS.md`
- Kontrol listesi: `docs/LAUNCH_CHECKLIST.md`
- Güvenlik matrisi: `docs/SECURITY_MATRIX.md`
- Günlük operasyon: `docs/OPERATIONS.md`
- Mimari kararlar: `docs/architecture-decisions.md`
