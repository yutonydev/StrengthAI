import { useCallback } from 'react'
import { sessions, variants as variantsApi } from '@/api/db'

/**
 * The exercise-list operations shared by the live workout and the template editor.
 *
 * Both screens hold a row with an `exercise_order` array of variant ids and offer the same
 * three actions against it: resolve-and-append a new exercise, swap two neighbours, and
 * start a session from a plan. They had three near-identical copies of each — the
 * `handleAddExercise` bodies were byte-for-byte the same eleven-field destructure and
 * `variants.ensure` call, differing only in which table the resulting order was written to.
 *
 * The shape is deliberately "give me a setter and a persist function" rather than a hook
 * that owns the row: the two screens genuinely differ in what they hold (a session vs a
 * template) and in their optimistic-rollback needs, and hiding that would cost more than
 * the duplication did.
 *
 * @param {object} opts
 * @param {object|null} opts.row       the session or template being edited
 * @param {Function} opts.setRow       React setter for that row
 * @param {Function} opts.persistOrder `(order) => Promise` — writes the new order
 * @param {Function} opts.setVariants  React setter for the variant registry
 * @param {Function} opts.onError      called with a message when a write fails
 */
export function useExerciseOrder({ row, setRow, persistOrder, setVariants, onError }) {
  /**
   * Append an exercise, creating the variant first when the sheet resolved a new one.
   *
   * `variants.ensure` upserts on (user_id, base, mods), so a description that lands on tags
   * the lifter already has continues that trend line rather than forking it — which is why
   * this passes the resolver's output through untouched rather than second-guessing it.
   */
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

/**
 * Start a workout from a template — or resume the open one.
 *
 * The single-active-session rule is the reason this is shared rather than inlined: Templates,
 * TemplateEditor and the chat coach's stage_session tool all reach it, and two active
 * sessions would make "resume workout" ambiguous from then on.
 *
 * @returns {Promise<string|null>} the session id to navigate to, or null when the write failed
 */
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
