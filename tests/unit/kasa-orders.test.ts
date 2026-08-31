import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  netProfitMinor,
  ORDER_STATUSES,
  ORDER_STATUS_LABEL,
  paymentStateOf,
  summarizeOrders,
  type ManualOrderStatus,
  type OrderLike,
} from '@/lib/kasa/orders'

/**
 * ⭐ ELLE GİRİLEN SİPARİŞ DEFTERİ — birim testleri
 *
 * Kanıtlanan şeyler:
 *   1. Net kâr ve ödeme durumu SAKLANMAZ, türetilir.
 *   2. Aylık toplam sipariş TARİHİNE göredir ve iptaller ciroya girmez.
 *   3. Tahsil edilmemiş tutar ayrıca ölçülür.
 *   4. Bu modül sitedeki `Order` tablosuna hiç dokunmaz.
 */

const ROOT = path.resolve(__dirname, '../..')
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')
const stripComments = (body: string) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

function order(over: Partial<OrderLike> = {}): OrderLike {
  return {
    occurredAt: new Date('2026-08-15T00:00:00Z'),
    salePriceMinor: 100_000,
    costMinor: 30_000,
    status: 'TAMAMLANDI',
    paidAt: null,
    ...over,
  }
}

// ===========================================================================
describe('net kâr', () => {
  it('satış eksi maliyet', () => {
    expect(netProfitMinor({ salePriceMinor: 100_000, costMinor: 30_000 })).toBe(70_000)
  })

  it('maliyet satıştan büyükse NEGATİF kalır — sıfıra kırpılmaz', () => {
    /**
     * ⚠️ Kırpılsaydı zarar eden bir iş "0 kâr" görünürdü ve toplamda
     * zarar hiç görünmezdi. Zararın görünmesi, gösterilmesinin tek sebebi.
     */
    expect(netProfitMinor({ salePriceMinor: 10_000, costMinor: 25_000 })).toBe(-15_000)
  })

  it('kuruş tam sayı kalır — kayan nokta yok', () => {
    const n = netProfitMinor({ salePriceMinor: 32_490, costMinor: 10_003 })
    expect(Number.isInteger(n)).toBe(true)
    expect(n).toBe(22_487)
  })
})

// ===========================================================================
describe('ödeme durumu', () => {
  it('paidAt boşsa bekliyor, doluysa ödendi', () => {
    expect(paymentStateOf({ paidAt: null })).toBe('BEKLIYOR')
    expect(paymentStateOf({ paidAt: new Date('2026-08-20T00:00:00Z') })).toBe('ODENDI')
  })

  it('⚠️ ödeme durumu İŞ durumundan BAĞIMSIZ', () => {
    // Tamamlanmış ama tahsil edilmemiş sipariş bu defterde olağandır.
    expect(paymentStateOf(order({ status: 'TAMAMLANDI', paidAt: null }))).toBe('BEKLIYOR')
    // Ve tersi: bekleyen bir iş peşin tahsil edilmiş olabilir.
    expect(
      paymentStateOf(order({ status: 'BEKLIYOR', paidAt: new Date('2026-08-01T00:00:00Z') })),
    ).toBe('ODENDI')
  })
})

