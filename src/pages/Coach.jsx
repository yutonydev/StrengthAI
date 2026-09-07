import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, Loader2, Network, Plus, Radar } from 'lucide-react'
import {
  flags as flagsApi,
  goals as goalsApi,
  plans as plansApi,
  profile as profileApi,
  readiness as readinessApi,
  recommendations as recommendationsApi,
  reports as reportsApi,
  sessions,
  sets as setsApi,
  variants as variantsApi,
} from '@/api/db'
import { canonicalLabel } from '@/lib/resolver'
import { display } from '@/lib/units'
import {
  BACKOFF_FACTOR,
  currentE1rm,
  detectPlateau,
  detectProgramPattern,
  matchedRirSeries,
  sessionVolumeKg,
  weekRange,
} from '@/lib/coach'
import { PlateauCard } from '@/components/coach/PlateauCard'
import { GoalCard } from '@/components/coach/GoalCard'
import { GoalSheet } from '@/components/coach/GoalSheet'
import { useVariantMap } from '@/hooks/useVariantMap'
import { useQuery } from '@/hooks/useQuery'
import { fetchQuery, qk } from '@/api/queryCache'
import { ScreenLoading, ErrorBanner } from '@/components/ScreenState'

// Stable identity for the not-yet-loaded case, so `?? EMPTY` doesn't hand the memos
// below a brand-new array on every render.
const EMPTY = Object.freeze([])

const PROGRAM_ACTION =
  'Take a deload week — same movements, 60% of your usual sets, top sets at RIR 4 — then re-test the lifts above before changing programming.'

