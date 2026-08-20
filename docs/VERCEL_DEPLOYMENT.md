# VERCEL DAĞITIMI — Medya 333

> Faz 11. Bu belge, uygulamayı **Vercel'e güvenle dağıtılabilir** hâle getiren
> kararları ve dağıtım yordamını içerir.
>
> ⚠️ **Bu belge "her şey bağlandı" demez.** Gerçekten bağlanmamış her dış
> servis `PENDING` veya `BLOCKED` olarak işaretlenmiştir.
>
> ⚠️ Burada tek bir gerçek sır, merchant bilgisi veya bağlantı adresi YOKTUR.

**Canlı alan adı:** `https://www.medya333.com`
**PayTR:** dokunulmadı — aktivasyon onay bekliyor.

---

## 0) Dağıtım denetimi — bulgular

Faz 0–10 mimarisi Vercel serverless modeline karşı denetlendi.

### BLOCKER — düzeltildi

| # | Bulgu | Neden kritik | Durum |
|---|---|---|---|
| B1 | **Rate limit IP sahteciliğiyle atlatılabiliyordu** | `x-forwarded-for`'un EN SOLDAKİ değeri okunuyordu; o değeri istemci yazar. Saldırgan her istekte farklı sahte IP göndererek her seferinde temiz kova alırdı — giriş, sipariş ve misafir sorgulama limitleri anlamsızdı. Ayrıca `cf-connecting-ip` körü körüne okunuyordu. | ✅ `src/server/client-ip.ts` + `TRUSTED_PROXY` + 21 test |
| B2 | **Serverless'te bağlantı tükenmesi** | `pg` havuzu örnek başına 10 bağlantı açıyordu. Vercel'de her eşzamanlı örnek KENDİ havuzunu açar: 50 örnek × 10 = 500 bağlantı. Yönetilen PostgreSQL bunu reddeder — tam yük anında TAM KESİNTİ. | ✅ `DATABASE_POOL_MAX` + boot uyarısı |
| B3 | **`process.exit(1)` serverless'te yanlış** | Açılış hatasında süreç öldürülüyordu. Lambda'da bu, aynı örnekte işlenen DİĞER istekleri de yarıda keser ve platform log'una anlamlı hata yerine "runtime exited" düşer. | ✅ Serverless'te `throw`, uzun ömürlü süreçte `exit(1)` |

### WARNING — ele alındı

| # | Bulgu | Yapılan |
|---|---|---|
| W1 | Soğuk başlangıçta damga kontrolü DB'ye gidiyor; yavaş DB tüm istekleri kilitleyebilir | 3 sn zaman aşımı → uyarıya düşer, açılışı kilitlemez |
| W2 | `output: 'standalone'` Vercel'de gereksiz | Yalnızca Vercel dışında etkin |
| W3 | `NEXT_PUBLIC_SITE_URL` derlemeye gömülür; Preview dağıtımları rastgele URL alır | Ortam bazlı değer + boot uyarısı (`BASE_URL_MISMATCH`) belgelendi |
| W4 | `@node-rs/argon2` yerel (native) modül | İlk dağıtımda doğrulanmalı — aşağıda kontrol maddesi |
| W5 | Preview dağıtımları canlı veritabanına bakabilir | Dağıtım damgası bunu ZATEN engelliyor (Faz 10) |

### OK — Vercel modeline uygun bulundu

- **Middleware** Edge-safe: yalnızca çerez varlığına bakar, DB'ye dokunmaz, Node API kullanmaz.
- **Dosya sistemine yazma YOK** (`writeFileSync`/`createWriteStream` hiç yok).
- **WebSocket / SSE YOK** — sipariş ilerlemesi 20 sn'de bir kısa okuma ile alınır.
- **Uzun süren süreç / arka plan worker / cron YOK.**
- **Bellekte üretim durumu tutulmuyor** — sipariş, ödeme, fiyat yalnızca PostgreSQL'de.
- **`node:crypto` kullanımı** yalnızca Node runtime'da; Edge'e sızmıyor.
- **Sağlık uçları** `force-dynamic` — CDN önbelleğine takılmaz.
- **Güvenlik başlıkları** `next.config.ts` üzerinden; Vercel bunları aynen servis eder.
- **Prisma 7 queryCompiler (WASM)** — native engine indirmesi yok, derleme ağa bağımlı değil.

---

