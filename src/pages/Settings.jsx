import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, LogOut, Minus, Plus } from 'lucide-react'
import { auth, muscleGoals, profile as profileApi } from '@/api/db'
import { PART_LABELS, PART_ORDER } from '@/lib/bodyParts'
import { useHoldRepeat } from '@/hooks/useHoldRepeat'
import { ScreenLoading, ErrorBanner } from '@/components/ScreenState'

const UNIT_OPTS = [
  { key: 'kg', label: 'kg', hint: 'Kilograms' },
  { key: 'lb', label: 'lb', hint: 'Pounds' },
]

const DIET_OPTS = [
  { key: 'cutting', label: 'Cutting', hint: 'Deficit' },
  { key: 'maintaining', label: 'Maintaining', hint: 'Neutral' },
  { key: 'bulking', label: 'Bulking', hint: 'Surplus' },
]

export default function Settings() {
  const navigate = useNavigate()
  const { start, stop } = useHoldRepeat()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [profileRow, setProfileRow] = useState(null)
  const [mgoals, setMgoals] = useState([])
  // per-body-part debounce so a burst of stepper clicks coalesces into one write —
  // two independent upserts fired back to back have no ordering guarantee, so the
  // last click's value isn't reliably the last one persisted otherwise
  const goalTimers = useRef({})
  // What each pending timer is going to write, so unmount can FLUSH rather than cancel.
  const pendingGoals = useRef({})
  // body_part -> current value, mirrored SYNCHRONOUSLY.
  //
  // The stepper used to derive its new value inside the setMgoals updater, which React does
  // not run until it renders. Anything outside the updater that needed the number therefore
  // read `undefined`, which is what silently broke the flush-on-unmount below. A ref is
  // readable and writable in the same tick, so two rapid clicks still each see the other's
  // result — the property the updater was being used for in the first place.
  const goalValues = useRef(new Map())

  // Leaving Settings mid-burst must not silently drop the change.
  //
  // Cancelling the timers here was wrong and cost a real bug: tap +, navigate away inside the
  // 400ms debounce, and the write never happened — the goal snapped back to its old value
  // with nothing to explain why. The lifter did the thing; the app just forgot. So the
  // cleanup fires the outstanding writes immediately instead of clearing them.
  //
  // Errors are swallowed rather than surfaced: this screen is already gone, so there is no
  // banner left to show one in. That is the honest trade for not losing the write.
  useEffect(() => {
    const timers = goalTimers.current
    const pending = pendingGoals.current
    return () => {
      for (const [part, value] of Object.entries(pending)) {
        clearTimeout(timers[part])
        muscleGoals.set(part, value).catch(() => {})
      }
    }
  }, [])

  useEffect(() => {
    let alive = true
    Promise.all([profileApi.get(), muscleGoals.list()])
      .then(([p, g]) => {
        if (!alive) return
        setProfileRow(p)
        setMgoals(g)
        goalValues.current = new Map(g.map((row) => [row.body_part, row.weekly_target]))
      })
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const pickUnit = async (unit) => {
    if (unit === profileRow.unit) return
    const prev = profileRow
    setProfileRow((p) => ({ ...p, unit }))
    try {
      await profileApi.update({ unit })
    } catch (err) {
      setProfileRow(prev)
      setError(err.message)
    }
  }

  const pickDiet = async (diet) => {
    const next = profileRow.diet_phase === diet ? null : diet
    const prev = profileRow
    setProfileRow((p) => ({ ...p, diet_phase: next }))
    try {
      await profileApi.update({ diet_phase: next })
    } catch (err) {
      setProfileRow(prev)
      setError(err.message)
    }
  }

  // Steps a goal, then debounces the write per body part.
  //
  // The new value is computed from `goalValues` rather than from a render-time closure, so a
  // burst of taps each builds on the last instead of all computing from the same stale
  // render — and, unlike deriving it inside the setMgoals updater, it is available
  // immediately to both the debounce and the flush-on-unmount.
  const bumpGoal = (bodyPart, delta) => {
    const current = goalValues.current.get(bodyPart) ?? 0
    const clamped = Math.max(0, Math.min(7, current + delta))
    // Already at 0 or 7 — nothing changed, so there is nothing to write.
    if (clamped === current) return
    goalValues.current.set(bodyPart, clamped)

    setMgoals((list) =>
      list.some((g) => g.body_part === bodyPart)
        ? list.map((g) => (g.body_part === bodyPart ? { ...g, weekly_target: clamped } : g))
        : [...list, { body_part: bodyPart, weekly_target: clamped }]
    )

    pendingGoals.current[bodyPart] = clamped
    clearTimeout(goalTimers.current[bodyPart])
    goalTimers.current[bodyPart] = setTimeout(() => {
      delete pendingGoals.current[bodyPart]
      muscleGoals.set(bodyPart, clamped).catch((err) => setError(err.message))
    }, 400)
  }

  const handleLogout = async () => {
    await auth.signOut()
    navigate('/login', { replace: true })
  }

  if (loading) {
    return <ScreenLoading full />
  }

  const goalByPart = new Map(mgoals.map((g) => [g.body_part, g.weekly_target]))

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <div
        className="sticky z-20 flex items-center gap-[10px] border-b border-accent bg-background/90 px-[14px] py-[10px] backdrop-blur-md"
        style={{ top: 'var(--safe-top)' }}
      >
        <button
          onClick={() => navigate('/')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-muted-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="text-[15px] font-bold tracking-[-0.02em]">Settings</div>
      </div>

      <div className="flex flex-col gap-0 px-[18px] pt-[16px] pb-8">
        <ErrorBanner error={error} className="mb-3" />

        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Units</div>
        <div className="mb-[22px] grid grid-cols-2 gap-2">
          {UNIT_OPTS.map((o) => {
            const isSel = profileRow.unit === o.key
            return (
              <button
                key={o.key}
                onClick={() => pickUnit(o.key)}
                className="rounded-2xl border p-[14px] text-left"
                style={{
                  borderColor: isSel ? 'rgba(168,201,162,.45)' : '#272C29',
                  background: isSel ? 'rgba(168,201,162,.07)' : 'transparent',
                }}
              >
                <div className="text-[15px] font-bold" style={{ color: isSel ? '#A8C9A2' : '#ECEFEA' }}>
                  {o.label}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{o.hint}</div>
              </button>
            )
          })}
        </div>

        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Diet phase
        </div>
        <div className="mb-[9px] text-[12px] leading-[1.45] text-muted-foreground">
          Optional. Lets the coach separate a real plateau from a calorie deficit.
        </div>
        <div className="mb-[22px] grid grid-cols-3 gap-2">
          {DIET_OPTS.map((o) => {
            const isSel = profileRow.diet_phase === o.key
            return (
              <button
                key={o.key}
                onClick={() => pickDiet(o.key)}
                className="rounded-[14px] border p-3 text-center"
                style={{
                  borderColor: isSel ? 'rgba(168,201,162,.45)' : '#272C29',
                  background: isSel ? 'rgba(168,201,162,.07)' : 'transparent',
                }}
              >
                <div className="text-[13px] font-semibold" style={{ color: isSel ? '#A8C9A2' : '#ECEFEA' }}>
                  {o.label}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">{o.hint}</div>
              </button>
            )
          })}
        </div>

        <div className="mb-[9px] text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Weekly training goals
        </div>
        <div className="mb-[22px] flex flex-col gap-[9px]">
          {PART_ORDER.map((part) => {
            const val = goalByPart.get(part) ?? 0
            return (
              <div
                key={part}
                className="flex items-center justify-between gap-3 rounded-[14px] border border-border bg-card px-[14px] py-3"
              >
                <div className="text-[14px] font-medium">{PART_LABELS[part]}</div>
                <div className="flex items-center gap-[10px]">
                  <button
                    onPointerDown={() => start(() => bumpGoal(part, -1))}
                    onPointerUp={stop}
                    onPointerLeave={stop}
                    onPointerCancel={stop}
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] border border-border text-muted-foreground"
                  >
                    <Minus className="h-[17px] w-[17px]" />
                  </button>
                  <div className="w-4 text-center font-mono text-[15px]">{val}</div>
                  <button
                    onPointerDown={() => start(() => bumpGoal(part, 1))}
                    onPointerUp={stop}
                    onPointerLeave={stop}
                    onPointerCancel={stop}
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] border border-border text-muted-foreground"
                  >
                    <Plus className="h-[17px] w-[17px]" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mb-[9px] text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Account
        </div>
        <div className="rounded-2xl border border-border bg-card p-[14px]">
          <div className="text-[11px] text-muted-foreground">Signed in as</div>
          <div className="mt-0.5 text-[14px] font-medium">{profileRow.email}</div>
          <button onClick={handleLogout} className="mt-3 flex items-center gap-[7px] text-[13px] text-destructive">
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </div>
    </div>
  )
}
