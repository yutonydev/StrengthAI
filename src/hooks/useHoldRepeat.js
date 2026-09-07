import { useCallback, useEffect, useRef } from 'react'

// One immediate step, a pause long enough that an ordinary tap is never mistaken for a
// hold, then a fast repeat. Reaching 225 lb shouldn't be twenty separate taps.
const HOLD_DELAY = 380
const HOLD_INTERVAL = 90

// Press-and-hold repeat for stepper buttons. Wire it with Pointer Events — onPointerDown
// starts, and onPointerUp/Leave/Cancel stop, so a hold that turns into a scroll does not
// run on invisibly. `start` fires the action itself, so the button must NOT also carry an
// onClick or every tap doubles. The repeated `fn` must compute from the setter's callback
// argument: a value closed over at render would apply the same step forever.
export function useHoldRepeat() {
  const delayRef = useRef(null)
  const repeatRef = useRef(null)

  const stop = useCallback(() => {
    clearTimeout(delayRef.current)
    clearInterval(repeatRef.current)
    delayRef.current = null
    repeatRef.current = null
  }, [])

  const start = useCallback(
    (fn) => {
      fn()
      stop()
      delayRef.current = setTimeout(() => {
        repeatRef.current = setInterval(fn, HOLD_INTERVAL)
      }, HOLD_DELAY)
    },
    [stop]
  )

  // A sheet can close mid-hold (pointerup lands outside the unmounted button), which
  // would otherwise leave the interval running against a dead component.
  useEffect(() => stop, [stop])

  return { start, stop }
}