## 1) İstemci IP güven modeli — `TRUSTED_PROXY`

Rate limit kimliğini istemci IP'sinden alır. Yanlış başlığa güvenmek onu
**tamamen atlatılabilir** yapar.

| Değer | Nereden okur | Ne zaman |
|---|---|---|
| `xff-rightmost` ⭐ | `x-forwarded-for` zincirinin **en sağdaki** değeri | Varsayılan. Tek güvenilir hop arkasında (nginx / Caddy / ALB / **Vercel**) doğrudur |
| `vercel` | `x-vercel-forwarded-for` | Vercel'in **üstüne** başka bir proxy (ör. Cloudflare) koyduysanız |
| `cloudflare` | `cf-connecting-ip` | YALNIZCA origin'e Cloudflare dışından erişilemiyorsa |
| `none` | hiçbiri | Fail-closed: tüm istekler tek kova. Aşırı kısıtlayıcı ama sınırsıza düşmez |

**Vercel'de neden `xff-rightmost` yeterli?** Vercel `x-forwarded-for`
başlığını **üzerine yazar ve dış IP'leri iletmez**; bunu tam olarak IP
sahteciliğini önlemek için yapar. Yani başlık tek değer taşır ve en sağdaki
değer = tek değer = gerçek istemci.

⚠️ Ortamdan otomatik tahmin **edilmez**: güvenlik davranışı dağıtım ortamına
göre kendiliğinden değişmemelidir.

Testler: `tests/unit/client-ip.test.ts` (21 test), aralarında "5 farklı sahte
önek → 1 tek rate limit kimliği" kanıtı.

---

## 2) Veritabanı — bağlantı havuzu

⚠️ **Serverless'te iki ayrı şey gerekir; biri diğerinin yerine geçmez.**

**(a) Havuzlu bağlantı adresi.** Sağlayıcının pooler ucunu kullanın
(Neon pooler, Supabase pooler, PgBouncer). Uygulamanın `DATABASE_URL`i
budur.

**(b) `DATABASE_POOL_MAX=1`.** Vercel'de her eşzamanlı fonksiyon örneği kendi
`pg` havuzunu açar; örnekler arasında paylaşım yoktur. Bir örnek aynı anda tek
istek işlediği için ikinci bağlantı boşta bekler.

**(c) Migration için havuzsuz adres.** `prisma migrate deploy`, PgBouncer'ın
transaction modunda **çalışmaz**; migration'ı `DIRECT_DATABASE_URL` ile
çalıştırın.

Boot kapısı, serverless ortamda `DATABASE_POOL_MAX > 1` görürse uyarır
(`POOL_MAX_TOO_HIGH_FOR_SERVERLESS`).

**Bölge eşleşmesi:** `vercel.json` fonksiyonları `fra1` (Frankfurt) bölgesine
sabitler — Türkiye trafiğine en yakın Vercel bölgesi budur. **Veritabanını da
aynı bölgeye yakın seçin.** DB başka kıtadaysa her sorgu okyanus aşırı gider;
o durumda `vercel.json` içindeki `regions` değerini DB'nin bölgesine göre
değiştirin.

### Migration yordamı (Vercel)

⚠️ **Migration build sırasında ÇALIŞTIRILMAZ.** Build komutuna
`prisma migrate deploy` eklemek cazip ama yanlıştır: her Preview dağıtımı
şemaya dokunur ve iki eşzamanlı build yarışır.

Migration, repo checkout'u olan **ayrı bir adımdır**:

```bash
npm ci
DATABASE_URL="<havuzsuz-direct-adres>" npm run db:deploy
DATABASE_URL="<havuzsuz-direct-adres>" npm run db:stamp -- --stage=production --label="vercel-prod"
DATABASE_URL="<havuzsuz-direct-adres>" npm run db:stamp:check   # → production
```

### Seed

⚠️ **`npm run db:seed` canlıda çalışmaz ve açılışta ASLA çağrılmaz.**

- Kapı ortama bakar: `APP_ENV=production` veya tanımsız → **reddedilir**
  (`prisma/seed/guard.ts`, fail-closed).
- Uygulama açılışında seed **çağrılmaz** — `instrumentation.ts` yalnızca
  yapılandırma ve damga kontrolü yapar.
- `SEED_ALLOW_PRODUCTION` gibi bir kaçış kapısı **bilinçli olarak yoktur**.
- Canlı katalog yükleme yordamı: `docs/PRODUCTION_RUNBOOK.md` § 6.

