import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { AlertDialog } from '@base-ui/react/alert-dialog'
import { ArrowLeft, Minus, Pencil, ShieldOff, Trash2, TrendingDown, TrendingUp, Trophy } from 'lucide-react'
import {
  flags as flagsApi,
  profile as profileApi,
  sessions,
  sets as setsApi,
  variants as variantsApi,
} from '@/api/db'
import { canonicalLabel } from '@/lib/resolver'
import { display, formatVolume } from '@/lib/units'
import { sessionSummary, sessionVolumeKg } from '@/lib/coach'
import { Sheet } from '@/components/Sheet'
import { SetLoggerSheet } from '@/components/workout/SetLoggerSheet'
import { RecordBadge } from '@/components/workout/ExerciseBlock'
import { useVariantMap } from '@/hooks/useVariantMap'
import { ScreenLoading, ErrorBanner } from '@/components/ScreenState'
import { useQuery } from '@/hooks/useQuery'
import { forget, invalidate, qk, setQueryData } from '@/api/queryCache'

const EMPTY = Object.freeze([])

// Today's top set against the last session that trained this lift. States a direction only
// when the comparison is like-for-like (see compareTopSets); otherwise it just shows both.
function LastTime({ lift, setLine }) {
  if (!lift?.top) return null
  if (!lift.lastTop) {
    return <div className="mt-1.5 text-[11.5px] text-muted-foreground">First time logging this lift</div>
  }
  const when = new Date(lift.lastAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const Icon = lift.trend === 'up' ? TrendingUp : lift.trend === 'down' ? TrendingDown : Minus
  const verb =
    lift.trend === 'up' ? 'up from' : lift.trend === 'down' ? 'down from' : lift.trend === 'same' ? 'same as' : 'last time'
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
      {lift.trend && (
        <Icon
          aria-hidden="true"
          className={`h-[13px] w-[13px] shrink-0 ${lift.trend === 'up' ? 'text-primary' : 'text-muted-graphic'}`}
        />
      )}
      <span>
        Top set <span className="font-mono text-foreground">{setLine(lift.top)}</span>, {verb}{' '}
        <span className="font-mono">{setLine(lift.lastTop)}</span> on {when}
      </span>
    </div>
  )
}

