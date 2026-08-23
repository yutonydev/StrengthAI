import { useEffect, useRef, useState } from 'react'
import { CalendarClock, Minus, Plus } from 'lucide-react'
import { Sheet } from '@/components/Sheet'
import { sets as setsApi } from '@/api/db'
import { display, rirToRpe, step, toKg } from '@/lib/units'
import { e1rm } from '@/lib/coach'
import { useHoldRepeat } from '@/hooks/useHoldRepeat'

// RIR is what the lifter enters and what the coach reads; RPE is derived (10 - RIR).
// Asking for both let them contradict each other, so RPE is display-only now.
// Half steps exist only between 1 and 3 — that's the range where "maybe two, maybe
// three" is a real answer. Nobody can judge the difference between 4 and 4.5.
const RIR_SCALE = [
  { rir: 0, label: 'Failure', sub: 'Nothing left in the tank' },
  { rir: 1, label: 'Near failure', sub: 'One more rep, no question' },
  { rir: 1.5, label: 'Near failure', sub: 'Maybe one, maybe two' },
  { rir: 2, label: 'Hard', sub: 'Two more reps' },
  { rir: 2.5, label: 'Hard', sub: 'Maybe two, maybe three' },
  { rir: 3, label: 'Controlled', sub: 'Three more reps' },
  { rir: 4, label: 'Comfortable', sub: 'Four more reps' },
  { rir: 5, label: 'Easy', sub: 'Five or more — a warmup weight' },
]

