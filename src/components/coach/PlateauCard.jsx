import { display } from '@/lib/units'
import { BACKOFF_FACTOR } from '@/lib/coach'

export function PlateauCard({ rec, unit, onDismiss, onAccept }) {
  const load = display(rec.actions.matchedLoadKg, unit)
  const window = `${rec.actions.sessions} matched sessions at ${load} ${unit}`
  const suggestions = [
    `Drop to ${Math.round(load * BACKOFF_FACTOR)} ${unit} for one session, then rebuild`,
    'Add one back-off set at RIR 3 instead of pushing the top set',
    'Re-test in two weeks before changing the movement',
  ]

  return (
    <div className="rounded-[18px] border border-border bg-card p-[15px]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[14.5px] font-semibold tracking-[-0.01em]">{rec.title}</div>
          <div className="mt-[3px] text-[11px] text-muted-foreground">{window}</div>
        </div>
        <div className="shrink-0 rounded-[7px] bg-[#F2B544]/[0.12] px-2 py-1 text-[10px] font-bold tracking-[0.06em] text-[#F2B544]">
          STALLED
        </div>
      </div>
      <div className="mt-[10px] text-[13px] leading-[1.55] text-[#C7CCC6]">{rec.body}</div>
      <div className="mt-[11px] flex flex-col gap-[6px]">
        {suggestions.map((s) => (
          <div key={s} className="flex items-start gap-2 text-[12.5px] leading-[1.45] text-[#C7CCC6]">
            <div className="mt-[6px] h-[5px] w-[5px] shrink-0 rounded-full bg-primary" />
            {s}
          </div>
        ))}
      </div>
      <div className="mt-[13px] flex gap-2">
        <button
          onClick={onDismiss}
          className="flex-1 rounded-[10px] border border-border py-[9px] text-center text-[12px] text-muted-foreground"
        >
          Not now
        </button>
        <button
          onClick={onAccept}
          className="flex-1 rounded-[10px] border border-[#313632] bg-[#1E2220] py-[9px] text-center text-[12px] font-semibold"
        >
          Apply next week
        </button>
      </div>
    </div>
  )
}
