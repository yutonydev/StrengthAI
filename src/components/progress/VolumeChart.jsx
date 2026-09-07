import { useState } from 'react'

const VIEW_W = 320
const VIEW_H = 150
const BASELINE = 128
const MAX_BAR_H = 120

// Rounded top corners, square baseline — SVG <rect rx> would round all four.
function barPath(x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h)
  return `M ${x} ${y + h} L ${x} ${y + radius} Q ${x} ${y} ${x + radius} ${y} L ${x + w - radius} ${y} Q ${x + w} ${y} ${x + w} ${y + radius} L ${x + w} ${y + h} Z`
}

export function VolumeChart({ data, unit }) {
  const [active, setActive] = useState(data.length ? data.length - 1 : null)

  if (data.length === 0) {
    return <p className="py-[26px] text-center text-[12.5px] text-muted-foreground">Not enough sessions yet.</p>
  }

  const max = Math.max(1, ...data.map((d) => d.volume))
  const bw = VIEW_W / data.length
  const barW = Math.min(24, Math.max(4, bw - 4))
  const activePoint = active != null ? data[active] : null
  const showLabel = (i) => i === 0 || i === data.length - 1 || i % 3 === 0

  return (
    <div>
      <div className="mb-2 h-[15px] text-[11px] text-muted-foreground">
        {activePoint && (
          <>
            <span className="font-mono font-medium text-foreground">
              {activePoint.volume.toLocaleString()} {unit}
            </span>
            <span className="ml-1">· {activePoint.label}</span>
          </>
        )}
      </div>
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full" style={{ height: 140 }}>
        <line x1="0" y1={BASELINE} x2={VIEW_W} y2={BASELINE} stroke="#272C29" strokeWidth="1" />
        {data.map((d, i) => {
          const h = Math.max(2, (d.volume / max) * MAX_BAR_H)
          const x = i * bw + (bw - barW) / 2
          const y = BASELINE - h
          const isActive = i === active
          return (
            <path
              key={i}
              d={barPath(x, y, barW, h, 4)}
              fill="#A8C9A2"
              opacity={isActive ? 1 : 0.55}
              onClick={() => setActive(i)}
              className="cursor-pointer"
            />
          )
        })}
        {data.map(
          (d, i) =>
            showLabel(i) && (
              <text
                key={`l-${i}`}
                x={i * bw + bw / 2}
                y={142}
                textAnchor="middle"
                fontSize="9"
                fontFamily="'JetBrains Mono', monospace"
                className="fill-muted-foreground"
              >
                {d.shortLabel}
              </text>
            )
        )}
      </svg>
    </div>
  )
}
