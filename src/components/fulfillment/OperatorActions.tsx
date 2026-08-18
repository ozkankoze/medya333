'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FieldError, FieldHint, Input, Label } from '@/components/ui/input'
import type { FulfillmentStatus } from '@/lib/enums'

/**
 * OPERATÖR AKSİYONLARI
 *
 * ⚠️ Buradaki hiçbir buton "otomatik" bir şey yapmaz. Her biri bir insanın
 * yaptığı işin KAYDINI oluşturur:
 *   [İşleme Başlat] · [İlerleme Güncelle] · [Tamamla] · [Sorun Bildir]
 *   [Operatör Değiştir] · [Telafi Aç]
 *
 * ⚠️ İlerleme yüzdesi GÖNDERİLMEZ. Sunucu `deliveredQuantity` /
 * `currentMetric` üzerinden kendisi hesaplar (Faz 4 kuralı 14, 16).
 *
 * Butonların görünürlüğü duruma ve role göredir; gerçek yetki kontrolü
 * her zaman sunucuda yapılır.
 */

interface Props {
  fulfillmentId: string
  status: FulfillmentStatus
  canOperate: boolean
  isAdmin: boolean
  measurementMode: string
  currentMetric: number | null
  deliveredQuantity: number
  requestedQuantity: number
  assignedToUserId: string | null
  currentUserId: string
  operators: Array<{ id: string; label: string; role: string }>
  guaranteeActive: boolean
}

export function OperatorActions(props: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function call(path: string, body: unknown, action: string) {
    setBusy(action)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/admin/fulfillments/${props.fulfillmentId}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error?.message ?? 'İşlem tamamlanamadı.')
        return false
      }
      if (json?.metricDecreased) {
        setNotice(
          `Ölçüm ${json.dropAmount} birim geriye düştü. Kayıt alındı; inceleme gerekebilir.`,
        )
      }
      router.refresh()
      return true
    } catch {
      setError('Bağlantı kurulamadı.')
      return false
    } finally {
      setBusy(null)
    }
  }

  const canStart =
    props.canOperate && (props.status === 'READY' || props.status === 'PROCESSING' || props.status === 'REVIEW_REQUIRED')
  const canProgress = props.canOperate && (props.status === 'STARTED' || props.status === 'PARTIAL')
  const canComplete =
    props.canOperate && (props.status === 'STARTED' || props.status === 'PARTIAL' || props.status === 'REVIEW_REQUIRED')
  const canFail = props.canOperate && props.status !== 'COMPLETED' && props.status !== 'FAILED'
  const canReplace = props.canOperate && props.status === 'COMPLETED' && props.guaranteeActive

  return (
    <div className="flex flex-col gap-4">
      {!props.canOperate && (
        <div className="rounded-[--radius-card] border border-warning-600/30 bg-warning-100 p-4 text-small text-warning-700">
          {props.assignedToUserId
            ? 'Bu iş başka bir operatöre atanmış. Yalnızca size atanmış işleri yönetebilirsiniz.'
            : 'Bu iş henüz kimseye atanmamış. İşlem yapmak için önce üzerinize alın.'}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-[--radius-card] border border-danger-600/30 bg-danger-100 p-4 text-small text-danger-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-[--radius-card] border border-warning-600/30 bg-warning-100 p-4 text-small text-warning-700">
          {notice}
        </div>
      )}

      {/* ------------------------------- Atama -------------------------------- */}
      <Panel title="Atama">
        <AssignForm
          operators={props.operators}
          isAdmin={props.isAdmin}
          currentUserId={props.currentUserId}
          assignedToUserId={props.assignedToUserId}
          busy={busy === 'assign'}
          onSubmit={(userId) => call('assign', { userId }, 'assign')}
        />
      </Panel>

      {/* --------------------------- İşleme başlat ---------------------------- */}
      {canStart && (
        <Panel title="İşleme Başlat">
          <StartForm
            needsMetric={props.measurementMode === 'METRIC' && props.currentMetric === null}
            busy={busy === 'start'}
            onSubmit={(initialMetric, note) => call('start', { initialMetric, note }, 'start')}
          />
        </Panel>
      )}

      {/* -------------------------- İlerleme güncelle -------------------------- */}
      {canProgress && (
        <Panel title="İlerleme Güncelle">
          <ProgressForm
            metricMode={props.measurementMode === 'METRIC'}
            currentMetric={props.currentMetric}
            deliveredQuantity={props.deliveredQuantity}
            requestedQuantity={props.requestedQuantity}
            busy={busy === 'progress'}
            onSubmit={(payload) => call('progress', payload, 'progress')}
          />
        </Panel>
      )}

      {/* ------------------------------ Tamamla -------------------------------- */}
      {canComplete && (
        <Panel title="Tamamla">
          <CompleteForm
            delivered={props.deliveredQuantity}
            requested={props.requestedQuantity}
            busy={busy === 'complete'}
            onSubmit={(allowPartial, note) => call('complete', { allowPartial, note }, 'complete')}
          />
        </Panel>
      )}

      {/* ---------------------------- Sorun bildir ----------------------------- */}
      {canFail && (
        <Panel title="Sorun Bildir">
          <ReasonForm
            placeholder="Teknik gerekçe (müşteriye gösterilmez)"
            submitLabel="Sorun Bildir"
            busy={busy === 'fail'}
            onSubmit={(reason) => call('fail', { reason }, 'fail')}
          />
        </Panel>
      )}

      {/* ------------------------------- Telafi -------------------------------- */}
      {canReplace && (
        <Panel title="Telafi Vakası Aç">
          <ReplacementForm
            maxQuantity={props.deliveredQuantity}
            busy={busy === 'replacement'}
            onSubmit={(reason, replacementQuantity, currentMetric) =>
              call('replacement', { reason, replacementQuantity, currentMetric }, 'replacement')
            }
          />
        </Panel>
      )}

      {/* -------------------------------- Notlar ------------------------------- */}
      <Panel title="Not Ekle">
        <NoteForm busy={busy === 'note'} onSubmit={(note, customerVisible) => call('note', { note, customerVisible }, 'note')} />
      </Panel>
    </div>
  )
}

