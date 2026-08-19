# Medya 333 — Operasyon El Kitabı

> Bu belge **günlük işi yapan kişi** içindir: siparişi bulan, atayan, ilerleme
> giren, tamamlayan ve müşteriyle konuşan kişi. Teknik derinlik için
> `docs/architecture-decisions.md`, canlıya çıkış için
> `docs/PRODUCTION_CHECKLIST.md`.

---

## 0 · Değişmeyen kural

**Hizmetler gerçek kullanıcılar tarafından ELLE gerçekleştirilir.**
Sistem hiçbir sosyal medya hesabına otomatik etkileşim göndermez; yaptığı tek
şey siparişi, ödemeyi ve **sizin yaptığınız işin kaydını** tutmaktır.

Bunun panelde üç somut karşılığı var:

1. Bir iş **kendiliğinden başlamaz**. `READY` durumundaki bir işi başlatan
   şey sizin "İşleme Başlat" tıklamanızdır.
2. Bir iş **kendiliğinden tamamlanmaz**. Teslim %100 olsa bile durum
   `COMPLETED` olmaz; "Tamamla" demeniz gerekir.
3. Her durum değişikliği **kimin yaptığını** kaydeder. Sistem aktörüyle
   yapılan geçiş kodda reddedilir.

---

## 1 · Günlük akış (sabah rutini)

1. `/yonetim/fulfillment` adresini aç.
2. Üstteki sayaçlara bak:

   | Sekme | Ne demek | Ne yapmalı |
   |---|---|---|
   | **Yeni Siparişler** | Ödemesi alınmış, henüz kimse dokunmamış | Kendine ata, başlat |
   | **İşlemde** | Başlatılmış işler | İlerleme gir |
   | **Kısmi** | Teslim başladı, bitmedi | İlerleme gir, bitince tamamla |
   | **İnceleme** | Bir sorun var | §6'ya bak |
   | **Tamamlanan** | Bitmiş işler | Yalnızca kayıt |

3. **Önce İnceleme** kuyruğunu boşalt (müşteri bekliyor olabilir),
   sonra Yeni Siparişler'e geç.

> ⚠️ Sayaçlar **filtreden etkilenmez**. Arama yaptığınızda liste daralır ama
> sekme sayıları aynı kalır — "işler kayboldu" paniği yaşamayın.

---

## 2 · Yeni sipariş nasıl bulunur?

### Sayfalar
Kuyruk sayfa başına **50 kayıt** gösterir ve varsayılan sıralama
**"En yeni"**dir. Yani yeni düşen sipariş **her zaman ilk sayfadadır**.

Sayfalar arasında **Önceki / Sonraki** düğmeleriyle gezinirsiniz. Siz
gezerken yeni sipariş düşse bile hiçbir kayıt iki kez görünmez ve hiçbiri
atlanmaz.

### Arama
Tek kutu, üç şeyi birden arar:

| Yazarsanız | Bulur |
|---|---|
| `M333-A1B2C3D4` | Sipariş numarası (kısmi de olur: `A1B2`) |
| `ornek@site.com` | Müşteri e-postası |
| `@medya333` veya `medya333` | Hedef hesap |

### Filtreler
Platform · Hizmet · Paket · İş durumu · Sipariş durumu · Operatör · Tarih aralığı.

- **Operatör → "Atanmamış"**: sahipsiz işleri görürsünüz. Vardiya başında
  bakılacak ilk yer burasıdır.
- **Sıralama → "Durum önceliği"**: `READY` işler başa gelir.
- Filtreler adres çubuğuna yazılır; ekranı bir arkadaşınıza **link olarak
  gönderebilirsiniz**.

---

## 3 · Sipariş nasıl atanır?

Detay sayfasında **Atama** bölümü:

| Rolünüz | Yapabilecekleriniz |
|---|---|
| SUPPORT | Atama yapamaz (yalnızca okur ve müşteri notu yazar) |
| OPERATOR | **Yalnızca kendine** atayabilir, o da iş **boştaysa** |
| ADMIN / SUPERADMIN | Herkesi atayabilir, atamayı değiştirebilir |

