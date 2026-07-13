import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/Auth'
import { parseImport } from '../lib/parser'
import { rankFor, crusadePoints } from '../lib/xp'
import { notifyRosterApproved } from '../lib/discord'
import { recordEvent } from '../lib/chronicle'
import { useToast } from '../context/Toast'
import { Panel, Badge, Field, Empty } from '../components/ui'
import AssetInput from '../components/AssetInput'

export default function RosterPage(ctx) {
  const { rosterId } = useParams()
  const { rosters, myRoster } = ctx
  const roster = rosterId ? rosters.find((r) => r.id === rosterId) : myRoster

  return (
    <div className="grid lg:grid-cols-4 gap-6">
      <div className="space-y-2">
        <p className="eyebrow mb-2">Forces</p>
        {rosters.map((r) => (
          <Link key={r.id} to={`/c/${ctx.campaign.id}/roster/${r.id}`}
            className={`block panel p-3 hover:border-brass ${roster?.id === r.id ? 'border-brass' : ''}`}>
            <div className="flex justify-between items-center">
              <span className="text-sm">{r.name}</span>
              <Badge>{r.status}</Badge>
            </div>
            <p className="font-mono text-[10px] text-ash mt-1">{r.faction ?? '—'} · {r.unit?.length ?? 0} units</p>
          </Link>
        ))}
        {!myRoster && <CreateRoster {...ctx} />}
      </div>
      <div className="lg:col-span-3">
        {roster ? <RosterDetail key={roster.id} roster={roster} {...ctx} /> : <Empty>No roster selected. {!myRoster && 'Muster your force to begin.'}</Empty>}
      </div>
    </div>
  )
}

function CreateRoster({ campaign, reload }) {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [faction, setFaction] = useState('')
  async function create(e) {
    e.preventDefault()
    await supabase.from('roster').insert({
      campaign_id: campaign.id, player_id: user.id, name, faction,
      supply_limit: campaign.supply_limit_base,
      requisition_points: campaign.requisition_points_start,
    })
    reload()
  }
  return (
    <form onSubmit={create} className="panel p-3 space-y-2 mt-4">
      <p className="eyebrow">Muster your force</p>
      <input className="field" placeholder="Force name" value={name} onChange={(e) => setName(e.target.value)} required />
      <input className="field" placeholder="Faction" value={faction} onChange={(e) => setFaction(e.target.value)} />
      <button className="btn-brass w-full">Create roster</button>
    </form>
  )
}

