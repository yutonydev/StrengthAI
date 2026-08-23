import { lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppLayout, PlainLayout } from '@/components/AppLayout'
import Home from '@/pages/Home'
import Login from '@/pages/Login'

/*
 * Home and Login are eager: they are the two screens the app can open on, and code-splitting
 * the first paint would only trade bundle size for a spinner on the critical path.
 *
 * Everything else is lazy. The whole app used to arrive as one 637 kB chunk, which meant a
 * lifter opening Home on gym wifi also downloaded the charts, the template editor and both
 * coach screens before anything rendered. Suspense boundaries live in AppLayout, around the
 * Outlet, so a route being fetched shows the same placeholder as a route being loaded.
 */
const Register = lazy(() => import('@/pages/Register'))
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'))
const ResetPassword = lazy(() => import('@/pages/ResetPassword'))
const Workout = lazy(() => import('@/pages/Workout'))
const Progress = lazy(() => import('@/pages/Progress'))
const Coach = lazy(() => import('@/pages/Coach'))
const CoachChat = lazy(() => import('@/pages/CoachChat'))
const SessionDetail = lazy(() => import('@/pages/SessionDetail'))
const Settings = lazy(() => import('@/pages/Settings'))
const Templates = lazy(() => import('@/pages/Templates'))
const TemplateEditor = lazy(() => import('@/pages/TemplateEditor'))

// The screen fade lives in the layout routes, not in a wrapper around <Routes>. Wrapping
// everything put the bottom nav inside the animated element, and the animation's retained
// transform re-anchored the nav's `position: fixed` to that box instead of the viewport.
function App() {
  return (
    <Routes>
      <Route element={<PlainLayout />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot" element={<ForgotPassword />} />
        <Route path="/reset" element={<ResetPassword />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/workout/:sessionId" element={<Workout />} />
          <Route path="/progress" element={<Progress />} />
          {/* The Coach tab is the chat. The detection screen it replaced is still reachable
              at /coach/insights — plateau cards, goals and weekly reports all live there,
              and nothing has been deleted. */}
          <Route path="/coach" element={<CoachChat />} />
          <Route path="/coach/insights" element={<Coach />} />
          <Route path="/workouts" element={<Templates />} />
        </Route>
        <Route element={<PlainLayout />}>
          <Route path="/session/:sessionId" element={<SessionDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/template/:templateId" element={<TemplateEditor />} />
        </Route>
      </Route>
    </Routes>
  )
}

export default App
