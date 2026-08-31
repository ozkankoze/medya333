import { describe, expect, it } from 'vitest'

/**
 * ⭐ KASA HESAP MANTIĞI
 *
 * ⚠️ Bu testler bir rapor ekranını değil, PARANIN KENDİSİNİ koruyor.
 * Buradaki bir hata sessizdir: ekran bir sayı gösterir, kimse hata almaz,
 * ve yanlışlık ancak bankayla mutabakat tutmayınca — genelde aylar sonra —
 * fark edilir. Bu yüzden testler "fonksiyon çalışıyor mu" değil, "hangi
 * rakamın neyi ifade ettiği" sözleşmesini kilitliyor.
 */
import {
  accountBalance,
  balancesByAccount,
  profitOf,
  tlToUsdMinor,
  weekOfMonth,
  weeklyBuckets,
  type CashMovement,
} from '@/lib/kasa/calc'

const ACC = { id: 'vakif', openingBalanceMinor: 0 }

function mv(p: Partial<CashMovement> & Pick<CashMovement, 'direction' | 'category' | 'amountMinor'>): CashMovement {
  return {
    accountId: 'vakif',
    occurredAt: new Date('2026-08-10T00:00:00Z'),
    costMinor: null,
    ...p,
  }
}

// ===========================================================================
describe('bakiye', () => {
  it('giren artırır, çıkan azaltır', () => {
    const b = accountBalance(ACC, [
      mv({ direction: 'IN', category: 'SATIS', amountMinor: 110_000 }),
      mv({ direction: 'OUT', category: 'GIDER', amountMinor: 30_000 }),
    ])
    expect(b).toBe(80_000)
  })

  /**
   * ⚠️ AÇILIŞ BAKİYESİ HAREKET DEĞİLDİR.
   * Sisteme geçmeden önceki para, sahte bir "giriş" satırı olarak
   * yazılsaydı ciro raporunu şişirirdi — hiç yapılmamış bir satış gibi
   * görünürdü. Ayrı alanda durur ve yalnızca bakiyeye eklenir.
   */
  it('⚠️ açılış bakiyesi toplama eklenir ama ciroya girmez', () => {
    const acc = { id: 'vakif', openingBalanceMinor: 500_000 }
    const entries = [mv({ direction: 'IN', category: 'SATIS', amountMinor: 110_000 })]
    expect(accountBalance(acc, entries)).toBe(610_000)
    // Aynı hareketlerin cirosu açılıştan etkilenmez:
    expect(profitOf(entries).revenueMinor).toBe(110_000)
  })

  /**
   * ⚠️ BAŞKA HESABIN HAREKETİ SESSİZCE TOPLANMAZ.
   * Yanlış hesabın parasını toplamak, iki hesabın da bakiyesini bozar ve
   * hiçbir yerde iz bırakmaz. Gürültüyle patlamak, sessizce yanlış
   * olmaktan iyidir.
   */
  it('⚠️ yabancı hesabın hareketi HATA fırlatır', () => {
    expect(() =>
      accountBalance(ACC, [
        mv({ accountId: 'akbank', direction: 'IN', category: 'SATIS', amountMinor: 1 }),
      ]),
    ).toThrow(/ait olmayan hareket/)
  })

  it('⚠️ tanımsız hesabın hareketi SESSİZCE YUTULMAZ', () => {
    expect(() =>
      balancesByAccount([ACC], [mv({ accountId: 'yok', direction: 'IN', category: 'SATIS', amountMinor: 1 })]),
    ).toThrow(/tanımsız hesap/)
  })

  it('birden çok hesap ayrı ayrı toplanır', () => {
    const accounts = [
      { id: 'vakif', openingBalanceMinor: 10_000 },
      { id: 'akbank', openingBalanceMinor: 0 },
    ]
    const m = balancesByAccount(accounts, [
      mv({ direction: 'IN', category: 'SATIS', amountMinor: 50_000 }),
      mv({ accountId: 'akbank', direction: 'IN', category: 'SATIS', amountMinor: 20_000 }),
      mv({ accountId: 'akbank', direction: 'OUT', category: 'GIDER', amountMinor: 5_000 }),
    ])
    expect(m.get('vakif')).toBe(60_000)
    expect(m.get('akbank')).toBe(15_000)
  })
})

