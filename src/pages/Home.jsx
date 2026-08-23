import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@/hooks/useQuery'
import { qk } from '@/api/queryCache'
import { ChevronLeft, ChevronRight, Play, Settings } from 'lucide-react'
import {
  profile as profileApi,
  sessions,
  sets as setsApi,
  variants as variantsApi,
  muscleGoals,
} from '@/api/db'
import { display } from '@/lib/units'
import { weekRange, sessionVolumeKg } from '@/lib/coach'
import { PART_LABELS, PART_ORDER } from '@/lib/bodyParts'
import logo from '@/assets/logo.png'
import { useVariantMap } from '@/hooks/useVariantMap'
import { ScreenLoading, ErrorBanner } from '@/components/ScreenState'

const ymd = (d) => {
  const dt = new Date(d)
  return `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`
}

// Stable identity for the not-yet-loaded case, so `?? EMPTY` doesn't hand the memos
// below a brand-new array on every render.
const EMPTY = Object.freeze([])

export default function Home() {
  const navigate = useNavigate()
  // Cached reads: a revisit renders from cache on the first frame and revalidates
  // behind it, so switching back to this tab no longer flashes "Loading…".
  const profileQ = useQuery(qk.profile, () => profileApi.get())
  const activeQ = useQuery(qk.activeSession, () => sessions.active())
  const sessionsQ = useQuery(qk.sessions, () => sessions.list())
  const setsQ = useQuery(qk.sets, () => setsApi.all())
  const variantsQ = useQuery(qk.variants, () => variantsApi.list())
  const goalsQ = useQuery(qk.muscleGoals, () => muscleGoals.list())

  const unit = profileQ.data?.unit ?? 'lb'
  const active = activeQ.data ?? null
  const sessionList = sessionsQ.data ?? EMPTY
  const allSets = setsQ.data ?? EMPTY
  const variantList = variantsQ.data ?? EMPTY
  const goals = goalsQ.data ?? EMPTY

  const loading =
    profileQ.loading || activeQ.loading || sessionsQ.loading || setsQ.loading ||
    variantsQ.loading || goalsQ.loading
  const loadError =
    profileQ.error || activeQ.error || sessionsQ.error || setsQ.error ||
    variantsQ.error || goalsQ.error

  // Separate from the read errors above: this one is for failed writes on this screen.
  const [actionError, setActionError] = useState(null)
  const error = actionError || loadError
  const setError = setActionError

  const [starting, setStarting] = useState(false)
  const [cursor, setCursor] = useState(null)
  const [openDay, setOpenDay] = useState(null)

  const variantById = useVariantMap(variantList)

  const handleStart = async () => {
    if (active) {
      navigate(`/workout/${active.id}`)
      return
    }
    setStarting(true)
    try {
      const created = await sessions.start()
      navigate(`/workout/${created.id}`)
    } catch (err) {
      setError(err.message)
      setStarting(false)
    }
  }

  const weekStats = useMemo(() => {
    const [start, end] = weekRange(new Date())
    const weekSessionIds = new Set(
      sessionList
        .filter((s) => new Date(s.started_at) >= start && new Date(s.started_at) < end)
        .map((s) => s.id)
    )
    const weekSets = allSets.filter((s) => weekSessionIds.has(s.session_id))
    const volKg = sessionVolumeKg(weekSets)
    const volK = Math.round((display(volKg, unit) / 1000) * 10) / 10
    return [
      { label: 'Sessions', value: weekSessionIds.size, unit: '' },
      { label: 'Sets', value: weekSets.length, unit: '' },
      { label: 'Volume', value: volK, unit: `k ${unit}` },
    ]
  }, [sessionList, allSets, unit])

  const sessionsByDay = useMemo(() => {
    const map = new Map()
    sessionList.forEach((s) => {
      const key = ymd(s.started_at)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(s)
    })
    return map
  }, [sessionList])

  const monthDate = cursor || new Date()
  const calMonth = monthDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const calendarCells = useMemo(() => {
    const year = monthDate.getFullYear()
    const month = monthDate.getMonth()
    const firstOfMonth = new Date(year, month, 1)
    const startOffset = firstOfMonth.getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const todayKey = ymd(new Date())
    const cells = []
    for (let i = 0; i < startOffset; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${month + 1}-${d}`
      cells.push({ key, day: d, isToday: key === todayKey, sessions: sessionsByDay.get(key) || [] })
    }
    return cells
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthDate.getFullYear(), monthDate.getMonth(), sessionsByDay])

  const weekRangeLabel = useMemo(() => {
    const [start, end] = weekRange(new Date())
    const endDisplay = new Date(end.getTime() - 86400000)
    const opts = { month: 'short', day: 'numeric' }
    return `${start.toLocaleDateString(undefined, opts)}–${endDisplay.toLocaleDateString(undefined, opts)}`
  }, [])

  const goalRows = useMemo(() => {
    const [start, end] = weekRange(new Date())
    const counts = Object.fromEntries(PART_ORDER.map((p) => [p, 0]))
    sessionList
      .filter((s) => new Date(s.started_at) >= start && new Date(s.started_at) < end)
      .forEach((s) => {
        const parts = new Set()
        ;(s.exercise_order || []).forEach((vid) => {
          const v = variantById.get(vid)
          if (v?.body_part) parts.add(v.body_part)
        })
        parts.forEach((p) => {
          counts[p] = (counts[p] || 0) + 1
        })
      })
    return goals
      .filter((g) => g.weekly_target > 0)
      .sort((a, b) => PART_ORDER.indexOf(a.body_part) - PART_ORDER.indexOf(b.body_part))
      .map((g) => {
        const done = counts[g.body_part] || 0
        const met = done >= g.weekly_target
        return {
          key: g.id,
          label: PART_LABELS[g.body_part] || g.body_part,
          count: `${done}/${g.weekly_target}`,
          pct: Math.min(100, (done / g.weekly_target) * 100),
          color: met ? 'var(--color-primary)' : '#4C8E96',
        }
      })
  }, [sessionList, goals, variantById])

  const startTitle = active ? 'Resume workout' : 'Start workout'
  const startSub = active ? active.name || 'Session in progress' : 'Describe it, log it, done'

  if (loading) {
    return <ScreenLoading />
  }

  return (
    <div className="min-h-full bg-background px-[18px] pt-[14px] pb-[76px] text-foreground">
      <ErrorBanner error={error} className="mb-3" />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-[11px]">
          <img src={logo} alt="" className="h-[38px] w-[38px] rounded-xl object-cover" />
          <div>
            <div className="text-base font-semibold leading-[1.1] tracking-[-0.01em]">StrengthAI</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">Train Smarter</div>
          </div>
        </div>
        <button
          onClick={() => navigate('/settings')}
          className="flex h-[38px] w-[38px] items-center justify-center rounded-xl border border-border text-muted-foreground"
        >
          <Settings className="h-[18px] w-[18px]" />
        </button>
      </div>

      <button
        onClick={handleStart}
        disabled={starting}
        className="mt-[22px] flex w-full items-center justify-between rounded-[20px] bg-primary px-5 py-[18px] text-primary-foreground disabled:opacity-70"
      >
        <div className="text-left">
          <div className="text-lg font-bold tracking-[-0.02em]">{startTitle}</div>
          <div className="mt-0.5 text-[13px] opacity-70">{startSub}</div>
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-foreground text-primary">
          <Play className="h-6 w-6 fill-current" />
        </div>
      </button>

      <div className="mt-[10px] grid grid-cols-3 gap-2">
        {weekStats.map((s) => (
          <div key={s.label} className="rounded-[14px] border border-border bg-card px-3 py-[11px]">
            <div className="font-mono text-[19px] font-medium tracking-[-0.03em]">
              {s.value}
              {s.unit && <span className="ml-0.5 font-sans text-[11px] text-muted-foreground">{s.unit}</span>}
            </div>
            <div className="mt-[3px] text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Training calendar
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCursor(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))}
            className="flex h-[26px] w-[26px] items-center justify-center rounded-lg text-muted-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={() => setCursor(null)} className="px-1.5 text-[11px] text-muted-foreground">
            Today
          </button>
          <button
            onClick={() => setCursor(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))}
            className="flex h-[26px] w-[26px] items-center justify-center rounded-lg text-muted-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-[10px] rounded-[18px] border border-border bg-card px-[13px] pt-[14px] pb-[11px]">
        <div className="mb-[10px] text-[13px] font-semibold tracking-[-0.01em]">{calMonth}</div>
        <div className="grid grid-cols-7 gap-[3px]">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={i} className="text-center text-[9px] font-semibold tracking-[0.06em] text-[#5F665F]">
              {d}
            </div>
          ))}
          {calendarCells.map((cell, i) =>
            cell ? (
              <button
                key={cell.key}
                onClick={() => cell.sessions.length > 0 && setOpenDay(cell.key === openDay ? null : cell.key)}
                className={`flex aspect-square flex-col items-center justify-center gap-0.5 rounded-[9px] ${
                  cell.isToday ? 'ring-1 ring-primary' : ''
                }`}
              >
                <span className="font-mono text-xs">{cell.day}</span>
                {cell.sessions.length > 0 && <span className="h-1 w-1 rounded-full bg-primary" />}
              </button>
            ) : (
              <div key={`empty-${i}`} />
            )
          )}
        </div>
      </div>

      {openDay && (
        <div className="mt-2 flex flex-col gap-2 rounded-[14px] border border-border bg-card p-3">
          {(sessionsByDay.get(openDay) || []).map((s) => (
            <button
              key={s.id}
              onClick={() => navigate(`/session/${s.id}`)}
              className="text-left text-sm"
            >
              <div className="font-medium">{s.name || 'Workout'}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(s.started_at).toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Weekly goals
        </div>
        <div className="font-mono text-[11px] text-[#5F665F]">{weekRangeLabel}</div>
      </div>

      {goalRows.length > 0 ? (
        <div className="mt-[10px] flex flex-col gap-[7px]">
          {goalRows.map((g) => (
            <div key={g.key} className="rounded-[14px] border border-border bg-card px-[13px] py-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium">{g.label}</span>
                <span className="font-mono text-[11px]" style={{ color: g.color }}>
                  {g.count}
                </span>
              </div>
              <div className="mt-[9px] h-[5px] overflow-hidden rounded-full bg-[#222724]">
                <div className="h-full rounded-full" style={{ width: `${g.pct}%`, background: g.color }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-[10px] w-full rounded-[14px] border border-dashed border-border px-[18px] py-[18px] text-center text-[13px] text-muted-foreground">
          No weekly goals yet — <span className="text-primary">set them in Settings</span>
        </div>
      )}
    </div>
  )
}
