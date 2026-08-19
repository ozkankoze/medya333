# Medya 333 — Yetki Matrisi ve Rate Limit Envanteri

> Faz 7 denetim çıktısı. Bu belge KODDAN türetilmiştir; değerler
> `src/server/ratelimit.ts` ve `src/app/api/v1/admin/_handler.ts` ile
> birebir örtüşür. Kod değişirse bu belge de güncellenmelidir.

---

## 1. Roller

`prisma/schema.prisma → enum UserRole`, hiyerarşi `src/lib/enums.ts → ROLE_LEVEL`:

```
SUPERADMIN (4) > ADMIN (3) > OPERATOR (2) > SUPPORT (1) > CUSTOMER (0)
```

Kapı tek yerdedir: `src/server/auth/guards.ts → requireRole(minimum)`.
Sayısal karşılaştırma yapılır, rol adı listesi değil — yeni bir rol eklendiğinde
her endpoint'i tek tek gözden geçirmek gerekmez.

**⚠️ İstemci tarafında düğme gizlemek yetki mekanizması DEĞİLDİR.** UI'da
gizlenen her işlem sunucuda ayrıca `requireRole` ile korunur; asıl kapı odur.
`src/middleware.ts` yalnızca oturum çerezi olmayanı `/yonetim` altından
uzaklaştırır (kaba filtre) — yetkilendirme kararını vermez.

---

## 2. Yetki matrisi

`—` = erişim yok (403 `FORBIDDEN`), `✔` = izinli.

### 2.1 Müşteri yüzeyi

| İşlem | CUSTOMER | SUPPORT | OPERATOR | ADMIN | SUPERADMIN | Uygulanan kural |
|---|:--:|:--:|:--:|:--:|:--:|---|
| Katalog okuma (`GET /api/v1/catalog/snapshot`) | ✔ | ✔ | ✔ | ✔ | ✔ | Herkese açık (oturum gerekmez) |
| Fiyat teklifi (`POST /pricing/quote`) | ✔ | ✔ | ✔ | ✔ | ✔ | Herkese açık |
| Hedef çözümleme (`POST /targets/resolve`) | ✔ | ✔ | ✔ | ✔ | ✔ | Herkese açık |
| Kupon doğrulama (`POST /coupons/validate`) | ✔ | ✔ | ✔ | ✔ | ✔ | Herkese açık |
| Sipariş oluşturma (`POST /orders`) | ✔ | ✔ | ✔ | ✔ | ✔ | Misafir de olabilir |
| **Kendi** siparişini görme (`GET /orders/{no}`) | ✔ | ✔ | ✔ | ✔ | ✔ | **Sahiplik**: `userId` eşleşmesi VEYA imzalı misafir token |
| **Başkasının** siparişini görme | — | — | — | — | — | Sahiplik kontrolü rolden bağımsızdır |
| Ödeme başlatma (`POST /payments/create`) | ✔ | ✔ | ✔ | ✔ | ✔ | Yalnızca **kendi** siparişi için |
| Misafir siparişi hesaba bağlama | ✔ | ✔ | ✔ | ✔ | ✔ | E-posta eşleşmesi + oturum |

> ⚠️ Personel rolleri müşteri uçlarında **ayrıcalıklı değildir**. Bir ADMIN,
> `/api/v1/orders/{no}` üzerinden başkasının siparişini göremez; yönetim
> verisine yalnızca `/api/v1/admin/**` üzerinden, denetim kaydı bırakarak erişir.

### 2.2 Yönetim yüzeyi (`/api/v1/admin/**`)

Varsayılan minimum rol **ADMIN**'dir (`_handler.ts`); aşağıdakiler açıkça
belirtilmiş istisnalardır.

