# ORTAM AYRIMI — development · staging · production

> Faz 10. Bu belge üç ortamın **neyi paylaşıp neyi paylaşmadığını** ve ayrımın
> nasıl **zorunlu kılındığını** tanımlar.
>
> ⚠️ Burada gerçek bir sır, gerçek bir bağlantı adresi veya gerçek bir
> merchant bilgisi YOKTUR.

---

## 0) Neden bu belge var?

"Staging ayrı veritabanı kullanır" cümlesi bir niyettir. Niyeti bozmak için
tek bir yanlış kopyala-yapıştır yeter ve **hiçbir hata alınmaz**: staging
açılır, çalışır, testler geçer — ve canlı müşteri verisine yazar.

Bu yüzden ayrım üç katmanda tutulur:

| Katman | Ne yapar | Nerede |
|---|---|---|
| **Belge** | Hangi değişkenin ayrı olması gerektiğini söyler | bu dosya |
| **Denetim aracı** | İki ortam dosyasını karşılaştırıp paylaşımı yakalar | `npm run env:check` |
| **Çalışma zamanı kapısı** | Yanlış veritabanına bağlanan süreci AÇTIRMAZ | dağıtım damgası |

Belge tek başına yeterli değildir; araç tek başına yeterli değildir (kimse
çalıştırmayabilir); kapı tek başına yeterli değildir (yalnızca veritabanını
korur). Üçü birlikte çalışır.

---

## 1) Aşamalar

`APP_ENV` "gerçekten hangi ortamdayız" sorusunun **tek** doğru kaynağıdır.
`NODE_ENV` bu soruyu cevaplayamaz: `next build` ve `next start` onu her zaman
`production` yapar — staging ve E2E de üretim derlemesi çalıştırır.

| `APP_ENV` | Anlamı | Gerçek para | Gerçek e-posta | İzolasyon bölgesi |
|---|---|---|---|---|
| `production` | CANLI | evet (credential geldiğinde) | evet | `production` |
| `staging` | Canlıya benzer prova | **hayır** — engellenir | sağlayıcıya göre | `staging` |
| `e2e` | Playwright koşusu | hayır | hayır | `local` |
| *(tanımsız)* | **production sayılır** | — | — | `production` |

⚠️ **Fail-closed.** `APP_ENV` yazılmamışsa ortam canlı kabul edilir. Değişkeni
unutmak kapıyı gevşetmez.

⚠️ **`APP_ENV` bir kaçış kapısı değildir.** `APP_ENV=staging` ile
`PAYMENT_ENVIRONMENT=production` birlikte kullanılamaz; bu bileşim her aşamada
boot'u durdurur (`STAGE_REAL_PAYMENT`).

### İzolasyon bölgesi nedir?

Damga kontrolü aşamaya birebir değil, **bölgeye** bakar:

```
production  →  bölge: production   (yalnız canlı süreç)
staging     →  bölge: staging      (yalnız staging süreci)
development →  bölge: local
e2e         →  bölge: local
```

`development` ve `e2e` aynı bölgededir çünkü geliştiricinin makinesinde
`npm run dev` ile `npx playwright test` aynı yerel veritabanını kullanır.
Birebir eşleşme arasaydık ikisinden biri hiç açılamaz, ilk yapılacak iş de
kontrolü kapatmak olurdu. **Kapatılan kontrol, olmayan kontroldür.**

Bölge esnekliği canlıya **uzanmaz**: `local` damgalı bir veritabanına
`production` süreci bağlanamaz, tersi de geçerlidir.

---

## 2) Değişken matrisi

| Değişken | development | staging | production | Ayrı olmalı mı? |
|---|---|---|---|---|
| `APP_ENV` | *(boş)* | `staging` | `production` | evet |
| `APP_BASE_URL` | `http://localhost:3000` | **PENDING** | `https://www.medya333.com` | evet |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | **PENDING** | `https://www.medya333.com` | evet |
| `DATABASE_URL` | yerel | **ayrı sunucu/veritabanı** | canlı | **ZORUNLU** |
| `REDIS_URL` | yerel | **ayrı instance veya ayrı DB no** | canlı | **ZORUNLU** |
| `AUTH_SECRET` | yerel | **ayrı** | **ayrı** | **ZORUNLU** |
| `ORDER_TOKEN_SECRET` | yerel | **ayrı** | **ayrı** | **ZORUNLU** |
| `IP_HASH_SALT` | yerel | **ayrı** | **ayrı** | **ZORUNLU** |
| `PAYMENT_PROVIDER` | `mock` | `paytr` | `paytr` | hayır |
| `PAYMENT_ENVIRONMENT` | `sandbox` | `sandbox` | `production` | evet |
| `PAYTR_MERCHANT_*` | boş | **sandbox credential** | **canlı credential** | **ZORUNLU** |
| `EMAIL_PROVIDER` | `console` | `none` veya `resend` | `resend` | evet |
| `RESEND_API_KEY` | boş | ayrı anahtar | canlı anahtar | **ZORUNLU** |
| `MAIL_FROM` | herhangi | `staging@…` önerilir | `siparis@medya333.com` | önerilir |
| `SENTRY_DSN` | boş | ayrı proje/ortam | canlı | önerilir |
| `SEED_ADMIN_*` | serbest | serbest | **BOŞ OLMALI** | — |

