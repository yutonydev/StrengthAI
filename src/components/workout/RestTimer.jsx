import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, X } from 'lucide-react'

const CIRCUMFERENCE = 94.2 // 2*pi*r for r=15, matches the prototype's ring exactly
// How long the "Rest done" cue stays up before the timer clears itself. Two 0.8s pulses
// fit inside this, so the cue fades while still mid-beat rather than freezing on a
// half-finished pulse.
const DONE_MS = 1700

// `restEnd` is an absolute deadline (epoch ms), not a countdown — recomputed from Date.now()
// every tick so it cannot drift, and so a persisted deadline resumes after a reload.
export function RestTimer({ restEnd, restLen, restFor, onExtend, onSkip }) {
  const [now, setNow] = useState(Date.now())
  // Hitting zero used to clear the timer immediately, so the countdown simply vanished.
  // It now hands off to a brief cue: `done` holds the row on screen for DONE_MS, and only
  // then does onSkip run and unmount it.
  const [done, setDone] = useState(false)
  const skipRef = useRef(onSkip)
  skipRef.current = onSkip

  useEffect(() => {
    if (!restEnd) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [restEnd])

  // A new or extended rest period resets the cue, so +30s after the cue appears puts the
  // countdown back rather than leaving "Rest done" stuck over a running timer.
  useEffect(() => {
    setDone(false)
  }, [restEnd])

  // Detecting the end and scheduling the dismissal have to be two effects. Combined, the
  // `setDone(true)` here re-runs this same effect (it depends on `done`), and the re-run's
  // cleanup cancels the timeout the previous pass had just scheduled — after which the
  // guard stops it ever being rescheduled, so the cue hangs on screen forever.
  useEffect(() => {
    if (!restEnd || done || now < restEnd) return
    setDone(true)
  }, [now, restEnd, done])

  useEffect(() => {
    if (!done) return
    // skipRef, not onSkip: the parent passes a fresh arrow each render, so depending on it
    // directly would tear down and restart this timeout on every tick and it would never
    // reach DONE_MS.
    const id = setTimeout(() => skipRef.current(), DONE_MS)
    return () => clearTimeout(id)
  }, [done])

  if (!restEnd) return null
  const left = Math.max(0, Math.ceil((restEnd - now) / 1000))

  const label = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
  const offset = CIRCUMFERENCE * (1 - left / (restLen || 150))

  // Same footprint and position as the timer it replaces, so the row transforms in place
  // instead of the screen shifting under a lifter who is about to reach for the bar.
  if (done) {
    return (
      <div
        className="rest-pulse fixed z-[31] flex items-center gap-[11px] rounded-2xl border px-[15px] py-[13px] shadow-lg"
        style={{
          left: '50%',
          transform: 'translateX(-50%)',
          bottom: 'calc(76px + var(--safe-bottom))',
          width: 'calc(100% - 28px)',
          maxWidth: '412px',
          background: 'rgba(168,201,162,.14)',
          borderColor: 'rgba(168,201,162,.4)',
        }}
      >
        <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
        <div className="text-[13.5px] font-semibold text-primary">Rest done — go get it</div>
      </div>
    )
  }

  return (
    <div
      className="fixed z-[31] flex items-center gap-[11px] rounded-2xl border border-[#313632] bg-[#1E2220] px-[13px] py-[11px] shadow-lg"
      style={{
        left: '50%',
        transform: 'translateX(-50%)',
        // sits above the fixed bottom nav (~58px) plus its own 18px gap
        bottom: 'calc(76px + var(--safe-bottom))',
        width: 'calc(100% - 28px)',
        maxWidth: '412px',
      }}
    >
      <div className="relative h-[34px] w-[34px] shrink-0">
        <svg viewBox="0 0 36 36" className="h-[34px] w-[34px] -rotate-90">
          <circle cx="18" cy="18" r="15" fill="none" stroke="#313632" strokeWidth="3" />
          <circle
            cx="18"
            cy="18"
            r="15"
            fill="none"
            stroke="#A8C9A2"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
          />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[17px] tracking-[-0.02em]">{label}</div>
        <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground">Rest · {restFor}</div>
      </div>
      <button onClick={onExtend} className="shrink-0 rounded-[9px] border border-[#3A403B] px-[9px] py-[7px] text-[11.5px] font-semibold">
        +30s
      </button>
      <button onClick={onSkip} aria-label="Skip rest" className="shrink-0 p-1 text-muted-foreground">
        <X className="h-[18px] w-[18px]" />
      </button>
    </div>
  )
}