> ⚠️ **İş çalma engellidir.** Başka bir operatöre atanmış bir işi
> OPERATOR kendine alamaz. Devir gerekiyorsa ADMIN'den isteyin — böylece
> devir bir kayda dönüşür.

**Kural:** Atanmamış bir işte ilerleme kaydedemezsiniz. Önce üstlenin.

---

## 4 · İşe nasıl başlanır ve ilerleme nasıl girilir?

### Başlatma
1. İşi kendinize atayın.
2. **Başlangıç ölçümü**nü girin — hedef hesabın **şu andaki** takipçi/beğeni
   sayısı.
3. "İşleme Başlat".

> ⚠️ Başlangıç ölçümü **donar**. Sipariş anı ile başlangıç arasındaki
> organik değişim bize yazılmaz; bu, müşteri lehine bir korumadır.

### İlerleme
İki ölçüm biçimi var; hangisinin geçerli olduğunu ekran söyler:

| Mod | Ne girersiniz | Sistem ne yapar |
|---|---|---|
| **METRIC** (takipçi, beğeni) | Hedefin **güncel** sayısı | `teslim = güncel − başlangıç`, üst sınır istenen miktar |
| **MANUAL_COUNT** (yorum, tanıtım) | Doğrudan **teslim adedi** | Olduğu gibi kaydeder |

> ⚠️ **Yüzde ve kalan miktar girilmez.** Bu değerler sunucuda hesaplanır.
> Arayüzden gönderilemezler; gönderilse bile yok sayılırlar.

**Ölçüm geriye düşerse** (organik kayıp) sistem bunu ayrı bir olay olarak
kaydeder ve teslimi **geri almaz**. Düşüş telafi (garanti) konusudur — §7.

---

## 5 · Sipariş nasıl tamamlanır?

1. Teslim istenen miktara ulaşsın.
2. **"Tamamla"** düğmesine basın.

> ⚠️ **%100 teslim OTOMATİK TAMAMLAMA DEĞİLDİR.** Bu bilinçli bir karardır:
> son kontrolü bir insan yapar. Teslim dolmuş bir iş, siz tamamlamadıkça
> kuyrukta bekler.

### Eksik teslimle kapatmak
Teslim eksikken tamamlamak isterseniz sistem sizi durdurur ve **kısmi
tamamlama onayı** ister. Bu kasıtlı bir sürtünmedir: yanlışlıkla eksik
kapatma olmasın diye.

### Tamamlandığında ne olur?
- Sipariş `COMPLETED` (veya kısmiyse `PARTIAL`) olur.
- **Garanti saati başlar** — süre sipariş anındaki snapshot'tan gelir.
- Müşteriye **"Siparişiniz tamamlandı"** e-postası gider *(e-posta
  sağlayıcısı bağlıysa — bkz. §11)*.

---

## 6 · REVIEW_REQUIRED ne zaman kullanılır?

**İnceleme**, "bu işi ben tek başıma kapatamam" demenin yoludur.

Kullanın:
- Hedef hesap **kapandı / gizlendi / adını değiştirdi**
- Müşteri yanlış hedef vermiş
- Teslim edilemeyecek bir durum var
- Ölçüm anlamsız şekilde oynuyor

Nasıl: "Başarısız" aksiyonu + **teknik sebep**. Sistem işi otomatik olarak
inceleme kuyruğuna alır.

> ⚠️ Yazdığınız teknik sebep **müşteriye GÖSTERİLMEZ**. Müşteri yalnızca
> *"Siparişiniz inceleniyor."* görür. Müşteriye bir şey söylemek istiyorsanız
> ayrıca **müşteri notu** yazın (§8).

---

## 7 · Telafi (garanti) nasıl açılır?

**Telafi**, tamamlanmış bir siparişte sonradan düşüş olduğunda uygulanır.

