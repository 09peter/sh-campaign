import { Routes, Route, Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/Auth'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import NewCampaign from './pages/NewCampaign'
import Join from './pages/Join'
import Reset from './pages/Reset'
import CampaignLayout from './pages/CampaignLayout'

function Shell({ children }) {
  const { user, profile } = useAuth()
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-slate2/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-baseline gap-3">
            <span className="h-display text-2xl text-bone">SLEDGEHAMMER</span>
            <span className="eyebrow">Crusade Command</span>
          </Link>
          {user && (
            <div className="flex items-center gap-4">
              <span className="font-mono text-xs text-ash">{profile?.display_name}</span>
              <button className="btn-ghost text-xs" onClick={() => supabase.auth.signOut()}>Sign out</button>
            </div>
          )}
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
      <footer className="max-w-6xl mx-auto px-4 py-8">
        <p className="font-mono text-[10px] text-ash/50 uppercase tracking-widest">
          Sledgehammer Gaming Club · Vienna · The Emperor Protects
        </p>
      </footer>
    </div>
  )
}

function RequireAuth({ children }) {
  const { session } = useAuth()
  const loc = useLocation()
  if (session === undefined) return <p className="p-8 font-mono text-ash">Establishing vox link…</p>
  if (!session) return <Navigate to="/login" state={{ from: loc }} replace />
  return children
}

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/reset" element={<Reset />} />
        <Route path="/join/:code?" element={<RequireAuth><Join /></RequireAuth>} />
        <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/new" element={<RequireAuth><NewCampaign /></RequireAuth>} />
        <Route path="/c/:id/*" element={<RequireAuth><CampaignLayout /></RequireAuth>} />
      </Routes>
    </Shell>
  )
}
