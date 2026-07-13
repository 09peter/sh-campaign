import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/Auth'
import { Panel, Field } from '../components/ui'

export default function NewCampaign() {
  const { user } = useAuth()
  const nav = useNavigate()
  const [form, setForm] = useState({ name: '', description: '', ruleset_label: '10th Edition', max_players: 8 })
  const [error, setError] = useState(null)
  const [templates, setTemplates] = useState([])
  const [templateId, setTemplateId] = useState('')
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  useState(() => {
    supabase.from('campaign_template').select('id,name').order('created_at', { ascending: false })
      .then(({ data }) => setTemplates(data ?? []))
  })

  async function submit(e) {
    e.preventDefault()
    if (templateId) {
      const { data, error } = await supabase.rpc('instantiate_template', {
        tid: templateId, cname: form.name,
      })
      if (error) return setError(error.message)
      return nav(`/c/${data}`)
    }
    const { data, error } = await supabase.from('campaign')
      .insert({ ...form, max_players: Number(form.max_players), created_by: user.id })
      .select('id').single()
    if (error) return setError(error.message)
    // DB trigger makes the creator GM automatically
    nav(`/c/${data.id}`)
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="h-display text-3xl mb-4">Found a campaign</h1>
      <Panel title="Administratum // New campaign charter">
        <form onSubmit={submit} className="space-y-4">
          {templates.length > 0 && (
            <Field label="Start from a club template (optional)">
              <select className="field" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Blank campaign</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Campaign name">
            <input className="field" value={form.name} onChange={set('name')} required placeholder="The Vogelsang Crusade" />
          </Field>
          <Field label="Description">
            <textarea className="field" rows={3} value={form.description} onChange={set('description')} />
          </Field>
          {templateId && <p className="font-mono text-[11px] text-ash">Rules, victory conditions, map, and theme come from the template; the fields below are ignored except the name.</p>}
          {!templateId && <div className="grid grid-cols-2 gap-4">
            <Field label="Ruleset label">
              <input className="field" value={form.ruleset_label} onChange={set('ruleset_label')} />
            </Field>
            <Field label="Max players">
              <input className="field" type="number" min={2} max={12} value={form.max_players} onChange={set('max_players')} />
            </Field>
          </div>}
          {error && <p className="text-emberlight text-sm font-mono">{error}</p>}
          <button className="btn-primary">Create in draft state</button>
          <p className="text-ash text-xs">You become the campaign GM. Configure rules, the map, and victory conditions before opening the muster.</p>
        </form>
      </Panel>
    </div>
  )
}