// ---------------------------------------------------------------------------

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[--radius-card] border border-ink-200 bg-white p-5 shadow-[--shadow-card]">
      <h3 className="text-small font-semibold text-ink-800">{title}</h3>
      <div className="mt-3">{children}</div>
    </div>
  )
}

function AssignForm({
  operators,
  isAdmin,
  currentUserId,
  assignedToUserId,
  busy,
  onSubmit,
}: {
  operators: Array<{ id: string; label: string; role: string }>
  isAdmin: boolean
  currentUserId: string
  assignedToUserId: string | null
  busy: boolean
  onSubmit: (userId: string) => void
}) {
  const [userId, setUserId] = useState(assignedToUserId ?? currentUserId)

  // OPERATOR yalnızca kendine alabilir; ADMIN listeden seçer.
  if (!isAdmin) {
    return (
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || assignedToUserId === currentUserId}
        data-testid="assign-self"
        onClick={() => onSubmit(currentUserId)}
      >
        {assignedToUserId === currentUserId ? 'Zaten sizde' : 'Üzerime al'}
      </Button>
    )
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <Label htmlFor="assignee">Operatör</Label>
        <select
          id="assignee"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="mt-1 h-10 w-64 rounded-[--radius-control] border border-ink-200 px-3 text-small"
          data-testid="assign-select"
        >
          {operators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label} ({o.role})
            </option>
          ))}
        </select>
      </div>
      <Button size="sm" disabled={busy} data-testid="assign-submit" onClick={() => onSubmit(userId)}>
        {busy ? 'Atanıyor…' : 'Ata'}
      </Button>
    </div>
  )
}

