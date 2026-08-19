# CANLIYA ÇIKIŞ KONTROL LİSTESİ — Medya 333

> Faz 10. Runbook **nasıl yapılacağını** anlatır; bu liste **yapıldı mı**
> sorusunu cevaplar.
>
> ⚠️ Bir kutu, işi **gördüğünüzde** işaretlenir — planladığınızda değil.
> "Muhtemelen çalışıyordur" işaretlenmiş bir kutu, işaretlenmemiş bir kutudan
> tehlikelidir.
>
> **[✓]** = bu depoda doğrulandı · **[ ]** = dış bir bileşen bekliyor
>
> **Canlı alan adı:** `https://www.medya333.com`
> **Staging alan adı:** belirlenmedi

---

## 1. Kod ve derleme

- [✓] `npm run typecheck` hatasız
- [✓] `npm run test` — 33 dosya, 889 test, hepsi geçiyor
- [✓] `npm run build` başarılı (standalone çıktı üretiliyor)
- [✓] Standalone sunucu gerçekten açılıyor (`node server.js` denendi)
- [✓] Playwright E2E paketi mevcut ve çalışıyor
- [ ] Dağıtılacak commit etiketlendi ve çalışma ağacı temiz
- [ ] CI, `env:check` adımını çalıştırıyor

## 2. Üretim imajı

- [✓] `Dockerfile` · `.dockerignore` · `docker-compose.production.yml` yazıldı
- [✓] Tarif statik olarak denetlendi (24 test)
- [✓] `next.config.ts`: `output: 'standalone'`, `productionBrowserSourceMaps: false`
- [✓] `typescript` paketi üretim çıktısından çıkarıldı
- [ ] İmaj **derlendi** (bu ortamda Docker daemon yok)
- [ ] `./scripts/verify-image.sh` çalıştırıldı ve temiz döndü
- [ ] İmaj etiketi commit SHA'sı (`latest` değil)

## 3. Sırlar ve ortam ayrımı

- [✓] `src/env.ts` boot'ta doğruluyor; eksik zorunlu değişkende uygulama açılmıyor
- [✓] Hiçbir sır `NEXT_PUBLIC_` değil (testle kilitli)
- [✓] `AUTH_SECRET` = `ORDER_TOKEN_SECRET` ise boot duruyor (`SECRET_REUSE`)
- [✓] Placeholder sır tespiti çalışıyor (`PLACEHOLDER_SECRET`)
- [✓] `npm run env:check` iki ortamın paylaştığı sırrı yakalıyor (11 test)
- [✓] Denetim aracı sır **değeri** yazdırmıyor (SHA-256 üzerinden karşılaştırma)
- [ ] Canlı sırlar üretildi ve `/etc/medya333/env` içine `chmod 600` ile yazıldı
- [ ] Staging sırları canlıdan **farklı** üretildi
- [ ] `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` canlı ortamda **boş**

## 4. Veritabanı

- [✓] Migration'lar elle yazıldı, sırayla uygulanıyor ve testte doğrulanıyor
- [✓] Şemada PAN/CVV alanı **yok** (testle kilitli)
- [✓] Tüm idempotency garantileri DB unique kısıtı (prosedür değil)
- [✓] Cursor sayfalama — hiçbir yerde OFFSET yok
- [✓] Gereksiz index kaldırıldı (`Order_idempotencyKey_idx` — ölçümle)
- [✓] Yeni index **eklenmedi**: ölçülebilir bir ihtiyaç görülmedi
- [✓] N+1 yok — sorgu sayısı ölçülerek kanıtlandı (kuyruk · katalog · takip · admin)
- [ ] Üretim veritabanı sağlandı ve migration uygulandı
- [ ] **Veritabanı damgalandı** (`npm run db:stamp -- --stage=production`)
- [ ] `npm run db:stamp:check` → `production`

## 5. Ortam izolasyonu

- [✓] `APP_ENV` tek doğru kaynak; tanımsızsa **canlı** varsayılıyor (fail-closed)
- [✓] Dağıtım damgası mekanizması çalışıyor (20 test)
- [✓] Yanlış damgalı veritabanına bağlanan süreç **gerçekten açılmıyor**
      (üretim derlemesiyle denendi, süreç `exit 1` ile kapandı)
