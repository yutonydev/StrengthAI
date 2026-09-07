// 12-point trend line in the de-emphasis hue, current period marked in the accent —
// per the dataviz skill's stat-tile spec.
export function Sparkline({ values, width = 72, height = 24 }) {
  if (values.length < 2) return null

  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const stepX = width / (values.length - 1)
  const y = (v) => height - ((v - min) / range) * height

  const points = values.map((v, i) => `${i * stepX},${y(v)}`).join(' ')
  const lastX = (values.length - 1) * stepX
  const lastY = y(values[values.length - 1])

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={points} fill="none" stroke="var(--muted-graphic)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2.5" fill="#A8C9A2" />
    </svg>
  )
}