export default function Coach() {
  // The six shared reads go through the query cache, like Home and Progress. This screen
  // used to fetch all of them itself and gate on a full-screen "Loading…" every single
  // mount — the exact behaviour the cache was built to remove, on the one screen that
  // still had it. A revisit now renders from cache on the first frame.
  const profileQ = useQuery(qk.profile, () => profileApi.get())
  const sessionsQ = useQuery(qk.sessions, () => sessions.list())
  const setsQ = useQuery(qk.sets, () => setsApi.all())
  const variantsQ = useQuery(qk.variants, () => variantsApi.list())
  const readinessQ = useQuery(qk.readiness, () => readinessApi.list())
  const excludedQ = useQuery(qk.excludedFlags, () => flagsApi.byStatus('excluded'))

  const unit = profileQ.data?.unit ?? 'lb'
  const variantList = variantsQ.data ?? EMPTY
  const allSets = setsQ.data ?? EMPTY

  const loading =
    profileQ.loading || sessionsQ.loading || setsQ.loading || variantsQ.loading ||
    readinessQ.loading || excludedQ.loading

  const [actionError, setActionError] = useState(null)
  const error =
    actionError || profileQ.error || sessionsQ.error || setsQ.error || variantsQ.error ||
    readinessQ.error || excludedQ.error
  const setError = setActionError

  // Detection output — not cached keys, so these stay local.
  const [recommendationsList, setRecommendationsList] = useState([])
  const [openPlans, setOpenPlans] = useState([])
  const [scanning, setScanning] = useState(false)
  // Whether a detection pass has finished at least once. The screen now paints from cache
  // before detection completes, so without this the plateau and goal lists render their
  // empty states — "No stalled lifts right now", "No strength goals yet" — while the pass
  // that would populate them is still running. Both are claims, and both would be false.
  const [scanned, setScanned] = useState(false)
  const [scanMsg, setScanMsg] = useState(null)
  const [goalsList, setGoalsList] = useState([])
  const [goalSheetOpen, setGoalSheetOpen] = useState(false)
  const [goalSheetInitial, setGoalSheetInitial] = useState(null)
  const [reportsList, setReportsList] = useState([])
  // guards against overlapping runs — StrictMode's double effect-invoke (and a fast
  // double-tap of Scan) would otherwise race two passes against the same dedup snapshot
  // and both sides could decide independently to create a recommendation
  const runningRef = useRef(false)

  const variantById = useVariantMap(variantList)

  // Detection runs client-side, on load and on demand — there is no cron. Each pass only
  // writes a coach_recommendations row when the dedup rule says the episode is new.
  // `force` is true for the Scan button; the mount pass passes false so it shares the
  // request useQuery already has in flight.
  const runDetection = useCallback(async ({ force = false } = {}) => {
    if (runningRef.current) return
    runningRef.current = true
    setScanning(true)
    setScanMsg(null)
    try {
      // Read through the cache rather than around it, so the numbers this pass reasons about
      // and the numbers on screen are the same object — not two reads that could disagree.
      const [sessionList, setRows, variantRows, readinessList, excludedFlags, allRecs, goalRows] =
        await Promise.all([
          fetchQuery(qk.sessions, () => sessions.list(), { force }),
          fetchQuery(qk.sets, () => setsApi.all(), { force }),
          fetchQuery(qk.variants, () => variantsApi.list(), { force }),
          fetchQuery(qk.readiness, () => readinessApi.list(), { force }),
          fetchQuery(qk.excludedFlags, () => flagsApi.byStatus('excluded'), { force }),
          recommendationsApi.all(),
          goalsApi.list(),
        ])

      // write-on-read, same pattern as recommendation creation: the first time a
      // goal's current e1RM clears its target, flip the row to 'achieved' so it stops
      // being treated as in-progress
      const updatedGoals = await Promise.all(
        goalRows.map(async (g) => {
          if (g.status !== 'active') return g
          const currentKg = currentE1rm(setRows.filter((s) => s.variant_id === g.variant_id))
          if (currentKg < g.target_kg) return g
          const updated = await goalsApi.update(g.id, { status: 'achieved', achieved_at: new Date().toISOString() })
          return { ...g, ...updated }
        })
      )
      setGoalsList(updatedGoals)

      // weekly reports — last 3 weeks with at least one session (including the
      // current, in-progress one, matching the prototype's own w=0..2 loop), upserted
      // so re-opening Coach later in an active week just refreshes its numbers
      const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      // Averaged only over rows that carry the value. The old version read `s.rpe ?? 0` and
      // averaged the zeros in, so a week where nobody rated a set reported "an average RPE
      // of 0" — a number the lifter never entered, written into weekly_reports.
      const avg = (arr, f) => {
        const vals = arr.map(f).filter((v) => v != null && Number.isFinite(Number(v))).map(Number)
        if (!vals.length) return null
        return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
      }
      const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
      const reportRows = []
      for (let w = 0; w < 3; w++) {
        const anchor = new Date()
        anchor.setDate(anchor.getDate() - w * 7)
        const [start, end] = weekRange(anchor)
        const weekSessions = sessionList.filter((s) => {
          const d = new Date(s.started_at)
          return d >= start && d < end
        })
        if (!weekSessions.length) continue
        const weekIds = new Set(weekSessions.map((s) => s.id))
        const weekSets = setRows.filter((s) => weekIds.has(s.session_id))
        const weekReadiness = readinessList.filter((r) => weekIds.has(r.session_id))
        const avgRpe = avg(weekSets, (s) => s.rpe)
        const trained = `You trained ${plural(weekSessions.length, 'time')} for ${plural(weekSets.length, 'set')}`
        const recap =
          avgRpe == null
            ? `${trained}. No effort ratings logged this week, so there is nothing to say about intensity yet.`
            : avgRpe >= 8.5
              ? `${trained} at an average RPE of ${avgRpe}. That is a hard week — most of your work sat near failure, which is why readiness is sliding.`
              : `${trained} at an average RPE of ${avgRpe}. Effort sat in a sustainable band; volume is doing the work rather than intensity.`
        reportRows.push({
          week_start: ymd(start),
          week_end: ymd(new Date(end.getTime() - 1)),
          sessions_count: weekSessions.length,
          sets_count: weekSets.length,
          // Raw field, not `?? 0` — same reasoning as RPE above. A readiness entry with a
          // blank sleep figure must not average in as a night of zero hours.
          avg_readiness: avg(weekReadiness, (r) => r.score),
          avg_sleep: avg(weekReadiness, (r) => r.sleep_hours),
          avg_rpe: avgRpe,
          volume_kg: sessionVolumeKg(weekSets),
          recap,
        })
      }
      await Promise.all(reportRows.map((row) => reportsApi.upsert(row)))
      setReportsList(await reportsApi.list())

      const datesBySession = {}
      sessionList.forEach((s) => {
        datesBySession[s.id] = s.started_at
      })
      const excludedIds = new Set(excludedFlags.map((f) => f.session_id))

      const usedVariantIds = new Set(setRows.map((s) => s.variant_id))
      const perVariant = variantRows
        .filter((v) => usedVariantIds.has(v.id))
        .map((v) => {
          const variantSets = setRows.filter((s) => s.variant_id === v.id)
          const { series, modal } = matchedRirSeries(variantSets, datesBySession, excludedIds)
          return {
            variantId: v.id,
            name: canonicalLabel(v.base),
            series,
            modal,
            variantSets,
            verdict: detectPlateau(series),
          }
        })

      for (const pv of perVariant) {
        if (!pv.verdict.stalled) continue

        // The load the plateau was measured at — the modal weight of the matched series, not
        // the most recent set. Those diverge on any deload, back-off set or rep-scheme change,
        // and this number is both shown on the card and multiplied by BACKOFF_FACTOR for the back-off
        // target, so taking the wrong one turns a reporting slip into wrong programming.
        if (!pv.modal) continue
        const matchedLoadKg = pv.modal.weightKg

        const latest = allRecs
          .filter((r) => r.kind === 'plateau' && r.variant_id === pv.variantId)
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]

        let shouldCreate
        if (!latest) shouldCreate = true
        else if (latest.status === 'open') shouldCreate = false
        else shouldCreate = latest.actions?.matchedLoadKg != null && matchedLoadKg > latest.actions.matchedLoadKg
        if (!shouldCreate) continue

        const body = `Load has not moved while RIR fell ${pv.verdict.drop} points. That is a fatigue plateau, not a strength ceiling — the same weight is simply costing more.`
        const row = await recommendationsApi.create({
          kind: 'plateau',
          variant_id: pv.variantId,
          title: pv.name,
          body,
          actions: { matchedLoadKg, drop: pv.verdict.drop, sessions: pv.series.length },
          status: 'open',
        })
        allRecs.push(row)
      }

      const programPattern = detectProgramPattern(
        perVariant.map(({ variantId, name, series }) => ({ variantId, name, series })),
        readinessList
      )

      if (programPattern.detected) {
        const stalledVariantIds = programPattern.stalled.map((s) => s.variantId).sort()
        const latestProgram = allRecs
          .filter((r) => r.kind === 'program')
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]

        let shouldCreateProgram
        if (!latestProgram) shouldCreateProgram = true
        else if (latestProgram.status === 'open') shouldCreateProgram = false
        else {
          const storedIds = (latestProgram.actions?.stalledVariantIds || []).slice().sort().join(',')
          shouldCreateProgram = storedIds !== stalledVariantIds.join(',')
        }

        if (shouldCreateProgram) {
          // the prototype asserted "while readiness fell" unconditionally — real detection
          // only earns that clause when readinessTrend is actually negative
          const readinessClause =
            programPattern.readinessTrend != null && programPattern.readinessTrend < 0 ? ' while readiness fell' : ''
          const title = `${programPattern.stalled.length} lifts stalled inside the same two-week window`
          const body =
            `Per-exercise diagnosis would file these as ${programPattern.stalled.length} unrelated plateaus. ` +
            `They are not: effort climbed at matched load across different movement patterns${readinessClause}. ` +
            `That points at recovery, not at any one lift.`
          const row = await recommendationsApi.create({
            kind: 'program',
            variant_id: null,
            title,
            body,
            actions: { stalledVariantIds, readinessTrend: programPattern.readinessTrend },
            status: 'open',
          })
          allRecs.push(row)
        }
      }

      const openPlanRows = await plansApi.list()
      setOpenPlans(openPlanRows)
      setRecommendationsList(allRecs.filter((r) => r.status === 'open'))

      const stalledCount = perVariant.filter((pv) => pv.verdict.stalled).length
      setScanMsg(
        `Checked ${perVariant.length} variant${perVariant.length === 1 ? '' : 's'} across ${sessionList.length} session${sessionList.length === 1 ? '' : 's'} · ${stalledCount} stalled, ${programPattern.detected ? 1 : 0} program-level pattern${programPattern.detected ? '' : 's'}.`
      )
    } catch (err) {
      setActionError(err.message)
    } finally {
      runningRef.current = false
      setScanning(false)
      setScanned(true)
    }
    // setActionError is a state setter, which React guarantees is stable for the life of
    // the component — naming it here would be noise, and the aliased `setError` is what
    // confused the linter into asking.
  }, [])

  // Detection still runs on mount, but it no longer gates the render — `loading` comes from
  // the cache above, so a revisit paints instantly and this pass refreshes behind it.
  useEffect(() => {
    runDetection()
  }, [runDetection])

  const handleDismiss = async (rec) => {
    try {
      const updated = await recommendationsApi.update(rec.id, { status: 'dismissed' })
      setRecommendationsList((list) => list.filter((r) => r.id !== updated.id))
    } catch (err) {
      setError(err.message)
    }
  }

  const handleAccept = async (rec) => {
    try {
      const targetLoadKg = rec.actions.matchedLoadKg * BACKOFF_FACTOR
      const plan = await plansApi.create({
        variant_id: rec.variant_id,
        target_load_kg: targetLoadKg,
        note: 'Back-off set from a plateau: cap the top set, add volume at RIR 3.',
      })
      const updated = await recommendationsApi.update(rec.id, { status: 'accepted' })
      setRecommendationsList((list) => list.filter((r) => r.id !== updated.id))
      setOpenPlans((list) => [...list.filter((p) => p.variant_id !== plan.variant_id), plan])
    } catch (err) {
      setError(err.message)
    }
  }

  const handleUndoPlan = async (plan) => {
    try {
      await plansApi.remove(plan.id)
      setOpenPlans((list) => list.filter((p) => p.id !== plan.id))
      // recommendationsList only holds open recs — the one to reopen is 'accepted',
      // so it has to be looked up fresh rather than found in local state
      const allRecs = await recommendationsApi.all()
      const rec = allRecs.find(
        (r) => r.kind === 'plateau' && r.variant_id === plan.variant_id && r.status === 'accepted'
      )
      if (rec) {
        const updated = await recommendationsApi.update(rec.id, { status: 'open' })
        setRecommendationsList((list) => [...list, updated])
      }
    } catch (err) {
      setError(err.message)
    }
  }

  const handleSaveGoal = async ({ variantId, targetKg, reps }) => {
    const created = await goalsApi.create({ variant_id: variantId, target_kg: targetKg, target_reps: reps })
    const variant = variantById.get(variantId)
    setGoalsList((list) => [...list, { ...created, exercise_variants: variant }])
  }

  const handleArchiveGoal = async (goal) => {
    try {
      await goalsApi.update(goal.id, { status: 'archived' })
      setGoalsList((list) => list.filter((g) => g.id !== goal.id))
    } catch (err) {
      setError(err.message)
    }
  }

  const handleRemoveGoal = async (goal) => {
    try {
      await goalsApi.remove(goal.id)
      setGoalsList((list) => list.filter((g) => g.id !== goal.id))
    } catch (err) {
      setError(err.message)
    }
  }

  const handleNextGoal = (goal) => {
    const currentKg = currentE1rm(allSets.filter((s) => s.variant_id === goal.variant_id))
    const current = display(currentKg, unit)
    setGoalSheetInitial({
      variantId: goal.variant_id,
      target: String(Math.round((current + 10) / 5) * 5),
      reps: String(goal.target_reps),
    })
    setGoalSheetOpen(true)
  }

  // Every lift in the registry, not just ones with logged sets: filtering meant a new lifter
  // tapping "Add" got an empty picker and a disabled button, which the empty state above
  // actively routed them into. Nothing downstream needs history — projectGoal already
  // returns `projectable: false` with a stated reason.
  const goalCandidates = useMemo(() => variantList.slice(0, 8), [variantList])

  if (loading) {
    return <ScreenLoading />
  }

  const plateauRecs = recommendationsList.filter((r) => r.kind === 'plateau')
  const programRec = recommendationsList.find((r) => r.kind === 'program')

  return (
    <div className="min-h-full bg-background px-[18px] pt-[14px] pb-[76px] text-foreground">
      <ErrorBanner error={error} className="mb-3" />

      <div className="text-[22px] font-bold tracking-[-0.025em]">Coach</div>
      <div className="mt-1 mb-[18px] text-[12.5px] leading-[1.45] text-muted-foreground">
        Everything below is derived from sets you actually logged.
      </div>

      {programRec && (
        <div className="mb-[22px] rounded-[20px] border border-[#F2B544]/[0.32] bg-[#F2B544]/[0.06] p-4">
          <div className="mb-[9px] flex items-center gap-[7px]">
            <Network className="h-[17px] w-[17px] text-[#F2B544]" />
            <div className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#F2B544]">
              Program-level pattern
            </div>
          </div>
          <div className="mb-[7px] text-[15px] font-semibold tracking-[-0.01em]">{programRec.title}</div>
          <div className="text-[13px] leading-[1.55] text-[#C7CCC6]">{programRec.body}</div>
          <div className="my-[11px] flex flex-wrap gap-[6px]">
            {(programRec.actions.stalledVariantIds || []).map((vid) => {
              const v = variantById.get(vid)
              return v ? (
                <div key={vid} className="rounded-[7px] bg-[#1E2220] px-2 py-1 text-[11px] text-[#C7CCC6]">
                  {canonicalLabel(v.base)}
                </div>
              ) : null
            })}
          </div>
          <div className="rounded-[13px] border border-border bg-background p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Suggested
            </div>
            <div className="mt-1 text-[13px] font-medium leading-[1.5]">{PROGRAM_ACTION}</div>
          </div>
          <button
            onClick={() => handleDismiss(programRec)}
            className="mt-[13px] w-full rounded-[10px] border border-border py-[9px] text-center text-[12px] text-muted-foreground"
          >
            Not now
          </button>
        </div>
      )}

      <div className="mb-[10px] flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Plateau diagnoses
        </div>
        <button
          onClick={() => runDetection({ force: true })}
          disabled={scanning}
          className="flex items-center gap-[5px] py-[6px] text-[11.5px] font-semibold text-primary disabled:opacity-60"
        >
          {scanning ? <Loader2 className="h-[15px] w-[15px] animate-spin" /> : <Radar className="h-[15px] w-[15px]" />}
          {scanning ? 'Scanning…' : 'Scan'}
        </button>
      </div>
      {scanMsg && (
        <div className="mb-[10px] rounded-xl border border-border bg-card px-3 py-[10px] text-[12px] text-[#9AA39C]">
          {scanMsg}
        </div>
      )}

      <div className="mb-6 flex flex-col gap-[10px]">
        {plateauRecs.length === 0 && (
          <div className="rounded-2xl border border-border bg-card p-4 text-center text-[12.5px] text-muted-foreground">
            {scanned ? 'No stalled lifts right now.' : 'Checking your lifts…'}
          </div>
        )}
        {plateauRecs.map((rec) => (
          <PlateauCard
            key={rec.id}
            rec={rec}
            unit={unit}
            onDismiss={() => handleDismiss(rec)}
            onAccept={() => handleAccept(rec)}
          />
        ))}
      </div>

      {openPlans.length > 0 && (
        <>
          <div className="mb-[10px] text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Applied to next session
          </div>
          <div className="mb-6 flex flex-col gap-2">
            {openPlans.map((p) => {
              const v = variantById.get(p.variant_id)
              return (
                <div
                  key={p.id}
                  className="flex items-start gap-[10px] rounded-2xl border border-[#A8C9A2]/[0.28] bg-[#A8C9A2]/[0.05] p-[13px]"
                >
                  <CalendarClock className="mt-[1px] h-[17px] w-[17px] shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold">{v ? canonicalLabel(v.base) : 'Unknown exercise'}</div>
                    <div className="mt-[3px] text-[11.5px] leading-[1.5] text-muted-foreground">
                      Top set capped at {Math.round(display(p.target_load_kg, unit))} {unit}, back-off at RIR 3 —
                      waiting on your next session with this lift.
                    </div>
                  </div>
                  <button
                    onClick={() => handleUndoPlan(p)}
                    className="shrink-0 pt-[2px] pl-1 text-[11.5px] text-muted-foreground"
                  >
                    Undo
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="mb-[10px] flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Strength goals
        </div>
        <button
          onClick={() => {
            setGoalSheetInitial(null)
            setGoalSheetOpen(true)
          }}
          className="flex items-center gap-1 py-[6px] text-[11.5px] font-semibold text-primary"
        >
          <Plus className="h-[14px] w-[14px]" />
          Add
        </button>
      </div>
      <div className="flex flex-col gap-[10px]">
        {goalsList.length === 0 && scanned && (
          <div className="rounded-2xl border border-border bg-card p-4 text-center text-[12.5px] text-muted-foreground">
            No strength goals yet.
          </div>
        )}
        {goalsList.map((goal) => (
          <GoalCard
            key={goal.id}
            goal={goal}
            sets={allSets.filter((s) => s.variant_id === goal.variant_id)}
            unit={unit}
            onArchive={() => handleArchiveGoal(goal)}
            onRemove={() => handleRemoveGoal(goal)}
            onNext={() => handleNextGoal(goal)}
          />
        ))}
      </div>

      {reportsList.length > 0 && (
        <>
          <div className="mt-6 mb-[10px] text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Weekly reports
          </div>
          <div className="flex flex-col gap-[10px]">
            {reportsList.map((r) => {
              const rangeStart = new Date(`${r.week_start}T00:00:00`)
              const rangeEnd = new Date(`${r.week_end}T00:00:00`)
              const opts = { month: 'short', day: 'numeric' }
              const stats = [
                { k: 'Avg readiness', v: r.avg_readiness != null ? `${r.avg_readiness}/10` : '—' },
                { k: 'Avg sleep', v: r.avg_sleep != null ? `${r.avg_sleep}h` : '—' },
                { k: 'Avg RPE', v: r.avg_rpe ?? '—' },
                { k: 'Volume', v: `${Math.round((display(r.volume_kg, unit) / 1000) * 10) / 10}k` },
              ]
              return (
                <div key={r.id} className="rounded-[18px] border border-border bg-card p-[15px]">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="font-mono">
                      {rangeStart.toLocaleDateString(undefined, opts)} – {rangeEnd.toLocaleDateString(undefined, opts)}
                    </span>
                    <span>
                      {r.sessions_count} session{r.sessions_count === 1 ? '' : 's'} · {r.sets_count} set
                      {r.sets_count === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="mt-[9px] text-[13px] leading-[1.6] text-[#C7CCC6]">{r.recap}</div>
                  <div className="mt-3 grid grid-cols-2 gap-[7px]">
                    {stats.map((s) => (
                      <div key={s.k} className="rounded-[11px] border border-border p-[10px]">
                        <div className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">{s.k}</div>
                        <div className="mt-0.5 font-mono text-[13px] font-semibold">{s.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <GoalSheet
        open={goalSheetOpen}
        onOpenChange={setGoalSheetOpen}
        variants={goalCandidates}
        unit={unit}
        initial={goalSheetInitial}
        onSave={handleSaveGoal}
      />
    </div>
  )
}