- [✓] `development` ↔ `e2e` aynı bölgede; `production`/`staging` izole
- [✓] Uyuşmazlık mesajı bağlantı adresi/kimlik bilgisi sızdırmıyor
- [ ] Staging ortamı kuruldu ve `staging` olarak damgalandı
- [ ] Staging'in canlı veritabanına erişemediği **canlı kurulumda** doğrulandı

## 6. Seed güvenliği

- [✓] `npm run db:seed` `APP_ENV=production` iken **reddediyor** (denendi)
- [✓] `APP_ENV` ve `NODE_ENV` tanımsızken de **reddediyor** (fail-closed, denendi)
- [✓] `development` / `test` / `staging` aşamalarında normal çalışıyor
- [✓] `SEED_ALLOW_PRODUCTION` benzeri kaçış kapısı **yok** (bilinçli)
- [✓] Seed demo `User`/`Order`/`Payment` üretmiyor
- [ ] Canlı katalog yükleme yordamı (runbook § 6) uygulandı

## 7. Redis ve rate limit

- [✓] Redis yoksa canlı boot **duruyor** (`REDIS_REQUIRED`)
- [✓] Bellek-içi yedek **yok** (bilinçli)
- [✓] Rate limit üretimde **fail-closed**
- [✓] Cache kaybı fiyatlandırmayı bozmuyor — **DB authoritative** kalıyor
- [ ] Üretim Redis örneği sağlandı
- [ ] `maxmemory-policy noeviction` ayarlandı
- [ ] `appendonly yes`

## 8. E-posta

- [✓] 9 şablonun tamamı render oluyor, Türkçe ve iç enum sızdırmıyor
- [✓] Sağlayıcı sözleşme testleri **gerçek gönderim olmadan** geçiyor (14 test)
- [✓] Teslim edemeyen sağlayıcı "gönderildi" **demiyor** (`canDeliver`)
- [✓] `console` sağlayıcısı canlıda boot'u **durduruyor**
- [✓] Hata yollarında API anahtarı ve sağlayıcı gövdesi **sızmıyor**
- [✓] Aynı olay için ikinci bildirim oluşmuyor (`unique(orderEventId, channel)`)
- [✓] Yeniden gönderim retry-safe; otomatik kuyruğa **bağlı değil**
- [✓] Yeniden gönderim artık **denetim kaydı** yazıyor (`notification.retry`)
- [ ] Resend hesabı açıldı, `RESEND_API_KEY` yazıldı
- [ ] **SPF Resend'i içerecek şekilde güncellendi** (şu an yalnızca Google)
- [ ] **DKIM kaydı eklendi** (şu an yok)
- [ ] **DMARC kaydı eklendi** (şu an yok)
- [ ] Tek bir test maili gerçekten ulaştı

## 9. Alan adı, DNS ve TLS

- [✓] Canlı alan adı kodda tek yerden okunuyor (`APP_BASE_URL`, çalışma zamanı)
- [✓] Canonical / `og:url` / sitemap / robots / manifest doğru adresi üretiyor
- [✓] `NEXT_PUBLIC_SITE_URL` sunucu callback'i üretmiyor
- [✓] Çerez `Secure` kararı çalışma zamanında veriliyor (derleme zamanında değil)
- [ ] **`www.medya333.com` şu anda Wix'e işaret ediyor** — geçiş yapılmadı
- [ ] Reverse proxy + TLS sertifikası kuruldu
- [ ] `medya333.com` → `www` yönlendirmesi
- [ ] TLS **bu ortamdan doğrulanamadı** — canlıda `openssl s_client` ile bakın
- [ ] HSTS'in geri alınmasının zor olduğu bilinerek DNS çevrildi

## 10. Güvenlik

