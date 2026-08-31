import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⭐ SİPARİŞ ARŞİVİ VE SİLME — GERÇEK MÜŞTERİ SİPARİŞLERİ
 *
 * ⚠️⚠️ BURADAKİ KAYITLAR KASA DEFTERİ DEĞİLDİR. Kasa'daki `ManualOrder`
 * serbestçe silinir; bunlara ödeme kaydı, iade kaydı, sözleşme onayı ve
 * müşterinin takip linki bağlıdır.
 *
 * Canlı veritabanında ölçülen davranış:
 *   · Ödemeli sipariş SİLİNEMEZ (Payment/Refund → ON DELETE RESTRICT)
 *   · Ödemesiz sipariş silinir; OrderItem/OrderEvent/Fulfillment/Notification
 *     CASCADE ile birlikte gider
 *   · Arşiv hiçbir şey silmez, yalnızca kuyruktan kaldırır ve geri alınır
 */

const ROOT = path.resolve(__dirname, '../..')
const SRC = path.join(ROOT, 'src')
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')
const stripComments = (body: string) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// ===========================================================================
describe('silme koruması', () => {
  const service = read('src/server/orders/archive.ts')

  it('⚠️ ÖDEME veya İADE kaydı olan sipariş silinemez', () => {
    const code = stripComments(service)
    expect(code).toContain('HAS_PAYMENT')
    expect(code).toMatch(/_count\.payments > 0 \|\| .*_count\.refunds > 0/)
  })

  it('⚠️ ASIL ENGEL VERİTABANINDA — uygulama kontrolü tek başına değil', () => {
    /**
     * `Payment` ve `Refund` yabancı anahtarları ON DELETE RESTRICT olduğu
     * için uygulama atlansa bile (elle SQL, ileride bir script) silme
     * reddedilir. Şema bunu SetNull veya Cascade'e çevirirse para izi
     * silinebilir hâle gelir — bu test o değişikliği yakalar.
     */
    const schema = read('prisma/schema.prisma')
    const payment = /model Payment \{[\s\S]*?\n\}/.exec(schema)
    const refund = /model Refund \{[\s\S]*?\n\}/.exec(schema)
    expect(payment).not.toBeNull()
    expect(refund).not.toBeNull()
    for (const m of [payment![0], refund![0]]) {
      expect(m).toMatch(/order\s+Order\s+@relation\([^)]*onDelete: Restrict/)
    }
  })

  it('⚠️ DENETİM KAYDI SİLMEDEN ÖNCE ve ÖZETLE yazılır', () => {
    /**
     * Sonra yazılsaydı, silme başarısız olduğunda gerçekleşmemiş bir olay
     * kaydedilirdi. Özet olmadan ise satır "bir sipariş silindi" demekten
     * öteye geçmez — hangisi, ne kadardı, bilinemezdi.
     */
    const code = stripComments(service)
    const audit = code.indexOf("action: 'order.delete'")
    const del = code.indexOf('db.order.delete(')
    expect(audit).toBeGreaterThan(-1)
    expect(del).toBeGreaterThan(-1)
    expect(audit, 'denetim kaydı silmeden SONRA yazılıyor').toBeLessThan(del)
    for (const field of ['orderNo:', 'status:', 'totalMinor:']) {
      expect(code, `denetim özetinde ${field} yok`).toContain(field)
    }
  })

  it('silme ucu SUPERADMIN, arşiv ucu ADMIN ister', () => {
    // ⚠️ En yıkıcı işlem en dar kapıda. Silme geri alınamaz, arşiv alınabilir.
    const del = read('src/app/api/v1/admin/orders/[orderNo]/route.ts')
    expect(del).toContain("minimumRole: 'SUPERADMIN'")
    const arc = read('src/app/api/v1/admin/orders/[orderNo]/arsiv/route.ts')
    expect(arc).toContain("minimumRole: 'ADMIN'")
  })
})