// ===========================================================================
describe('aylık özet', () => {
  const AGUSTOS = { year: 2026, month1: 8 }

  it('yalnızca seçili ayın siparişlerini toplar', () => {
    const s = summarizeOrders(
      [
        order({ occurredAt: new Date('2026-08-01T00:00:00Z'), salePriceMinor: 10_000, costMinor: 0 }),
        order({ occurredAt: new Date('2026-08-31T00:00:00Z'), salePriceMinor: 20_000, costMinor: 0 }),
        // sınırın hemen dışı — sayılmamalı
        order({ occurredAt: new Date('2026-07-31T00:00:00Z'), salePriceMinor: 99_000, costMinor: 0 }),
        order({ occurredAt: new Date('2026-09-01T00:00:00Z'), salePriceMinor: 99_000, costMinor: 0 }),
      ],
      AGUSTOS,
    )
    expect(s.monthCount).toBe(2)
    expect(s.monthSaleMinor).toBe(30_000)
  })

  it('⚠️ İPTAL edilen sipariş ciroya GİRMEZ ama satır sayısında görünür', () => {
    /**
     * Ciroya girseydi, yapılmayan işin parası kazanılmış gibi görünürdü.
     * Satır sayısından da düşülseydi iptaller gözden kaybolurdu — ikisi
     * ayrı ayrı doğru olmalı.
     */
    const s = summarizeOrders(
      [
        order({ salePriceMinor: 50_000, costMinor: 10_000, status: 'TAMAMLANDI' }),
        order({ salePriceMinor: 80_000, costMinor: 20_000, status: 'IPTAL' }),
      ],
      AGUSTOS,
    )
    expect(s.monthSaleMinor).toBe(50_000)
    expect(s.monthCostMinor).toBe(10_000)
    expect(s.monthNetMinor).toBe(40_000)
    expect(s.monthCount).toBe(2)
    expect(s.monthCanceledCount).toBe(1)
  })

  it('⚠️ TAHSİL EDİLMEMİŞ tutar ayrı ölçülür', () => {
    // Ciroya bakıp "bu para bende" sanmak en pahalı yanlış okumadır.
    const s = summarizeOrders(
      [
        order({ salePriceMinor: 50_000, paidAt: new Date('2026-08-16T00:00:00Z') }),
        order({ salePriceMinor: 30_000, paidAt: null }),
        // iptal edilmiş ve ödenmemiş — "dışarıdaki para" sayılmaz
        order({ salePriceMinor: 90_000, paidAt: null, status: 'IPTAL' }),
      ],
      AGUSTOS,
    )
    expect(s.monthSaleMinor).toBe(80_000)
    expect(s.monthUnpaidMinor).toBe(30_000)
  })

  it('boş liste sıfır döner, çökmez', () => {
    const s = summarizeOrders([], AGUSTOS)
    expect(s).toEqual({
      monthCount: 0,
      monthSaleMinor: 0,
      monthCostMinor: 0,
      monthNetMinor: 0,
      monthUnpaidMinor: 0,
      monthCanceledCount: 0,
    })
  })

  it('⚠️ AY SINIRI UTC gününe göre — saat kayması ayı değiştirmez', () => {
    /**
     * Tarihler gün başlangıcına sabitlenmiş UTC değerleridir. Yerel saate
     * göre karşılaştırılsaydı, ayın 1'i Türkiye'de bir önceki aya düşerdi
     * ve o siparişin cirosu yanlış ayda görünürdü.
     */
    const s = summarizeOrders(
      [order({ occurredAt: new Date('2026-08-01T00:00:00Z'), salePriceMinor: 12_345, costMinor: 0 })],
      AGUSTOS,
    )
    expect(s.monthSaleMinor).toBe(12_345)
  })
})

// ===========================================================================
describe('durum listesi', () => {
  it('dört durumun hepsinin etiketi var', () => {
    for (const s of ORDER_STATUSES) {
      expect(ORDER_STATUS_LABEL[s], `${s} etiketsiz`).toBeTruthy()
    }
    expect(ORDER_STATUSES).toHaveLength(4)
  })

  it('⚠️ durum listesi veritabanı enum’u ile AYNI', () => {
    /**
     * Ayrışsalardı, formda seçilebilen bir değer veritabanı tarafından
     * reddedilir ve kullanıcı sebebini anlamadığı bir hata görürdü.
     */
    const sql = read('prisma/migrations/20260831090000_kasa_siparisler/migration.sql')
    const block = /CREATE TYPE "ManualOrderStatus" AS ENUM \(([\s\S]*?)\)/.exec(sql)
    expect(block, 'enum tanımı bulunamadı').not.toBeNull()
    const inSql = [...block![1]!.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] as ManualOrderStatus)
    expect(inSql.sort()).toEqual([...ORDER_STATUSES].sort())
  })
})

// ===========================================================================
describe('⚠️ sitedeki SİPARİŞLERE dokunulmuyor', () => {
  /**
   * En pahalı olası hata bu olurdu: elle tutulan defterin silme düğmesinin
   * gerçek bir müşteri siparişini silmesi. Tabloların ayrı olması bunu
   * yapısal olarak imkânsız kılar; bu testler ayrımın kazara kaybolmasını
   * engeller.
   */
  const serverFiles = [
    'src/server/kasa/orders.ts',
    'src/app/api/v1/admin/kasa/siparisler/route.ts',
    'src/app/api/v1/admin/kasa/siparisler/[id]/route.ts',
    'src/app/api/v1/admin/kasa/siparisler/[id]/tahsil/route.ts',
    'src/app/api/v1/admin/kasa/siparisler/[id]/maliyet/route.ts',
    'src/app/api/v1/admin/kasa/siparisler/[id]/durum/route.ts',
  ]

  it('sipariş defteri modülleri `db.order` veya `Order` tablosunu HİÇ kullanmıyor', () => {
    for (const f of serverFiles) {
      const body = stripComments(read(f))
      expect(body, `${f} içinde db.order`).not.toMatch(/\bdb\.order\b/)
      expect(body, `${f} içinde tx.order`).not.toMatch(/\btx\.order\b/)
      expect(body, `${f} içinde "Order" tablosu`).not.toContain('"Order"')
      expect(body, `${f} içinde orderItem`).not.toContain('orderItem')
    }
  })

  it('ekran da yalnızca ManualOrder okuyor', () => {
    const page = stripComments(read('src/app/yonetim/(panel)/kasa/siparisler/page.tsx'))
    expect(page).toContain('@/server/kasa/orders')
    expect(page).not.toMatch(/\bdb\.order\b/)
    expect(page).not.toContain('@/server/orders')
  })

  it('silme ucu yalnızca ManualOrder siler', () => {
    const body = stripComments(read('src/server/kasa/orders.ts'))
    const deletes = [...body.matchAll(/db\.(\w+)\.delete/g)].map((m) => m[1])
    expect(deletes).toEqual(['manualOrder'])
  })
})

