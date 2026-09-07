import { useEffect, useMemo, useState } from 'react'
import { Ban, Link2, Loader2, PencilLine, PlusCircle, Sparkles } from 'lucide-react'
import { Sheet } from '@/components/Sheet'
import { suggest, canonicalLabel, findLocal, normalizePhrase } from '@/lib/resolver'
import { suggestNext } from '@/lib/suggestNext'
import { resolveExercise } from '@/api/resolveExercise'
import { sets as setsApi } from '@/api/db'
import { display } from '@/lib/units'

const pluralize = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)

// Shown only when there's no history yet to suggest from. These teach the freeform syntax —
// describe the lift, including the bits that change how it loads — rather than a blank box.
const EXAMPLES = [
  'single arm cuff tricep extension',
  'heel elevated barbell squat',
  'zercher barbell squat',
]

// exercise_variants.resolved_by is 'ai' | 'manual' (migration 004 dropped 'dictionary',
// along with the dictionary itself). A cache hit is an AI answer someone already paid for,
// so it records as 'ai' — the column is about how the movement was worked out, not which
// layer served it this time.
const resolvedByFor = (source) => (source === 'ai' || source === 'cache' ? 'ai' : 'manual')

// Chip styling for the "Trains" row. Primary muscles are accent-tinted because they're what
// the movement is for; secondaries stay quiet so the row reads at a glance.
const muscleChipStyle = (role) =>
  role === 'primary'
    ? { background: 'rgba(168,201,162,.13)', color: '#A8C9A2', borderColor: 'rgba(168,201,162,.3)' }
    : { background: '#1E2220', color: '#9AA39C', borderColor: 'transparent' }

// Joint actions sit above Trains: what the joints do is the objective fact about the
// movement, and it's what accumulates across differently-named lifts.
function JointActionRow({ actions }) {
  if (!actions?.length) return null
  return (
    <div className="mt-[11px]">
      <div className="mb-[6px] text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Joint actions
      </div>
      <div className="flex flex-wrap gap-[5px]">
        {actions.map((a) => (
          <span key={a} className="rounded-[7px] bg-[#1E2220] px-2 py-1 text-[11px] text-[#9AA39C]">
            {a}
          </span>
        ))}
      </div>
    </div>
  )
}

function MuscleRow({ muscles }) {
  if (!muscles?.length) return null
  return (
    <div className="mt-[11px]">
      <div className="mb-[6px] text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Trains
      </div>
      <div className="flex flex-wrap gap-[5px]">
        {muscles.map((m) => (
          <span
            key={`${m.name}-${m.role}`}
            className="rounded-[7px] border px-2 py-1 text-[11px]"
            style={muscleChipStyle(m.role)}
          >
            {m.name}
          </span>
        ))}
      </div>
    </div>
  )
}