### Önce garantiyi kontrol edin
Detay sayfasında **Garanti bitişi** yazar. Yoksa o üründe garanti **tanımlı
değildir** — bu bir eksiklik değil, o ürünün koşuludur. Garantisi olmayan bir
ürüne "herhâlde vardır" diyerek telafi açmayın.

### Akış

| Adım | Kim | Ne olur |
|---|---|---|
| Vaka açılır | OPERATOR+ | Düşüş miktarı ve sebep kaydedilir |
| **Onay** | **yalnızca ADMIN+** | Müşteriye *"Telafi talebiniz onaylandı"* gider |
| İşleme alma | OPERATOR+ | Telafi elle yapılır |
| **Tamamlama** | OPERATOR+ | Müşteriye *"Telafi tamamlandı"* gider |

> ⚠️ Telafi **ücretsizdir** ve yeni sipariş açılmaz. Müşteri iç adımları
> (düşüş tespiti, inceleme, işleme alma) görmez; yalnızca **onay** ve
> **tamamlama** anlarını görür.

---

## 8 · Notlar: hangisi müşteriye gider?

| Not türü | Kim yazabilir | Müşteri görür mü |
|---|---|---|
| **İç not** | OPERATOR (kendi işinde) · ADMIN+ | **HAYIR** |
| **Müşteri notu** | SUPPORT · OPERATOR · ADMIN+ | **EVET** |

- İç not: "hesap 2 saat kapalıydı", "ikinci partiyi yarın vereceğim".
- Müşteri notu: "Siparişiniz yoğunluk nedeniyle bir gün uzayabilir."

> ⚠️ Müşteri notuna **operatör adı, iç durum adı, teknik hata veya başka
> müşterinin bilgisi yazılmaz**. Yazdığınız şey aynen görünür.

---

## 9 · Müşteri siparişini nasıl takip eder?

Üç yol var; hepsi **sipariş numarası tek başına yeterli değildir** ilkesine
dayanır:

1. **E-postadaki takip bağlantısı** — kişiye özeldir, içinde imzalı bir
   anahtar taşır.
2. **`/siparis-takip`** — sipariş numarası **+ e-posta** birlikte.
3. **Hesap** — giriş yaptıysa `/hesabim`.

Müşterinin gördüğü durum dili (iç adlar **gösterilmez**):

| İç durum | Müşteri görür |
|---|---|
| `READY` | Siparişiniz sıraya alındı. |
| `PROCESSING` / `STARTED` | Siparişiniz işleme alındı. |
| `PARTIAL` | Siparişiniz devam ediyor. |
| `COMPLETED` | Siparişiniz tamamlandı. |
| `FAILED` / `REVIEW_REQUIRED` | Siparişiniz inceleniyor. |

**Müşteri "linkim çalışmıyor" derse:** takip sayfasından *yeniden gönderim*
yapılabilir. Sınır: saatte 3 kez (hem IP hem sipariş bazında).

---

## 10 · Katalog fiyatı nasıl değiştirilir?

1. `/yonetim/katalog` → platform → varyant kartına tıklayın.
2. **Fiyatlar** tablosunda ilgili satırın kutusuna yeni fiyatı yazın:
   `1.349,90` biçiminde. **Kaydet**.
3. Üstteki **doğrulama raporu**na bakın: `PASS` değilse düzeltin.

> ⚠️ **Yetki: ADMIN+.** SUPPORT ve OPERATOR fiyat göremez değil,
> **değiştiremez**.

### Fiyat yazarken
- Tüm fiyatlar **KDV DAHİL** müşteri satış fiyatıdır. Üzerine KDV eklenmez.
- `1.349,90` ve `1349,90` aynıdır. `1349.90` da kabul edilir (nokta ondalık
  sayılır).
- **Silme yoktur, pasifleştirme vardır.** Bir fiyat kademesi geçmiş
  siparişlere bağlıdır; silinirse o siparişin hangi fiyattan verildiği
  kaybolur.

### Doğrulama raporu ne der?

