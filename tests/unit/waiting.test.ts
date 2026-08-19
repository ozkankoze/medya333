/**
 * BEKLEME SÜRESİ — birim testleri (Faz 10)
 *
 * Kanıtlanan iki şey:
 *   1. Süre doğru ölçülür ve okunabilir biçimde yazılır.
 *   2. Tanımlı SLA olmadan HİÇBİR yargı üretilmez — "gecikti" yok.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  NO_SLA,
  computeWaiting,
  evaluateSla,
  formatDuration,
  type SlaPolicy,
} from '@/lib/fulfillment/waiting'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = new Date('2026-08-19T12:00:00.000Z').getTime()

describe('süre biçimlendirme', () => {
  it('bir dakikanın altı "<1dk"', () => {
    expect(formatDuration(0)).toBe('<1dk')
    expect(formatDuration(59_999)).toBe('<1dk')
  })

  it('dakika · saat · gün', () => {
    expect(formatDuration(MINUTE)).toBe('1dk')
    expect(formatDuration(47 * MINUTE)).toBe('47dk')
    expect(formatDuration(2 * HOUR + 14 * MINUTE)).toBe('2s 14dk')
    expect(formatDuration(3 * HOUR)).toBe('3s')
    expect(formatDuration(3 * DAY + 5 * HOUR)).toBe('3g 5s')
    expect(formatDuration(2 * DAY)).toBe('2g')
  })

  it('en fazla İKİ birim gösterilir', () => {
    // 3g 5s 12dk 44sn → "3g 5s"
    expect(formatDuration(3 * DAY + 5 * HOUR + 12 * MINUTE + 44_000)).toBe('3g 5s')
  })

  it('negatif ve geçersiz değerler kırmaz', () => {
    expect(formatDuration(-1)).toBe('<1dk')
    expect(formatDuration(Number.NaN)).toBe('—')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—')
  })
})

describe('bekleme hesabı', () => {
  it('başlamamış iş: kuyruğa girdiğinden beri ölçülür', () => {
    const w = computeWaiting(
      {
        status: 'READY',
        createdAt: new Date(NOW - (2 * HOUR + 14 * MINUTE)),
        startedAt: null,
      },
      NOW,
    )
    expect(w.kind).toBe('queued')
    expect(w.label).toBe('Bekleme: 2s 14dk')
  })

  it('başlamış iş: işe başlandığından beri ölçülür', () => {
    const w = computeWaiting(
      {
        status: 'STARTED',
        // 3 gün önce oluşturulmuş ama 45 dakika önce başlanmış
        createdAt: new Date(NOW - 3 * DAY),
        startedAt: new Date(NOW - 45 * MINUTE),
      },
      NOW,
    )
    expect(w.kind).toBe('running')
    expect(w.label).toBe('İşlemde: 45dk')
    // ⚠️ "3 gündür bekliyor" ile "45dk'dır çalışılıyor" karıştırılmaz.
    expect(w.ms).toBe(45 * MINUTE)
  })

  it('tamamlanan/başarısız işte süre saati durur', () => {
    for (const status of ['COMPLETED', 'FAILED'] as const) {
      const w = computeWaiting(
        { status, createdAt: new Date(NOW - DAY), startedAt: new Date(NOW - DAY) },
        NOW,
      )
      expect(w.kind).toBe('stopped')
      expect(w.ms).toBeNull()
      expect(w.label).toBeNull()
    }
  })

  it('⚠️ REVIEW_REQUIRED saati DURDURMAZ — incelemede unutulan iş görünür kalır', () => {
    const w = computeWaiting(
      { status: 'REVIEW_REQUIRED', createdAt: new Date(NOW - 5 * HOUR), startedAt: null },
      NOW,
    )
    expect(w.kind).toBe('queued')
    expect(w.ms).toBe(5 * HOUR)
  })

  it('ISO string girdi de kabul edilir', () => {
    const w = computeWaiting(
      { status: 'READY', createdAt: new Date(NOW - HOUR).toISOString(), startedAt: null },
      NOW,
    )
    expect(w.ms).toBe(HOUR)
  })

  it('gelecekteki tarih negatif süre üretmez', () => {
    const w = computeWaiting(
      { status: 'READY', createdAt: new Date(NOW + HOUR), startedAt: null },
      NOW,
    )
    expect(w.ms).toBe(0)
  })
})

describe('⭐ SLA — tanımlı değil, uydurulmaz', () => {
  it('varsayılan politika tamamen null', () => {
    expect(NO_SLA.firstResponseMinutes).toBeNull()
    expect(NO_SLA.completionMinutes).toBeNull()
  })

  it('⚠️ politika yoksa yargı "unknown" — varsayılan eşik ÜRETİLMEZ', () => {
    const w = computeWaiting(
      { status: 'READY', createdAt: new Date(NOW - 30 * DAY), startedAt: null },
      NOW,
    )
    // 30 GÜN beklemiş bir iş bile, tanım olmadan "gecikmiş" sayılmaz.
    expect(evaluateSla(w).status).toBe('unknown')
    expect(evaluateSla(w, NO_SLA).status).toBe('unknown')
  })

  it('politika tanımlanınca mimari çalışır — within', () => {
    const policy: SlaPolicy = { firstResponseMinutes: 120, completionMinutes: 1440 }
    const w = computeWaiting(
      { status: 'READY', createdAt: new Date(NOW - 30 * MINUTE), startedAt: null },
      NOW,
    )
    const v = evaluateSla(w, policy)
    expect(v.status).toBe('within')
    if (v.status !== 'within') throw new Error('unreachable')
    expect(v.remainingMs).toBe(90 * MINUTE)
  })

  it('politika tanımlanınca mimari çalışır — breached', () => {
    const policy: SlaPolicy = { firstResponseMinutes: 120, completionMinutes: 1440 }
    const w = computeWaiting(
      { status: 'READY', createdAt: new Date(NOW - 3 * HOUR), startedAt: null },
      NOW,
    )
    const v = evaluateSla(w, policy)
    expect(v.status).toBe('breached')
    if (v.status !== 'breached') throw new Error('unreachable')
    expect(v.overMs).toBe(HOUR)
  })

  it('başlamış iş completion eşiğiyle, başlamamış iş firstResponse eşiğiyle ölçülür', () => {
    const policy: SlaPolicy = { firstResponseMinutes: 60, completionMinutes: 10_000 }
    const running = computeWaiting(
      { status: 'STARTED', createdAt: new Date(NOW - 10 * DAY), startedAt: new Date(NOW - 2 * HOUR) },
      NOW,
    )
    // 2 saat çalışılıyor: completion eşiği (10.000dk) çok uzak → within
    expect(evaluateSla(running, policy).status).toBe('within')

    const queued = computeWaiting(
      { status: 'READY', createdAt: new Date(NOW - 2 * HOUR), startedAt: null },
      NOW,
    )
    // 2 saat bekliyor: firstResponse eşiği 60dk → breached
    expect(evaluateSla(queued, policy).status).toBe('breached')
  })

  it('duran işte SLA değerlendirilmez', () => {
    const w = computeWaiting(
      { status: 'COMPLETED', createdAt: new Date(NOW - DAY), startedAt: new Date(NOW - DAY) },
      NOW,
    )
    expect(evaluateSla(w, { firstResponseMinutes: 1, completionMinutes: 1 }).status).toBe('unknown')
  })
})

describe('⚠️ "gecikti" hiçbir yerde yazmıyor', () => {
  const ROOT = path.resolve(__dirname, '../..')
  const FILES = [
    'src/lib/fulfillment/waiting.ts',
    'src/server/fulfillment/queue.ts',
    'src/app/yonetim/fulfillment/page.tsx',
    'src/app/yonetim/fulfillment/[id]/page.tsx',
  ]

  /** Yorumlar çıkarılır: açıklamalar tam olarak yasakladığımız kelimeyi anlatır. */
  const stripComments = (body: string) =>
    body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

  const FORBIDDEN = ['gecikti', 'gecikme', 'geç kaldı', 'gecikmiş', 'overdue', 'delayed', 'late']

  it('operasyon ekranlarında gecikme YARGISI yok', () => {
    for (const file of FILES) {
      const body = stripComments(readFileSync(path.join(ROOT, file), 'utf8')).toLowerCase()
      for (const word of FORBIDDEN) {
        expect(body, `${file} içinde "${word}" geçiyor`).not.toContain(word)
      }
    }
  })

  it('üretilen etiket yalnızca "Bekleme:" veya "İşlemde:" ile başlar', () => {
    for (const status of ['READY', 'PROCESSING', 'STARTED', 'PARTIAL', 'REVIEW_REQUIRED'] as const) {
      for (const started of [null, new Date(NOW - HOUR)]) {
        const w = computeWaiting({ status, createdAt: new Date(NOW - DAY), startedAt: started }, NOW)
        expect(w.label).toMatch(/^(Bekleme|İşlemde): /)
      }
    }
  })
})