function ResolutionCard({ result, variants, unit, submitting, onConfirm, onRetry, onEdit }) {
  // Genuinely not an exercise. The ONLY status that blocks logging.
  if (result.status === 'rejected') {
    return (
      <div
        className="mt-[10px] rounded-[18px] border p-4"
        style={{ borderColor: 'rgba(242,112,92,.3)', background: 'rgba(242,112,92,.05)' }}
      >
        <div className="flex items-center gap-[6px]">
          <Ban className="h-[15px] w-[15px] text-destructive" />
          <div className="text-[10px] font-bold uppercase tracking-[0.13em] text-destructive">
            Not an exercise
          </div>
        </div>
        <div className="mt-[10px] text-[17px] font-bold tracking-[-0.02em]">&quot;{result.raw}&quot;</div>
        <div className="mt-[9px] text-[12.5px] leading-[1.55] text-muted-foreground">{result.reason}</div>
        <button
          onClick={onRetry}
          className="mt-[14px] w-full rounded-[12px] bg-primary py-[11px] text-[13px] font-bold text-primary-foreground"
        >
          Try again
        </button>
      </div>
    )
  }

  // Offline, capped, or out of credit. Never a dead end — the lifter is standing at a rack,
  // so the set still gets logged and the raw phrase becomes a variant that future identical
  // descriptions match into. It can be re-resolved later.
  if (result.status === 'unresolved') {
    const asTyped = normalizePhrase(result.raw)
    return (
      <div
        className="mt-[10px] rounded-[18px] border p-4"
        style={{ borderColor: 'rgba(242,181,68,.35)', background: 'rgba(242,181,68,.05)' }}
      >
        <div className="flex items-center gap-[6px]">
          <PencilLine className="h-[15px] w-[15px] text-[#F2B544]" />
          <div className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#F2B544]">
            Logged as typed
          </div>
        </div>
        <div className="mt-[10px] text-[17px] font-bold tracking-[-0.02em]">{canonicalLabel(asTyped)}</div>
        <div className="mt-[9px] text-[12.5px] leading-[1.55] text-muted-foreground">
          {result.reason} It still gets its own trend line, and it can be re-resolved later.
        </div>
        <div className="mt-[14px] flex gap-2">
          <button
            onClick={onEdit}
            disabled={submitting}
            className="flex-1 rounded-[12px] border border-[#313632] py-[11px] text-[12.5px] font-semibold disabled:opacity-60"
          >
            Edit
          </button>
          <button
            onClick={() =>
              onConfirm({
                base: asTyped,
                mods: [],
                muscle: null,
                muscles: [],
                jointActions: [],
                bodyPart: null,
                sourceText: result.raw,
                resolvedBy: 'manual',
              })
            }
            disabled={submitting}
            className="flex-[2] rounded-[12px] bg-primary py-[11px] text-[13px] font-bold text-primary-foreground disabled:opacity-60"
          >
            Log it as typed
          </button>
        </div>
      </div>
    )
  }

  // ---- known / resolved ------------------------------------------------------------
  const known = result.status === 'known'
  const mods = result.mods ?? []

  // Which trend line this lands on. For `resolved`, the model's tags are the variant's
  // identity — variants.ensure upserts on (user_id, base, mods), so an answer carrying tags
  // the lifter already has continues that line rather than starting one. This is an exact
  // comparison of the model's own output, not a second opinion about what the lift is.
  const sortedMods = [...mods].sort().join('\0')
  const existing = known
    ? result.variant
    : variants.find(
        (v) => v.base === result.base && [...(v.mods || [])].sort().join('\0') === sortedMods
      )

  const accent = known ? '#A8C9A2' : existing ? '#A8C9A2' : '#4C8E96'
  const borderColor = existing ? 'rgba(168,201,162,.3)' : '#272C29'
  const bgColor = existing ? 'rgba(168,201,162,.06)' : '#171A18'
  const statusLabel = known
    ? 'Matched to an existing variant'
    : existing
      ? 'Resolved to a variant you already have'
      : 'New variant'
  const StatusIcon = existing ? Link2 : PlusCircle

  const lowConfidence = result.confidence === 'low'

  let trend
  if (existing) {
    const uses = existing.uses || 0
    const last = result.lastSet
    trend = `Continues the trend line you already have — logged ${pluralize(uses)}${
      last ? `, last at ${display(last.weight_kg, unit)} ${unit} × ${last.reps}` : ''
    }.`
  } else {
    trend =
      'No prior match. Starting a fresh trend line — future sessions with this description will land here automatically.'
  }

  const confirm = () =>
    existing
      ? onConfirm({ variantId: existing.id })
      : onConfirm({
          base: result.base,
          mods,
          muscle: result.muscle,
          muscles: result.muscles ?? [],
          jointActions: result.joint_actions ?? [],
          bodyPart: result.body_part,
          sourceText: result.raw,
          resolvedBy: resolvedByFor(result.source),
          loadNote: result.note || null,
          confidence: result.confidence || null,
        })

  return (
    <div className="mt-[10px] rounded-[18px] border p-4" style={{ borderColor, background: bgColor }}>
      <div className="flex items-center gap-[6px]">
        <StatusIcon className="h-[15px] w-[15px]" style={{ color: accent }} />
        <div className="text-[10px] font-bold uppercase tracking-[0.13em]" style={{ color: accent }}>
          {statusLabel}
        </div>
      </div>
      <div className="mt-[10px] text-[17px] font-bold tracking-[-0.02em]">{canonicalLabel(result.base)}</div>
      {mods.length > 0 && (
        <div className="mt-[9px] flex flex-wrap gap-[5px]">
          {mods.map((c) => (
            <span key={c} className="rounded-[7px] bg-[#1E2220] px-2 py-1 text-[11px] text-[#C7CCC6]">
              {c}
            </span>
          ))}
        </div>
      )}
      <JointActionRow actions={result.joint_actions} />
      <MuscleRow muscles={result.muscles} />
      <div className="mt-[11px] text-[12.5px] leading-[1.55] text-muted-foreground">{trend}</div>
      {lowConfidence && (
        <div className="mt-[8px] flex items-start gap-[7px] text-[11.5px] leading-[1.5] text-[#8A928C]">
          <span className="mt-[1px] shrink-0 text-muted-foreground">?</span>
          The coach worked this one out from the name rather than recognising it — worth a look before you trust
          the note.
        </div>
      )}
      {result.note && (
        <div className="mt-[11px] rounded-[13px] border border-border bg-background p-3">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Why the load will differ
          </div>
          <div className="mt-[5px] text-[12.5px] leading-[1.55] text-[#C7CCC6]">{result.note}</div>
        </div>
      )}
      <button
        onClick={confirm}
        disabled={submitting}
        className="mt-[14px] w-full rounded-[12px] bg-primary py-[11px] text-[13px] font-bold text-primary-foreground disabled:opacity-60"
      >
        Add to workout
      </button>
    </div>
  )
}