---

## 3) Redis

Vercel'de Redis'e TCP ile bağlanılır (ioredis). Örnek başına bir bağlantı
açılır ve örnek sıcak kaldığı sürece yeniden kullanılır.

- **Sağlayıcı seçerken bağlantı sayısı limitine bakın** — serverless'te
  eşzamanlı örnek sayısı kadar bağlantı olabilir. Upstash gibi serverless'e
  yönelik sağlayıcılar bunun için uygundur.
- `maxmemory-policy noeviction` **zorunludur**: rate limit sayaçlarının bellek
  baskısıyla atılması, korumayı **sessizce** kapatır.

**Cache sorunu ile rate limit sorunu birbirine karıştırılmaz:**

| Redis yok / erişilemez | Davranış |
|---|---|
| **Rate limit** | Üretimde **fail-closed** — istek reddedilir. Sessizce sınırsıza DÜŞMEZ. Bellek-içi yedek bilinçli olarak YOKTUR (tek süreçlik sayaç, çok örnekli üretimde koruma sağlamaz). |
| **Katalog cache** | Fiyatlandırma BOZULMAZ. Kaynak-of-truth PostgreSQL'dir; cache soğur, fiyat DB'den yeniden hesaplanır. |
| **Boot** | `REDIS_URL` yoksa canlı açılış **durur** (`REDIS_REQUIRED`). |

---

## 4) Ortam ayrımı — Development / Preview / Production

Vercel'de üç ortam vardır. **Her biri kendi değişken setini alır.**

| Değişken | Development | Preview | Production |
|---|---|---|---|
| `APP_ENV` | *(boş)* | `staging` | `production` |
| `APP_BASE_URL` | `http://localhost:3000` | Preview URL'i | `https://www.medya333.com` |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Preview URL'i | `https://www.medya333.com` |
| `DATABASE_URL` | yerel | **ayrı veritabanı** | canlı (havuzlu) |
| `DATABASE_POOL_MAX` | `10` | `1` | `1` |
| `TRUSTED_PROXY` | `xff-rightmost` | `xff-rightmost` | `xff-rightmost` |
| `REDIS_URL` | yerel | **ayrı instance/DB no** | canlı |
| `AUTH_SECRET` | yerel | **ayrı** | **ayrı** |
| `ORDER_TOKEN_SECRET` | yerel | **ayrı** | **ayrı** |
| `IP_HASH_SALT` | yerel | **ayrı** | **ayrı** |
| `PAYMENT_PROVIDER` | `mock` | `mock` | `mock` *(PayTR onayına kadar)* |
| `PAYMENT_ENVIRONMENT` | `sandbox` | `sandbox` | `sandbox` *(PayTR onayına kadar)* |
| `EMAIL_PROVIDER` | `console` | `none` | `none` → `resend` (credential gelince) |
| `SEED_ADMIN_*` | serbest | serbest | **BOŞ** |

⚠️ **Preview dağıtımları canlı veritabanına bağlanamaz.** Yanlışlıkla canlı
`DATABASE_URL` verilse bile **dağıtım damgası** uyuşmazlığı yakalar ve
uygulama açılmaz (Faz 10, `docs/ENVIRONMENTS.md`).

⚠️ **Preview URL'i her dağıtımda değişir.** `NEXT_PUBLIC_SITE_URL` derlemeye
gömüldüğü için Preview'da canonical/OG adresi sabit kalır. Sunucu tarafı
adresler (callback, e-posta linki, sipariş takip linki) `APP_BASE_URL`den
okunur ve çalışma zamanında doğru olur.

⚠️ **Preview ve staging İNDEKSLENMEZ (Faz 11).** `APP_ENV` production
değilse `robots.txt` tüm siteyi kapatır (`Disallow: /`) ve sitemap
bildirilmez. Aksi hâlde aynı içerik iki adreste indekslenir, arama sonucunda
müşterinin karşısına eski bir dağıtım çıkabilir ve staging'deki test verisi
aranabilir hâle gelirdi.

**Sırların istemciye sızmadığı testle kilitlidir:** hiçbir sır `NEXT_PUBLIC_`
değildir (`tests/unit/production-audit.test.ts`). `NEXT_PUBLIC_` yalnızca üç
değerde kullanılır: site adı, site adresi, "fiyatlar KDV dahil" bayrağı.