// ===========================================================================
describe('arşiv', () => {
  it('⚠️ "ARŞİVLENDİ" AYRI BİR OrderStatus DEĞİL', () => {
    /**
     * Enum'a eklenseydi siparişin gerçek durumunu (PAID, COMPLETED…) ezer
     * ve arşivden çıkarıldığında hangi duruma döneceği bilinemezdi.
     */
    const schema = read('prisma/schema.prisma')
    const enumBlock = /enum OrderStatus \{[\s\S]*?\n\}/.exec(schema)
    expect(enumBlock).not.toBeNull()
    expect(enumBlock![0]).not.toMatch(/ARCHIVED|ARSIV/i)
  })

  it('arşiv alanları şemada ve migration’da var', () => {
    const schema = read('prisma/schema.prisma')
    const order = /model Order \{[\s\S]*?\n\}/.exec(schema)
    expect(order![0]).toContain('archivedAt   DateTime?')
    const sql = read('prisma/migrations/20260901090000_order_arsiv/migration.sql')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "archivedAt"')
  })

  it('⚠️ ARŞİV HEM LİSTEYİ HEM SEKME SAYAÇLARINI etkiler', () => {
    /**
     * Yalnızca listeye uygulansaydı kuyruk boş görünür ama sekmede "12 iş"
     * yazmaya devam ederdi — arşivlemenin tek amacı olan "kuyruğu
     * temizleme" hissi tam da orada bozulurdu.
     */
    const queue = read('src/server/fulfillment/queue.ts')
    const occurrences = [...queue.matchAll(/archivedAt: params\.archived \? \{ not: null \} : null/g)]
    expect(occurrences.length, 'arşiv filtresi tek yerde — sayaçlar kaçmış').toBeGreaterThanOrEqual(2)
  })

  it('kuyruk satırı silinebilirliği taşıyor', () => {
    const queue = read('src/server/fulfillment/queue.ts')
    expect(queue).toContain('deletable: boolean')
    expect(queue).toContain('_count: { select: { payments: true, refunds: true } }')
  })

  it('⚠️ satır başına EK SORGU YOK — sayım select içinde', () => {
    // 50 satırlık bir sayfada "bu silinebilir mi?" sorusunu ayrı ayrı
    // sormak 50 ek sorgu demekti.
    const queue = stripComments(read('src/server/fulfillment/queue.ts'))
    expect(queue).not.toMatch(/for \([^)]*\)\s*\{[^}]*db\.payment\.count/)
  })
})

// ===========================================================================
describe('arayüz', () => {
  /**
   * ⚠️ YORUMLAR ÇIKARILIR. Bu tuzağa bu oturumda ikinci kez düşüldü:
   * "`window.confirm` yeterli değil" diye AÇIKLAYAN yorumun kendisi,
   * "window.confirm geçmesin" aramasını ihlal sayıyordu. Dosya doğruydu,
   * testi bozan şey dosyanın kendi belgelendirmesiydi.
   */
  const actions = stripComments(read('src/components/orders/OrderRowActions.tsx'))

  it('⚠️ SİLME ONAYI SİPARİŞ NUMARASI YAZDIRIR', () => {
    /**
     * `window.confirm` yeterli değil: kuyrukta hızla ilerleyen biri onay
     * kutusunu okumadan kapatır. Numarayı yazmak, doğru satırda olduğunu
     * fiilen doğrulamayı zorunlu kılar.
     */
    expect(actions).toContain('typed !== orderNo')
    expect(actions).not.toContain('window.confirm')
  })

  it('silinemeyen satırda düğme yerine SEBEP yazıyor', () => {
    // Gizlemek, kullanıcıya özelliğin bozuk olduğunu düşündürürdü.
    expect(actions).toContain('Ödemeli · silinemez')
  })

  it('arşiv geri alınabilir olarak sunuluyor', () => {
    expect(actions).toContain('Geri al')
  })

  it('postJson sözleşmesini kullanıyor — ham fetch yok', () => {
    const code = stripComments(actions)
    expect(code).toContain('postJson(')
    expect(code).not.toMatch(/\bawait fetch\(/)
  })
})

// ===========================================================================
describe('⚠️ KATALOG panelden kaldırıldı', () => {
  it('katalog ekranları yok', () => {
    expect(existsSync(path.join(SRC, 'app/(admin)/admin/(panel)/katalog'))).toBe(false)
  })

  it('menüde katalog bağlantısı yok', () => {
    const layout = stripComments(read('src/app/(admin)/admin/(panel)/layout.tsx'))
    expect(layout).not.toContain('/admin/katalog')
  })

  it('⚠️ VERİ VE API UÇLARI DURUYOR — silinmedi', () => {
    /**
     * Uçlar kaldırılsaydı fiyat değiştirmenin hiçbir yolu kalmazdı ve
     * müşteri sitesi katalogdan beslendiği için geri dönüş zorlaşırdı.
     */
    for (const p of [
      'app/api/v1/admin/platforms/route.ts',
      'app/api/v1/admin/services/route.ts',
      'app/api/v1/admin/variants/route.ts',
      'app/api/v1/admin/pricing-rules/route.ts',
    ]) {
      expect(existsSync(path.join(SRC, p)), `${p} silinmiş`).toBe(true)
    }
  })

  it('paylaşılan yardımcı taşındı, bağımlıları güncellendi', () => {
    // `admin-client` katalog dışında da kullanılıyordu (kullanıcılar,
    // bildirimler); silinen bir klasörün adını taşımaya devam etmesi
    // ileride kafa karıştırırdı.
    expect(existsSync(path.join(SRC, 'components/admin/admin-client.ts'))).toBe(true)
    expect(existsSync(path.join(SRC, 'components/catalog'))).toBe(false)
    for (const f of ['components/users/RoleSelect.tsx', 'components/notifications/RetryButton.tsx']) {
      expect(read(`src/${f}`)).toContain('@/components/admin/admin-client')
    }
  })

  it('kalan menü bölümleri korundu', () => {
    const layout = read('src/app/(admin)/admin/(panel)/layout.tsx')
    for (const label of ['İş Kuyruğu', 'Bildirimler', 'Kullanıcılar', 'Kasa', 'Hesabım']) {
      expect(layout, `menüde "${label}" yok`).toContain(label)
    }
  })
})
