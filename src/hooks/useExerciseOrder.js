import { useCallback } from 'react'
import { sessions, variants as variantsApi } from '@/api/db'

// The exercise-list operations shared by the live workout and the template editor: append a
// resolved exercise, swap two neighbours, start a session from a plan. Both screens had
// byte-identical copies. Takes a setter and a persist function rather than owning the row —
// the two screens genuinely differ in what they hold and in their rollback needs.
export function useExerciseOrder({ row, setRow, persistOrder, setVariants, onError }) {
  // Append, creating the variant first when the sheet resolved a new one. `variants.ensure`
  // upserts on (user_id, base, mods), so a description landing on existing tags continues
  // that trend line — which is why the resolver's output passes through untouched.
  const addExercise = useCallback(
    async ({
      variantId, base, mods, muscle, muscles, jointActions, bodyPart, sourceText,
      resolvedBy, loadNote, confidence,
    }) => {
      let vid = variantId
      if (!vid) {
        const created = await variantsApi.ensure({
          base,
          mods,
          muscle,
          muscles,
          joint_actions: jointActions,
          body_part: bodyPart,
          source_text: sourceText,
          resolved_by: resolvedBy,
          load_note: loadNote,
          confidence,
        })
        vid = created.id
        setVariants((list) => (list.some((v) => v.id === created.id) ? list : [...list, created]))
      }
      await variantsApi.bumpUse(vid)
      setVariants((list) => list.map((v) => (v.id === vid ? { ...v, uses: (v.uses || 0) + 1 } : v)))

      const prevOrder = row?.exercise_order || []
      if (prevOrder.includes(vid)) return
      const newOrder = [...prevOrder, vid]
      setRow((r) => ({ ...r, exercise_order: newOrder }))
      await persistOrder(newOrder)
    },
    [row, setRow, persistOrder, setVariants]
  )

  /** Swap an exercise with its neighbour, rolling back the optimistic move if the write fails. */
  const reorder = useCallback(
    async (index, direction) => {
      const prevOrder = row?.exercise_order || []
      const newIndex = index + direction
      if (newIndex < 0 || newIndex >= prevOrder.length) return
      const order = [...prevOrder]
      ;[order[index], order[newIndex]] = [order[newIndex], order[index]]

      setRow((r) => ({ ...r, exercise_order: order }))
      try {
        await persistOrder(order)
      } catch (err) {
        setRow((r) => ({ ...r, exercise_order: prevOrder }))
        onError(err.message)
      }
    },
    [row, setRow, persistOrder, onError]
  )

  return { addExercise, reorder }
}

// Start a workout from a template, or resume the open one. Shared because Templates,
// TemplateEditor and the coach's stage_session tool all reach it, and two active sessions
// would make "resume workout" ambiguous from then on. Returns the session id, or null.
export async function startFromTemplate(template, active, onError) {
  if (active) return active.id
  try {
    const created = await sessions.start({
      name: template.name,
      template_id: template.id,
      exercise_order: template.exercise_order || [],
    })
    return created.id
  } catch (err) {
    onError(err.message)
    return null
  }
}
