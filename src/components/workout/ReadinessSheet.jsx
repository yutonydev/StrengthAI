import { useState } from 'react'
import { readinessScore } from '@/lib/units'

const FIELDS = [
  { key: 'sleep_hours', label: 'Sleep', min: 0, max: 10, step: 0.5, lo: '0h', hi: '10h+', unit: 'h' },
  { key: 'energy', label: 'Energy', min: 0, max: 10, step: 1, lo: 'Wiped', hi: 'Great' },
  { key: 'soreness', label: 'Soreness', min: 0, max: 10, step: 1, lo: 'None', hi: 'Very sore' },
  { key: 'stress', label: 'Stress', min: 0, max: 10, step: 1, lo: 'Calm', hi: 'Frazzled' },
]

// Full-height overlay rather than a bottom sheet, matching the prototype's inset:0 for this
// one screen. The width constraint is not optional: in the prototype inset:0 resolved
// against the phone frame, here against the viewport, so this was the one surface spanning
// the whole window while every other sat in 440px. Sheet.jsx repeats it for the same reason.
export function ReadinessSheet({ open, onSkip, onSubmit }) {
  const [values, setValues] = useState({ sleep_hours: 7, energy: 6, soreness: 3, stress: 3 })
  const [submitting, setSubmitting] = useState(false)

  if (!open) return null

  const score = readinessScore(values)

  const handleSubmit = async () => {
    setSubmitting(true)
    await onSubmit({ ...values, score })
  }

  return (
    <>
      {/* Constraining the panel to the column leaves the workout screen exposed either side
          on a wide window, so this covers it. Matches AppShell's own outer background. */}
      <div className="fixed inset-0 z-[59] bg-[#0A0B0A]" />
      <div
        className="fixed inset-y-0 left-1/2 z-[60] flex w-full max-w-[440px] -translate-x-1/2 flex-col border-x border-accent bg-background"
        style={{ paddingTop: 'var(--safe-top)' }}
      >
      <div className="flex items-start justify-between px-5 pt-[18px] pb-2">
        <div>
          <div className="text-[20px] font-bold tracking-[-0.02em]">Readiness check</div>
          <div className="mt-[3px] text-[12.5px] text-muted-foreground">
            Takes ten seconds. It&apos;s what separates a bad day from a real plateau.
          </div>
        </div>
        <button onClick={onSkip} className="shrink-0 pt-1 pl-[10px] text-[13px] text-muted-foreground">
          Skip
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pt-[14px] pb-5">
        <div className="mb-[22px] rounded-[20px] border border-primary/30 bg-primary/[0.06] p-5 text-center">
          <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
            Readiness score
          </div>
          <div className="mt-1 font-mono text-[44px] tracking-[-0.05em] text-primary">{score}</div>
        </div>

        <div className="flex flex-col gap-5">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <div className="flex items-center justify-between">
                <div className="text-[14px] font-medium">{f.label}</div>
                <div className="font-mono text-[14px] text-primary">
                  {values[f.key]}
                  {f.unit || ''}
                </div>
              </div>
              <input
                type="range"
                min={f.min}
                max={f.max}
                step={f.step}
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: parseFloat(e.target.value) }))}
                className="mt-2 w-full accent-primary"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{f.lo}</span>
                <span>{f.hi}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

        <div className="px-5 pb-[22px]">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full rounded-2xl bg-primary py-[15px] text-center text-[14.5px] font-bold text-primary-foreground disabled:opacity-60"
          >
            Start training
          </button>
        </div>
      </div>
    </>
  )
}
