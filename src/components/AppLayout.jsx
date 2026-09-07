import { Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { ScreenLoading } from './ScreenState'

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
      <Suspense fallback={<ScreenLoading />}>
        <Outlet />
      </Suspense>
    </div>
  )
}

/** The four tab screens: faded content, with the nav pinned outside the faded box. */
export function AppLayout() {
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
