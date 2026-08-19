# Medya 333 — Üretim Kontrol Listesi

> Bu belge **canlıya çıkış** içindir. Her kutu işaretlenmeden dağıtım yapılmaz.
> ⚠️ Şu an **canlıya çıkılamaz** — açık PRODUCTION BLOCKER'lar için en alttaki
> bölüme bakın.

---

## 0 · PRODUCTION BLOCKER (canlıya çıkışı ENGELLEYEN eksikler)

Bunlar kodla "varmış gibi" gösterilmedi. Gerçekten yoklar.

| # | Eksik | Etki | Ne gerekiyor |
|---|---|---|---|
| B1 | **Gerçek merchant credential yok** | Hiçbir tahsilat yapılamaz | iyzico veya PayTR üye iş yeri onayı + canlı anahtarlar |
| B2 | **Transactional e-posta sağlayıcısı yok** | Müşteriye **hiçbir e-posta gitmiyor** (sipariş, ödeme, takip linki yalnızca sunucu log'una yazılıyor) | Resend/Postmark hesabı + `RESEND_API_KEY` + `MailProvider` implementasyonu |
| B3 | **Alan adı ve HTTPS sertifikası bağlı değil** | Ödeme callback'leri ve `__Secure-` çerezleri çalışmaz | DNS + TLS + `APP_BASE_URL=https://…` |
| B4 | **Yönetilen PostgreSQL ve Redis yok** | Veri kalıcılığı ve rate limit garantisi yok | Yedeklemeli PostgreSQL 16 + Redis 7 |
| B5 | **Hata izleme (Sentry vb.) bağlı değil** | Canlı hatalar yalnızca konteyner log'unda | `SENTRY_DSN` veya eşdeğeri |

`assertProductionReady()` B1, B3 ve B4'ü **boot'ta yakalar ve uygulamayı
açmaz**. B2 ve B5 uyarı üretir; iş kararı sizindir.

---

## 1 · PRE-DEPLOY

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
| `RESEND_API_KEY` | **secret** | Yoksa e-posta GİTMEZ (B2) |
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

## 2 · DATABASE

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

## 3 · DEPLOY

```bash
npx prisma generate
npm run build
npx prisma migrate deploy
npm run db:seed          # yalnızca ilk kurulum ve katalog güncellemelerinde
npm run start            # veya süreç yöneticiniz
```

- [ ] Boot log'unda `[boot:blocker]` satırı **yok** (varsa süreç zaten açılmaz)
- [ ] `[boot:warning]` satırlarını oku ve kabul et
- [ ] Sağlık kontrolü: `GET /api/v1/catalog/snapshot` → 200 ve dolu katalog

---

## 4 · PAYMENT

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

## 5 · SECURITY

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

## 6 · REDIS

- [ ] `REDIS_URL` tanımlı (yoksa boot FAIL — bellek-içi yedek **yok**)
- [ ] Kalıcılık: rate limit için gerekmez, katalog cache için de gerekmez;
      yeniden başlatmada sayaçlar sıfırlanır (kabul edilebilir)
- [ ] `maxmemory-policy` **`noeviction`** — sayaçların atılması rate limit'i
      sessizce devre dışı bırakır
- [ ] Katalog cache invalidation çalışıyor: admin fiyat değiştirdiğinde public
      snapshot anında güncelleniyor

---

## 7 · MONITORING

- [ ] Uygulama log'ları toplanıyor (stdout → log toplayıcı)
- [ ] Log'lar **PII-safe**: kart verisi, CVV, secret, session token, Authorization
      başlığı yazılmıyor; e-posta maskeleniyor, IP hash'leniyor
- [ ] `X-Request-Id` / `requestId` alanı destek taleplerinde kullanılabiliyor
- [ ] İzlenecek olaylar:
      - `[payment.webhook] outcome=invalid_signature` → saldırı veya yanlış anahtar
      - `[boot:blocker]` → dağıtım hatası
      - `payment.amount_mismatch` audit kaydı → sağlayıcı/veri tutarsızlığı
      - `getRefundSummary().needsReconciliation` → çift tahsilat
- [ ] Uyarı eşiği: 5 dk içinde >10 `invalid_signature`

---

## 8 · POST-DEPLOY

- [ ] Ana sayfa, katalog, sipariş sihirbazı canlıda açılıyor
- [ ] Gerçek bir misafir siparişi uçtan uca denendi (küçük tutar)
- [ ] Operatör panelinde iş göründü, manuel başlat/ilerleme/tamamla çalıştı
- [ ] Müşteri sipariş sayfasında garanti bilgisi doğru
- [ ] `sitemap.xml` ve `robots.txt` doğru alan adını gösteriyor
- [ ] OG etiketleri doğru (⚠️ `og:image` YOK — marka görseli gelmedi)
- [ ] Mobilde (390px) sipariş akışı denendi

---

## 9 · ROLLBACK

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

## 10 · YEDEKLEME

| Ne | Sıklık | Saklama | Test |
|---|---|---|---|
| PostgreSQL tam yedek (`pg_dump -Fc`) | günlük | 30 gün | ayda bir **geri yükleme provası** |
| PostgreSQL WAL / PITR | sürekli | 7 gün | çeyrekte bir |
| Dağıtım öncesi anlık yedek | her dağıtım | 7 gün | — |
| Uygulama imajı / git etiketi | her dağıtım | 90 gün | — |

- Uygulama yedeği ≠ veritabanı yedeği. İkisi ayrı saklanır.
- **Geri yükleme denenmemiş yedek, yedek değildir.**
- Yedekler şifreli ve uygulama sunucusundan farklı bir konumda tutulur.

---

## 11 · POST-LAUNCH (canlıyı engellemez, sırada)

- [ ] Operatör kuyruğunda sayfalama (50+ açık işte en yeni iş ilk sayfada değil)
- [ ] Müşteri bildirimleri: sipariş oluşturuldu / ödeme alındı / işlem başladı /
      tamamlandı / garanti hatırlatma
- [ ] Instagram dışındaki ürünlerde garanti süresi tanımlanması (`refillDays`)
- [ ] SLA / gecikme alarmı (`READY`'de bekleyen iş için eşik)
- [ ] Admin panelinde hizmet/varyant oluşturma ve fiyat kademesi ekleme formu
- [ ] Kampanya ve kupon yönetim arayüzü
- [ ] `og:image` ve gerçek marka logosu
- [ ] Fatura entegrasyonu (alanlar hazır, sağlayıcı yok)
- [ ] Telafi kaydının kendi fulfillment'ını üretmesi