function RosterDetail({ roster, campaign, isGM, reload, players, currentTurn }) {
  const toast = useToast()
  const [evacConfirm, setEvacConfirm] = useState(false)
  const { user } = useAuth()
  const isOwner = roster.player_id === user.id
  const compositionLocked = roster.status === 'approved' && !isGM
  const supplyUsed = (roster.unit ?? []).reduce((s, u) => s + (u.points ?? 0), 0)
  const overSupply = supplyUsed > roster.supply_limit
  const relicCount = (roster.unit ?? []).filter((u) => u.has_relic).length

  async function setStatus(status) {
    await supabase.from('roster').update({ status, updated_at: new Date().toISOString() }).eq('id', roster.id)
    if (status === 'approved') {
      const owner = players.find((p) => p.user_id === roster.player_id)
      notifyRosterApproved(campaign.webhook_roster_approved, {
        player: owner?.profile?.display_name ?? 'Unknown', faction: roster.faction, roster: roster.name,
      })
      recordEvent(campaign.id, 'roster_approved',
        `${roster.name} sanctioned for war${roster.faction ? ` (${roster.faction})` : ''}.`,
        { roster_id: roster.id })
    }
    reload()
  }

  return (
    <div className="space-y-6">
      {evacConfirm && (
        <div className="panel border-imperial p-4 space-y-2">
          <p className="eyebrow text-emberlight">Evacuate {roster.name}</p>
          <p className="font-mono text-xs text-bone">All their territory reverts to unclaimed, armies leave the map,
            and the roster is marked departed. Battles, units, and chronicle entries are preserved. Territory does not return.</p>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={async () => {
              const { error } = await supabase.rpc('evacuate_roster', { rid: roster.id })
              toast(error ? `Evacuation failed: ${error.message}` : `${roster.name} has withdrawn from the sector.`, error ? 'error' : 'info')
              setEvacConfirm(false); reload()
            }}>Confirm withdrawal</button>
            <button className="btn-ghost" onClick={() => setEvacConfirm(false)}>Cancel</button>
          </div>
        </div>
      )}
      <Panel
        title={`Order of Battle // ${roster.name}`}
        right={<div className="flex items-center gap-2">
          <Badge>{roster.status}</Badge>
          {isGM && roster.status === 'pending_approval' && (
            <button className="btn-brass text-xs" onClick={() => setStatus('approved')}>Approve</button>
          )}
          {isGM && roster.status === 'approved' && (
            <button className="btn-ghost text-xs" onClick={() => setStatus('pending_approval')}>Unlock composition</button>
          )}
          {isGM && roster.status !== 'departed' && (
            <button className="btn-ghost text-xs" onClick={() => setEvacConfirm(true)}>Evacuate…</button>
          )}
        </div>}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono text-sm">
          <Stat label="Supply used" value={`${supplyUsed} / ${roster.supply_limit}`} warn={overSupply} />
          <Stat label="Requisition" value={`${roster.requisition_points} RP`} />
          <Stat label="Units" value={roster.unit?.length ?? 0} />
          <Stat label="Relics" value={relicCount} warn={relicCount > 1} />
        </div>
        {overSupply && <p className="text-emberlight text-xs font-mono mt-3">⚠ Supply limit exceeded — the GM has been notified by the warp itself.</p>}
        {relicCount > 1 && <p className="text-emberlight text-xs font-mono mt-1">⚠ More than one relic in this force — check campaign restrictions.</p>}
        {compositionLocked && <p className="text-ash text-xs font-mono mt-3">Composition locked (roster approved). Crusade card fields — XP, honours, scars, notes — remain editable.</p>}
        {(isOwner || isGM) && (
          <div className="mt-4 max-w-sm">
            <AssetInput label="Army icon (map token)" value={roster.icon_url}
              onChange={async (url) => {
                await supabase.from('roster').update({ icon_url: url, updated_at: new Date().toISOString() }).eq('id', roster.id)
                reload()
              }}
              campaignId={campaign.id} prefix={`army-${roster.id.slice(0, 8)}`} />
            <p className="font-mono text-[10px] text-ash mt-1">Square images work best — rendered as a circular token ringed in your force colour. Without one, the tactical abbreviation token is used.</p>
          </div>
        )}
      </Panel>

      {(isOwner || isGM) && !compositionLocked && <ImportPanel roster={roster} reload={reload} />}

      <div className="space-y-3">
        <p className="eyebrow">Crusade cards</p>
        {(roster.unit ?? []).length === 0
          ? <Empty>No units on record. Import your list above.</Empty>
          : roster.unit.sort((a, b) => b.points - a.points).map((u) => (
            <UnitCard key={u.id} unit={u} editable={isOwner || isGM} isGM={isGM} compositionLocked={compositionLocked} campaign={campaign} currentTurn={currentTurn} reload={reload} />
          ))}
      </div>
    </div>
  )
}

function Stat({ label, value, warn }) {
  return (
    <div>
      <p className="lbl">{label}</p>
      <p className={`text-lg ${warn ? 'text-emberlight' : 'text-bone'}`}>{value}</p>
    </div>
  )
}

