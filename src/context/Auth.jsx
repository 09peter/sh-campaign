import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) { setProfile(null); return }
    supabase.from('profile').select('*').eq('id', session.user.id).single()
      .then(({ data }) => setProfile(data))
  }, [session?.user?.id])

  return (
    <AuthCtx.Provider value={{ session, user: session?.user ?? null, profile, isAdmin: profile?.role === 'admin' }}>
      {children}
    </AuthCtx.Provider>
  )
}