**İki ortamın aynı sırrı paylaşmadığını doğrulayın:**

```bash
npm run env:check -- .env.preview .env.production
```

---

## 5) Domain ve DNS

⚠️ **DNS DEĞİŞTİRİLMEDİ.** Bu belge yalnızca hedefi tanımlar; kayıtları siz
gireceksiniz.

### Ölçülen mevcut durum (19 Ağustos 2026, DNS sorgusu)

| Kayıt | Değer | Sonuç |
|---|---|---|
| `medya333.com` NS | `ns0.wixdns.net`, `ns1.wixdns.net` | DNS **Wix**'te yönetiliyor |
| `www.medya333.com` CNAME | `cdn3.wixdns.net` | **Şu an bir Wix sitesi yayında** |
| `medya333.com` A | `185.230.63.107/.171/.186` | Wix |
| MX | Google Workspace | e-posta ALMA çalışıyor |
| SPF TXT | `v=spf1 include:_spf.google.com ~all` | ⚠️ Resend YOK |
| `_dmarc` | **kayıt yok** | ⚠️ |
| `resend._domainkey` | **kayıt yok** | ⚠️ |

### Hedef: tek canonical

| Adres | Nihai davranış |
|---|---|
| `https://www.medya333.com` | ⭐ **CANONICAL** — uygulama burada servis edilir |
| `https://medya333.com` | 308 → `https://www.medya333.com` |
| `http://www.medya333.com` | 308 → `https://www.medya333.com` |
| `http://medya333.com` | 308 → `https://www.medya333.com` |

Vercel, alan adı projeye eklendiğinde HTTP→HTTPS yönlendirmesini ve
sertifikayı kendi yönetir. Apex→www yönlendirmesi Vercel domain ayarlarında
"Redirect to www.medya333.com" seçilerek yapılır.

### Vercel'in isteyeceği DNS kayıtları

⚠️ **Aşağıdaki değerler ÖRNEKTİR.** Vercel panelinde alan adını eklediğinizde
size **kendi** değerlerini gösterir; onları kullanın, buradakini değil.

| Ad | Tip | Değer |
|---|---|---|
| `www` | CNAME | Vercel'in verdiği hedef |
| `@` (apex) | A veya ALIAS | Vercel'in verdiği adres |

⚠️ **Wix NS'te kaldığı sürece kayıtları Wix DNS panelinden gireceksiniz.**
Alternatif olarak alan adının NS'ini başka bir DNS sağlayıcısına taşıyabilir
veya alan adını Vercel'e devredebilirsiniz — bu bir iş kararıdır.

⚠️ **HSTS geri alınması zordur.** Uygulama
`max-age=63072000; includeSubDomains; preload` gönderir. TLS'in çalıştığından
emin olmadan DNS'i çevirmeyin: hatalı bir kurulumla yayına girerseniz
tarayıcılar alan adını uzun süre HTTPS'e zorlar.

**Geçiş sırası:** önce Preview/staging URL'inde duman testi geçsin, sonra DNS.

---

## 6) E-posta

Sistem **sağlayıcıdan bağımsızdır** ve bu korunmuştur.

- Credential yoksa `EMAIL_PROVIDER=none` → bildirim `FAILED` yazılır,
  sistem **"gönderildi" demez** (`canDeliver`).
- `console` sağlayıcısı canlıda **boot'u durdurur** — teslim etmediği hâlde
  başarı döndürdüğü için.
- Şablonlarda `localhost`, `example.com`, token, sır, `internalNote` veya
  operatör bilgisi **yoktur**; testle kilitlidir
  (`tests/unit/notifications.test.ts`, `tests/unit/mail-contract.test.ts`).
- Takip token'ı e-posta **log'una** yazılmaz; yalnızca şablon adı ve maskeli
  alıcı loglanır.

### Resend bağlandığında gereken DNS kayıtları

1. **DKIM** — Resend panelinin verdiği CNAME/TXT kayıtları. *(Şu an yok.)*
2. **SPF** — mevcut kaydı **düzenleyin**, ikinci bir SPF kaydı **eklemeyin**
   (bir alan adında yalnızca bir SPF olabilir; ikincisi ikisini de geçersiz
   kılar). Resend'in verdiği `include:` değerini ekleyin. *(Şu an yalnızca
   Google var.)*
