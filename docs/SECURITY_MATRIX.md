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
| `GET /admin/fulfillments?q=…` (arama/filtre) | SUPPORT | — | ✔ | ✔ | ✔ | ✔ |
| `/yonetim/notifications` (bildirim izleme) | SUPPORT | — | ✔ | ✔ | ✔ | ✔ |
| **`POST /admin/notifications/{id}/retry`** | **ADMIN** | — | — | — | ✔ | ✔ |
| `/yonetim/kullanicilar` (kullanıcı listesi) | ADMIN | — | — | — | ✔ | ✔ |
| **`PATCH /admin/users/{id}/role`** | **ADMIN** + 5 ek kural | — | — | — | ✔* | ✔ |
| `GET /admin/services`, `/variants`, `/pricing-rules`, `/platforms` | SUPPORT | — | ✔ | ✔ | ✔ | ✔ |
| `GET /admin/pricing/simulate`, `/pricing/validate` | SUPPORT | — | ✔ | ✔ | ✔ | ✔ |
| `POST`/`PATCH` katalog (servis, varyant, fiyat kuralı, platform, sıralama) | ADMIN | — | — | — | ✔ | ✔ |
| `DELETE` katalog (servis, varyant, fiyat kuralı, platform) | ADMIN | — | — | — | ✔ | ✔ |

**Okunacak ana kural:** *okumak* SUPPORT'tan, *işi ilerletmek* OPERATOR'dan,
*katalog/fiyat değiştirmek* ADMIN'den, *para iade etmek* SUPERADMIN'den başlar.

`✔*` = ADMIN rol atayabilir ama **sınırlı**: yalnızca kendinden düşük roller,
yalnızca kendinden düşük kullanıcılara, asla kendine (§ 2.4).

### 2.4 Rol değiştirme — beş katmanlı yükseltme engeli (Faz 9)

`PATCH /api/v1/admin/users/{id}/role` en hassas yönetim ucudur: burada bir
hata, tüm yetki modelini geçersiz kılar. Beş kural üst üste uygulanır:

| # | Kural | Engellediği senaryo |
|---|---|---|
| 1 | Uç `minimumRole: 'ADMIN'` | **CUSTOMER kendini ADMIN yapar** |
| 2 | Kimse **kendi** rolünü değiştiremez (SUPERADMIN dahil) | ADMIN kendini SUPERADMIN yapar |
| 3 | ADMIN kendi seviyesinde/üstünde **rol atayamaz** | ADMIN yeni ADMIN/SUPERADMIN üretir |
| 4 | ADMIN kendi seviyesinde/üstünde **kullanıcıyı değiştiremez** | ADMIN diğer ADMIN'leri düşürüp tek yetkili olur |
| 5 | **Son SUPERADMIN düşürülemez** | Sistem yönetilemez hâle gelir (kilitlenme) |

Kural 5, sayım ve güncellemeyi **aynı transaction'da satır kilidiyle** yapar
(`SELECT … FOR UPDATE`); aksi hâlde iki eşzamanlı istek son iki SUPERADMIN'i
birlikte düşürebilirdi.

Ek kısıtlar: misafir gölge kayıtlarına rol atanamaz · kullanıcı listesi
**maskeli** e-posta gösterir · her değişiklik `user.role_change` olarak
AuditLog'a yazılır ve payload'a PII girmez.

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
| `GET /api/health` | — | **yok** | — | ⚠️ Bilinçli. Sağlık yoklamasını kısmak, sağlıklı bir örneğin "ölü" işaretlenmesine yol açar. Uç iki ucuz ping'den ibarettir ve sır döndürmez. |
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
| `GET /api/health` | Sağlık yoklaması kısılmaz (yukarı bkz.). |
| `GET /api/health/live` | Liveness probu — bağımlılığa bakmaz, sabit `ok` döner. |

---

## 4. Bilinen boşluklar (POST-LAUNCH)

| # | Konu | Etki |
|---|---|---|
| G1 | Rate limit sayaçları IP hash'ine dayanır; CDN/proxy arkasında `X-Forwarded-For` **güvenilir olmalıdır**. Ters proxy bunu istemciden gelen değerle **ezmelidir**. | Yanlış yapılandırılırsa limit atlatılabilir |
| ~~G2~~ | ~~Operatör kuyruğunda sayfalama yok~~ → **Faz 8'de kapatıldı**: cursor tabanlı sayfalama, varsayılan sıralama "en yeni", 50 kayıt/sayfa. | ✅ |
| G3 | Rol değişikliği için yönetim arayüzü yok; roller DB'den atanır. | Operasyonel |

---

## 5. Bildirim yüzeyi (Faz 8)

Bildirimler yeni bir yetki yüzeyi açmaz — hiçbir uçtan **tetiklenemezler**.
Tek doğuş yolları bir `OrderEvent` yazılmasıdır ve o olayı yazan kod zaten
kendi yetki kontrolünden geçmiştir.

| Soru | Cevap |
|---|---|
| Müşteri bildirim tetikleyebilir mi? | Yalnızca dolaylı: sipariş oluşturarak veya takip linki isteyerek. İkisi de rate limitlidir. |
| Aynı olay iki e-posta üretebilir mi? | Hayır. `Notification` tablosunda `unique(orderEventId, channel)` vardır; ikinci kayıt veritabanı seviyesinde açılamaz. |
| Bildirim kaydında PII var mı? | Yalnızca **maskeli** alıcı (`ab***@site.com`). Ham e-posta, takip token'ı ve sağlayıcı sırrı yazılmaz. |
| Sağlayıcı yokken ne olur? | Kayıt `FAILED` olur. **"Gönderildi" denmez.** |
| E-postada iç bilgi görünür mü? | Hayır. `assertSafeVariables` yasaklı alan adlarını (token, secret, cvv, internalNote, failureReason, operatorId…) çalışma zamanında reddeder; testler ayrıca şablon çıktısını iç enum'lara karşı tarar. |

---

## 6. İzleme yüzeyi (Faz 9)

Hata izleme **bağlı değildir** (SDK kurulmadı). Bağlandığında dışarıya çıkacak
veri bugünden sınırlandırılmıştır — `server/observability.ts`.

| Soru | Cevap |
|---|---|
| Hangi alanlar gönderilebilir? | Yalnızca yedi tanımlayıcı: `requestId`, `orderId`, `orderNo`, `paymentId`, `providerEventId`, `fulfillmentId`, `scope`. **Beyaz liste** — tanımlanmamış her alan sessizce düşer. |
| Yığın izi gönderilir mi? | **Hayır.** Dosya yolları ve bazen değişken değerleri taşır. Sunucu log'unda tam istisna zaten var. |
| Hata mesajı temizlenir mi? | Evet: bağlantı dizeleri, `Bearer` token'ları, `anahtar=değer` sırları, e-posta adresleri, 13–19 haneli kart benzeri diziler ve IPv4 adresleri maskelenir. |
| Ham IP gider mi? | **Hayır.** KVKK gereği hiçbir yere ham IP yazılmaz; kalıp maskelemesi ayrıca yakalar. |
| DSN varsa "aktif" mi? | **Hayır.** SDK kurulu değilse durum `pending_sdk` olur ve boot `ERROR_TRACKING_SDK_MISSING` uyarısı verir. |
