import { Suspense, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { ScreenLoading } from './ScreenState'
import { Preloader } from './Preloader'
import { ErrorBoundary } from './ErrorBoundary'
import { warmTabData } from '@/api/warmup'

// The faded screen surface. `key={pathname}` remounts it per navigation, which is what
// re-runs the animation. Nothing position:fixed may live inside it, and the fade animates
// opacity only (see index.css): a transformed ancestor becomes the containing block for
// fixed descendants, which is why the bottom nav is a sibling of this box, never a child.
function FadedScreen() {
  const { pathname } = useLocation()

  return (
    <div key={pathname} className="screen-fade">
      {/* Routes are lazy (see App.jsx), so a first visit to a screen has a chunk to fetch.
          The fallback is the same placeholder a screen shows while its data loads, so the
          two phases read as one wait rather than two different ones. */}
      <ErrorBoundary>
        <Suspense fallback={<ScreenLoading />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}

// Specifiers must match App.jsx's `lazy()` calls so both hit the same module-cache entry.
const prefetchTabs = () =>
  Promise.all([
    import('@/pages/Templates').catch(() => {}),
    import('@/pages/Progress').catch(() => {}),
    import('@/pages/CoachChat').catch(() => {}),
  ])

// Module scope, not state: one splash per page load, not one per remount.
let warmed = false

const MIN_MS = 650 // floor, so the splash cannot flash past
const CAP_MS = 2500 // cap, so a slow network cannot hold the app behind it

/** Holds the preloader until the chunks and query cache are warm, floored at MIN_MS and capped at CAP_MS. */
function useWarmup() {
  const [ready, setReady] = useState(warmed)

  useEffect(() => {
    if (warmed) return
    let alive = true

    const settle = () => {
      if (!alive) return
      warmed = true
      setReady(true)
    }

    const floor = new Promise((r) => setTimeout(r, MIN_MS))
    const cap = new Promise((r) => setTimeout(r, CAP_MS))
    // Both halves: a warm chunk still shows ScreenLoading until its queries land.
    Promise.race([Promise.all([prefetchTabs(), warmTabData(), floor]), cap]).then(settle)

    return () => {
      alive = false
    }
  }, [])

  return ready
}

/** The four tab screens: faded content, with the nav pinned outside the faded box. */
export function AppLayout() {
  const ready = useWarmup()

  if (!ready) return <Preloader />

  return (
    <>
      <FadedScreen />
      <BottomNav />
    </>
  )
}

/** Full-screen routes that carry no bottom nav — auth, settings, detail, editor. */
export function PlainLayout() {
  return <FadedScreen />
}