| Seviye | Anlamı |
|---|---|
| **PASS** | Tüm miktarlar fiyatlanabiliyor |
| **WARNING** | Çalışır ama dikkat gerektiren bir durum var |
| **ERROR** | Bir miktar fiyatlanamıyor — **sipariş açılamaz** |

Her sorun kartında *ne oldu · neden önemli · nasıl düzeltilir* yazar.
En sık görülen ikisi:

- **Fiyat boşluğu (GAP)** — o aralıkta kademe yok, müşteri sipariş veremez.
- **Kademe çakışması (OVERLAP)** — aynı miktar iki kademeye düşüyor,
  hangi fiyatın uygulanacağı belirsizleşir.

### Yeni hizmet / paket eklemek
Aynı ekranda **+ Yeni hizmet** ve **+ Yeni varyant** panelleri var.

- **Hazır miktar kilidi** açıksa müşteri listede olmayan bir miktar giremez —
  sunucu da reddeder. Kilidi açıyorsanız **en az bir miktar** tanımlayın.
- **Garanti (gün)** alanını **boş bırakırsanız garanti YOKTUR**. Emin
  değilseniz boş bırakın; sonradan eklemek, olmayan bir garantiyi vaat
  etmekten iyidir.

---

## 10b · Bildirim paneli — "e-posta gitti mi?"

`/yonetim/notifications`

| Sekme | Ne gösterir |
|---|---|
| **Gönderilemeyen** | Müşteriye ulaşmayan bildirimler (varsayılan sekme) |
| Gönderilen | Teslim edilenler |
| Atlanan | Alıcı adresi olmayan kayıtlar |

Her satırda: şablon · sipariş no · **maskeli** alıcı · durum · sağlayıcı ·
oluşturma ve gönderim zamanı.

> ⚠️ Ham e-posta adresi, takip token'ı, sağlayıcının ham cevabı ve API anahtarı
> **gösterilmez**. Sağlayıcı teslim edemiyorsa ekranın üstünde kırmızı bir uyarı
> çıkar — bu bir arıza değil, eksik yapılandırmadır.

**Yeniden gönderme** (yalnızca ADMIN+, yalnızca başarısız kayıtlarda):
sorunun düzeldiğini biliyorsanız tıklayın.

> ⚠️ **Otomatik tekrar YOKTUR.** Sağlayıcı yapılandırılmamışken çalışan bir
> retry döngüsü, saatte binlerce başarısız denemeden başka bir şey üretmez.
> Yeniden gönderim yeni kayıt açmaz; "aynı olay için tek bildirim" kuralı
> korunur, yalnızca deneme sayacı artar.

### Üstteki dört sayaç

| Sayaç | Anlamı |
|---|---|
| Gönderilemeyen bildirim | Müşteriye e-posta gitmiyor |
| İnceleme bekleyen iş | § 6'ya bakın |
| 24 saatten uzun sıradaki iş | **Bir ölçümdür, gecikme bildirimi DEĞİL** |
| 30 gün içinde garantisi bitecek | Bilgi amaçlı |

> ⚠️ Sistemde tanımlı bir **hedef teslim süresi (SLA) yoktur**. Bu yüzden
> hiçbir ekran "gecikti" demez. Uydurma bir eşiğe göre aciliyet ilan etmek,
> zamanla tüm uyarıların yok sayılmasına yol açar.

---

## 10c · Kullanıcı ve rol yönetimi

`/yonetim/kullanicilar` — **yalnızca ADMIN ve SUPERADMIN görür.**

| Rolünüz | Atayabildikleriniz |
|---|---|
| ADMIN | Müşteri · Destek · Operatör |
| SUPERADMIN | Hepsi (Yönetici ve Süper Yönetici dahil) |

Değiştiremeyeceğiniz üç durum arayüzde **kilitli** görünür:

1. **Kendiniz** — kendi rolünüzü değiştiremezsiniz. Başka bir yönetici gerekir.
2. **Kendinizle aynı veya üstü** — ADMIN, başka bir ADMIN'i değiştiremez.
3. **Son SUPERADMIN** — düşürülemez. Önce başka bir SUPERADMIN atayın.

