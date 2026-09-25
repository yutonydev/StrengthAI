import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { Preloader } from '@/components/Preloader'

export function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()

  // Not `null`: session restore can hit the network, and rendering nothing reads as a broken app.
  if (loading) return <Preloader />
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}

// The inverse: sign-in screens send an already-signed-in user into the app. The target is the
// same `from` Login navigates to — the auth listener sets `user` before signIn() resolves, so a
// plain redirect to "/" would win that race and drop a deep link on the floor.
// Not for /reset: a recovery link signs the user in *before* that screen renders.
export function GuestRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Preloader />
  if (user) return <Navigate to={location.state?.from?.pathname ?? '/'} replace />
  return <Outlet />
}