| Uç | Min. rol | CUSTOMER | SUPPORT | OPERATOR | ADMIN | SUPERADMIN |
|---|---|:--:|:--:|:--:|:--:|:--:|
| `GET /admin/orders`, `/admin/orders/{no}` | SUPPORT | — | ✔ | ✔ | ✔ | ✔ |
| `PATCH /admin/orders/{no}/status` | OPERATOR | — | — | ✔ | ✔ | ✔ |
| `GET /admin/orders/{no}/refund` (iade önizleme) | SUPPORT | — | ✔ | ✔ | ✔ | ✔ |
| **`POST /admin/orders/{no}/refund` (para iadesi)** | **SUPERADMIN** | — | — | — | — | ✔ |
| `GET /admin/fulfillments` (kuyruk) | SUPPORT | — | ✔ | ✔ | ✔ | ✔ |
| `GET /admin/fulfillments/{id}` | SUPPORT | — | ✔ | ✔ | ✔ | ✔ |
| `POST …/note` (iç not) | SUPPORT | — | ✔ | ✔ | ✔ | ✔ |
| `POST …/assign`, `…/start`, `…/progress`, `…/complete`, `…/fail`, `…/replacement` | OPERATOR | — | — | ✔ | ✔ | ✔ |
| `GET /admin/services`, `/variants`, `/pricing-rules`, `/platforms` | SUPPORT | — | ✔ | ✔ | ✔ | ✔ |
| `GET /admin/pricing/simulate`, `/pricing/validate` | SUPPORT | — | ✔ | ✔ | ✔ | ✔ |
| `POST`/`PATCH` katalog (servis, varyant, fiyat kuralı, platform, sıralama) | ADMIN | — | — | — | ✔ | ✔ |
| `DELETE` katalog (servis, varyant, fiyat kuralı, platform) | ADMIN | — | — | — | ✔ | ✔ |

**Okunacak ana kural:** *okumak* SUPPORT'tan, *işi ilerletmek* OPERATOR'dan,
*katalog/fiyat değiştirmek* ADMIN'den, *para iade etmek* SUPERADMIN'den başlar.

### 2.3 Rolden bağımsız ek kapılar

Rol yetmez; şu kontroller **ayrıca** çalışır:

1. **Atama kontrolü** — bir fulfillment üzerinde ilerleme kaydı, ona atanmış
   operatör (veya ADMIN+) tarafından yazılabilir.
2. **Manuel aktör zorunluluğu** — `MANUAL_ONLY_TRANSITIONS` + `assertManualActor`:
   `PROCESSING → COMPLETED` gibi geçişler **gerçek bir personel kimliği**
   olmadan yapılamaz. Sistem kendi kendine tamamlayamaz.
   > İş modeli gereği hizmetler gerçek kullanıcılar tarafından **elle**
   > gerçekleştirilir; otomatik tamamlama üç bağımsız katmanda engellidir.
3. **Durum makinesi** — izinli olmayan geçiş, rol ne olursa olsun reddedilir.
4. **Sahiplik** — müşteri uçlarında `userId` / imzalı misafir token eşleşmesi.
5. **Same-origin (CSRF)** — durum değiştiren tüm uçlarda `assertSameOrigin`.
   Webhook uçları hariçtir; onlar imza ile doğrulanır.

---

## 3. Rate limit envanteri

Uygulama: Redis üzerinde **atomik Lua kayan pencere** (`src/server/ratelimit.ts`).
**⚠️ Üretimde bellek-içi yedek YOKTUR** — `REDIS_URL` yoksa uygulama açılmaz
(`REDIS_REQUIRED`). Tek süreçlik bir sayaç, çok örnekli üretimde koruma değildir.

Aşan istek `429 RATE_LIMITED` + `X-RateLimit-*` başlıkları döner.

### 3.1 Herkese açık uçlar

| Uç | Anahtar | Limit | Pencere | Gerekçe |
|---|---|---|---|---|
| `GET /catalog/snapshot` | `catalog.read.ip` | 120 | 1 dk | Sayfa açılışında okunur; cömert |
| `POST /pricing/quote` | `pricing.quote.ip` | 30 | 1 dk | Miktar değiştikçe çağrılır |
| `POST /targets/resolve` | `targets.resolve.ip` | 10 | 1 dk | Dış kaynak maliyeti + numaralandırma riski |
| ” (oturumlu) | `targets.resolve.user` | 30 | 1 dk | Giriş yapana daha geniş alan |
| `POST /coupons/validate` | `coupons.validate.ip` | 10 | 1 dk | **Kupon kodu deneme (brute force)** |
| `GET /orders/{no}` | `orders.detail.ip` | 60 | 1 dk | Durum sayfası yoklaması |
| `GET /payments/{no}/status` | `payments.status.ip` | 60 | 1 dk | Ödeme dönüşü yoklaması |

