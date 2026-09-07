import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertDialog } from '@base-ui/react/alert-dialog'
import { ArrowLeft, Check, Sparkles, Trash2 } from 'lucide-react'
import {
  plans as plansApi,
  profile as profileApi,
  readiness as readinessApi,
  sessions,
  sets as setsApi,
  templates as templatesApi,
  variants as variantsApi,
} from '@/api/db'
import { canonicalLabel } from '@/lib/resolver'
import { display } from '@/lib/units'
import { ExerciseBlock } from '@/components/workout/ExerciseBlock'
import { AddExerciseSheet } from '@/components/workout/AddExerciseSheet'
import { SetLoggerSheet } from '@/components/workout/SetLoggerSheet'
import { RestTimer } from '@/components/workout/RestTimer'
import { ReadinessSheet } from '@/components/workout/ReadinessSheet'
import { useVariantMap } from '@/hooks/useVariantMap'
import { useExerciseOrder } from '@/hooks/useExerciseOrder'
import { REST_KEY } from '@/lib/localState'
import { ScreenLoading, ErrorBanner } from '@/components/ScreenState'

const REST_SECONDS = 150

export default function Workout() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [unit, setUnit] = useState('lb')
  const [session, setSession] = useState(null)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [variantList, setVariantList] = useState([])
  const [sessionSets, setSessionSets] = useState([])
  const [sessionHistory, setSessionHistory] = useState([])
  const [allSets, setAllSets] = useState([])
  const [templateList, setTemplateList] = useState([])
  const [openPlans, setOpenPlans] = useState([])
  const [busy, setBusy] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [logVariantId, setLogVariantId] = useState(null)
  const [restEnd, setRestEnd] = useState(null)
  const [restLen, setRestLen] = useState(REST_SECONDS)
  const [restFor, setRestFor] = useState('')
  const [showReadiness, setShowReadiness] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(REST_KEY)
      if (!raw) return
      const saved = JSON.parse(raw)
      if (saved.restEnd > Date.now()) {
        setRestEnd(saved.restEnd)
        setRestLen(saved.restLen)
        setRestFor(saved.restFor)
      } else {
        localStorage.removeItem(REST_KEY)
      }
    } catch {
      localStorage.removeItem(REST_KEY)
    }
  }, [])

  useEffect(() => {
    let alive = true
    Promise.all([
      profileApi.get(),
      sessions.get(sessionId),
      variantsApi.list(),
      setsApi.forSession(sessionId),
      plansApi.list(),
      // History for the "Up next" ranking: which lifts follow which, and how long ago each
      // was last trained. Read-only and only feeds suggestions, so a failure here must not
      // stop the session loading — hence the catch-to-empty on each.
      sessions.list().catch(() => []),
      setsApi.all().catch(() => []),
      templatesApi.list().catch(() => []),
    ])
      .then(([p, s, v, st, openPlanRows, pastSessions, everySet, tpls]) => {
        if (!alive) return
        // this screen is for the live session only; a finished one is read-only on /session
        if (s.status !== 'active') {
          navigate(`/session/${s.id}`, { replace: true })
          return
        }
        setUnit(p?.unit ?? 'lb')
        setSession(s)
        setName(s.name || '')
        setNotes(s.notes || '')
        setVariantList(v)
        setSessionSets(st)
        setOpenPlans(openPlanRows)
        setSessionHistory(pastSessions)
        setAllSets(everySet)
        setTemplateList(tpls)

        // a brand-new session (no sets logged yet) gets a readiness check, once
        if (st.length === 0) {
          readinessApi.forSession(sessionId).then((rd) => {
            if (alive && !rd) setShowReadiness(true)
          })
        }
      })
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [sessionId])

  const variantById = useVariantMap(variantList)

  const persistOrder = useCallback(
    (order) => sessions.update(sessionId, { exercise_order: order }),
    [sessionId]
  )
  const { addExercise: handleAddExercise, reorder } = useExerciseOrder({
    row: session,
    setRow: setSession,
    persistOrder,
    setVariants: setVariantList,
    onError: setError,
  })

  const planByVariant = useMemo(() => {
    const map = new Map()
    openPlans.forEach((p) => map.set(p.variant_id, p))
    return map
  }, [openPlans])

  const blocks = useMemo(() => {
    const order = session?.exercise_order || []
    return order.map((vid) => {
      const v = variantById.get(vid)
      const varSets = sessionSets
        .filter((s) => s.variant_id === vid)
        .sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at))
      const plan = planByVariant.get(vid)
      return {
        variantId: vid,
        name: v ? canonicalLabel(v.base) : 'Unknown exercise',
        chips: v ? [...(v.mods || []), v.muscle].filter(Boolean) : [],
        sets: varSets,
        planText: plan ? `Coach plan · top set ${Math.round(display(plan.target_load_kg, unit))} ${unit} @ RIR 3` : null,
        // How many sets the chat coach suggested, if it staged this exercise. A display
        // count only — it draws empty prompts, never a set row.
        targetSets: session?.target_sets?.[vid] ?? null,
      }
    })
  }, [session, variantById, sessionSets, planByVariant, unit])

  const formattedDate = session
    ? new Date(session.started_at).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : ''

  const persistName = async () => {
    if (!session || name === (session.name || '')) return
    try {
      const updated = await sessions.update(sessionId, { name })
      setSession(updated)
    } catch (err) {
      setError(err.message)
    }
  }

  const persistNotes = async () => {
    if (!session || notes === (session.notes || '')) return
    try {
      const updated = await sessions.update(sessionId, { notes })
      setSession(updated)
    } catch (err) {
      setError(err.message)
    }
  }

  const removeExercise = async (vid) => {
    const prevOrder = session.exercise_order || []
    const prevSets = sessionSets
    const removedSets = prevSets.filter((s) => s.variant_id === vid)
    const newOrder = prevOrder.filter((id) => id !== vid)

    setSession((s) => ({ ...s, exercise_order: newOrder }))
    setSessionSets((list) => list.filter((s) => s.variant_id !== vid))
    try {
      await sessions.update(sessionId, { exercise_order: newOrder })
      await Promise.all(removedSets.map((s) => setsApi.remove(s.id)))
    } catch (err) {
      setSession((s) => ({ ...s, exercise_order: prevOrder }))
      setSessionSets(prevSets)
      setError(err.message)
    }
  }

  const deleteSet = async (setId) => {
    const prevSets = sessionSets
    setSessionSets((list) => list.filter((s) => s.id !== setId))
    try {
      await setsApi.remove(setId)
    } catch (err) {
      setSessionSets(prevSets)
      setError(err.message)
    }
  }

  const startRestTimer = (name) => {
    const end = Date.now() + REST_SECONDS * 1000
    setRestEnd(end)
    setRestLen(REST_SECONDS)
    setRestFor(name)
    localStorage.setItem(REST_KEY, JSON.stringify({ restEnd: end, restLen: REST_SECONDS, restFor: name }))
  }

  const extendRest = () => {
    const newEnd = restEnd + 30000
    const newLen = restLen + 30
    setRestEnd(newEnd)
    setRestLen(newLen)
    localStorage.setItem(REST_KEY, JSON.stringify({ restEnd: newEnd, restLen: newLen, restFor }))
  }

  const skipRest = () => {
    setRestEnd(null)
    localStorage.removeItem(REST_KEY)
  }

  const handleLogSet = (variantId, { weightKg, reps, rir, rpe }) => {
    // Belt and braces behind the sheet's own re-entry guard. Without a variant this write
    // trips a not-null constraint and dumps the raw Postgres text into the banner — and it
    // would also start a rest timer for a set that was never recorded.
    if (!variantId) return

    // Clear any stale failure. The banner is only ever set on error and had no reset, so one
    // failed write left a database error on screen through every later successful set.
    setError(null)

    const variant = variantById.get(variantId)
    const variantName = variant ? canonicalLabel(variant.base) : ''
    const setNumber = sessionSets.filter((s) => s.variant_id === variantId).length + 1
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const optimisticSet = {
      id: tempId,
      session_id: sessionId,
      variant_id: variantId,
      weight_kg: weightKg,
      reps,
      rir,
      rpe,
      set_number: setNumber,
      logged_at: new Date().toISOString(),
    }

    setSessionSets((list) => [...list, optimisticSet])
    startRestTimer(variantName)

    setsApi
      .log({
        session_id: sessionId,
        variant_id: variantId,
        weight_kg: weightKg,
        reps,
        rir,
        rpe,
        set_number: setNumber,
      })
      .then((real) => {
        setSessionSets((list) => list.map((s) => (s.id === tempId ? real : s)))
      })
      .catch((err) => {
        setSessionSets((list) => list.filter((s) => s.id !== tempId))
        setError(err.message)
      })
  }

  const handleSkipReadiness = () => setShowReadiness(false)

  const handleSubmitReadiness = async (values) => {
    try {
      await readinessApi.create({ session_id: sessionId, ...values })
    } catch (err) {
      setError(err.message)
    } finally {
      setShowReadiness(false)
    }
  }

  const handleFinish = async () => {
    setBusy(true)
    try {
      await sessions.finish(sessionId)
      // a plan is consumed when the session finishes, not the first logged set —
      // an exercise is three or four sets, and the target shouldn't vanish mid-exercise
      const trainedIds = new Set(session?.exercise_order || [])
      const consumed = openPlans.filter((p) => trainedIds.has(p.variant_id))
      await Promise.all(consumed.map((p) => plansApi.consume(p.id)))
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const handleDiscard = async () => {
    setBusy(true)
    try {
      await sessions.remove(sessionId)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
      setBusy(false)
      setDiscardOpen(false)
    }
  }

  if (loading) {
    return <ScreenLoading />
  }

  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <div
        className="sticky z-20 flex items-center justify-between gap-2 border-b border-accent bg-background/90 px-[14px] py-[10px] backdrop-blur-md"
        style={{ top: 'var(--safe-top)' }}
      >
        <button
          onClick={() => navigate('/')}
          aria-label="Back to home"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-muted-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-sm font-semibold tracking-[-0.01em]">{session?.name || 'Workout'}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{formattedDate}</div>
        </div>
        <button
          onClick={handleFinish}
          disabled={busy}
          className="flex shrink-0 items-center gap-1 rounded-[11px] bg-primary px-[14px] py-[9px] text-[13px] font-bold text-primary-foreground disabled:opacity-60"
        >
          <Check className="h-[17px] w-[17px]" />
          Finish
        </button>
      </div>

      <div className="flex flex-col gap-3 px-[18px] pt-[14px] pb-[76px]">
        <ErrorBanner error={error} />

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={persistName}
          placeholder="Name this workout"
          className="rounded-2xl border border-border bg-card px-4 py-[14px] text-base font-semibold tracking-[-0.01em] text-foreground placeholder:font-normal placeholder:text-muted-foreground/50"
        />

        {blocks.map((block, i) => (
          <ExerciseBlock
            key={block.variantId}
            block={block}
            index={i}
            total={blocks.length}
            unit={unit}
            onReorder={(direction) => reorder(i, direction)}
            onRemove={() => removeExercise(block.variantId)}
            onDeleteSet={deleteSet}
            onLogSet={() => setLogVariantId(block.variantId)}
          />
        ))}

        <button
          onClick={() => setAddOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-[15px] text-[13.5px] font-medium text-[#9AA39C]"
        >
          <Sparkles className="h-[18px] w-[18px] text-primary" />
          Describe an exercise
        </button>

        <div className="rounded-2xl border border-border bg-card p-[13px]">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Session notes
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={persistNotes}
            placeholder="How did it feel? Anything off?"
            rows={3}
            className="w-full resize-none bg-transparent text-[13.5px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground/50"
          />
        </div>

        <AlertDialog.Root open={discardOpen} onOpenChange={setDiscardOpen}>
          <AlertDialog.Trigger className="flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/30 py-3 text-[13px] text-destructive">
            <Trash2 className="h-4 w-4" />
            Discard workout
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-black/60" />
            <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[min(90vw,360px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-5 text-foreground">
              <AlertDialog.Title className="text-[16px] font-semibold">Discard this workout?</AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-[13.5px] text-muted-foreground">
                All logged sets will be deleted. This can&apos;t be undone.
              </AlertDialog.Description>
              <div className="mt-5 flex gap-2">
                <AlertDialog.Close className="flex-1 rounded-xl border border-border py-[10px] text-[13px] text-muted-foreground">
                  Cancel
                </AlertDialog.Close>
                <button
                  onClick={handleDiscard}
                  disabled={busy}
                  className="flex-1 rounded-xl bg-destructive/10 py-[10px] text-[13px] font-semibold text-destructive disabled:opacity-60"
                >
                  Discard
                </button>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>

      <AddExerciseSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        variants={variantList}
        unit={unit}
        onAdd={handleAddExercise}
        sessions={sessionHistory}
        allSets={allSets}
        templates={templateList}
        currentOrder={session.exercise_order || []}
        templateId={session.template_id || null}
      />

      <SetLoggerSheet
        open={!!logVariantId}
        onOpenChange={(v) => !v && setLogVariantId(null)}
        variantId={logVariantId}
        variantName={logVariantId ? canonicalLabel(variantById.get(logVariantId)?.base || '') : ''}
        unit={unit}
        plan={logVariantId ? planByVariant.get(logVariantId) : null}
        onSave={(payload) => handleLogSet(logVariantId, payload)}
      />

      <RestTimer restEnd={restEnd} restLen={restLen} restFor={restFor} onExtend={extendRest} onSkip={skipRest} />

      <ReadinessSheet open={showReadiness} onSkip={handleSkipReadiness} onSubmit={handleSubmitReadiness} />
    </div>
  )
}
