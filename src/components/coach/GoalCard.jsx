import { CheckCircle2, X } from 'lucide-react'
import { canonicalLabel } from '@/lib/resolver'
import { display } from '@/lib/units'
import { currentE1rm, projectGoal } from '@/lib/coach'

export function GoalCard({ goal, sets, unit, onArchive, onRemove, onNext }) {
  const variant = goal.exercise_variants
  const sorted = [...sets].sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at))
  const currentKg = currentE1rm(sorted)
  const achieved = goal.status === 'achieved' || currentKg >= goal.target_kg

  const current = Math.round(display(currentKg, unit))
  const pct = Math.min(100, Math.round((currentKg / goal.target_kg) * 100))

  const lastSet = sorted.at(-1)
  const reached = `Hit at ${lastSet ? `${display(lastSet.weight_kg, unit)} ${unit} × ${lastSet.reps}` : `${current} ${unit}`} — estimated, not a tested single. Test it or set the next target.`

  const projection = achieved
    ? null
    : projectGoal({ currentKg, targetKg: goal.target_kg, history: sorted, weeksObserved: 8 })

  return (
    <div className="rounded-[18px] border border-border bg-card p-[15px]">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[14.5px] font-semibold tracking-[-0.01em]">
            {variant ? canonicalLabel(variant.base) : 'Unknown exercise'}
          </div>
          <div className="mt-[3px] text-[11.5px] text-muted-foreground">
            Target {Math.round(display(goal.target_kg, unit))} {unit} × {goal.target_reps}
          </div>
        </div>
        {!achieved && (
          <button
          onClick={onRemove}
          aria-label={`Remove ${variant ? canonicalLabel(variant.base) : 'this'} goal`}
          className="text-muted-graphic"
        >
            <X className="h-[17px] w-[17px]" />
          </button>
        )}
      </div>

      <div className="my-[13px] mb-2 flex items-end gap-[10px]">
        <div className="font-mono text-[26px] font-medium tracking-[-0.04em]">{current}</div>
        <div className="pb-[5px] text-[11.5px] text-muted-foreground">est. 1RM now</div>
      </div>
      <div className="h-[6px] overflow-hidden rounded-full bg-[#22272B]">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>

      {!achieved && projection && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border p-[10px]">
              <div className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">Linear pace</div>
              <div className="mt-[3px] font-mono text-[13px] font-semibold">
                {projection.projectable ? `${projection.linearWeeks} wk` : 'flat'}
              </div>
            </div>
            <div className="rounded-xl border border-primary/25 bg-primary/[0.05] p-[10px]">
              <div className="text-[9.5px] uppercase tracking-[0.1em] text-primary">Decay-adjusted</div>
              <div className="mt-[3px] font-mono text-[13px] font-semibold">
                {projection.projectable ? `${projection.decayWeeks[0]}–${projection.decayWeeks[1]} wk` : 'stalled'}
              </div>
            </div>
          </div>
          <div className="mt-[9px] text-[11.5px] leading-[1.5] text-muted-foreground">
            {projection.projectable ? projection.caveat : projection.reason}
          </div>
        </>
      )}

      {achieved && (
        <>
          <div className="mt-3 flex items-start gap-[9px] rounded-[13px] border border-primary/30 bg-primary/[0.06] p-3">
            <CheckCircle2 className="mt-[1px] h-[17px] w-[17px] shrink-0 text-primary" />
            <div>
              <div className="text-[13px] font-semibold text-primary">Target reached</div>
              <div className="mt-[3px] text-[11.5px] leading-[1.5] text-muted-foreground">{reached}</div>
            </div>
          </div>
          <div className="mt-[10px] flex gap-2">
            <button
              onClick={onArchive}
              className="flex-1 rounded-[11px] border border-border py-[10px] text-center text-[12.5px] text-muted-foreground"
            >
              Archive
            </button>
            <button
              onClick={onNext}
              className="flex-[2] rounded-[11px] bg-primary py-[10px] text-center text-[12.5px] font-bold text-primary-foreground"
            >
              Set next target
            </button>
          </div>
        </>
      )}
    </div>
  )
}