### 3.2 Sipariş ve ödeme

| Uç | Anahtar | Limit | Pencere | Gerekçe |
|---|---|---|---|---|
| `POST /orders` | `orders.create.ip` | 5 | 1 dk | Sipariş taşkını |
| ” | `orders.create.user` | 20 | 1 saat | Hesap başına üst sınır |
| `POST /payments/create` | `payments.create.ip` | 10 | 1 dk | Sağlayıcı maliyeti |
| ” (sipariş bazlı) | `payments.init.order` | 5 | 1 dk | Dağıtık IP'den aynı siparişi zorlama |
| `POST /me/claim-guest-orders` | `orders.claim.user` | 5 | 1 saat | Misafir sipariş sahiplenme denemesi |

`POST /orders` ayrıca `Idempotency-Key` ister; aynı anahtarla ikinci istek
**yeni sipariş oluşturmaz**, ilkini döndürür (`Order.idempotencyKey` unique).

### 3.3 Sipariş takibi — **iki eksenli**

| Uç | Anahtar | Limit | Pencere |
|---|---|---|---|
| `POST /orders/lookup` | `orders.lookup.ip` | 5 | 1 saat |
| ” | `orders.lookup.orderNo` | 5 | 1 saat |
| `POST /orders/{no}/send-link` | `orders.sendlink.ip` | 3 | 1 saat |
| ” | `orders.sendlink.orderNo` | 3 | 1 saat |

> ⚠️ **Neden iki eksen?** Yalnızca IP'ye bakan bir limit, dağıtık IP'lerle tek
> bir sipariş numarasını denemeyi engellemez. Yalnızca sipariş numarasına bakan
> bir limit ise tek IP'den sipariş numarası taramasını engellemez. İkisi birden
> uygulanır.

### 3.4 Kimlik doğrulama

| Uç | Anahtar | Limit | Pencere |
|---|---|---|---|
| `POST /auth/login` | `auth.login.ip` | 5 | 1 dk |
| `POST /auth/register` | `auth.register.ip` | 3 | 1 saat |

IP **ham saklanmaz**: `IP_HASH_SALT` ile hash'lenir (KVKK).
Giriş hata mesajı hesabın var olup olmadığını **sızdırmaz**.

### 3.5 Yönetim

| Uç | Anahtar | Limit | Pencere |
|---|---|---|---|
| `/api/v1/admin/**` (tümü) | `admin.api.user` | 100 | 1 dk |
| `POST /admin/orders/{no}/refund` | `admin.refund.user` | 20 | 1 saat |

Yönetim limiti **kullanıcı kimliğine** bağlıdır (IP'ye değil): ofis NAT'ı
arkasındaki personel birbirini kilitlemez.

### 3.6 Rate limit KAPSAMINDA OLMAYAN uçlar

| Uç | Neden |
|---|---|
| `POST /payments/webhooks/{provider}` | Sağlayıcı yeniden deneme yapar; limitlemek **ödeme kaybına** yol açar. Koruma imza + tekrar (replay) engeli + `PaymentEvent(provider, providerEventId)` unique kısıtıdır. |
| `GET /robots.txt`, `/sitemap.xml`, `/icon.svg` | Statik, maliyetsiz. |

---

## 4. Bilinen boşluklar (POST-LAUNCH)

| # | Konu | Etki |
|---|---|---|
| G1 | Rate limit sayaçları IP hash'ine dayanır; CDN/proxy arkasında `X-Forwarded-For` **güvenilir olmalıdır**. Ters proxy bunu istemciden gelen değerle **ezmelidir**. | Yanlış yapılandırılırsa limit atlatılabilir |
| G2 | Operatör kuyruğunda **sayfalama yok** (ilk 50 kayıt, eskiden yeniye). İş hacmi arttığında yeni işler görünmez. | Operasyonel |
| G3 | Rol değişikliği için yönetim arayüzü yok; roller DB'den atanır. | Operasyonel |