> ⚠️ E-posta adresleri **maskeli** gösterilir. Rol atamak için tam adres
> gerekmez; kişiyi ayırt edebilmek gerekir.
>
> ⚠️ Her rol değişikliği denetim kaydına yazılır: kim, ne zaman, eski rol →
> yeni rol. Adres ve ad kaydedilmez.

---

## 11 · Bilinen sınırlar (uydurmuyoruz, söylüyoruz)

| Konu | Durum |
|---|---|
| **E-posta** | Sağlayıcı bağlı değilse müşteriye **e-posta GİTMEZ**. Panel bunu "gönderildi" diye göstermez; bildirim kaydı `FAILED` olur. |
| **Ödeme** | PayTR başvurusu onaylanmadı. Canlı tahsilat yapılamaz. |
| **SMS / WhatsApp** | Yok. |
| **Hata izleme** | Sentry **bağlı değil**. Canlıda bir istisna olduğunda kimse otomatik haberdar olmaz. |
| **SLA** | Hedef teslim süresi tanımlı değil — bu yüzden hiçbir ekran "gecikti" demez, yalnızca süre ölçer. |
| **Alan adı** | `www.medya333.com` DNS ve TLS bağlanmadı. |

---

## 12 · Sağlık kontrolü

İki ayrı uç vardır:

| Uç | Cevapladığı soru | Bağımlılık |
|---|---|---|
| `/api/health/live` | Süreç ayakta mı? | **yok** |
| `/api/health` | Bu örneğe trafik verilebilir mi? | Veritabanı + Redis |

`/api/health` → `healthy` · `degraded` · `unavailable`

| Durum | Anlamı | Ne yapmalı |
|---|---|---|
| `healthy` | Her şey çalışıyor | — |
| `degraded` | Uygulama ayakta, Redis zayıf | Teknik ekibe haber verin; sipariş almaya devam |
| `unavailable` | Veritabanı yok | **Sipariş alınamıyor** — acil |

---

## 13 · Kim ne yapabilir? (özet)

| İşlem | SUPPORT | OPERATOR | ADMIN | SUPERADMIN |
|---|:--:|:--:|:--:|:--:|
| Kuyruğu ve detayı görmek | ✔ | ✔ | ✔ | ✔ |
| Müşteri notu yazmak | ✔ | ✔ | ✔ | ✔ |
| İç not yazmak | — | ✔ (kendi işi) | ✔ | ✔ |
| Kendine atamak | — | ✔ | ✔ | ✔ |
| Başkasına atamak | — | — | ✔ | ✔ |
| Başlat / ilerleme / tamamla | — | ✔ (kendi işi) | ✔ | ✔ |
| Telafi vakası açmak | — | ✔ | ✔ | ✔ |
| **Telafi onaylamak** | — | — | ✔ | ✔ |
| Katalog / fiyat değiştirmek | — | — | ✔ | ✔ |
| Bildirim izleme | ✔ | ✔ | ✔ | ✔ |
| **Bildirimi yeniden gönderme** | — | — | ✔ | ✔ |
| **Kullanıcı rolü değiştirme** | — | — | ✔ (sınırlı) | ✔ |
| **Para iadesi** | — | — | — | ✔ |

Tam matris: [`docs/SECURITY_MATRIX.md`](SECURITY_MATRIX.md).

---

## 14 · Her şey kaydediliyor

Şu işlemler **kim · ne zaman · hangi kayıt · eski → yeni** olarak AuditLog'a
yazılır:

katalog oluşturma · katalog güncelleme · aktif/pasif · fiyat değişikliği ·
atama ve devir · durum geçişi · telafi adımları · not ekleme · sipariş
oluşturma · ödeme · para iadesi.

> ⚠️ Denetim kaydına parola, token, sır ve tam ödeme verisi **yazılmaz**.
> Bu, sizi izlemek için değil; bir şey ters gittiğinde **ne olduğunu
> anlayabilmek** için vardır.