function StartForm({
  needsMetric,
  busy,
  onSubmit,
}: {
  needsMetric: boolean
  busy: boolean
  onSubmit: (initialMetric: number | null, note: string | null) => void
}) {
  const [metric, setMetric] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)

  return (
    <div className="flex flex-wrap items-end gap-3">
      {needsMetric && (
        <div>
          <Label htmlFor="initial-metric">Hedefin şu anki değeri</Label>
          <Input
            id="initial-metric"
            inputMode="numeric"
            className="mt-1 w-44"
            placeholder="örn. 2340"
            value={metric}
            onChange={(e) => setMetric(e.target.value.replace(/\D/g, ''))}
            data-testid="initial-metric"
          />
          <FieldHint className="mt-1">İşe başlarken ölçülen değer dondurulur.</FieldHint>
        </div>
      )}
      <div className="flex-1 min-w-48">
        <Label htmlFor="start-note">Not (isteğe bağlı)</Label>
        <Input id="start-note" className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <Button
        size="sm"
        disabled={busy}
        data-testid="start-fulfillment"
        onClick={() => {
          if (needsMetric && !metric) {
            setErr('Bu hizmet ölçüme dayalı; başlangıç değerini girin.')
            return
          }
          setErr(null)
          onSubmit(metric ? Number(metric) : null, note.trim() || null)
        }}
      >
        {busy ? 'Başlatılıyor…' : 'İşleme Başlat'}
      </Button>
      {err && <FieldError className="w-full">{err}</FieldError>}
    </div>
  )
}

function ProgressForm({
  metricMode,
  currentMetric,
  deliveredQuantity,
  requestedQuantity,
  busy,
  onSubmit,
}: {
  metricMode: boolean
  currentMetric: number | null
  deliveredQuantity: number
  requestedQuantity: number
  busy: boolean
  onSubmit: (payload: { currentMetric?: number; deliveredQuantity?: number; note?: string }) => void
}) {
  const [metric, setMetric] = useState(currentMetric != null ? String(currentMetric) : '')
  const [delivered, setDelivered] = useState(String(deliveredQuantity))
  const [note, setNote] = useState('')

  return (
    <div className="flex flex-wrap items-end gap-3">
      {metricMode ? (
        <div>
          <Label htmlFor="current-metric">Hedefin güncel değeri</Label>
          <Input
            id="current-metric"
            inputMode="numeric"
            className="mt-1 w-44"
            value={metric}
            onChange={(e) => setMetric(e.target.value.replace(/\D/g, ''))}
            data-testid="current-metric"
          />
        </div>
      ) : (
        <div>
          <Label htmlFor="delivered">Teslim edilen (toplam)</Label>
          <Input
            id="delivered"
            inputMode="numeric"
            className="mt-1 w-44"
            value={delivered}
            onChange={(e) => setDelivered(e.target.value.replace(/\D/g, ''))}
            data-testid="delivered-quantity"
          />
          <FieldHint className="mt-1">En fazla {requestedQuantity}</FieldHint>
        </div>
      )}
      <div className="flex-1 min-w-48">
        <Label htmlFor="progress-note">Not (isteğe bağlı)</Label>
        <Input id="progress-note" className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <Button
        size="sm"
        disabled={busy}
        data-testid="save-progress"
        onClick={() =>
          onSubmit({
            ...(metricMode ? { currentMetric: Number(metric || 0) } : { deliveredQuantity: Number(delivered || 0) }),
            ...(note.trim() ? { note: note.trim() } : {}),
          })
        }
      >
        {busy ? 'Kaydediliyor…' : 'İlerleme Güncelle'}
      </Button>
      {/* ⚠️ Yüzde alanı YOK — sunucu hesaplar. */}
    </div>
  )
}

