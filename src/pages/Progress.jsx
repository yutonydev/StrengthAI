import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import {
  flags as flagsApi,
  profile as profileApi,
  readiness as readinessApi,
  sessions,
  sets as setsApi,
  variants as variantsApi,
} from '@/api/db'
import { canonicalLabel } from '@/lib/resolver'
import { display } from '@/lib/units'
import { detectPlateau, matchedRirSeries, sessionVolumeKg } from '@/lib/coach'
import { VolumeChart } from '@/components/progress/VolumeChart'
import { RirChart } from '@/components/progress/RirChart'
import { Sparkline } from '@/components/progress/Sparkline'
import { useQuery } from '@/hooks/useQuery'
import { qk } from '@/api/queryCache'
import { ScreenLoading, ErrorBanner } from '@/components/ScreenState'

const STABILITY_LABEL = { declining: 'Declining', volatile: 'Volatile', stable: 'Stable' }

// Stable identity for the not-yet-loaded case, so `?? EMPTY` doesn't hand the memos
// below a brand-new array on every render.
const EMPTY = Object.freeze([])

export default function Progress() {
  const navigate = useNavigate()
  const profileQ = useQuery(qk.profile, () => profileApi.get())
  const sessionsQ = useQuery(qk.sessions, () => sessions.list())
  const setsQ = useQuery(qk.sets, () => setsApi.all())
  const variantsQ = useQuery(qk.variants, () => variantsApi.list())
  const readinessQ = useQuery(qk.readiness, () => readinessApi.list())
  const excludedQ = useQuery(qk.excludedFlags, () => flagsApi.byStatus('excluded'))

  const unit = profileQ.data?.unit ?? 'lb'
  const sessionList = sessionsQ.data ?? EMPTY
  const allSets = setsQ.data ?? EMPTY
  const variantList = variantsQ.data ?? EMPTY
  const readinessList = readinessQ.data ?? EMPTY
  const excludedSessionIds = useMemo(
    () => new Set((excludedQ.data ?? EMPTY).map((f) => f.session_id)),
    [excludedQ.data]
  )

  const loading =
    profileQ.loading || sessionsQ.loading || setsQ.loading || variantsQ.loading ||
    readinessQ.loading || excludedQ.loading
  const error =
    profileQ.error || sessionsQ.error || setsQ.error || variantsQ.error ||
    readinessQ.error || excludedQ.error

  const [selectedVariantId, setSelectedVariantId] = useState(null)

  const datesBySession = useMemo(() => {
    const map = {}
    sessionList.forEach((s) => {
      map[s.id] = s.started_at
    })
    return map
  }, [sessionList])

  // variants.list() already orders by uses desc, so this chip order is most-used-first for free
  const exercisesWithSets = useMemo(() => {
    const used = new Set(allSets.map((s) => s.variant_id))
    return variantList.filter((v) => used.has(v.id))
  }, [allSets, variantList])

  const selectedId =
    selectedVariantId && exercisesWithSets.some((v) => v.id === selectedVariantId)
      ? selectedVariantId
      : exercisesWithSets[0]?.id ?? null

  const matchedSeries = useMemo(() => {
    if (!selectedId) return []
    const setsForVariant = allSets.filter((s) => s.variant_id === selectedId)
    return matchedRirSeries(setsForVariant, datesBySession, excludedSessionIds).series
  }, [allSets, selectedId, datesBySession, excludedSessionIds])

  const plateau = matchedSeries.length >= 3 ? detectPlateau(matchedSeries) : null
  const declining = plateau?.stability === 'declining'

  const stats = useMemo(() => {
    const volKg = sessionVolumeKg(allSets)
    return [
      { label: 'Sessions', value: sessionList.length.toLocaleString(), color: '#ECEFEA' },
      { label: 'Sets', value: allSets.length.toLocaleString(), color: '#ECEFEA' },
      { label: 'Total volume', value: `${Math.round(display(volKg, unit)).toLocaleString()} ${unit}`, color: '#ECEFEA' },
    ]
  }, [allSets, sessionList, unit])

  // The coach has something to say about the selected exercise. When it does, this tile stops
  // restating a one-word verdict and becomes the route to the plateau card on Insights, where
  // the reasoning and the accept/dismiss actions already live. Duplicating the diagnosis here
  // would mean two places to keep true.
  const coachFlagged = !!plateau && (plateau.stalled || plateau.watch)

  const volumeData = useMemo(() => {
    const bySession = {}
    allSets.forEach((s) => {
      bySession[s.session_id] = (bySession[s.session_id] || 0) + s.weight_kg * s.reps
    })
    return Object.entries(bySession)
      .map(([sessionId, volKg]) => ({
        date: datesBySession[sessionId],
        volume: Math.round(display(volKg, unit)),
      }))
      .filter((x) => x.date && x.volume > 0)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(-12)
      .map((x) => ({
        volume: x.volume,
        label: new Date(x.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        shortLabel: new Date(x.date).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
      }))
  }, [allSets, datesBySession, unit])

  const readinessScores = readinessList.map((r) => r.score).filter((s) => s != null)
  const currentReadiness = readinessScores[readinessScores.length - 1] ?? null

  const selectedVariant = exercisesWithSets.find((v) => v.id === selectedId)
  const rirSub = selectedVariant
    ? `Actual RIR at your most-repeated load for ${canonicalLabel(selectedVariant.base)}. Lower means the same weight is costing more.`
    : 'Log a few sets to see this.'

  if (loading) {
    return <ScreenLoading />
  }

  return (
    <div className="min-h-full bg-background px-[18px] pt-[14px] pb-[76px] text-foreground">
      <ErrorBanner error={error} className="mb-3" />

      <div className="mb-4 text-[22px] font-bold tracking-[-0.025em]">Progress</div>

      <div className="mb-5 grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-[13px]">
            <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{s.label}</div>
            <div className="mt-1 font-mono text-[21px] font-medium tracking-[-0.03em]" style={{ color: s.color }}>
              {s.value}
            </div>
          </div>
        ))}

        {coachFlagged ? (
          // Insights has no per-exercise deep link today, so this lands on the screen rather
          // than the card. Worth revisiting if the plateau list ever grows past a screenful.
          <button
            onClick={() => navigate('/coach/insights')}
            className="rounded-2xl border border-border bg-card p-[13px] text-left"
          >
            <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">RIR stability</div>
            <div className="mt-1 flex items-center gap-[3px] text-[13.5px] font-semibold text-primary">
              Coach flagged this
              <ChevronRight className="h-[15px] w-[15px] shrink-0" />
            </div>
          </button>
        ) : (
          <div className="rounded-2xl border border-border bg-card p-[13px]">
            <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">RIR stability</div>
            <div className="mt-1 font-mono text-[21px] font-medium tracking-[-0.03em] text-primary">
              {plateau ? STABILITY_LABEL[plateau.stability] : 'No data'}
            </div>
          </div>
        )}
      </div>

      {currentReadiness != null && (
        <div className="mb-[14px] flex items-center justify-between rounded-2xl border border-border bg-card p-[13px]">
          <div>
            <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Readiness</div>
            <div className="mt-1 font-mono text-[21px] font-medium tracking-[-0.03em]">
              {currentReadiness}
              <span className="ml-1 font-sans text-[11px] text-muted-foreground">/10</span>
            </div>
          </div>
          <Sparkline values={readinessScores.slice(-12)} />
        </div>
      )}

      <div className="mb-[14px] rounded-[18px] border border-border bg-card p-[15px]">
        <div className="text-[13px] font-semibold">Volume per session</div>
        <div className="mt-0.5 mb-2 text-[11.5px] text-muted-foreground">
          Last {volumeData.length} sessions · {unit}
        </div>
        <VolumeChart data={volumeData} unit={unit} />
      </div>

      <div className="rounded-[18px] border border-border bg-card p-[15px]">
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-semibold">RIR at matched load</div>
          {declining && (
            <div className="flex items-center gap-1 text-[10px] font-semibold text-[#F2B544]">
              <span>▼</span>Declining
            </div>
          )}
        </div>
        <div className="mt-1 mb-[10px] text-[11.5px] leading-[1.45] text-muted-foreground">{rirSub}</div>

        {exercisesWithSets.length > 0 && (
          <div className="mb-3 flex gap-[6px] overflow-x-auto">
            {exercisesWithSets.map((v) => {
              const isSel = v.id === selectedId
              return (
                <button
                  key={v.id}
                  onClick={() => setSelectedVariantId(v.id)}
                  className="shrink-0 rounded-full px-[11px] py-[6px] text-[11.5px]"
                  style={{
                    border: `1px solid ${isSel ? 'rgba(168,201,162,.5)' : '#272C29'}`,
                    background: isSel ? 'rgba(168,201,162,.1)' : 'transparent',
                    color: isSel ? '#A8C9A2' : '#8A928C',
                  }}
                >
                  {canonicalLabel(v.base)}
                </button>
              )
            })}
          </div>
        )}

        <RirChart points={matchedSeries} declining={declining} />
      </div>
    </div>
  )
}
