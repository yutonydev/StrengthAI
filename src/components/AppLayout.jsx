import { Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { ScreenLoading } from './ScreenState'

/**
 * The faded screen surface. `key={pathname}` remounts it on every navigation, which is
 * what re-runs the CSS animation — the class alone would only animate on first paint.
 *
 * Nothing `position: fixed` may live inside this element, and the fade animates opacity
 * only for the same reason (see index.css): a transformed ancestor becomes the containing
 * block for fixed descendants. The bottom nav is therefore a sibling of this box, never a
 * child of it — that is what keeps it pinned to the viewport.
 */
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