> **STAGING ALAN ADI: PENDING.** Staging için bir alan adı henüz
> belirlenmemiştir. Bu belge alan adı **uydurmaz**. Belirlendiğinde bu iki
> satır doldurulur ve `APP_BASE_URL` staging ortamına yazılır.

### Neden bu değişkenler paylaşılamaz?

| Paylaşılırsa | Sonuç |
|---|---|
| `AUTH_SECRET` | Staging'de üretilen oturum çerezi **canlıda da geçerlidir**. Staging'e erişimi olan herkes canlıda oturum açabilir. |
| `ORDER_TOKEN_SECRET` | Staging'de üretilen misafir takip linki **canlı siparişleri açar**. |
| `IP_HASH_SALT` | İki ortamın IP hash'leri eşleşir; ortamlar arası kullanıcı ilişkilendirmesi mümkün olur (KVKK). |
| `DATABASE_URL` | Staging testleri **canlı müşteri verisine yazar**. Geri alınamaz. |
| `REDIS_URL` | Staging, canlının rate limit sayaçlarını sıfırlar ve katalog cache'ini ezer. |
| PayTR credential | Staging bir hatası **gerçek para** hareketi üretebilir. |

---

## 3) Denetim: `npm run env:check`

```bash
npm run env:check -- .env.staging .env.production
```

İki ortam dosyasını karşılaştırır ve **aynı değeri paylaşan** sırları bildirir.

```
Ortam ayrımı raporu: .env.staging ↔ .env.production

  [ENGEL ] SHARED_SECRET — AUTH_SECRET ... ortamlarında AYNI. Her ortam kendi sırrını üretmelidir.
  [ENGEL ] SHARED_URL — DATABASE_URL ... aynı adresi gösteriyor. İki ortam aynı veri deposunu paylaşamaz.

2 engelleyici bulgu. Ortamlar birbirinden ayrılmamış.
```

Engelleyici bulgu varsa **çıkış kodu 1**'dir; CI adımı olarak kullanılabilir.

⚠️ **Araç hiçbir değeri yazdırmaz.** Karşılaştırma SHA-256 özetleri üzerinden
yapılır, rapor yalnızca değişken **adı** verir. Dosyalar `process.env`e de
yüklenmez — aksi hâlde ayrımı doğrulayan araç, sırları CI log'una döken araç
olurdu.

Kapsanan değişkenler: `scripts/env-separation.ts` → `MUST_DIFFER`.
Testler: `tests/unit/env-separation.test.ts` (11 test).

---

## 4) Çalışma zamanı kapısı: dağıtım damgası

Denetim aracı **dosyalara** bakar. Ama staging sunucusundaki `.env` doğru olup
ortam değişkeni panelinden yanlış `DATABASE_URL` verilmişse araç bunu göremez.

Bu yüzden ayrım **veritabanının kendisine** yazılır: `DeploymentStamp`
tablosunda tek satırlık bir damga.

### Damgalama

```bash
# Mevcut damgayı gör
npm run db:stamp:check

# Damgala (aşama AÇIKÇA verilir — ortamdan tahmin edilmez)
npm run db:stamp -- --stage=production --label="hetzner-db-01"
npm run db:stamp -- --stage=staging    --label="hetzner-db-02"
npm run db:stamp -- --stage=development

# Mevcut damganın üzerine yazmak --force ister
npm run db:stamp -- --stage=staging --force
```

⚠️ Aşama `APP_ENV`den **tahmin edilmez**. Komut bir kez çalıştırılır ve sonucu
kalıcıdır; "APP_ENV neyse o" davranışı yanlış terminalde çalıştırıldığında
canlı veritabanını sessizce yeniden damgalardı.

### Açılışta ne olur?

`src/instrumentation.ts`, yapılandırma kapısından sonra damgayı okur:

| Durum | Davranış | Kod |
|---|---|---|
| Damga = süreç bölgesi | açılır | — |
| Damga ≠ süreç bölgesi | **süreç AÇILMAZ** | `DEPLOYMENT_STAMP_MISMATCH` |
| Damga yok | açılır + uyarı | `DEPLOYMENT_STAMP_MISSING` |
| Damga okunamıyor | açılır + uyarı | `DEPLOYMENT_STAMP_UNREADABLE` |