// ===========================================================================
describe('⚠️ finansal bütünlük kuralları veritabanında', () => {
  const sql = read('prisma/migrations/20260831090000_kasa_siparisler/migration.sql')

  it('tahsil edilmiş siparişin tutarı DONAR', () => {
    expect(sql).toContain('kasa_siparis_tutar_dondur')
    expect(sql).toMatch(/BEFORE UPDATE ON "ManualOrder"/)
  })

  it('hareketi olan sipariş SİLİNEMEZ', () => {
    expect(sql).toContain('kasa_siparis_silme_engel')
    expect(sql).toMatch(/BEFORE DELETE ON "ManualOrder"/)
  })

  it('bağlı hareket RESTRICT ile korunuyor — SET NULL DEĞİL', () => {
    /**
     * SET NULL olsaydı hareket silinince `paymentEntryId` boşalır ama
     * `paidAt` dolu kalırdı: sipariş "tahsil edildi" görünür, karşılığında
     * para olmazdı. Paketlerde bu ders zaten alınmıştı.
     */
    expect(sql).toMatch(/"ManualOrder_paymentEntryId_fkey"[\s\S]{0,200}ON DELETE RESTRICT/)
    expect(sql).toMatch(/"ManualOrder_costEntryId_fkey"[\s\S]{0,200}ON DELETE RESTRICT/)
    expect(sql).not.toMatch(/"ManualOrder_\w+_fkey"[\s\S]{0,200}ON DELETE SET NULL/)
  })

  it('paidAt ile paymentEntryId birlikte yaşar', () => {
    expect(sql).toContain('("paidAt" IS NULL) = ("paymentEntryId" IS NULL)')
  })

  it('⚠️ CashEntry donduran fonksiyon HER İKİ tabloyu da görüyor', () => {
    /**
     * Bu, yeni tablo eklenirken sessizce kaçırılabilecek yerdi:
     * `kasa_bagli_hareket_dondur` yalnızca `ServicePackage`e bakıyordu, yani
     * bir SİPARİŞE bağlı hareketin tutarı serbestçe değiştirilebilirdi ve
     * hiçbir hata düşmezdi.
     */
    const fn = /CREATE OR REPLACE FUNCTION "kasa_bagli_hareket_dondur"[\s\S]*?LANGUAGE plpgsql/.exec(
      sql,
    )
    expect(fn, 'fonksiyon yeniden yazılmamış').not.toBeNull()
    expect(fn![0]).toContain('"ServicePackage"')
    expect(fn![0]).toContain('"ManualOrder"')
  })

  it('şema ile veritabanı aynı fikirde: FK RESTRICT', () => {
    // Şema `SetNull` deseydi, `prisma migrate dev` çalıştıran biri kuralı
    // sessizce geri alırdı.
    const schema = read('prisma/schema.prisma')
    const model = /model ManualOrder \{[\s\S]*?\n\}/.exec(schema)
    expect(model).not.toBeNull()
    expect(model![0]).not.toContain('onDelete: SetNull')
    expect(model![0]).toContain('onDelete: Restrict')
  })
})

// ===========================================================================
describe('uçlar SUPERADMIN istiyor', () => {
  it('beş sipariş ucunun hepsi', () => {
    for (const f of [
      'src/app/api/v1/admin/kasa/siparisler/route.ts',
      'src/app/api/v1/admin/kasa/siparisler/[id]/route.ts',
      'src/app/api/v1/admin/kasa/siparisler/[id]/tahsil/route.ts',
      'src/app/api/v1/admin/kasa/siparisler/[id]/maliyet/route.ts',
      'src/app/api/v1/admin/kasa/siparisler/[id]/durum/route.ts',
    ]) {
      expect(read(f), `${f} SUPERADMIN istemiyor`).toContain("minimumRole: 'SUPERADMIN'")
    }
  })
})