function ImportPanel({ roster, reload }) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)

  function parse() { setPreview(parseImport(text)) }

  async function commit() {
    setBusy(true)
    const rows = preview.units.map((u) => ({
      roster_id: roster.id,
      name: u.name, points: u.points, power_level: u.power_level,
      battlefield_role: u.battlefield_role, unit_type: u.unit_type,
      model_count: u.model_count, keywords: u.keywords ?? [],
      wargear_notes: u.wargear_notes, raw_notes: u.raw_notes,
    }))
    if (rows.length) await supabase.from('unit').insert(rows)
    await supabase.from('roster').update({
      import_raw: text,
      notes: preview.leftovers ? `Unparsed import lines:\n${preview.leftovers}` : roster.notes,
      updated_at: new Date().toISOString(),
    }).eq('id', roster.id)
    setBusy(false); setText(''); setPreview(null)
    reload()
  }

  return (
    <Panel title="Import army list" right={<span className="font-mono text-[10px] text-ash">Listforge JSON · Newrecruit · plain text</span>}>
      <textarea className="field font-mono text-xs" rows={6} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={'Paste your export here, e.g.\nLeman Russ Battle Tank (170 pts)\n10x Cadian Shock Troops - 65\n- Plasma gun, vox-caster'} />
      <div className="flex gap-2 mt-3">
        <button className="btn-brass" onClick={parse} disabled={!text.trim()}>Parse</button>
        {preview && <button className="btn-primary" onClick={commit} disabled={busy || !preview.units.length}>Add {preview.units.length} unit(s)</button>}
      </div>
      {preview && (
        <div className="mt-4 text-sm">
          <p className="font-mono text-[11px] text-ash mb-2">Format: {preview.format} · {preview.units.length} units detected</p>
          <ul className="space-y-1">
            {preview.units.map((u, i) => (
              <li key={i} className="flex justify-between border-b border-line/40 py-1">
                <span>{u.model_count ? `${u.model_count}× ` : ''}{u.name}
                  {u.confidence !== 'high' && <span className="text-brass font-mono text-[10px] ml-2">CHECK</span>}
                </span>
                <span className="font-mono text-ash">{u.points} pts</span>
              </li>
            ))}
          </ul>
          {preview.leftovers && (
            <p className="text-brass font-mono text-[11px] mt-2 whitespace-pre-wrap">
              Unparsed (kept in roster notes, nothing is dropped):{'\n'}{preview.leftovers}
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}

function UnitCard({ unit, editable, isGM, compositionLocked, campaign, currentTurn, reload }) {
  const inRecovery = campaign.attrition_enabled && unit.recovering_until_turn != null
    && (currentTurn?.turn_number ?? 0) <= unit.recovering_until_turn
  const [open, setOpen] = useState(false)
  const [u, setU] = useState(unit)
  const [entry, setEntry] = useState('')
  const [entryWarn, setEntryWarn] = useState(null)
  const [history, setHistory] = useState(null)

  useEffect(() => {
    if (!open || history !== null) return
    supabase.from('battle_unit')
      .select('marked_for_greatness, destroyed_in_battle, side, battle:battle_id(id, mission, attacker_result, played_at, status)')
      .eq('unit_id', unit.id)
      .then(({ data }) => setHistory((data ?? []).filter((x) => x.battle?.status === 'verified')))
  }, [open])
  const set = (k) => (e) => setU({ ...u, [k]: e.target?.type === 'checkbox' ? e.target.checked : e.target.value })

  async function save() {
    const patch = compositionLocked
      ? { name: u.name, notes: u.notes, has_relic: u.has_relic, relic_name: u.relic_name,
          is_destroyed: u.is_destroyed, is_in_reserve: u.is_in_reserve }
      : { ...u, points: Number(u.points) }
    if (isGM) patch.xp_total = Number(u.xp_total)
    else delete patch.xp_total
    delete patch.id; delete patch.created_at; delete patch.roster_id
    patch.updated_at = new Date().toISOString()
    await supabase.from('unit').update(patch).eq('id', unit.id)
    setOpen(false); reload()
  }

  async function addEntry(kind) {
    const name = entry.trim()
    if (!name) return
    setEntryWarn(kind === 'battle_honours' && campaign.unique_honours?.includes(name)
      ? `"${name}" is campaign-unique — check no other unit already carries it.` : null)
    const list = [...(unit[kind] ?? []), { type: kind, name, description: '', gained_at_battle_id: null }]
    await supabase.from('unit').update({ [kind]: list, updated_at: new Date().toISOString() }).eq('id', unit.id)
    recordEvent(campaign.id, kind === 'battle_honours' ? 'honour_gained' : 'scar_gained',
      `${unit.name} ${kind === 'battle_honours' ? 'earns the honour' : 'suffers the scar'} "${name}".`,
      { unit_id: unit.id })
    setEntry('')
    reload()
  }

  async function removeEntry(kind, index) {
    const list = (unit[kind] ?? []).filter((_, i) => i !== index)
    await supabase.from('unit').update({ [kind]: list, updated_at: new Date().toISOString() }).eq('id', unit.id)
    reload()
  }

  return (
    <div className={`panel p-4 ${unit.is_destroyed ? 'opacity-50' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="h-display text-lg">{unit.name}</span>
          <span className="font-mono text-[11px] text-ash ml-3">
            {unit.battlefield_role ?? unit.unit_type ?? '—'} · {unit.points} pts
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span className="text-brasslight">{unit.xp_total} XP · {rankFor(unit.xp_total)}</span>
          <span className="text-ash">CP {crusadePoints(unit)}</span>
          {unit.has_relic && <Badge tone="mustering">Relic</Badge>}
          {unit.is_destroyed && <Badge tone="disputed">Destroyed</Badge>}
          {inRecovery && <Badge tone="pending">Recovering — until T{unit.recovering_until_turn}</Badge>}
          {editable && <button className="btn-ghost text-[10px]" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Edit'}</button>}
        </div>
      </div>
      {(unit.battle_honours?.length > 0 || unit.battle_scars?.length > 0) && (
        <p className="font-mono text-[11px] mt-2">
          {unit.battle_honours?.map((h, i) => <span key={i} className="text-brasslight mr-3">✦ {h.name}</span>)}
          {unit.battle_scars?.map((s, i) => <span key={i} className="text-emberlight mr-3">✖ {s.name}</span>)}
        </p>
      )}
      {unit.wargear_notes && <p className="text-ash text-xs mt-1">{unit.wargear_notes}</p>}
      {open && (
        <div className="mt-4 grid md:grid-cols-2 gap-3 border-t border-line/60 pt-4">
          <Field label="Name"><input className="field" value={u.name} onChange={set('name')} /></Field>
          <Field label={isGM ? 'XP total (GM override)' : 'XP total (managed by verification)'}>
            <input className="field" type="number" value={u.xp_total} onChange={set('xp_total')} disabled={!isGM} />
          </Field>
          {!compositionLocked && <>
            <Field label="Points"><input className="field" type="number" value={u.points ?? 0} onChange={set('points')} /></Field>
            <Field label="Battlefield role"><input className="field" value={u.battlefield_role ?? ''} onChange={set('battlefield_role')} /></Field>
            <Field label="Wargear"><input className="field" value={u.wargear_notes ?? ''} onChange={set('wargear_notes')} /></Field>
          </>}
          <Field label="Relic name"><input className="field" value={u.relic_name ?? ''} onChange={set('relic_name')} /></Field>
          <div className="flex gap-4 items-end pb-1 font-mono text-xs">
            <label className="flex gap-2 items-center"><input type="checkbox" checked={u.has_relic} onChange={set('has_relic')} /> Relic</label>
            <label className="flex gap-2 items-center"><input type="checkbox" checked={u.is_destroyed} onChange={set('is_destroyed')} /> Destroyed</label>
            <label className="flex gap-2 items-center"><input type="checkbox" checked={u.is_in_reserve} onChange={set('is_in_reserve')} /> Reserve</label>
          </div>
          <Field label="Notes"><textarea className="field" rows={2} value={u.notes ?? ''} onChange={set('notes')} /></Field>
          {unit.raw_notes && <Field label="Unparsed import data"><pre className="text-[10px] text-ash whitespace-pre-wrap">{unit.raw_notes}</pre></Field>}
          {(unit.battle_honours?.length > 0 || unit.battle_scars?.length > 0) && (
            <div className="md:col-span-2 flex flex-wrap gap-2 font-mono text-[11px]">
              {unit.battle_honours?.map((h, i) => (
                <span key={`h${i}`} className="badge border-brass text-brasslight">✦ {h.name}
                  <button className="ml-1 text-ash hover:text-emberlight" onClick={() => removeEntry('battle_honours', i)}>✕</button>
                </span>
              ))}
              {unit.battle_scars?.map((s, i) => (
                <span key={`s${i}`} className="badge border-imperial text-emberlight">✖ {s.name}
                  <button className="ml-1 text-ash hover:text-bone" onClick={() => removeEntry('battle_scars', i)}>✕</button>
                </span>
              ))}
            </div>
          )}
          <div className="md:col-span-2 flex flex-wrap gap-2 items-center">
            <button className="btn-primary" onClick={save}>Save</button>
            <input className="field !w-56" placeholder="Honour or scar name…" value={entry}
              onChange={(e) => setEntry(e.target.value)} list={`honours-${unit.id}`} />
            <datalist id={`honours-${unit.id}`}>
              {(campaign.unique_honours ?? []).map((h) => <option key={h} value={h} />)}
            </datalist>
            <button className="btn-brass" disabled={!entry.trim()} onClick={() => addEntry('battle_honours')}>+ Honour</button>
            <button className="btn-ghost" disabled={!entry.trim()} onClick={() => addEntry('battle_scars')}>+ Scar</button>
          </div>
          {entryWarn && <p className="md:col-span-2 text-brass font-mono text-[11px]">⚠ {entryWarn}</p>}
          {history?.length > 0 && (
            <div className="md:col-span-2 border-t border-line/40 pt-3">
              <p className="lbl">Battle record</p>
              <ul className="font-mono text-[11px] space-y-1">
                {history.map((h, i) => {
                  const won = (h.side === 'attacker') === (h.battle.attacker_result === 'victory')
                  return (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="text-ash truncate">{h.battle.played_at} · {h.battle.mission || 'unnamed mission'}</span>
                      <span className="shrink-0">
                        {h.battle.attacker_result === 'draw' ? <span className="text-ash">draw</span>
                          : won ? <span className="text-brasslight">victory</span>
                          : <span className="text-emberlight">defeat</span>}
                        {h.marked_for_greatness && ' ★'}{h.destroyed_in_battle && ' ✖'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
