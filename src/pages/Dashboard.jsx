import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Panel, Badge, Empty, Field } from '../components/ui'

export default function Dashboard() {
  const [campaigns, setCampaigns] = useState(null)
  const [code, setCode] = useState('')
  const [joinError, setJoinError] = useState(null)

  async function load() {
    const { data } = await supabase
      .from('campaign')
      .select('id,name,description,status,max_players,campaign_player(count)')
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
    setCampaigns(data ?? [])
  }
  useEffect(() => { load() }, [])

  async function join(e) {
    e.preventDefault()
    setJoinError(null)
    const { data, error } = await supabase.rpc('join_campaign', { invite_code: code.trim() })
    if (error) setJoinError(error.message)
    else window.location.href = `/c/${data}`
  }

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <div className="md:col-span-2 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="h-display text-3xl">Campaigns</h1>
          <Link to="/new" className="btn-primary">Found a campaign</Link>
        </div>
        {campaigns === null ? <Empty>Consulting the Administratum…</Empty>
          : campaigns.length === 0 ? <Empty>No campaigns on record. Found one, or join with an invite code.</Empty>
          : campaigns.map((c) => (
            <Link key={c.id} to={`/c/${c.id}`} className="block panel p-4 hover:border-brass transition-colors">
              <div className="flex items-center justify-between">
                <span className="h-display text-xl">{c.name}</span>
                <Badge>{c.status}</Badge>
              </div>
              {c.description && <p className="text-ash text-sm mt-1 line-clamp-2">{c.description}</p>}
              <p className="font-mono text-[11px] text-ash mt-2">
                {c.campaign_player?.[0]?.count ?? 0} / {c.max_players} commanders
              </p>
            </Link>
          ))}
      </div>
      <div>
        <Panel title="Muster // Join by code">
          <form onSubmit={join} className="space-y-3">
            <Field label="Invite code">
              <input className="field font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="A1B2C3" maxLength={6} />
            </Field>
            {joinError && <p className="text-emberlight text-xs font-mono">{joinError}</p>}
            <button className="btn-brass w-full">Join campaign</button>
          </form>
        </Panel>
      </div>
    </div>
  )
}