3. **DMARC** — önce gözlem modunda:
   `_dmarc.medya333.com TXT "v=DMARC1; p=none; rua=mailto:dmarc@medya333.com"`
   Raporlar temizse `p=quarantine` → `p=reject`. *(Şu an yok.)*

---

## 7) Monitoring

⚠️ **Sentry SDK kurulmadı** — credential yokken SDK eklemek, hiçbir olay
göndermeyen ama "kurulu" görünen bir entegrasyon üretirdi.

Mevcut soyutlama korundu: `errorTrackingState()` → `not_configured`.
`SENTRY_DSN` verilirse `pending_sdk` olur, **`active` olmaz**.

Bağlamak için gerekenler:

| Gereken | Not |
|---|---|
| **DSN** | `SENTRY_DSN` |
| **Environment** | `SENTRY_ENVIRONMENT=production` / `preview` |
| **Release** | Vercel `VERCEL_GIT_COMMIT_SHA` sağlar — release adı olarak bunu kullanın; hata hangi dağıtımdan geldi sorusu ancak böyle cevaplanır |
| **Source map** | ⚠️ PUBLIC servis **edilmez**. Derleme adımında sağlayıcıya yüklenip çıktıdan silinir. `productionBrowserSourceMaps` `false` kalır |
| **SDK** | Kurulunca `src/server/observability.ts` içindeki `SENTRY_SDK_INSTALLED` `true` yapılır |

⚠️ **PII filtresi aynen korunur.** Bağlam alanları bir **izin listesiyle**
sınırlıdır; e-posta, telefon, IP, sipariş takip token'ı, ödeme verisi ve
merchant sırları redakte edilir. `reportError` tek giriş noktası olarak kalır.

---

## 8) Sağlık uçları

| Uç | Ne yapar | Vercel'de kullanım |
|---|---|---|
| `GET /api/health/live` | Yalnızca sürecin ayakta olduğunu söyler. DB/Redis'e **dokunmaz** | Uptime kontrolü |
| `GET /api/health` | DB + Redis durumu. `unavailable` ise 503 | Dağıtım sonrası doğrulama |

⚠️ Ödeme sağlayıcısına **istek atılmaz** — duman testiyle doğrulandı.
⚠️ Cevapta sır, bağlantı adresi, credential, SQL veya stack **yoktur** —
duman testiyle doğrulandı.

---

## 9) Duman testi

```bash
# OKUMA katmanı — hiçbir kayıt oluşturmaz, CANLIYA karşı da çalıştırılabilir
SMOKE_BASE_URL=https://www.medya333.com npm run test:smoke

# YAZMA katmanı — sipariş/kullanıcı/fulfillment kaydı OLUŞTURUR
E2E_BASE_URL=https://<preview-veya-staging> npm run test:e2e
```

⚠️ **Yazma katmanı canlı alan adına yönlendirilemez.**
`playwright.config.ts` hedefi kontrol eder ve canlı alan adı görürse
Playwright **hiç başlamaz** (`tests/smoke/guard.ts`). Denendi ve doğrulandı.

Okuma katmanının hiçbir kayıt oluşturmadığı **ölçülerek** doğrulandı:
Order/User/Target/Payment/Fulfillment sayıları test öncesi ve sonrası
birebir aynı kaldı.

---

## 10) Dağıtım adımları

1. **Depoyu bir Git sağlayıcısına gönderin.** Şu an uzak depo (remote) yok.
2. Vercel'de **Import Project** → framework otomatik `Next.js` algılanır.
3. **Environment Variables** — yukarıdaki tabloya göre üç ortam için ayrı ayrı
   girin. (Build sırasında env doğrulaması çalışır; eksik zorunlu değişkende
   **build kırılır** — bu istenen davranıştır.)
4. **Migration'ı ayrı adımda** çalıştırın (§ 2) ve veritabanını **damgalayın**.
5. Preview dağıtımını bekleyin, o URL'e karşı **yazma** E2E paketini çalıştırın.
6. Production'a promote edin.
7. Production URL'ine karşı **okuma** duman testini çalıştırın.
8. Alan adını ekleyin ve DNS kayıtlarını girin (§ 5) — **onayınızla**.
9. Alan adı yayına girdikten sonra duman testini bir kez daha çalıştırın.

---

## 11) Geri alma (rollback)

### Kod — saniyeler