function CompleteForm({
  delivered,
  requested,
  busy,
  onSubmit,
}: {
  delivered: number
  requested: number
  busy: boolean
  onSubmit: (allowPartial: boolean, note: string | null) => void
}) {
  const [note, setNote] = useState('')
  const [allowPartial, setAllowPartial] = useState(false)
  const incomplete = delivered < requested

  return (
    <div className="flex flex-col gap-3">
      <p className="text-small text-ink-600">
        Teslim: <strong>{delivered}</strong> / {requested}
        {incomplete && ' — eksik teslimle kapatmak için onay kutusunu işaretleyin.'}
      </p>
      {incomplete && (
        <label className="flex items-center gap-2 text-small text-ink-700">
          <input
            type="checkbox"
            checked={allowPartial}
            onChange={(e) => setAllowPartial(e.target.checked)}
            className="size-4"
            data-testid="allow-partial"
          />
          Eksik teslimi kabul ediyorum
        </label>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-48">
          <Label htmlFor="complete-note">Not (isteğe bağlı)</Label>
          <Input id="complete-note" className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button
          size="sm"
          disabled={busy || (incomplete && !allowPartial)}
          data-testid="complete-fulfillment"
          onClick={() => onSubmit(allowPartial, note.trim() || null)}
        >
          {busy ? 'Tamamlanıyor…' : 'Tamamla'}
        </Button>
      </div>
    </div>
  )
}

function ReasonForm({
  placeholder,
  submitLabel,
  busy,
  onSubmit,
}: {
  placeholder: string
  submitLabel: string
  busy: boolean
  onSubmit: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-64">
        <Input placeholder={placeholder} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="fail-reason" />
      </div>
      <Button
        size="sm"
        variant="danger"
        disabled={busy || reason.trim().length < 3}
        data-testid="fail-fulfillment"
        onClick={() => onSubmit(reason.trim())}
      >
        {busy ? 'Kaydediliyor…' : submitLabel}
      </Button>
    </div>
  )
}

function ReplacementForm({
  maxQuantity,
  busy,
  onSubmit,
}: {
  maxQuantity: number
  busy: boolean
  onSubmit: (reason: string, quantity: number, currentMetric: number | null) => void
}) {
  const [reason, setReason] = useState('')
  const [qty, setQty] = useState('')
  const [metric, setMetric] = useState('')

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-48">
        <Label htmlFor="rep-reason">Gerekçe</Label>
        <Input id="rep-reason" className="mt-1" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="rep-qty">Telafi adedi</Label>
        <Input
          id="rep-qty"
          inputMode="numeric"
          className="mt-1 w-36"
          value={qty}
          onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))}
        />
        <FieldHint className="mt-1">En fazla {maxQuantity}</FieldHint>
      </div>
      <div>
        <Label htmlFor="rep-metric">Güncel ölçüm</Label>
        <Input
          id="rep-metric"
          inputMode="numeric"
          className="mt-1 w-36"
          value={metric}
          onChange={(e) => setMetric(e.target.value.replace(/\D/g, ''))}
        />
      </div>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || reason.trim().length < 3 || !qty}
        data-testid="create-replacement"
        onClick={() => onSubmit(reason.trim(), Number(qty), metric ? Number(metric) : null)}
      >
        {busy ? 'Açılıyor…' : 'Telafi Aç'}
      </Button>
    </div>
  )
}

function NoteForm({
  busy,
  onSubmit,
}: {
  busy: boolean
  onSubmit: (note: string, customerVisible: boolean) => void
}) {
  const [note, setNote] = useState('')
  const [customerVisible, setCustomerVisible] = useState(false)

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-64">
        <Input
          placeholder="Örn. İlk 300 adet tamamlandı."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          data-testid="note-text"
        />
      </div>
      <label className="flex h-11 items-center gap-2 text-small text-ink-700">
        <input
          type="checkbox"
          checked={customerVisible}
          onChange={(e) => setCustomerVisible(e.target.checked)}
          className="size-4"
          data-testid="note-customer-visible"
        />
        Müşteriye görünür
      </label>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || note.trim().length === 0}
        data-testid="save-note"
        onClick={() => onSubmit(note.trim(), customerVisible)}
      >
        {busy ? 'Kaydediliyor…' : 'Not Ekle'}
      </Button>
    </div>
  )
}