export function SetLoggerSheet({ open, onOpenChange, variantId, variantName, unit, plan, onSave }) {
  const { start, stop } = useHoldRepeat()
  const [weight, setWeight] = useState('')
  const [reps, setReps] = useState('')
  const [rir, setRir] = useState('')
  const [last, setLast] = useState(null)
  const [best, setBest] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  // A field only shows an error once the lifter has been in it. Screaming red at a form
  // nobody has touched yet is noise, not help.
  const [touched, setTouched] = useState({ weight: false, reps: false })
  const [saving, setSaving] = useState(false)
  // Synchronous double-tap guard. `saving` state alone is not enough: React batches, so a
  // second tap in the same tick still sees the old value. The sheet also stays mounted and
  // clickable through Base UI's ~260ms unmount animation, by which point the parent has
  // already nulled `logVariantId` — that race wrote a null variant_id and lost the set.
  const savingRef = useRef(false)

  useEffect(() => {
    if (!open || !variantId) return
    setWeight('')
    setReps('')
    setRir('')
    setTouched({ weight: false, reps: false })
    setSaving(false)
    savingRef.current = false
    setLast(null)
    setBest(null)
    setHistoryLoading(true)
    let alive = true
    setsApi
      .forVariant(variantId)
      .then((hist) => {
        if (!alive || !hist.length) return
        setLast(hist[hist.length - 1])
        setBest(hist.reduce((a, b) => (e1rm(b.weight_kg, b.reps) > e1rm(a.weight_kg, a.reps) ? b : a)))
      })
      .finally(() => alive && setHistoryLoading(false))
    return () => {
      alive = false
    }
  }, [open, variantId])

  const weightPh = plan ? display(plan.target_load_kg, unit) : best ? display(best.weight_kg, unit) : 0
  const stepAmt = step(unit)
  // `rir` is nullable in the schema, so the clause is appended only when there is one to
  // show. Interpolating it unconditionally rendered the literal text "@ RIR null" for any
  // set logged without one — the same data ExerciseBlock correctly renders as an em dash.
  const logRef = historyLoading
    ? 'Loading history…'
    : last
      ? `last ${display(last.weight_kg, unit)} ${unit} × ${last.reps}${last.rir != null ? ` @ RIR ${last.rir}` : ''}`
      : 'first time logging this'
  // "shown below", not "pre-filled": the plan seeds the PLACEHOLDER only. Saying pre-filled
  // promised the opposite of the guarantee this sheet exists to keep — that nothing is ever
  // entered on the lifter's behalf — and would have read as a bug the first time someone
  // tapped save on what looked like a filled field and got told a weight was missing.
  const logPlan = plan ? `Coach plan: ${Math.round(weightPh)} ${unit} at RIR 3 — shown below.` : null

  const repsPh = best ? best.reps : 0
  const touchReps = () => setTouched((t) => ({ ...t, reps: true }))

  // Every stepper below computes from the setter's own previous value rather than from
  // `weight`/`reps` closed over at render. Under a held button the repeat interval calls
  // the same function object ~11x/sec; reading the render-time value would apply the
  // identical step each time and the number would advance once and then stick.
  const touchWeight = () => setTouched((t) => ({ ...t, weight: true }))
  const weightUp = () => {
    touchWeight()
    setWeight((w) => String((parseFloat(w) || weightPh) + stepAmt))
  }
  const weightDown = () => {
    touchWeight()
    setWeight((w) => String(Math.max(0, (parseFloat(w) || weightPh) - stepAmt)))
  }
  const repsInc = () => {
    touchReps()
    setReps((r) => String(Math.min(100, (parseFloat(r) || repsPh) + 1)))
  }
  const repsDec = () => {
    touchReps()
    setReps((r) => String(Math.max(1, (parseFloat(r) || repsPh) - 1)))
  }

  const rirSel = rir === '' ? null : parseFloat(rir)
  const rirRow = RIR_SCALE.find((r) => r.rir === rirSel)
  const rirHint =
    last?.rir != null
      ? `Last time you logged RIR ${last.rir}`
      : 'How many more reps could you have done?'

  // Everything saved below is entered, never inferred. `best` and `plan` seed the PLACEHOLDER
  // so the lifter can see what they did last time; they never become the saved value. The old
  // version fell back to them — and to a hardcoded RIR of 2 — whenever a field was left blank,
  // so tapping straight through logged a fabricated set at your best-ever weight carrying an
  // effort rating you never gave. That rating is exactly what detectPlateau reads.
  const weightNum = parseFloat(weight)
  const repsNum = parseFloat(reps)
  const weightOk = weight.trim() !== '' && Number.isFinite(weightNum) && weightNum > 0
  const repsOk = reps.trim() !== '' && Number.isFinite(repsNum) && repsNum > 0
  const rirOk = rirSel != null
  const canSave = weightOk && repsOk && rirOk && !historyLoading && !saving

  const missing = [
    !weightOk && 'a weight',
    !repsOk && 'reps',
    !rirOk && 'how hard it was',
  ].filter(Boolean)

  const handleSave = () => {
    // Re-entry guard first, before any state read: a second tap in the same tick would still
    // see the old `saving`, and by then the parent may have nulled the variant id.
    if (savingRef.current || !canSave) return
    savingRef.current = true
    setSaving(true)
    onSave({ weightKg: toKg(weight, unit), reps: repsNum, rir: rirSel, rpe: rirToRpe(rirSel) })
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <div className="px-[18px] pb-6">
        <div className="text-[16px] font-bold tracking-[-0.02em]">{variantName}</div>
        <div className="mt-1 font-mono text-[11.5px] text-muted-foreground">{logRef}</div>
        {logPlan && (
          <div className="mt-[7px] flex items-start gap-[6px] text-[11.5px] leading-[1.45] text-primary">
            <CalendarClock className="mt-[1px] h-[14px] w-[14px] shrink-0" />
            {logPlan}
          </div>
        )}

        <div
          className="mt-4 rounded-2xl border bg-background px-[14px] py-3"
          style={{ borderColor: touched.weight && !weightOk ? '#F2B544' : '#272C29' }}
        >
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Weight</div>
            <div className="text-[11px] uppercase text-muted-foreground">{unit}</div>
          </div>
          <div className="mt-[6px] flex items-center gap-[10px]">
            <button
              onPointerDown={() => start(weightDown)}
              onPointerUp={stop}
              onPointerLeave={stop}
              onPointerCancel={stop}
              className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] border border-border text-muted-foreground"
            >
              <Minus className="h-4 w-4" />
            </button>
            <input
              value={weight}
              onChange={(e) => {
                setTouched((t) => ({ ...t, weight: true }))
                setWeight(e.target.value)
              }}
              type="number"
              disabled={historyLoading}
              placeholder={historyLoading ? '' : String(weightPh)}
              className="min-w-0 flex-1 bg-transparent text-center font-mono text-[30px] tracking-[-0.04em] text-foreground outline-none disabled:opacity-50"
            />
            <button
              onPointerDown={() => start(weightUp)}
              onPointerUp={stop}
              onPointerLeave={stop}
              onPointerCancel={stop}
              className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] border border-border text-muted-foreground"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          className="mt-[9px] flex items-center justify-between gap-3 rounded-2xl border bg-background px-[14px] py-[10px]"
          style={{ borderColor: touched.reps && !repsOk ? '#F2B544' : '#272C29' }}
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Reps</div>
          <div className="flex items-center gap-[6px]">
            <button
              onPointerDown={() => start(repsDec)}
              onPointerUp={stop}
              onPointerLeave={stop}
              onPointerCancel={stop}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-border text-muted-foreground"
            >
              <Minus className="h-[18px] w-[18px]" />
            </button>
            <input
              value={reps}
              onChange={(e) => {
                touchReps()
                setReps(e.target.value)
              }}
              type="number"
              placeholder={String(repsPh)}
              className="w-[58px] bg-transparent text-center font-mono text-[24px] tracking-[-0.03em] text-foreground outline-none"
            />
            <button
              onPointerDown={() => start(repsInc)}
              onPointerUp={stop}
              onPointerLeave={stop}
              onPointerCancel={stop}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-border text-muted-foreground"
            >
              <Plus className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>

        <div className="mt-[9px] rounded-2xl border border-border bg-background px-3 pb-3 pt-[13px]">
          <div className="text-center text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
            Reps in reserve
          </div>
          <div
            className={`mt-[5px] text-center font-mono text-[38px] leading-[1.05] tracking-[-0.05em] ${
              rirSel == null ? 'text-[#3A403B]' : rirSel <= 1 ? 'text-[#F2B544]' : 'text-primary'
            }`}
          >
            {rirSel == null ? '—' : rirSel}
          </div>
          <div className="mt-[2px] text-center text-[13px] font-semibold">{rirRow ? rirRow.label : 'Rate the set'}</div>
          <div className="mt-[2px] text-center text-[11.5px] text-muted-foreground">
            {rirRow ? rirRow.sub : rirHint}
          </div>

          <div className="mt-[11px] flex gap-[3px]">
            {RIR_SCALE.map(({ rir: stop }) => (
              <button
                key={stop}
                onClick={() => setRir(String(stop))}
                className={`flex h-11 min-w-0 flex-1 items-center justify-center rounded-[11px] border font-mono text-[13px] ${
                  stop === rirSel
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-transparent bg-card text-muted-foreground'
                }`}
              >
                {stop}
              </button>
            ))}
          </div>

          <div className="mt-[10px] flex items-center justify-center gap-[6px] border-t border-[#1E2220] pt-[9px]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.11em] text-[#5F665F]">RPE</div>
            <div className="font-mono text-[13px] text-muted-foreground">
              {rirSel == null ? '—' : rirToRpe(rirSel)}
            </div>
          </div>
        </div>

        {/* Says what is still needed rather than what is wrong. A set is three numbers; until
            all three are entered there is nothing honest to save. */}
        {!historyLoading && missing.length > 0 && (
          <div className="mt-[11px] text-center text-[11.5px] leading-[1.45] text-[#F2B544]">
            {missing.length === 1
              ? `Still need ${missing[0]}.`
              : `Still need ${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}.`}
          </div>
        )}

        <div className="mt-[14px] flex gap-2">
          <button
            onClick={() => onOpenChange(false)}
            className="flex-1 rounded-2xl border border-border py-[14px] text-center text-[13px] text-muted-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="flex-[2] rounded-2xl bg-primary py-[14px] text-center text-[14px] font-bold text-primary-foreground disabled:opacity-40"
          >
            Log set
          </button>
        </div>
      </div>
    </Sheet>
  )
}
