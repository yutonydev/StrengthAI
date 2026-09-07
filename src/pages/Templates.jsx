import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertDialog } from '@base-ui/react/alert-dialog'
import { Dumbbell, Play, Plus, Trash2 } from 'lucide-react'
import { sessions, templates as templatesApi, variants as variantsApi } from '@/api/db'
import { canonicalLabel } from '@/lib/resolver'
import { useQuery } from '@/hooks/useQuery'
import { qk } from '@/api/queryCache'
import { useVariantMap } from '@/hooks/useVariantMap'
import { startFromTemplate } from '@/hooks/useExerciseOrder'
import { ScreenLoading, ErrorBanner } from '@/components/ScreenState'

// Stable identity for the not-yet-loaded case, so `?? EMPTY` doesn't hand the memos
// below a brand-new array on every render.
const EMPTY = Object.freeze([])

export default function Templates() {
  const navigate = useNavigate()
  const templatesQ = useQuery(qk.templates, () => templatesApi.list())
  const variantsQ = useQuery(qk.variants, () => variantsApi.list())
  const activeQ = useQuery(qk.activeSession, () => sessions.active())

  const templateList = templatesQ.data ?? EMPTY
  const variantList = variantsQ.data ?? EMPTY
  const active = activeQ.data ?? null
  const loading = templatesQ.loading || variantsQ.loading || activeQ.loading

  const [actionError, setActionError] = useState(null)
  const error = actionError || templatesQ.error || variantsQ.error || activeQ.error
  const setError = setActionError
  const [starting, setStarting] = useState(null)
  // Deleting a template is irreversible and was a single unguarded tap. SessionDetail already
  // confirms before destroying a session; this is the same class of action.
  const [pendingDelete, setPendingDelete] = useState(null)

  const variantById = useVariantMap(variantList)

  const handleNew = async () => {
    try {
      const created = await templatesApi.create({ name: 'New workout', exercise_order: [] })
      navigate(`/template/${created.id}`)
    } catch (err) {
      setError(err.message)
    }
  }

  const handleDelete = async () => {
    const target = pendingDelete
    if (!target) return
    setPendingDelete(null)
    try {
      // No optimistic removal needed: templates.remove invalidates the templates key,
      // which pushes the new list straight into this mounted screen. On failure the
      // list is untouched, so there is also nothing to roll back.
      await templatesApi.remove(target.id)
    } catch (err) {
      setError(err.message)
    }
  }

  const handleStart = async (template) => {
    setStarting(template.id)
    const id = await startFromTemplate(template, active, setError)
    if (id) navigate(`/workout/${id}`)
    else setStarting(null)
  }

  if (loading) {
    return <ScreenLoading />
  }

  return (
    <div className="min-h-full bg-background px-[18px] pt-[14px] pb-[76px] text-foreground">
      <ErrorBanner error={error} className="mb-3" />

      <div className="mb-[18px] flex items-start justify-between">
        <div>
          <div className="text-[22px] font-bold tracking-[-0.025em]">Workouts</div>
          <div className="mt-[3px] text-[12px] text-muted-foreground">Reusable templates</div>
        </div>
        <button
          onClick={handleNew}
          aria-label="New template"
          className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-primary text-primary-foreground"
        >
          <Plus className="h-[22px] w-[22px]" />
        </button>
      </div>

      {templateList.length === 0 ? (
        <div className="flex flex-col items-center gap-[10px] py-[60px] text-center text-muted-foreground">
          <Dumbbell className="h-[38px] w-[38px]" />
          <div className="text-[13px]">No templates yet. Tap + to build one.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-[9px]">
          {templateList.map((t) => {
            const summary =
              (t.exercise_order || [])
                .map((vid) => {
                  const v = variantById.get(vid)
                  return v ? canonicalLabel(v.base) : null
                })
                .filter(Boolean)
                .join(' · ') || 'Empty'
            return (
              <div key={t.id} className="rounded-[18px] border border-border bg-card p-[15px]">
                <div className="flex items-start justify-between gap-[10px]">
                  <button onClick={() => navigate(`/template/${t.id}`)} className="min-w-0 flex-1 text-left">
                    <div className="text-[15px] font-semibold tracking-[-0.01em]">{t.name}</div>
                    <div className="mt-[3px] truncate text-[12px] leading-[1.4] text-muted-foreground">{summary}</div>
                  </button>
                  <button
                    onClick={() => setPendingDelete(t)}
                    aria-label={`Delete ${t.name}`}
                    className="text-muted-graphic"
                  >
                    <Trash2 className="h-[17px] w-[17px]" />
                  </button>
                </div>
                <button
                  onClick={() => handleStart(t)}
                  disabled={starting === t.id}
                  className="mt-3 flex w-full items-center justify-center gap-[6px] rounded-xl border border-[#313632] bg-[#1E2220] py-[11px] text-[13px] font-semibold disabled:opacity-60"
                >
                  <Play className="h-[17px] w-[17px] fill-primary text-primary" />
                  Start
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Same pattern and copy shape as SessionDetail's delete guard. */}
      <AlertDialog.Root open={!!pendingDelete} onOpenChange={(v) => !v && setPendingDelete(null)}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-black/60" />
          <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[min(90vw,360px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-5 text-foreground">
            <AlertDialog.Title className="text-[16px] font-semibold">
              Delete “{pendingDelete?.name}”?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-[13.5px] text-muted-foreground">
              The template is removed. Workouts you already logged from it are not affected.
            </AlertDialog.Description>
            <div className="mt-5 flex gap-2">
              <AlertDialog.Close className="flex-1 rounded-xl border border-border py-[10px] text-[13px] text-muted-foreground">
                Cancel
              </AlertDialog.Close>
              <button
                onClick={handleDelete}
                className="flex-1 rounded-xl bg-destructive/10 py-[10px] text-[13px] font-semibold text-destructive"
              >
                Delete
              </button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  )
}
