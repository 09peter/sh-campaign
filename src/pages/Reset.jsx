import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/Auth'
import { Panel, Field } from '../components/ui'

// Landing page for the password-recovery email link. Supabase signs the user
// in with a recovery session; we just set the new password.
export default function Reset() {
  const { session } = useAuth()
  const nav = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setError(error.message)
    else nav('/', { replace: true })
  }

  return (
    <div className="max-w-md mx-auto mt-12">
      <Panel title="Adeptus // Set new password">
        {session === null ? (
          <p className="text-ash font-mono text-sm">
            No recovery session found. Open the reset link from your email again,
            or request a new one from the sign-in page.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Field label="New password">
              <input className="field" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)} required minLength={6} autoFocus />
            </Field>
            {error && <p className="text-emberlight text-sm font-mono">{error}</p>}
            <button className="btn-primary" disabled={busy}>Save password &amp; continue</button>
          </form>
        )}
      </Panel>
    </div>
  )
}
