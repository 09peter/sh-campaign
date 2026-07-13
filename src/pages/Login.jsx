import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Panel, Field } from '../components/ui'

export default function Login() {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const from = useLocation().state?.from?.pathname ?? '/'

  const [resetSent, setResetSent] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    if (mode === 'reset') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset`,
      })
      setBusy(false)
      if (error) setError(error.message)
      else setResetSent(true)
      return
    }
    const { error } = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName } } })
    setBusy(false)
    if (error) setError(error.message)
    else nav(from, { replace: true })
  }

  return (
    <div className="max-w-md mx-auto mt-12">
      <h1 className="h-display text-4xl mb-1">Report for duty</h1>
      <p className="text-ash text-sm mb-6">Campaign records of the Sledgehammer gaming club.</p>
      <Panel title={mode === 'signin' ? 'Adeptus // Sign in' : mode === 'signup' ? 'Adeptus // Enlist' : 'Adeptus // Recover access'}>
        <form onSubmit={submit} className="space-y-4">
          {mode === 'signup' && (
            <Field label="Display name">
              <input className="field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            </Field>
          )}
          <Field label="Email">
            <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          {mode !== 'reset' && (
            <Field label="Password">
              <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </Field>
          )}
          {resetSent && <p className="text-brasslight text-sm font-mono">Recovery transmission sent — check your inbox for the reset link.</p>}
          {error && <p className="text-emberlight text-sm font-mono">{error}</p>}
          {mode !== 'reset' && (
            <button type="button" className="btn-brass w-full"
              onClick={async () => {
                const { error } = await supabase.auth.signInWithOAuth({
                  provider: 'discord',
                  options: { redirectTo: window.location.origin },
                })
                if (error) setError(error.message)
              }}>
              Sign in with Discord
            </button>
          )}
          <div className="flex items-center justify-between">
            <button className="btn-primary" disabled={busy || (mode === 'reset' && resetSent)}>
              {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
            </button>
            <span className="flex flex-col items-end gap-1">
              <button type="button" className="text-ash text-xs font-mono underline"
                onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setResetSent(false) }}>
                {mode === 'signin' ? 'New recruit? Enlist' : 'Already enlisted? Sign in'}
              </button>
              {mode === 'signin' && (
                <button type="button" className="text-ash text-xs font-mono underline"
                  onClick={() => { setMode('reset'); setError(null) }}>
                  Forgot password?
                </button>
              )}
            </span>
          </div>
        </form>
      </Panel>
    </div>
  )
}
