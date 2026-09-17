import { createContext, useContext, useEffect, useState } from 'react'
import { auth } from '@/api/db'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    auth
      .session()
      .then((session) => {
        if (!active) return
        setUser(session?.user ?? null)
        setLoading(false)
      })
      // Must never leave `loading` true: an unhandled rejection here strands the app forever.
      .catch((err) => {
        if (!active) return
        console.error('[auth] could not restore session', err)
        setUser(null)
        setLoading(false)
      })

    // Session persistence itself is the supabase-js client default (see src/api/db.js);
    // this just keeps React in sync with it, including PASSWORD_RECOVERY on /reset.
    const { data } = auth.onChange((session) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const value = {
    user,
    loading,
    signIn: (email, password) => auth.signIn(email, password),
    signUp: (email, password) => auth.signUp(email, password),
    signOut: () => auth.signOut(),
    requestPasswordReset: (email) => auth.resetPassword(email),
    updatePassword: (password) => auth.updatePassword(password),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