// ===========================================================================
describe('kâr', () => {
  it('net kâr = satış − maliyet − gider', () => {
    const p = profitOf([
      mv({ direction: 'IN', category: 'SATIS', amountMinor: 110_000, costMinor: 40_000 }),
      mv({ direction: 'OUT', category: 'GIDER', amountMinor: 10_000 }),
    ])
    expect(p.revenueMinor).toBe(110_000)
    expect(p.costOfSalesMinor).toBe(40_000)
    expect(p.expenseMinor).toBe(10_000)
    expect(p.netMinor).toBe(60_000)
  })

  /**
   * ⚠️ ALACAK TAHSİLİ CİRO DEĞİLDİR.
   * Satış zaten yapıldığında ciroya yazıldı; parasının gelmesini ikinci kez
   * ciro saymak aynı işi çift saymaktır. Bakiyeyi artırır, kârı artırmaz.
   */
  it('⚠️ TAHSILAT bakiyeyi artırır ama ciroya GİRMEZ', () => {
    const entries = [mv({ direction: 'IN', category: 'TAHSILAT', amountMinor: 520_000 })]
    expect(accountBalance(ACC, entries)).toBe(520_000)
    const p = profitOf(entries)
    expect(p.revenueMinor).toBe(0)
    expect(p.netMinor).toBe(0)
  })

  /**
   * ⚠️ KENDİ HESAPLARIN ARASINDAKİ TRANSFER NE GELİR NE GİDERDİR.
   * Ciroya yazılsaydı, parayı bir hesaptan diğerine taşıyarak istediğin
   * kadar "ciro" üretebilirdin.
   */
  it('⚠️ TRANSFER hiçbir kâr kalemine girmez, yalnız bakiye taşır', () => {
    const entries: CashMovement[] = [
      mv({ direction: 'OUT', category: 'TRANSFER_OUT', amountMinor: 100_000 }),
      mv({ accountId: 'akbank', direction: 'IN', category: 'TRANSFER_IN', amountMinor: 100_000 }),
    ]
    const p = profitOf(entries)
    expect(p.revenueMinor).toBe(0)
    expect(p.expenseMinor).toBe(0)
    expect(p.netMinor).toBe(0)

    // Toplam servet değişmemeli: biri azalır, diğeri artar.
    const m = balancesByAccount(
      [{ id: 'vakif', openingBalanceMinor: 100_000 }, { id: 'akbank', openingBalanceMinor: 0 }],
      entries,
    )
    expect(m.get('vakif')! + m.get('akbank')!).toBe(100_000)
  })

  it('⚠️ BAKİYE İLE KÂR AYNI SAYI DEĞİLDİR', () => {
    // Kredi taksiti ödendi: banka azaldı, ama bu satış zararı değil.
    const entries = [
      mv({ direction: 'IN', category: 'SATIS', amountMinor: 100_000, costMinor: 30_000 }),
      mv({ direction: 'OUT', category: 'BORC_ODEME', amountMinor: 90_000 }),
    ]
    expect(accountBalance(ACC, entries)).toBe(10_000) // kasada kalan
    expect(profitOf(entries).revenueMinor).toBe(100_000) // ciro etkilenmedi
  })

  it('maliyeti girilmemiş satış kârı düşürmez (null güvenli)', () => {
    const p = profitOf([mv({ direction: 'IN', category: 'SATIS', amountMinor: 100_000 })])
    expect(p.costOfSalesMinor).toBe(0)
    expect(p.netMinor).toBe(100_000)
  })
})

// ===========================================================================
describe('haftalık dağılım', () => {
  /**
   * ⚠️ HAFTA AYIN GÜNÜNE GÖRE HESAPLANIR, ISO HAFTA NUMARASINA GÖRE DEĞİL.
   * ISO kullanılsaydı ayın 1'i bazı aylarda "5. hafta"ya düşerdi.
   */
  it.each([
    [1, 1], [7, 1],
    [8, 2], [14, 2],
    [15, 3], [21, 3],
    [22, 4], [28, 4],
    [29, 5], [31, 5],
  ])('ayın %i. günü → %i. hafta', (day, week) => {
    expect(weekOfMonth(new Date(Date.UTC(2026, 7, day)))).toBe(week)
  })

  it('her ay TAM 5 kova üretir — şubatta 5. kova boş kalır', () => {
    const b = weeklyBuckets([])
    expect(b).toHaveLength(5)
    expect(b.map((x) => x.week)).toEqual([1, 2, 3, 4, 5])
  })

  it('satışlar doğru haftaya düşer', () => {
    const b = weeklyBuckets([
      mv({ occurredAt: new Date(Date.UTC(2026, 7, 10)), direction: 'IN', category: 'SATIS', amountMinor: 110_000 }),
      mv({ occurredAt: new Date(Date.UTC(2026, 7, 25)), direction: 'IN', category: 'SATIS', amountMinor: 50_000 }),
    ])
    expect(b[1]!.revenueMinor).toBe(110_000) // 2. hafta
    expect(b[3]!.revenueMinor).toBe(50_000) // 4. hafta
    expect(b[0]!.revenueMinor).toBe(0)
  })

  it('gider ilgili haftanın netini düşürür', () => {
    const b = weeklyBuckets([
      mv({ occurredAt: new Date(Date.UTC(2026, 7, 3)), direction: 'IN', category: 'SATIS', amountMinor: 100_000, costMinor: 20_000 }),
      mv({ occurredAt: new Date(Date.UTC(2026, 7, 3)), direction: 'OUT', category: 'GIDER', amountMinor: 30_000 }),
    ])
    expect(b[0]!.revenueMinor).toBe(100_000)
    expect(b[0]!.netMinor).toBe(50_000)
  })
})

// ===========================================================================
describe('dolar çevrimi', () => {
  /**
   * Tablodaki gerçek satır: 1.100,00 ₺ → $25,30.
   * Bu, kurun ~43,48 olduğu anlamına gelir.
   */
  it('tablodaki gerçek değeri üretir', () => {
    expect(tlToUsdMinor(110_000, 4348)).toBe(2530)
  })

  /**
   * ⚠️ KUR TANIMSIZSA SIFIR DEĞİL, `null`.
   * "$0,00" göstermek "hiç kazanmadın" demektir; doğrusu "kur girilmemiş".
   * İkisini aynı ekranda ayırt edememek yanlış karar aldırır.
   */
  it('⚠️ kur yoksa SIFIR DEĞİL null döner', () => {
    expect(tlToUsdMinor(110_000, 0)).toBeNull()
    expect(tlToUsdMinor(110_000, -5)).toBeNull()
    expect(tlToUsdMinor(110_000, Number.NaN)).toBeNull()
  })

  it('yarım sent yukarı yuvarlanır', () => {
    // 1 ₺ / 3 → 0,3333 $ → 33 sent
    expect(tlToUsdMinor(100, 300)).toBe(33)
  })

  it('sıfır tutar sıfır dolar', () => {
    expect(tlToUsdMinor(0, 4348)).toBe(0)
  })
})
