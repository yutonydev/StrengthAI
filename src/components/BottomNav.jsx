import { NavLink, useLocation } from 'react-router-dom'
import { Dumbbell, House, LineChart, Sparkles } from 'lucide-react'

// '/workout/:id' (a live session) is "Train"; '/workouts' and '/template/:id' are the
// separate Workouts (templates) tab — startsWith('/workout') alone would conflate them.
const ITEMS = [
  { to: '/', label: 'Train', Icon: House, match: (path) => path === '/' || path.startsWith('/workout/') },
  {
    to: '/workouts',
    label: 'Workouts',
    Icon: Dumbbell,
    match: (path) => path.startsWith('/workouts') || path.startsWith('/template'),
  },
  { to: '/progress', label: 'Progress', Icon: LineChart, match: (path) => path.startsWith('/progress') },
  { to: '/coach', label: 'Coach', Icon: Sparkles, match: (path) => path.startsWith('/coach') },
]

// Floating translucent overlay, matching the prototype — not sticky-in-flow, so the pages
// under it each add matching bottom padding to clear the bar.
export function BottomNav() {
  const location = useLocation()

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center">
      <nav
        className="w-full max-w-[440px] border-t border-accent bg-background/[0.86] backdrop-blur-[16px]"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        <div className="grid grid-cols-4">
          {ITEMS.map(({ to, label, Icon, match }) => {
            const active = match(location.pathname)
            return (
              <NavLink
                key={to}
                to={to}
                className="flex flex-col items-center gap-[3px] py-[10px]"
                style={{ color: active ? 'var(--primary)' : 'var(--muted-foreground)' }}
              >
                <Icon className="h-[21px] w-[21px]" />
                <span className="text-[10px] font-semibold tracking-[0.01em]">{label}</span>
              </NavLink>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
