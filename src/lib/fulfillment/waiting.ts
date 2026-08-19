/**
 * ⭐ BEKLEME SÜRESİ (Faz 10)
 *
 * Operasyon kuyruğunda her işin ne kadar süredir beklediğini gösterir.
 *
 * ⚠️ "GECİKTİ" DENMEZ.
 *
 * Bir işin geciktiğini söyleyebilmek için önce NE ZAMAN gecikmiş sayılacağını
 * tanımlamak gerekir — yani bir SLA. Medya 333'te tanımlı bir SLA YOKTUR.
 * Tanımı olmayan bir yargıyı ekrana yazmak iki şekilde zarar verir:
 *   • Operatör gerçekte sorun olmayan işleri "geç" sanıp öne alır,
 *   • gerçekten geç kalmış işler, uydurma eşiğin altında kaldığı için normal
 *     görünür.
 *
 * Bu yüzden ekranda YALNIZCA ÖLÇÜLEN SÜRE vardır: "Bekleme: 2s 14dk".
 * Bu bir yargı değil, bir olgudur; yanlış olamaz.
 *
 * SLA sonradan tanımlanabilsin diye mimari hazır bırakılmıştır:
 * `evaluateSla()` bir politika alır ve politika yoksa `unknown` döner.
 * Politika tanımlandığı gün tek yapılacak şey, gerçek eşikleri
 * `SlaPolicy` olarak sağlamaktır — çağıran kod değişmez.
 */

import type { FulfillmentStatus } from '@/lib/enums'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Süreyi Türkçe kısaltmalarla yazar: `2s 14dk`, `3g 5s`, `47dk`, `<1dk`.
 *
 * ⚠️ En fazla İKİ birim gösterilir. "3g 5s 12dk 44sn" okunmaz; operatörün
 * ihtiyacı büyüklük mertebesidir.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  const safe = Math.max(0, Math.floor(ms))

  if (safe < MINUTE) return '<1dk'

  const days = Math.floor(safe / DAY)
  const hours = Math.floor((safe % DAY) / HOUR)
  const minutes = Math.floor((safe % HOUR) / MINUTE)

  if (days > 0) return hours > 0 ? `${days}g ${hours}s` : `${days}g`
  if (hours > 0) return minutes > 0 ? `${hours}s ${minutes}dk` : `${hours}s`
  return `${minutes}dk`
}

/**
 * İşin süre saati durmuş mudur?
 *
 * ⚠️ `REVIEW_REQUIRED` terminal DEĞİLDİR: inceleme bekleyen iş hâlâ bekleyen
 * iştir ve saati işlemeye devam eder. Bu bilinçli bir karardır — incelemeye
 * düşen işin unutulması, kuyrukta bekleyen işin unutulmasından daha kolaydır.
 */
const STOPPED_STATUSES: ReadonlySet<FulfillmentStatus> = new Set<FulfillmentStatus>([
  'COMPLETED',
  'FAILED',
])

export type WaitingKind =
  /** Henüz başlanmamış — kuyrukta bekliyor */
  | 'queued'
  /** Başlamış, sürüyor */
  | 'running'
  /** Süre saati durmuş */
  | 'stopped'

export interface WaitingInfo {
  kind: WaitingKind
  /** Geçen süre (ms). `stopped` ise null. */
  ms: number | null
  /** Ekranda gösterilecek etiket. `stopped` ise null. */
  label: string | null
}

export interface WaitingInput {
  status: FulfillmentStatus
  createdAt: Date | string
  startedAt: Date | string | null
}

function toMillis(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

/**
 * Bekleme bilgisini hesaplar.
 *
 * ⚠️ `now` PARAMETRE OLARAK ALINIR. Modülün içinden `Date.now()` çağırmak,
 * fonksiyonu test edilemez ve sunucu/istemci arasında tutarsız hâle getirirdi.
 *
 * Ölçülen süre:
 *   • başlamamış iş → kuyruğa girdiğinden beri (`createdAt`)
 *   • başlamış iş   → işe başlandığından beri (`startedAt`)
 *
 * İki ayrı ölçüm tek bir sayıya karıştırılmaz: "3 gündür bekliyor" ile
 * "3 gündür üzerinde çalışılıyor" operatör için tamamen farklı iki durumdur.
 */
export function computeWaiting(input: WaitingInput, now: number): WaitingInfo {
  if (STOPPED_STATUSES.has(input.status)) {
    return { kind: 'stopped', ms: null, label: null }
  }

  const running = input.startedAt !== null
  const since = toMillis(running ? input.startedAt! : input.createdAt)
  const ms = Math.max(0, now - since)

  return {
    kind: running ? 'running' : 'queued',
    ms,
    // ⚠️ Yargı yok — yalnızca ölçüm.
    label: `${running ? 'İşlemde' : 'Bekleme'}: ${formatDuration(ms)}`,
  }
}

// ===========================================================================
//  SLA — SONRADAN TANIMLANABİLİR (şu an tanımlı DEĞİL)
// ===========================================================================

/**
 * Bir hizmet/varyant için hedef süreler. Değerler DAKİKA cinsindendir.
 *
 * ⚠️ `null` = "tanımlı değil". Sıfır ile karıştırılmamalıdır.
 */
export interface SlaPolicy {
  /** İlk temas (READY → PROCESSING) hedefi */
  firstResponseMinutes: number | null
  /** Tamamlanma hedefi */
  completionMinutes: number | null
}

/**
 * ⚠️ SİSTEMDE TANIMLI SLA YOKTUR.
 *
 * Bu sabit bilerek "hepsi null"dır ve tek gerçek kaynaktır. Bir gün SLA
 * tanımlanırsa doğru yol, buraya sayı yazmak değil, değerleri veritabanından
 * (ör. `ServiceVariant.slaMinutes`) okuyup `evaluateSla`ya geçirmektir —
 * böylece SLA hizmet bazında ve admin panelinden yönetilebilir olur.
 */
export const NO_SLA: SlaPolicy = {
  firstResponseMinutes: null,
  completionMinutes: null,
}

export type SlaVerdict =
  /** Politika tanımlı değil — hiçbir yargı üretilemez. UI hiçbir şey göstermez. */
  | { status: 'unknown' }
  | { status: 'within'; limitMs: number; remainingMs: number }
  | { status: 'breached'; limitMs: number; overMs: number }

/**
 * Bekleme süresini bir SLA politikasıyla karşılaştırır.
 *
 * ⚠️ Politika yoksa `unknown` döner — VARSAYILAN EŞİK ÜRETMEZ. "Makul bir
 * varsayılan" koymak, tanımlanmamış bir kuralı tanımlanmış gibi göstermektir.
 */
export function evaluateSla(waiting: WaitingInfo, policy: SlaPolicy = NO_SLA): SlaVerdict {
  if (waiting.ms === null) return { status: 'unknown' }

  const limitMinutes =
    waiting.kind === 'queued' ? policy.firstResponseMinutes : policy.completionMinutes

  if (limitMinutes === null || limitMinutes === undefined) return { status: 'unknown' }

  const limitMs = limitMinutes * MINUTE
  return waiting.ms <= limitMs
    ? { status: 'within', limitMs, remainingMs: limitMs - waiting.ms }
    : { status: 'breached', limitMs, overMs: waiting.ms - limitMs }
}