export default function SessionDetail() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  // Set by Workout's Finish, so the lifter lands on a summary of what they just did.
  const justFinished = useLocation().state?.finished === true

  const [actionError, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [excludeOpen, setExcludeOpen] = useState(false)
  const [excludeReason, setExcludeReason] = useState('')
  const [excluding, setExcluding] = useState(false)
  const [editingSet, setEditingSet] = useState(null)

  // All cached: reopening a session from Home or the calendar paints on the first frame.
  const setsKey = qk.sessionSets(sessionId)
  const profileQ = useQuery(qk.profile, () => profileApi.get())
  const sessionQ = useQuery(qk.session(sessionId), () => sessions.get(sessionId))
  const setsQ = useQuery(setsKey, () => setsApi.forSession(sessionId))
  const variantsQ = useQuery(qk.variants, () => variantsApi.list())
  const excludedQ = useQuery(qk.excludedFlags, () => flagsApi.byStatus('excluded'))
  // Full history, for records and "last time". Never waited on: the session renders without it.
  const historyQ = useQuery(qk.sets, () => setsApi.all())

  const unit = profileQ.data?.unit ?? 'lb'
  const session = sessionQ.data ?? null
  const sessionSets = setsQ.data ?? EMPTY
  const variantList = variantsQ.data ?? EMPTY
  const excluded = (excludedQ.data ?? EMPTY).some((f) => f.session_id === sessionId)

  const loading =
    profileQ.loading || sessionQ.loading || setsQ.loading || variantsQ.loading || excludedQ.loading
  const error =
    actionError || profileQ.error || sessionQ.error || setsQ.error || variantsQ.error || excludedQ.error

  // the still-in-progress session belongs on /workout
  useEffect(() => {
    if (session?.status === 'active') navigate(`/workout/${session.id}`, { replace: true })
  }, [session, navigate])

  const variantById = useVariantMap(variantList)

  const stats = useMemo(() => {
    if (!session) return []
    const volKg = sessionVolumeKg(sessionSets)
    const durMin = session.ended_at
      ? Math.round((new Date(session.ended_at) - new Date(session.started_at)) / 60000)
      : null
    return [
      { label: 'Sets', value: sessionSets.length },
      { label: 'Volume', value: formatVolume(volKg, unit) },
      { label: 'Time', value: durMin != null ? `${durMin}m` : '—' },
    ]
  }, [session, sessionSets, unit])

  const summary = useMemo(
    () => sessionSummary({ session, sessionSets, allSets: historyQ.data ?? EMPTY }),
    [session, sessionSets, historyQ.data]
  )
  // Until history arrives, "no new bests" and "first time" would be guesses, so say neither.
  const historyReady = historyQ.data !== undefined
  const liftByVariant = useMemo(
    () => new Map(summary.lifts.map((l) => [l.variantId, l])),
    [summary]
  )
  const setLine = (set) => `${display(set.weight_kg, unit)} ${unit} × ${set.reps}`

  const blocks = useMemo(() => {
    const order = session?.exercise_order || []
    return order.map((vid) => {
      const v = variantById.get(vid)
      const varSets = sessionSets
        .filter((s) => s.variant_id === vid)
        .sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at))
      return {
        variantId: vid,
        name: v ? canonicalLabel(v.base) : 'Unknown exercise',
        mods: v && v.mods?.length ? v.mods.join(' · ') : 'standard',
        sets: varSets.map((s, i) => ({
          id: s.id,
          n: i + 1,
          raw: s,
          line: `${display(s.weight_kg, unit)} ${unit} × ${s.reps}${s.rir != null ? ` · RIR ${s.rir}` : ''}`,
        })),
      }
    })
  }, [session, variantById, sessionSets, unit])

  const formattedDate = session
    ? new Date(session.started_at).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : ''

  const handleExclude = async () => {
    setExcluding(true)
    try {
      const flag = await flagsApi.create({
        session_id: sessionId,
        variant_ids: [],
        kind: 'manual_exclusion',
        status: 'excluded',
        is_medical: false,
        exclusion_reason: excludeReason.trim(),
      })
      setQueryData(qk.excludedFlags, (list) => [...list, flag])
      setExcludeOpen(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setExcluding(false)
    }
  }

  // Past sets are corrected in place, then every trend recomputes from the fixed number. The
  // write refreshes `sets`, and this session's key sits under it, so the server copy follows.
  const editSet = async (original, { weightKg, reps, rir, rpe }) => {
    const patch = { weight_kg: weightKg, reps, rir, rpe }
    setError(null)
    setQueryData(setsKey, (list) => list.map((s) => (s.id === original.id ? { ...s, ...patch } : s)))
    try {
      await setsApi.update(original.id, patch)
    } catch (err) {
      setQueryData(setsKey, (list) => list.map((s) => (s.id === original.id ? original : s)))
      setError(err.message)
    }
  }

  const deleteSet = async (original) => {
    setError(null)
    setQueryData(setsKey, (list) => list.filter((s) => s.id !== original.id))
    try {
      await setsApi.remove(original.id)
    } catch (err) {
      // The row is still on the server; re-read rather than guess where it went.
      invalidate(setsKey)
      setError(err.message)
    }
  }

  const handleDelete = async () => {
    setBusy(true)
    try {
      await sessions.remove(sessionId)
      forget(qk.session(sessionId), setsKey)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  if (loading) {
    return <ScreenLoading full />
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <div
        className="sticky z-20 flex items-center gap-3 border-b border-accent bg-background/90 px-[14px] py-[10px] backdrop-blur-md"
        style={{ top: 'var(--safe-top)' }}
      >
        <button
          onClick={() => navigate('/')}
          aria-label="Back to home"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-muted-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-[-0.01em]">{session?.name || 'Workout'}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{formattedDate}</div>
        </div>
      </div>

      <div className="flex flex-col gap-3 px-[18px] pt-[14px] pb-8">
        <ErrorBanner error={error} />

        <div className="grid grid-cols-3 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="rounded-[14px] border border-border bg-card p-[11px]">
              <div className="font-mono text-[18px] font-medium tracking-[-0.02em]">{s.value}</div>
              <div className="mt-1 text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        {(justFinished || summary.records.length > 0) && (
          <div className="rounded-2xl border border-primary/30 bg-primary/[0.06] p-[13px]">
            {justFinished && <div className="text-[15px] font-bold tracking-[-0.01em]">Workout complete</div>}
            {summary.records.length > 0 ? (
              <>
                <div
                  className={`${justFinished ? 'mt-2 ' : ''}text-[10px] font-semibold uppercase tracking-[0.12em] text-primary`}
                >
                  New best{summary.records.length === 1 ? '' : 's'}
                </div>
                <div className="mt-1.5 flex flex-col gap-[6px]">
                  {summary.records.map((r) => (
                    <div key={r.variantId} className="flex items-center gap-2 text-[13px]">
                      <Trophy className="h-[14px] w-[14px] shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {canonicalLabel(variantById.get(r.variantId)?.base || '')}
                      </span>
                      <span className="shrink-0 font-mono text-[12.5px]">{setLine(r.set)}</span>
                      <span className="w-[74px] shrink-0 text-right text-[10.5px] text-muted-foreground">
                        {r.kind === 'weight' ? 'heaviest yet' : 'best est. max'}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              historyReady && (
                <div className="mt-1 text-[12.5px] leading-[1.5] text-muted-foreground">
                  No new bests this time. Every set still counts toward your trends.
                </div>
              )
            )}
          </div>
        )}

        {blocks.map((block) => (
          <div key={block.variantId} className="rounded-2xl border border-border bg-card p-[13px]">
            <div className="text-[14px] font-semibold tracking-[-0.01em]">{block.name}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{block.mods}</div>
            {historyReady && <LastTime lift={liftByVariant.get(block.variantId)} setLine={setLine} />}
            <div className="mt-2">
              {block.sets.map((s) => {
                const record = summary.recordsById.has(s.id)
                return (
                  <button
                    key={s.id}
                    onClick={() => setEditingSet(s.raw)}
                    aria-label={`Edit set ${s.n}: ${s.line}${record ? ', a new best' : ''}`}
                    className="flex w-full items-center justify-between gap-3 border-t border-accent py-[7px] text-left font-mono text-[12.5px]"
                  >
                    <span className="text-muted-foreground">{s.n}</span>
                    <span className="flex items-center gap-2">
                      {record && <RecordBadge />}
                      {s.line}
                      <Pencil className="h-[12px] w-[12px] text-muted-graphic" />
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {session?.notes && (
          <div className="rounded-2xl border border-border bg-card p-[13px]">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Notes
            </div>
            <div className="text-[13px] leading-[1.5] text-[#C7CCC6]">{session.notes}</div>
          </div>
        )}

        {excluded ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-border py-3 text-[13px] text-muted-foreground">
            <ShieldOff className="h-4 w-4" />
            Excluded from trend analysis
          </div>
        ) : (
          <button
            onClick={() => setExcludeOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border py-3 text-[13px] text-muted-foreground"
          >
            <ShieldOff className="h-4 w-4" />
            Exclude from trends
          </button>
        )}

        <SetLoggerSheet
          open={!!editingSet}
          onOpenChange={(v) => !v && setEditingSet(null)}
          variantId={editingSet?.variant_id ?? null}
          variantName={
            editingSet ? canonicalLabel(variantById.get(editingSet.variant_id)?.base || '') : ''
          }
          unit={unit}
          plan={null}
          editing={editingSet}
          onSave={(payload) => editSet(editingSet, payload)}
          onDelete={() => deleteSet(editingSet)}
        />

        <Sheet open={excludeOpen} onOpenChange={setExcludeOpen}>
          <div className="px-[18px] pb-6">
            <div className="text-[16px] font-bold tracking-[-0.02em]">Exclude this session?</div>
            <div className="mt-1 text-[12.5px] leading-[1.5] text-muted-foreground">
              It stays in your history, but won&apos;t count toward plateau or RIR trends. Say why, so future-you
              knows this was situational.
            </div>
            <textarea
              value={excludeReason}
              onChange={(e) => setExcludeReason(e.target.value)}
              placeholder="e.g. slept 4h, flew back Tuesday, felt sick"
              rows={3}
              className="mt-3 w-full resize-none rounded-[14px] border border-border bg-background p-3 text-[13.5px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground/50"
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setExcludeOpen(false)}
                className="flex-1 rounded-2xl border border-border py-[12px] text-center text-[13px] text-muted-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleExclude}
                disabled={excluding || !excludeReason.trim()}
                className="flex-[2] rounded-2xl bg-primary py-[12px] text-center text-[13px] font-bold text-primary-foreground disabled:opacity-60"
              >
                Confirm exclusion
              </button>
            </div>
          </div>
        </Sheet>

        <AlertDialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialog.Trigger className="flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/30 py-3 text-[13px] text-destructive">
            <Trash2 className="h-4 w-4" />
            Delete session
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-black/60" />
            <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[min(90vw,360px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-5 text-foreground">
              <AlertDialog.Title className="text-[16px] font-semibold">Delete this session?</AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-[13.5px] text-muted-foreground">
                All logged sets will be deleted. This can&apos;t be undone.
              </AlertDialog.Description>
              <div className="mt-5 flex gap-2">
                <AlertDialog.Close className="flex-1 rounded-xl border border-border py-[10px] text-[13px] text-muted-foreground">
                  Cancel
                </AlertDialog.Close>
                <button
                  onClick={handleDelete}
                  disabled={busy}
                  className="flex-1 rounded-xl bg-destructive/10 py-[10px] text-[13px] font-semibold text-destructive disabled:opacity-60"
                >
                  Delete
                </button>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
    </div>
  )
}