- [✓] Güvenlik başlıkları (CSP, HSTS, X-Frame-Options, Referrer-Policy, …)
- [✓] Admin uçları rol kontrollü; CUSTOMER kendini yükseltemiyor
- [✓] Son SUPERADMIN silinemiyor / düşürülemiyor (`FOR UPDATE` ile)
- [✓] IDOR koruması: `userId` sorgunun **içinde**
- [✓] Misafir takip token'ı URL log'una, e-posta log'una ve cevaba **girmiyor**
- [✓] Ham SQL yalnızca parametreli tagged template (`$queryRawUnsafe` yok)
- [✓] IP adresleri ham saklanmıyor (hash + tuz)
- [✓] Denetim kaydı sır redakte ediyor
- [✓] Migration dosyalarında sır yok (testle kilitli)
- [ ] Sunucuya SSH erişimi anahtarla sınırlandı, parola girişi kapatıldı
- [ ] Veritabanı ve Redis portları dış dünyaya **kapalı**

## 11. İzleme ve operasyon

- [✓] `/api/health` (bağımlılıklarla) ve `/api/health/live` (bağımlısız) var
- [✓] Sağlık çıktısı sır içermiyor
- [✓] Operasyon paneli: kuyruk, bildirimler, kullanıcılar, uyarılar
- [✓] Kuyrukta **ölçülen bekleme süresi** gösteriliyor ("Bekleme: 2s 14dk")
- [✓] Hiçbir ekranda "gecikti" yargısı **yok** — SLA tanımlı değil (testle kilitli)
- [✓] SLA sonradan tanımlanabilecek şekilde mimari bırakıldı (`evaluateSla`)
- [✓] Hata izleme durumu dürüst raporlanıyor (`not_configured` / `pending_sdk`)
- [✓] PII filtresi izin listesi tabanlı
- [ ] Monitoring sağlayıcısı bağlandı ve **bir test hatası gerçekten görüldü**
- [ ] Uptime kontrolü `/api/health/live` adresine kuruldu
- [ ] Log saklama ve döndürme ayarlandı

## 12. Yedekleme ve geri dönüş

- [✓] Rollback yordamı yazıldı; imaj etiketi commit SHA'sı
- [✓] Faz 10 migration'ları salt eklemeli — eski kod yeni şemayla çalışır
- [✓] Kaldırılan index'in geri alma komutu migration içinde yazılı
- [ ] **Otomatik yedek kuruldu** — şu an hiçbir yedekleme bağlı değil
- [ ] Yedek **başka bir yerde** saklanıyor
- [ ] **Geri yükleme provası yapıldı** (yedek geri yüklendi, uygulama açıldı)
- [ ] RTO ve RPO yazıldı
- [ ] Saklama süresi ve KVKK uyumu karara bağlandı

---

## ⛔ Bu üçü olmadan canlıya çıkılmaz

1. **Yedek doğrulanmadı** (§12) — geri dönüşü olmayan bir dağıtım yapılıyor.
2. **E-posta gönderimi yok** (§8) — müşteri sipariş onayı ALMAZ. Sistem bunu
   gizlemez (`FAILED` yazar) ama müşteri yine de bilgilendirilmemiş olur.
3. **Ödeme aktif değil** (§13) — PayTR onayı beklenmektedir. Onay gelmeden
   sitede gerçek tahsilat yapılamaz.

## Bilinçli olarak YAPILMAYANLAR

Bunlar eksik değil, **karar**dır:

- Bellek-içi rate limit yedeği — sessizce korumasız kalmaktansa açıkça durmak
- `SEED_ALLOW_PRODUCTION` kaçış kapısı — eklendiği an kapı yok demektir
- Otomatik bildirim retry kuyruğu — sağlayıcı yokken saatte binlerce başarısız deneme üretirdi
- Varsayılan SLA eşiği — tanımlanmamış kuralı tanımlıymış gibi göstermek
- OG görseli / PNG ikon / manifest ekran görüntüsü — olmayan marka varlığı üretmemek
- Sentry SDK'sının credential'sız kurulması — "kurulu ama çalışmıyor" en kötü durumdur
- Üretim imajından migration çalıştırmak — iki örnek aynı anda migration'a girerdi