**Uyuşmazlık her aşamada blocker'dır** — canlı olmayan ortamlarda uyarıya
düşmez. Diğer bulgular "geliştirme kolaylığı" için gevşetilebilir; yanlış
veritabanına yazmak geri alınamaz.

**Damga yok = uyarı** olmasının sebebi: mevcut kurulumlar ve yeni açılan boş
veritabanları kırılmamalıdır. Ama uyarı log'un ilk satırlarında görünür, yani
"koruma kapalı" durumu görünmez değildir.

**Okunamıyor = uyarı** olmasının sebebi: veritabanına erişilememesi ayrı bir
sorundur ve kendi hatasını üretir; damga kapısı onu maskelememelidir.

⚠️ Hata mesajlarında **bağlantı adresi taşınmaz** — yalnızca hata *türü*.
Sürücü hata metinleri host, kullanıcı adı ve bazı durumlarda parola içerir.

Testler: `tests/integration/deployment-stamp.test.ts` (20 test), aralarında
bölge matrisinin tamamı (4×4).

---

## 5) Yeni bir staging ortamı kurulumu

1. **Ayrı veritabanı oluştur.** Canlı sunucuyla aynı makinede olabilir ama
   **aynı veritabanı olamaz**.
2. Migration'ları uygula: `npm run db:deploy`
3. **Damgala:** `npm run db:stamp -- --stage=staging --label="<sunucu>"`
4. **Her sırrı yeniden üret** — canlıdan kopyalama:
   ```bash
   openssl rand -base64 48   # AUTH_SECRET
   openssl rand -base64 48   # ORDER_TOKEN_SECRET
   openssl rand -hex 24      # IP_HASH_SALT
   ```
5. `APP_ENV=staging`, `PAYMENT_ENVIRONMENT=sandbox` yaz.
6. **Ayrımı doğrula:** `npm run env:check -- .env.staging .env.production`
7. Seed gerekiyorsa çalıştır — staging'de izinlidir
   (`prisma/seed/guard.ts`).
8. Boot log'unda `veritabanı damgası: staging ✓` satırını gör.

### Canlı veritabanına staging'in erişemediğini doğrulama

```bash
# staging sunucusunda, YANLIŞLIKLA canlı DATABASE_URL verilmiş gibi:
APP_ENV=staging DATABASE_URL="<canlı-url>" npm start
```

Beklenen çıktı — süreç **açılmaz**:

```
DAĞITIM DAMGASI UYUŞMAZLIĞI — uygulama açılmadı:
  • [DEPLOYMENT_STAMP_MISMATCH] VERİTABANI ORTAMI UYUŞMUYOR — uygulama aşaması
    "staging", bağlanılan veritabanının damgası "production". CANLI
    VERİTABANINA canlı olmayan bir uygulamadan bağlanılıyor. ...
```

---

## 6) Seed kapısı

`npm run db:seed` canlıda **çalışmaz** — davranışa değil ortama bakılır.

| Aşama | Seed |
|---|---|
| development | çalışır |
| test / e2e | çalışır |
| staging | çalışır |
| production | **REDDEDİLİR** |
| *(tanımsız)* | **REDDEDİLİR** (fail-closed) |

⚠️ `SEED_ALLOW_PRODUCTION` gibi bir bayrak **bilinçli olarak yoktur**. Böyle
bir kaçış kapısı eklendiği anda, acele eden biri onu ortama yazar ve kapı hiç
var olmamış gibi olur. Canlıda katalog güncellemesi gerekiyorsa doğru yol,
seed'i bir **kopya** üzerinde `APP_ENV=staging` ile çalıştırıp SQL farkını
gözden geçirmektir.

Detay: `prisma/seed/guard.ts`.

---

## 7) Sır rotasyonu

| Sır | Rotasyon etkisi |
|---|---|
| `AUTH_SECRET` | **Tüm oturumlar düşer.** Kullanıcılar yeniden giriş yapar. Veri kaybı yok. |
| `ORDER_TOKEN_SECRET` | **Dağıtılmış misafir takip linkleri geçersiz olur.** E-postadaki eski linkler çalışmaz. |
| `IP_HASH_SALT` | Eski hash'ler yeni hash'lerle eşleşmez; rate limit geçmişi kopar (zararsız). |
| PayTR credential | Sağlayıcı panelinden değiştirilir; devam eden ödemeler etkilenebilir. |
| `RESEND_API_KEY` | Anında etkili. |

Rotasyon adımları: `docs/PRODUCTION_RUNBOOK.md`.
