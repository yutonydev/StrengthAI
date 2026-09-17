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
