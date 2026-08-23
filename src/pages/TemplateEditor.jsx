import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronUp, Sparkles, X } from 'lucide-react'
import {
  profile as profileApi,
  sessions,
  sets as setsApi,
  templates as templatesApi,
  variants as variantsApi,
} from '@/api/db'
import { canonicalLabel } from '@/lib/resolver'
import { AddExerciseSheet } from '@/components/workout/AddExerciseSheet'
import { useVariantMap } from '@/hooks/useVariantMap'
import { startFromTemplate, useExerciseOrder } from '@/hooks/useExerciseOrder'
import { ScreenLoading, ErrorBanner } from '@/components/ScreenState'

export default function TemplateEditor() {
  const { templateId } = useParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [template, setTemplate] = useState(null)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('lb')
  const [variantList, setVariantList] = useState([])
  const [addOpen, setAddOpen] = useState(false)
  const [active, setActive] = useState(null)
  const [starting, setStarting] = useState(false)
  const [templateList, setTemplateList] = useState([])
  const [sessionHistory, setSessionHistory] = useState([])
  const [allSets, setAllSets] = useState([])

  useEffect(() => {
    let alive = true
    Promise.all([
      templatesApi.list(),
      variantsApi.list(),
      sessions.active(),
      profileApi.get(),
      // Suggestions only — never block the editor on them.
      sessions.list().catch(() => []),
      setsApi.all().catch(() => []),
    ])
      .then(([list, v, act, p, pastSessions, everySet]) => {
        if (!alive) return
        const t = list.find((x) => x.id === templateId)
        if (!t) {
          navigate('/workouts', { replace: true })
          return
        }
        setTemplate(t)
        setName(t.name || '')
        setVariantList(v)
        setActive(act)
        setUnit(p?.unit ?? 'lb')
        setTemplateList(list)
        setSessionHistory(pastSessions)
        setAllSets(everySet)
      })
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [templateId, navigate])

  const variantById = useVariantMap(variantList)

  const persistOrder = useCallback(
    (order) => templatesApi.update(template.id, { exercise_order: order }),
    [template?.id]
  )
  const { addExercise: handleAddExercise, reorder } = useExerciseOrder({
    row: template,
    setRow: setTemplate,
    persistOrder,
    setVariants: setVariantList,
    onError: setError,
  })

  const items = useMemo(() => {
    const order = template?.exercise_order || []
    return order.map((vid) => {
      const v = variantById.get(vid)
      return {
        variantId: vid,
        name: v ? canonicalLabel(v.base) : 'Unknown exercise',
        mods: v && v.mods?.length ? v.mods.join(' · ') : 'standard',
      }
    })
  }, [template, variantById])

  const persistName = async () => {
    if (!template || name === (template.name || '')) return
    try {
      const updated = await templatesApi.update(template.id, { name })
      setTemplate(updated)
    } catch (err) {
      setError(err.message)
    }
  }

  const removeItem = async (vid) => {
    const prevOrder = template.exercise_order || []
    const newOrder = prevOrder.filter((id) => id !== vid)
    setTemplate((t) => ({ ...t, exercise_order: newOrder }))
    try {
      await templatesApi.update(template.id, { exercise_order: newOrder })
    } catch (err) {
      setTemplate((t) => ({ ...t, exercise_order: prevOrder }))
      setError(err.message)
    }
  }

  const handleStart = async () => {
    setStarting(true)
    const id = await startFromTemplate(template, active, setError)
    if (id) navigate(`/workout/${id}`)
    else setStarting(false)
  }

  if (loading) {
    return <ScreenLoading full />
  }

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <div
        className="sticky z-20 flex items-center gap-[10px] border-b border-accent bg-background/90 px-[14px] py-[10px] backdrop-blur-md"
        style={{ top: 'var(--safe-top)' }}
      >
        <button
          onClick={() => navigate('/workouts')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-muted-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="text-[14px] font-semibold">Edit template</div>
      </div>

      <div className="flex flex-col gap-3 px-[18px] pt-[14px] pb-8">
        <ErrorBanner error={error} />

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={persistName}
          placeholder="Template name"
          className="w-full rounded-2xl border border-border bg-card px-4 py-[14px] text-base font-semibold tracking-[-0.01em] text-foreground"
        />

        {items.map((item, i) => (
          <div
            key={item.variantId}
            className="flex items-center gap-[10px] rounded-2xl border border-border bg-card p-[13px]"
          >
            <div className="flex flex-col gap-0.5">
              <button onClick={() => reorder(i, -1)} disabled={i === 0} className="text-[#5F665F] disabled:opacity-30">
                <ChevronUp className="h-[15px] w-[15px]" />
              </button>
              <button
                onClick={() => reorder(i, 1)}
                disabled={i === items.length - 1}
                className="text-[#5F665F] disabled:opacity-30"
              >
                <ChevronDown className="h-[15px] w-[15px]" />
              </button>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">{item.name}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{item.mods}</div>
            </div>
            <button onClick={() => removeItem(item.variantId)} className="text-[#5F665F]">
              <X className="h-[17px] w-[17px]" />
            </button>
          </div>
        ))}

        <button
          onClick={() => setAddOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-[15px] text-[13.5px] font-medium text-[#9AA39C]"
        >
          <Sparkles className="h-[18px] w-[18px] text-primary" />
          Describe an exercise
        </button>

        <button
          onClick={handleStart}
          disabled={starting}
          className="rounded-2xl bg-primary py-[14px] text-center text-[14px] font-bold text-primary-foreground disabled:opacity-60"
        >
          Start this workout
        </button>
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
        currentOrder={template.exercise_order || []}
        // The template being edited is the plan, not a session started from one — there is
        // no remainder to suggest from itself, so tier 1 stays out of it.
        templateId={null}
      />
    </div>
  )
}
