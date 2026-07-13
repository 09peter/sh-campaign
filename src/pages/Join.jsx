import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Panel } from '../components/ui'

export default function Join() {
  const { code } = useParams()
  const nav = useNavigate()
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!code) return
    supabase.rpc('join_campaign', { invite_code: code }).then(({ data, error }) => {
      if (error) setError(error.message)
      else nav(`/c/${data}`, { replace: true })
    })
  }, [code])

  return (
    <div className="max-w-md mx-auto mt-12">
      <Panel title="Muster // Invitation">
        {error
          ? <p className="text-emberlight font-mono text-sm">{error}</p>
          : <p className="text-ash font-mono text-sm">Verifying credentials…</p>}
      </Panel>
    </div>
  )
}