export function AddExerciseSheet({
  open,
  onOpenChange,
  variants,
  unit,
  onAdd,
  sessions = [],
  allSets = [],
  templates = [],
  currentOrder = [],
  templateId = null,
}) {
  const [query, setQuery] = useState('')
  const [resolved, setResolved] = useState(null)
  const [resolving, setResolving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResolved(null)
      setResolving(false)
      setError(null)
    }
  }, [open])

  // Ranked once, for every variant not already in the session, each carrying its reason.
  const ranked = useMemo(
    () => suggestNext({ variants, sessions, sets: allSets, templates, currentOrder, templateId }),
    [variants, sessions, allSets, templates, currentOrder, templateId]
  )
  const reasonFor = useMemo(
    () => new Map(ranked.map((r) => [r.variant.id, r.reason])),
    [ranked]
  )

  // Typing switches the ordering to text relevance — `suggest` puts an exact phrase match
  // first, which prediction shouldn't override once they've told you what they want. The
  // reason still rides along, so a row never loses its explanation. Not typing, the
  // predictive order stands on its own.
  const suggestions = useMemo(() => {
    const rows = query.trim()
      ? suggest(query, variants, 8)
          .filter((v) => reasonFor.has(v.id))
          .map((v) => ({ variant: v, reason: reasonFor.get(v.id) }))
      : ranked
    return rows.slice(0, 6)
  }, [query, variants, ranked, reasonFor])

  const suggestTitle = query.trim() ? 'From your history' : 'Up next'

  // Gate 1 only. Free, offline, instant — so it runs on every keystroke. Gates 2 and 3 are
  // deliberately NOT here: resolving as you type would send "heel", "heel el", "heel elev"
  // to the model, and every prefix is a novel phrase that gets cached and billed. They run
  // from runResolve, on Enter or the Resolve button.
  const local = useMemo(() => {
    const text = query.trim()
    if (!text) return null
    const hit = findLocal(text, variants)
    if (!hit) return null
    return {
      status: 'known',
      variant: hit,
      base: hit.base,
      mods: hit.mods ?? [],
      muscles: hit.muscles ?? [],
      muscle: hit.muscle,
      joint_actions: hit.joint_actions ?? [],
      body_part: hit.body_part,
      note: hit.load_note ?? '',
      confidence: 'high',
      source: 'local',
      raw: text,
    }
  }, [query, variants])

  const shown = resolved ?? local
  // Nothing local matched and nothing has been resolved yet — the model hasn't been asked.
  const needsResolve = !resolved && !local && !!query.trim()

  const withLastSet = async (r, variantId) => {
    try {
      const hist = await setsApi.forVariant(variantId)
      r.lastSet = hist.length ? hist[hist.length - 1] : null
    } catch {
      r.lastSet = null
    }
    return r
  }

  const runResolve = async () => {
    const text = query.trim()
    if (!text || resolving) return
    setResolving(true)
    setError(null)
    try {
      const r = await resolveExercise(text, variants)
      if (r.status === 'known' && r.variant) {
        await withLastSet(r, r.variant.id)
      } else if (r.status === 'resolved') {
        // Same exact-tag check the card makes, so the "continues your trend line" copy can
        // show the last set it continues from.
        const sortedMods = [...(r.mods ?? [])].sort().join('\0')
        const hit = variants.find(
          (v) => v.base === r.base && [...(v.mods || [])].sort().join('\0') === sortedMods
        )
        if (hit) await withLastSet(r, hit.id)
      }
      setResolved(r)
    } catch (err) {
      setError(err.message)
    } finally {
      setResolving(false)
    }
  }

  const confirm = async (payload) => {
    setSubmitting(true)
    setError(null)
    try {
      await onAdd(payload)
      onOpenChange(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <div className="px-[18px] pb-2">
        <div className="text-[17px] font-bold tracking-[-0.02em]">What are you doing?</div>
        <div className="mt-1 text-[12.5px] leading-[1.5] text-muted-foreground">
          Describe it the way you&apos;d say it out loud — grip, attachment, stance, tempo. The coach resolves it to
          a trend line.
        </div>
        <div className="mt-[13px] flex items-center gap-[10px] rounded-[15px] border border-border bg-background px-[14px] py-[13px]">
          <Sparkles className="h-[19px] w-[19px] shrink-0 text-primary" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setResolved(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && runResolve()}
            placeholder="single arm cuff tricep extension"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          {needsResolve && (
            <button
              onClick={runResolve}
              disabled={resolving}
              className="flex shrink-0 items-center justify-center rounded-[10px] bg-primary px-3 py-[7px] text-[12.5px] font-bold text-primary-foreground disabled:opacity-60"
            >
              {resolving ? <Loader2 className="h-[15px] w-[15px] animate-spin" /> : 'Resolve'}
            </button>
          )}
        </div>
      </div>

      <div className="px-[18px] pb-6">
        {error && (
          <div className="mt-3 rounded-[13px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
            {error}
          </div>
        )}

        {resolving && (
          <div className="mt-[10px] flex items-center gap-[10px] rounded-[18px] border border-border bg-card p-4">
            <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin text-primary" />
            <div className="text-[12.5px] leading-[1.5] text-muted-foreground">Asking the coach…</div>
          </div>
        )}

        {!resolving && shown && (
          <ResolutionCard
            result={shown}
            variants={variants}
            unit={unit}
            submitting={submitting}
            onConfirm={confirm}
            onRetry={() => {
              setResolved(null)
              setQuery('')
            }}
            onEdit={() => setResolved(null)}
          />
        )}

        {!resolving && needsResolve && (
          <div className="mt-[10px] rounded-[14px] border border-dashed border-border px-[13px] py-3 text-[12px] leading-[1.55] text-muted-foreground">
            You haven&apos;t logged this before. Press Enter, or tap Resolve, and the coach will work it out — that
            only costs a call the first time anyone describes it this way.
          </div>
        )}

        {!resolved && suggestions.length > 0 && (
          <>
            <div className="mt-4 mb-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
              {suggestTitle}
            </div>
            <div className="flex flex-col gap-[7px]">
              {suggestions.map(({ variant: v, reason }) => (
                <button
                  key={v.id}
                  onClick={() => confirm({ variantId: v.id })}
                  disabled={submitting}
                  className="flex items-center gap-[11px] rounded-[14px] border border-border bg-background px-[13px] py-3 text-left disabled:opacity-60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold">{canonicalLabel(v.base)}</div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {(v.mods || []).join(' · ') || 'standard'}
                    </div>
                  </div>
                  {/* The reason replaces the use count: "usually after Bench Press" earns the
                      row its place, where "12×" only ever restated the sort order. */}
                  <div className="max-w-[104px] shrink-0 text-right text-[10.5px] leading-[1.35] text-[#7F8A80]">
                    {reason}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {!resolved && suggestions.length === 0 && !query.trim() && (
          <div className="mt-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
              Try something like
            </div>
            <div className="flex flex-col gap-[7px]">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setQuery(ex)}
                  className="rounded-[14px] border border-dashed border-border px-[13px] py-3 text-left text-[13px] text-muted-foreground"
                >
                  &quot;{ex}&quot;
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}
