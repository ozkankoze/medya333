/**
 * YAPISAL VERİ (JSON-LD) — TEK ENJEKSİYON NOKTASI
 *
 * ⚠️ `dangerouslySetInnerHTML` BURADA ZORUNLUDUR ve tek yerde toplanmıştır.
 * React, `<script>` içine metin çocuğu koymayı desteklemez; JSON-LD'nin
 * sunucuda basılmasının başka yolu yoktur. Riski tek dosyada tutmak,
 * kaçış kuralının 5 farklı sayfada tekrar tekrar doğru yazılmasını
 * beklemekten güvenlidir.
 *
 * ⚠️ `</script>` KAÇIŞI. Veriden gelen bir metin `</script>` içerirse
 * tarayıcı script'i orada kapatır ve geri kalanı HTML olarak yorumlar —
 * klasik XSS vektörü. Katalog metinleri admin panelinden geldiği için bu
 * teorik değil, gerçek bir giriş noktasıdır.
 *
 * ⚠️ YAPISAL VERİ SAYFADAKİ İÇERİĞİ TEKRAR ETMELİ, ONA EKLEME YAPMAMALI.
 * Google'ın yapısal veri politikası, sayfada görünmeyen bilgiyi işaretlemeyi
 * ihlal sayar. Bu yüzden çağıran sayfalar buraya YALNIZCA ekranda gösterilen
 * fiyatı, SSS'yi ve adları verir.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: json }}
    />
  )
}