Vercel panelinde **Deployments → önceki dağıtım → Promote to Production**.
Vercel her dağıtımı sakladığı için geri alma anında yapılır.

⚠️ Geri alma **yalnızca kodu** geri alır. Ortam değişkeni ve veritabanı
şeması geri gelmez.

### Ortam değişkeni

Vercel değişken değişikliğini **yeni bir dağıtımda** uygular. Değişkeni geri
alıp **yeniden dağıtın** — sadece değişkeni düzeltmek çalışan dağıtımı
değiştirmez.

### Migration

⚠️ **Rastgele "down migration" ÜRETİLMEZ.** Her migration'ın geri alınma yolu
kendi dosyasında yazılıdır.

| Migration | Geri alma | Veri kaybı |
|---|---|---|
| `20260819120000_deployment_stamp` | Gerekmez — yeni tablo, eski kod görmez | Yok |
| `20260819140000_drop_redundant_index` | `CREATE INDEX "Order_idempotencyKey_idx" ON "Order"("idempotencyKey")` | Yok |

Faz 10–11 migration'ları **salt eklemelidir**: eski kod yeni şemayla sorunsuz
çalışır, yani kodu geri almak için veritabanını geri almak gerekmez.

⚠️ **VERİ KAYBI ÜRETEBİLECEK İŞLEMLER** (hiçbiri otomatik yapılmaz):
- `DROP TABLE` / `DROP COLUMN` içeren bir migration'ı geri almak
- `prisma migrate reset` — **canlıda ASLA**
- Yedekten geri yükleme: yedek anından sonraki **tüm** siparişler kaybolur

### Veritabanı yedeği

⚠️ **Şu an hiçbir yedekleme bağlı değil (`BLOCKED`).** Geri yükleme provası
yapılmadan yedek "yapılandırıldı" sayılmaz.
Geri yüklenen bir kopya staging'e alınacaksa **damgayı düzeltin**:
`npm run db:stamp -- --stage=staging --force`.

### Redis cache temizleme

Katalog cache bozulursa (ör. yanlış fiyat yayınlandıysa):

```bash
redis-cli --scan --pattern 'catalog:*' | xargs -r redis-cli DEL
```

⚠️ Rate limit anahtarlarını silmeyin — sayaçları sıfırlamak, devam eden bir
saldırıya temiz sayfa vermektir.

### Yanlış katalog fiyatı yayınlandıysa

1. **Önce yeni siparişleri durdurun** — ilgili varyantı admin panelinden
   pasife alın. Fiyatı düzeltmeden önce satışı kesmek, yanlış fiyatlı sipariş
   birikmesini engeller.
2. Fiyatı admin panelinden düzeltin (`PricingRule`).
3. Katalog cache'ini temizleyin (yukarıdaki komut) veya
   `invalidateCatalogCache()` tetikleyen bir admin işlemi yapın.
4. Yanlış fiyattan oluşmuş siparişleri `AuditLog`'dan bulun — her fiyat
   değişikliği denetim kaydı bırakır.
5. ⚠️ **Sipariş tutarları SNAPSHOT'tır.** Fiyatı düzeltmek geçmiş siparişleri
   DEĞİŞTİRMEZ; onlar tek tek iade/düzeltme kararı ister.

### Yanlış dağıtım

1. Önceki dağıtımı promote edin (yukarıda).
2. `/api/health` ile doğrulayın.
3. Okuma duman testini çalıştırın.
4. Ne olduğunu yazın — sonraki dağıtımda aynı hataya düşmemek için.

---

## 12) PayTR — DOKUNULMADI

⚠️ Bu fazda ödeme koduna **hiç dokunulmadı**.

`PAYMENT_PROVIDER=mock` ve `PAYMENT_ENVIRONMENT=sandbox` ile canlıya çıkılırsa
**gerçek tahsilat yapılmaz**. Açılış kapısı bunu canlıda blocker olarak
raporlar (`MOCK_PAYMENT`, `PAYMENT_SANDBOX`) — yani sistem "ödeme çalışıyor"
numarası yapmaz.

Merchant bilgileri (`PAYTR_MERCHANT_ID`, `PAYTR_MERCHANT_KEY`,
`PAYTR_MERCHANT_SALT`) **yoktur ve uydurulmamıştır**. Onay geldiğinde ayrı bir
aktivasyon kontrol listesi hazırlanacaktır.
