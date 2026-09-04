import { useEffect, useState } from 'react'
import { Sheet } from '@/components/Sheet'
import { canonicalLabel } from '@/lib/resolver'
import { toKg } from '@/lib/units'

export function GoalSheet({ open, onOpenChange, variants, unit, initial, onSave }) {
  const [variantId, setVariantId] = useState(null)
  const [target, setTarget] = useState('')
  const [reps, setReps] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setVariantId(initial?.variantId ?? null)
    setTarget(initial?.target ?? '')
    setReps(initial?.reps ?? '')
    setError(null)
  }, [open, initial])

  const handleSave = async () => {
    if (!variantId || !target) return
    setSubmitting(true)
    setError(null)
    try {
      await onSave({
        variantId,
        targetKg: toKg(target, unit),
        reps: parseFloat(reps) || 5,
      })
      onOpenChange(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <div className="px-[18px] pb-6">
        <div className="text-[16px] font-bold tracking-[-0.02em]">New strength goal</div>

        <div className="mt-4 mb-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
          Lift
        </div>
        {/* The picker now offers the whole registry, so this only fires on a brand-new
            account with nothing in it at all. Without it the sheet showed a "Lift" heading
            above nothing, with no way to tell whether that was a bug or a missing step. */}
        {variants.length === 0 && (
          <div className="rounded-[14px] border border-dashed border-border px-[13px] py-[14px] text-[12.5px] leading-[1.5] text-muted-foreground">
            No exercises yet. Describe one in a workout first — then you can set a target for it.
          </div>
        )}
        <div className="flex flex-wrap gap-[6px]">
          {variants.map((v) => {
            const isSel = v.id === variantId
            return (
              <button
                key={v.id}
                onClick={() => setVariantId(v.id)}
                className="rounded-full px-[11px] py-[7px] text-[12px]"
                style={{
                  border: `1px solid ${isSel ? 'rgba(168,201,162,.5)' : '#272C29'}`,
                  background: isSel ? 'rgba(168,201,162,.1)' : 'transparent',
                  color: isSel ? '#A8C9A2' : '#8A928C',
                }}
              >
                {canonicalLabel(v.base)}
              </button>
            )
          })}
        </div>

        <div className="mt-[14px] grid grid-cols-2 gap-2">
          <div className="rounded-[14px] border border-border bg-background px-[13px] py-[11px]">
            <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Target ({unit})</div>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              type="number"
              placeholder="225"
              className="mt-[3px] w-full bg-transparent font-mono text-[19px] text-foreground outline-none"
            />
          </div>
          <div className="rounded-[14px] border border-border bg-background px-[13px] py-[11px]">
            <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Reps</div>
            <input
              value={reps}
              onChange={(e) => setReps(e.target.value)}
              type="number"
              placeholder="5"
              className="mt-[3px] w-full bg-transparent font-mono text-[19px] text-foreground outline-none"
            />
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-[13px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
            {error}
          </div>
        )}

        {/* SetLoggerSheet and the exclude-session sheet both offer an explicit way out; this
            one did not, so a sheet you could not act in was also a sheet with no visible
            escape. Backdrop and Escape always worked — the affordance was the missing part. */}
        <div className="mt-[14px] flex gap-2">
          <button
            onClick={() => onOpenChange(false)}
            className="flex-1 rounded-[14px] border border-border py-[14px] text-center text-[13px] text-muted-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={submitting || !variantId || !target}
            className="flex-[2] rounded-[14px] bg-primary py-[14px] text-center text-[14px] font-bold text-primary-foreground disabled:opacity-60"
          >
            Track this goal
          </button>
        </div>
      </div>
    </Sheet>
  )
}
