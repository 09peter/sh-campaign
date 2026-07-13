import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Panel, Badge, Field, Empty } from '../components/ui'
import AssetInput from '../components/AssetInput'
import { useToast } from '../context/Toast'
import { TERRAIN } from '../lib/terrain'

const LIFECYCLE = ['draft', 'mustering', 'active', 'completed', 'archived']

export default function Settings({ campaign, players, rosters, reload, isAdmin }) {
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-6">
        <Lifecycle campaign={campaign} reload={reload} isAdmin={isAdmin} />
        <RulesConfig campaign={campaign} reload={reload} />
        <VictoryConditions campaign={campaign} reload={reload} />
        <Templates campaign={campaign} />
      </div>
      <div className="space-y-6">
        <Invites campaign={campaign} players={players} />
        <MapAppearance campaign={campaign} reload={reload} />
        <Webhooks campaign={campaign} reload={reload} />
        <Epilogue campaign={campaign} reload={reload} />
      </div>
    </div>
  )
}

function MapAppearance({ campaign, reload }) {
  const [theme, setTheme] = useState(campaign.map_theme ?? {})
  const [saved, setSaved] = useState(false)
  useEffect(() => setTheme(campaign.map_theme ?? {}), [campaign.id])

  const terrain = theme.terrain ?? {}
  const setTerrain = (t, patch) => {
    const cur = terrain[t] ?? {}
    const next = { ...cur, ...patch }
    // drop empty overrides so defaults keep applying
    Object.keys(next).forEach((k) => next[k] == null && delete next[k])
    const nextTerrain = { ...terrain }
    if (Object.keys(next).length) nextTerrain[t] = next
    else delete nextTerrain[t]
    setTheme({ ...theme, terrain: nextTerrain })
  }

  async function save() {
    await supabase.from('campaign').update({ map_theme: theme, updated_at: new Date().toISOString() }).eq('id', campaign.id)
    setSaved(true); setTimeout(() => setSaved(false), 2000)
    reload()
  }

  return (
    <Panel title="Cartographae // Map appearance"
      right={<span className="font-mono text-[10px] text-ash">all optional — flat display is the default</span>}>
      <div className="space-y-4">
        <AssetInput label="Background art (under the grid)" value={theme.background?.url}
          onChange={(url) => setTheme({ ...theme, background: url ? { ...(theme.background ?? {}), url } : undefined })}
          campaignId={campaign.id} prefix="background" />
        {theme.background?.url && (
          <Field label={`Background opacity — ${Math.round((theme.background.opacity ?? 0.5) * 100)}%`}>
            <input type="range" min="0.1" max="1" step="0.05" className="w-full accent-[#C0983E]"
              value={theme.background.opacity ?? 0.5}
              onChange={(e) => setTheme({ ...theme, background: { ...theme.background, opacity: Number(e.target.value) } })} />
          </Field>
        )}

        <div>
          <span className="lbl">Terrain overrides — colour and/or texture per type</span>
          <div className="space-y-2 mt-1">
            {Object.entries(TERRAIN).map(([t, def]) => (
              <div key={t} className="flex items-center gap-2 border border-line/60 rounded-sm p-2">
                <span className="font-mono text-[11px] w-28 shrink-0 text-ash">{def.glyph} {def.label}</span>
                <input type="color" value={terrain[t]?.fill ?? def.fill}
                  className="w-7 h-7 bg-transparent border border-line rounded-sm cursor-pointer shrink-0"
                  onChange={(e) => setTerrain(t, { fill: e.target.value })} />
                <div className="flex-1 min-w-0">
                  <AssetInput value={terrain[t]?.texture_url}
                    onChange={(url) => setTerrain(t, { texture_url: url })}
                    campaignId={campaign.id} prefix={`terrain-${t}`} />
                </div>
                {(terrain[t]?.fill || terrain[t]?.texture_url) && (
                  <button className="text-ash hover:text-emberlight font-mono text-[10px] shrink-0"
                    onClick={() => setTerrain(t, { fill: null, texture_url: null })}>reset</button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-6 font-mono text-xs">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={theme.show_glyphs !== false}
              onChange={(e) => setTheme({ ...theme, show_glyphs: e.target.checked })} />
            Terrain glyphs
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={theme.show_vp !== false}
              onChange={(e) => setTheme({ ...theme, show_vp: e.target.checked })} />
            VP labels
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={save}>Save appearance</button>
          <button className="btn-ghost" onClick={() => setTheme({})}>Reset all to tactical default</button>
          {saved && <span className="font-mono text-[11px] text-brasslight">Saved.</span>}
        </div>
        <p className="font-mono text-[10px] text-ash">
          Per-hex location art is attached on the map itself: Theatre Map → click a hex → Location art.
          Army icons live on each roster page.
        </p>
      </div>
    </Panel>
  )
}

function Lifecycle({ campaign, reload, isAdmin }) {
  const idx = LIFECYCLE.indexOf(campaign.status)
  const [pending, setPending] = useState(null) // two-step confirm, no browser dialog
  async function confirmStatus() {
    await supabase.from('campaign').update({ status: pending, updated_at: new Date().toISOString() }).eq('id', campaign.id)
    setPending(null)
    reload()
  }
  return (
    <Panel title="Campaign lifecycle" right={<Badge>{campaign.status}</Badge>}>
      <div className="flex flex-wrap items-center gap-1 font-mono text-[11px]">
        {LIFECYCLE.map((s, i) => (
          <span key={s} className="flex items-center gap-1">
            <button
              onClick={() => setPending(s)}
              disabled={s === campaign.status || (s === 'archived' && !isAdmin)}
              className={`px-2 py-1 rounded-sm border uppercase tracking-wider ${
                i === idx ? 'border-brass text-brasslight' :
                i < idx ? 'border-line text-ash/50' : 'border-line text-ash hover:text-bone hover:border-ash'}`}>
              {s}
            </button>
            {i < LIFECYCLE.length - 1 && <span className="text-ash/40">→</span>}
          </span>
        ))}
      </div>
      {pending && (
        <div className="flex items-center gap-2 mt-3 border border-brass rounded-sm p-2">
          <span className="font-mono text-xs text-brasslight">Move campaign to "{pending}"?</span>
          <button className="btn-primary text-xs" onClick={confirmStatus}>Confirm</button>
          <button className="btn-ghost text-xs" onClick={() => setPending(null)}>Cancel</button>
        </div>
      )}
      <p className="font-mono text-[10px] text-ash mt-3">
        draft: setup, hidden from players · mustering: rosters in, map locked · active: turns running ·
        completed: read-only + public share link · archived: admin only.
      </p>
      {campaign.status === 'completed' && (
        <p className="font-mono text-[10px] text-brasslight mt-2">
          Public link (read-only): {window.location.origin}/c/{campaign.id}
        </p>
      )}
    </Panel>
  )
}

const NUM_FIELDS = [
  ['max_players', 'Max players'],
  ['supply_limit_base', 'Base supply limit'],
  ['requisition_points_start', 'Starting RP'],
  ['xp_per_battle', 'XP per battle'],
  ['xp_agenda_achieved', 'XP: agenda achieved'],
  ['xp_marked_for_greatness', 'XP: Marked for Greatness'],
  ['xp_battle_honour_bonus', 'XP: honour bonus'],
  ['rp_per_battle', 'RP per battle'],
  ['rp_for_victory', 'RP for victory'],
  ['force_march_max', 'Force march distance'],
  ['soc_hold_turns', 'SoC hold turns to flip'],
  ['recovery_turns', 'Attrition: recovery turns'],
]

function RulesConfig({ campaign, reload }) {
  const toast = useToast()
  const [f, setF] = useState(campaign)
  useEffect(() => setF(campaign), [campaign.id])
  async function save() {
    const patch = Object.fromEntries(NUM_FIELDS.map(([k]) => [k, Number(f[k])]))
    patch.attrition_enabled = !!f.attrition_enabled
    patch.broken_income_penalty = f.broken_income_penalty !== false
    patch.ruleset_label = f.ruleset_label
    patch.description = f.description
    patch.name = f.name
    patch.unique_honours = typeof f.unique_honours === 'string'
      ? f.unique_honours.split('\n').map((s) => s.trim()).filter(Boolean)
      : f.unique_honours
    patch.mission_pool = typeof f.mission_pool === 'string'
      ? f.mission_pool.split('\n').map((s) => s.trim()).filter(Boolean)
      : f.mission_pool
    patch.updated_at = new Date().toISOString()
    const { error } = await supabase.from('campaign').update(patch).eq('id', campaign.id)
    toast(error ? `Save failed: ${error.message}` : 'Rules configuration saved.', error ? 'error' : 'info')
    reload()
  }
  return (
    <Panel title="Rules configuration" right={<span className="font-mono text-[10px] text-ash">edition-agnostic — all values live here</span>}>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Field label="Campaign name"><input className="field" value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Ruleset label"><input className="field" value={f.ruleset_label ?? ''} onChange={(e) => setF({ ...f, ruleset_label: e.target.value })} /></Field>
        {NUM_FIELDS.map(([k, label]) => (
          <Field key={k} label={label}>
            <input className="field" type="number" value={f[k] ?? 0} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </Field>
        ))}
      </div>
      <Field label="Campaign description">
        <textarea className="field" rows={2} value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Field label="Unique honours (one per line)">
          <textarea className="field font-mono text-xs" rows={3}
            value={Array.isArray(f.unique_honours) ? f.unique_honours.join('\n') : f.unique_honours ?? ''}
            onChange={(e) => setF({ ...f, unique_honours: e.target.value })} />
        </Field>
        <Field label="Wasteland mission pool (one per line)">
          <textarea className="field font-mono text-xs" rows={3}
            value={Array.isArray(f.mission_pool) ? f.mission_pool.join('\n') : f.mission_pool ?? ''}
            onChange={(e) => setF({ ...f, mission_pool: e.target.value })} />
        </Field>
      </div>
      <div className="flex gap-6 font-mono text-xs mt-4">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!f.attrition_enabled}
            onChange={(e) => setF({ ...f, attrition_enabled: e.target.checked })} />
          Attrition — destroyed units recover over turns instead of being marked destroyed
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.broken_income_penalty !== false}
            onChange={(e) => setF({ ...f, broken_income_penalty: e.target.checked })} />
          Broken forces draw no income
        </label>
      </div>
      <button className="btn-primary mt-4" onClick={save}>Save configuration</button>
    </Panel>
  )
}

function VictoryConditions({ campaign, reload }) {
  const conds = campaign.victory_conditions ?? []
  const editable = campaign.status === 'draft'
  const [type, setType] = useState('domination')
  const [params, setParams] = useState({ threshold_pct: 60, hex_id: '', turns_required: 3, turn_limit: 12, vp_target: 20 })
  const setP = (k) => (e) => setParams({ ...params, [k]: e.target.value })

  async function save(next) {
    await supabase.from('campaign').update({ victory_conditions: next, updated_at: new Date().toISOString() }).eq('id', campaign.id)
    reload()
  }

  function add() {
    const c = { type }
    if (type === 'domination') c.threshold_pct = Number(params.threshold_pct) || 60
    if (type === 'hold_hex') { c.hex_id = params.hex_id.trim(); c.turns_required = Number(params.turns_required) || 3 }
    if (type === 'vp_at_time') c.turn_limit = Number(params.turn_limit) || 12
    if (type === 'vp_threshold') c.vp_target = Number(params.vp_target) || 20
    save([...conds, c])
  }

  const paramFields = {
    domination: <Field label="Threshold %"><input className="field" type="number" min="1" max="100" value={params.threshold_pct} onChange={setP('threshold_pct')} /></Field>,
    hold_hex: <>
      <Field label="Hex ID"><input className="field font-mono text-xs" placeholder="uuid — from map inspector" value={params.hex_id} onChange={setP('hex_id')} /></Field>
      <Field label="Turns required"><input className="field" type="number" min="1" value={params.turns_required} onChange={setP('turns_required')} /></Field>
    </>,
    vp_at_time: <Field label="Turn limit"><input className="field" type="number" min="1" value={params.turn_limit} onChange={setP('turn_limit')} /></Field>,
    vp_threshold: <Field label="VP target"><input className="field" type="number" min="1" value={params.vp_target} onChange={setP('vp_target')} /></Field>,
  }

  return (
    <Panel title="Victory conditions" right={!editable && <span className="font-mono text-[10px] text-ash">locked outside draft</span>}>
      {conds.length === 0 && <Empty>No conditions set — the war never ends.</Empty>}
      <ul className="space-y-2">
        {conds.map((c, i) => (
          <li key={i} className="flex items-center justify-between font-mono text-xs border border-line rounded-sm p-2">
            <span className="text-bone">{describeCondition(c)}</span>
            {editable && <button className="text-ash hover:text-emberlight" onClick={() => save(conds.filter((_, j) => j !== i))}>remove</button>}
          </li>
        ))}
      </ul>
      {editable && (
        <div className="mt-3 space-y-3 border-t border-line/60 pt-3">
          <Field label="Condition type">
            <select className="field" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="domination">Domination (% of hexes)</option>
              <option value="hold_hex">Hold specific hex</option>
              <option value="vp_at_time">Highest VP at turn N</option>
              <option value="vp_threshold">VP threshold</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">{paramFields[type]}</div>
          <button className="btn-brass" disabled={type === 'hold_hex' && !params.hex_id.trim()} onClick={add}>+ Add condition</button>
        </div>
      )}
      <p className="font-mono text-[10px] text-ash mt-3">Multiple conditions run in parallel — first met at turn completion wins.</p>
    </Panel>
  )
}

const describeCondition = (c) =>
  c.type === 'domination' ? `Domination — control ≥ ${c.threshold_pct}% of hexes`
  : c.type === 'hold_hex' ? `Hold hex ${String(c.hex_id).slice(0, 8)}… for ${c.turns_required} turns`
  : c.type === 'vp_at_time' ? `Highest VP at turn ${c.turn_limit}`
  : c.type === 'vp_threshold' ? `First to ${c.vp_target} VP`
  : JSON.stringify(c)

function Invites({ campaign, players }) {
  const [invites, setInvites] = useState([])
  async function load() {
    const { data } = await supabase.from('campaign_invite').select('*')
      .eq('campaign_id', campaign.id).order('created_at', { ascending: false })
    setInvites(data ?? [])
  }
  useEffect(() => { load() }, [campaign.id])

  async function create() {
    const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('')
    await supabase.from('campaign_invite').insert({ campaign_id: campaign.id, code, created_by: (await supabase.auth.getUser()).data.user.id })
    load()
  }
  async function revoke(id) {
    await supabase.from('campaign_invite').update({ revoked: true }).eq('id', id)
    load()
  }

  return (
    <Panel title="Muster // Invites" right={<span className="font-mono text-[10px] text-ash">{players.length}/{campaign.max_players} commanders</span>}>
      <button className="btn-brass mb-3" onClick={create}>Generate invite (valid 7 days)</button>
      <ul className="space-y-2">
        {invites.map((inv) => {
          const dead = inv.revoked || new Date(inv.expires_at) < new Date()
          const link = `${window.location.origin}/join/${inv.code}`
          return (
            <li key={inv.id} className={`font-mono text-xs border border-line rounded-sm p-2 ${dead ? 'opacity-40' : ''}`}>
              <div className="flex justify-between items-center">
                <span className="text-brasslight text-base tracking-[0.3em]">{inv.code}</span>
                {dead
                  ? <span className="text-ash">{inv.revoked ? 'revoked' : 'expired'}</span>
                  : <span className="flex gap-2">
                      <button className="text-ash hover:text-bone" onClick={() => navigator.clipboard.writeText(link)}>copy link</button>
                      <button className="text-ash hover:text-emberlight" onClick={() => revoke(inv.id)}>revoke</button>
                    </span>}
              </div>
              {!dead && <p className="text-ash mt-1 break-all">{link}</p>}
            </li>
          )
        })}
      </ul>
      <p className="font-mono text-[10px] text-ash mt-3">Post the link or code in the club Discord. Expires after 7 days or when the campaign is full.</p>
    </Panel>
  )
}

const WEBHOOK_FIELDS = [
  ['webhook_battle_reported', 'Battle reported'],
  ['webhook_battle_verified', 'Battle verified'],
  ['webhook_dispute_raised', 'Dispute raised'],
  ['webhook_roster_approved', 'Roster approved'],
  ['webhook_turn_advanced', 'Turn advanced'],
  ['webhook_campaign_completed', 'Campaign completed'],
]

function Webhooks({ campaign, reload }) {
  const toast = useToast()
  const [f, setF] = useState(campaign)
  useEffect(() => setF(campaign), [campaign.id])
  async function save() {
    const patch = Object.fromEntries(WEBHOOK_FIELDS.map(([k]) => [k, f[k] || null]))
    const { error } = await supabase.from('campaign').update(patch).eq('id', campaign.id)
    toast(error ? `Save failed: ${error.message}` : 'Webhooks saved.', error ? 'error' : 'info')
    reload()
  }
  return (
    <Panel title="Vox-caster // Discord webhooks" right={<span className="font-mono text-[10px] t text-ash">all optional</span>}>
      <div className="space-y-3">
        {WEBHOOK_FIELDS.map(([k, label]) => (
          <Field key={k} label={label}>
            <input className="field font-mono text-xs" placeholder="https://discord.com/api/webhooks/…"
              value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </Field>
        ))}
        <button className="btn-primary" onClick={save}>Save webhooks</button>
      </div>
    </Panel>
  )
}

function Epilogue({ campaign, reload }) {
  const [text, setText] = useState(campaign.epilogue ?? '')
  return (
    <Panel title="Campaign epilogue" right={<span className="font-mono text-[10px] text-ash">shown on the completed campaign page</span>}>
      <textarea className="field" rows={4} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="And so the guns fell silent over the sector…" />
      <button className="btn-brass mt-3" onClick={async () => {
        await supabase.from('campaign').update({ epilogue: text }).eq('id', campaign.id); reload()
      }}>Save epilogue</button>
    </Panel>
  )
}


function Templates({ campaign }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [includeMap, setIncludeMap] = useState(true)
  const [templates, setTemplates] = useState([])

  const load = () => supabase.from('campaign_template').select('id,name,description,created_at')
    .order('created_at', { ascending: false }).then(({ data }) => setTemplates(data ?? []))
  useEffect(() => { load() }, [])

  async function save() {
    const { error } = await supabase.rpc('save_template', {
      cid: campaign.id, tname: name.trim(), tdesc: null, include_map: includeMap,
    })
    toast(error ? `Save failed: ${error.message}` : `Template "${name}" saved to the club library.`, error ? 'error' : 'info')
    if (!error) { setName(''); load() }
  }

  return (
    <Panel title="Club library // Campaign templates"
      right={<span className="font-mono text-[10px] text-ash">rules, map & theme — never players or history</span>}>
      <div className="flex gap-2 items-end">
        <Field label="Save this campaign as template">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sector War 1000pts" />
        </Field>
        <label className="font-mono text-[10px] flex items-center gap-1 pb-2 whitespace-nowrap">
          <input type="checkbox" checked={includeMap} onChange={(e) => setIncludeMap(e.target.checked)} /> incl. map
        </label>
        <button className="btn-brass whitespace-nowrap" disabled={!name.trim()} onClick={save}>Save</button>
      </div>
      {templates.length > 0 && (
        <ul className="mt-3 space-y-1 font-mono text-xs">
          {templates.map((t) => (
            <li key={t.id} className="flex justify-between items-center border-b border-line/30 py-1">
              <span className="text-bone">{t.name}</span>
              <button className="text-ash hover:text-emberlight text-[10px]"
                onClick={async () => {
                  const { error } = await supabase.from('campaign_template').delete().eq('id', t.id)
                  toast(error ? error.message : 'Template removed.', error ? 'error' : 'info'); load()
                }}>remove</button>
            </li>
          ))}
        </ul>
      )}
      <p className="font-mono text-[10px] text-ash mt-2">Templates appear as starting points on the "Found a campaign" page for every club GM.</p>
    </Panel>
  )
}
