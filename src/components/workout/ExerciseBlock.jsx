import { useRef, useState } from 'react'
import { GripVertical, Plus, Trash2, X } from 'lucide-react'
import { display } from '@/lib/units'

// Leftward travel that commits a delete. Short enough to be one flick, long enough that
// a thumb drifting during a scroll never reaches it.
const DELETE_AT = -64
// Vertical travel that swaps a block with its neighbour. Swapping at a threshold rather
// than computing a live multi-position insert keeps the reorder honest against a list
// whose order is also being written to the server.
const REORDER_AT = 54
const SPRING = 'cubic-bezier(.34,1.56,.64,1)'

// One logged set, swipeable left to delete. Pointer capture keeps the row receiving moves
// when the finger leaves its box, and gets `pointercancel` when a scroll takes over.
function SetRow({ set, unit, onDelete }) {
  const [x, setX] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const startX = useRef(0)
  // Gesture state lives in refs and is only mirrored into state for rendering. State is not
  // readable synchronously: a quick flick delivers pointermove in the same React batch as
  // pointerdown, where `swiping` is still false — so a guard reading state drops the whole
  // gesture. Slow drags happened to work, which is what made it easy to miss.
  const activeRef = useRef(false)
  const xRef = useRef(0)

  const down = (e) => {
    // The explicit trash button is still there for anyone who'd rather tap it. A press
    // that starts on it must stay a click instead of becoming a zero-distance swipe.
    if (e.target.closest('button')) return
    startX.current = e.clientX
    activeRef.current = true
    xRef.current = 0
    setSwiping(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const move = (e) => {
    if (!activeRef.current) return
    // Left only. A rightward drag has no meaning here, and letting the row travel right
    // would imply an undo that doesn't exist.
    const next = Math.min(0, e.clientX - startX.current)
    xRef.current = next
    setX(next)
  }

  const end = () => {
    if (!activeRef.current) return
    activeRef.current = false
    const travelled = xRef.current
    xRef.current = 0
    setSwiping(false)
    setX(0)
    if (travelled <= DELETE_AT) onDelete()
  }

  return (
    <div className="relative border-t border-accent">
      <div
        className="absolute inset-0 flex items-center justify-end bg-destructive/15 pr-[6px]"
        style={{ opacity: Math.min(1, Math.abs(x) / Math.abs(DELETE_AT)) }}
      >
        <Trash2 className="h-[15px] w-[15px] text-destructive" />
      </div>
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        // Losing capture must end the gesture too. Without this a gesture whose element
        // is moved or re-parented mid-drag never sees its pointerup, leaving the handler
        // armed with a stale origin — the next unrelated touch then measures from it.
        onLostPointerCapture={end}
        // pan-y so the page still scrolls vertically through the row; horizontal is ours.
        className="relative grid touch-pan-y grid-cols-[20px_1fr_46px_42px_42px_24px] items-center gap-[6px] bg-card py-[7px] font-mono text-[13px]"
        style={{
          transform: `translateX(${x}px)`,
          transition: swiping ? 'none' : `transform .25s ${SPRING}`,
        }}
      >
        <div className="text-muted-foreground">{set.set_number}</div>
        <div>
          {display(set.weight_kg, unit)}
          <span className="ml-0.5 font-sans text-[10px] text-muted-foreground">{unit}</span>
        </div>
        <div>{set.reps}</div>
        <div className={set.rir != null && set.rir <= 1 ? 'text-[#F2B544]' : ''}>{set.rir ?? '—'}</div>
        <div>{set.rpe ?? '—'}</div>
        <button
          onClick={onDelete}
          aria-label={`Delete set ${set.set_number}`}
          className="tap-target text-muted-graphic"
        >
          <Trash2 className="h-[15px] w-[15px]" />
        </button>
      </div>
    </div>
  )
}

export function ExerciseBlock({ block, index, total, unit, onReorder, onRemove, onDeleteSet, onLogSet }) {
  // Empty prompts the coach planned but the lifter hasn't filled in yet. These are
  // placeholders and nothing else — every number in them is a dash until the lifter types
  // one. A staged set is a plan; only a logged set is a fact.
  const pending = Math.max(0, (block.targetSets ?? 0) - block.sets.length)

  const [dy, setDy] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startY = useRef(0)
  // Ref rather than the `dragging` state, for the same reason as the swipe above: a fast
  // drag can deliver its first pointermove before React has committed `dragging = true`.
  const draggingRef = useRef(false)

  const gripDown = (e) => {
    startY.current = e.clientY
    draggingRef.current = true
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const gripMove = (e) => {
    if (!draggingRef.current) return
    const delta = e.clientY - startY.current
    if (Math.abs(delta) < REORDER_AT) {
      setDy(delta)
      return
    }
    const dir = delta > 0 ? 1 : -1
    // At either end there is nothing to swap with, so the block stops at the threshold
    // instead of sliding away from a reorder that can't happen.
    if ((dir < 0 && index === 0) || (dir > 0 && index === total - 1)) {
      setDy(dir * REORDER_AT)
      return
    }
    onReorder(dir)
    // Re-origin at the current position so a continuous drag keeps stepping past further
    // neighbours instead of firing once and then sitting beyond the threshold.
    startY.current = e.clientY
    setDy(0)
  }

  const gripEnd = () => {
    draggingRef.current = false
    setDragging(false)
    setDy(0)
  }

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-border bg-card"
      style={{
        transform: `translateY(${dy}px)`,
        transition: dragging ? 'none' : `transform .22s ${SPRING}`,
        boxShadow: dragging ? '0 10px 24px rgba(0,0,0,.45)' : 'none',
        zIndex: dragging ? 5 : 'auto',
      }}
    >
      <div className="flex items-start justify-between gap-2 px-[13px] pt-[13px] pb-[11px]">
        <div className="flex gap-2">
          <button
            onPointerDown={gripDown}
            onPointerMove={gripMove}
            onPointerUp={gripEnd}
            onPointerCancel={gripEnd}
            // Reordering re-parents this very button, which drops its pointer capture and
            // means pointerup can never arrive. Ending on lost capture is what stops the
            // handler staying armed with a stale startY into the next gesture.
            onLostPointerCapture={gripEnd}
            aria-label={`Reorder ${block.name}`}
            // touch-none: this handle owns the vertical axis, otherwise the drag would be
            // stolen by the page scroll on the first pixel of movement.
            className="tap-target mt-[3px] shrink-0 cursor-grab touch-none self-start text-muted-graphic active:cursor-grabbing"
          >
            <GripVertical className="h-[19px] w-[19px]" />
          </button>
          <div>
            <div className="text-[14.5px] font-semibold tracking-[-0.01em]">{block.name}</div>
            {(block.chips.length > 0 || block.planText) && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {block.chips.map((c) => (
                  <span key={c} className="rounded-md bg-accent px-[7px] py-[3px] text-[10px] text-[#9AA39C]">
                    {c}
                  </span>
                ))}
                {block.planText && (
                  <span className="rounded-md bg-primary/[0.12] px-[7px] py-[3px] text-[10px] font-semibold text-primary">
                    {block.planText}
                  </span>
                )}
                {block.targetSets != null && (
                  <span className="rounded-md bg-primary/[0.12] px-[7px] py-[3px] text-[10px] font-semibold text-primary">
                    Coach · {block.targetSets} set{block.targetSets === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={onRemove}
          aria-label={`Remove ${block.name} from this workout`}
          className="tap-target shrink-0 text-muted-graphic"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {(block.sets.length > 0 || pending > 0) && (
        <div className="px-[13px] pb-2">
          <div className="grid grid-cols-[20px_1fr_46px_42px_42px_24px] gap-[6px] text-[9px] uppercase tracking-[0.05em] text-muted-foreground">
            <div>#</div>
            <div>Weight</div>
            <div>Reps</div>
            <div>RIR</div>
            <div>RPE</div>
            <div />
          </div>
          {block.sets.map((s) => (
            <SetRow key={s.id} set={s} unit={unit} onDelete={() => onDeleteSet(s.id)} />
          ))}

          {Array.from({ length: pending }, (_, i) => (
            <button
              key={`pending-${i}`}
              onClick={onLogSet}
              className="grid w-full grid-cols-[20px_1fr_46px_42px_42px_24px] items-center gap-[6px] border-t border-dashed border-accent py-[7px] text-left font-mono text-[13px] text-muted-foreground"
            >
              <div>{block.sets.length + i + 1}</div>
              <div>—</div>
              <div>—</div>
              <div>—</div>
              <div>—</div>
              <div />
            </button>
          ))}
        </div>
      )}

      <button
        onClick={onLogSet}
        className="flex w-full items-center justify-center gap-1 border-t border-accent py-[10px] text-[13px] font-semibold text-primary"
      >
        <Plus className="h-[17px] w-[17px]" />
        Log set
      </button>
    </div>
  )
}
