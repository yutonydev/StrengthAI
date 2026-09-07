import { useState } from 'react'

const RIR_MAX = 5
const BASELINE = 128
const PLOT_H = 118

export function RirChart({ points, declining }) {
  const [active, setActive] = useState(points.length ? points.length - 1 : null)

  if (points.length < 2) {
    return <p className="py-[26px] text-center text-[12.5px] text-muted-foreground">Not enough matched-load sessions yet.</p>
  }

  const color = declining ? '#F2B544' : '#A8C9A2'
  const px = (i) => (points.length === 1 ? 160 : 22 + i * ((296 - 22) / (points.length - 1)))
  const py = (rir) => BASELINE - (rir / RIR_MAX) * PLOT_H
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(i)} ${py(p.rir)}`).join(' ')
  const activePoint = active != null ? points[active] : null

  return (
    <div>
      <div className="mb-2 h-[15px] text-[11px] text-muted-foreground">
        {activePoint && (
          <>
            <span className="font-mono font-medium text-foreground">RIR {activePoint.rir}</span>
            <span className="ml-1">
              ·{' '}
              {new Date(activePoint.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          </>
        )}
      </div>
      <svg viewBox="0 0 320 150" className="w-full" style={{ height: 140 }}>
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <line key={n} x1="18" y1={py(n)} x2="316" y2={py(n)} stroke="#272C29" strokeWidth="1" />
        ))}
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <text
            key={`t-${n}`}
            x="14"
            y={py(n) + 3}
            textAnchor="end"
            fontSize="9"
            fontFamily="'JetBrains Mono', monospace"
            className="fill-muted-foreground"
          >
            {n}
          </text>
        ))}
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={px(i)}
            cy={py(p.rir)}
            r="4"
            fill={color}
            stroke="#171A18"
            strokeWidth="2"
            onClick={() => setActive(i)}
            className="cursor-pointer"
          />
        ))}
        {(points.length <= 6 ? points.map((_, i) => i) : [0, points.length - 1]).map((i) => (
          <text
            key={`d-${i}`}
            x={px(i)}
            y="142"
            textAnchor="middle"
            fontSize="9"
            fontFamily="'JetBrains Mono', monospace"
            className="fill-muted-foreground"
          >
            {new Date(points[i].date).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
          </text>
        ))}
      </svg>
    </div>
  )
}
