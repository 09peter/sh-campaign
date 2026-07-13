import { useEffect, useState } from 'react'
import { Routes, Route, Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/Auth'
import { notifyBattleReported, notifyBattleVerified, notifyDispute } from '../lib/discord'
import { Panel, Badge, Field, Empty } from '../components/ui'

export default function Battles(ctx) {
  return (
    <Routes>
      <Route index element={<BattleList {...ctx} />} />
      <Route path="new" element={<BattleForm {...ctx} />} />
      <Route path=":battleId" element={<BattleDetail {...ctx} />} />
    </Routes>
  )
}

const rosterName = (rosters, id) => rosters.find((r) => r.id === id)?.name ?? '?'

function BattleList({ campaign, rosters }) {
  const [battles, setBattles] = useState(null)
  useEffect(() => {
    supabase.from('battle').select('*').eq('campaign_id', campaign.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setBattles(data ?? []))
  }, [campaign.id])

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="h-display text-2xl">Battle log</h2>
        <Link to="new" className="btn-primary">File battle report</Link>
      </div>
      {battles === null ? <Empty>Retrieving after-action reports…</Empty>
        : battles.length === 0 ? <Empty>No engagements on record. The sector is quiet — for now.</Empty>
        : battles.map((b) => (
          <Link key={b.id} to={b.id} className="block panel p-4 hover:border-brass">
            <div className="flex flex-wrap justify-between gap-2 items-center">
              <span>
                <strong>{rosterName(rosters, b.attacker_roster_id)}</strong>
                <span className="text-ash mx-2">vs</span>
                <strong>{rosterName(rosters, b.defender_roster_id)}</strong>
              </span>
              <div className="flex gap-2 items-center">
                {b.attacker_result && <span className="font-mono text-[11px] text-ash">
                  {b.attacker_result === 'victory' ? 'Attacker victory' : b.attacker_result === 'defeat' ? 'Defender victory' : 'Draw'}
                </span>}
                <Badge>{b.status}</Badge>
              </div>
            </div>
            <p className="font-mono text-[11px] text-ash mt-1">{b.mission ?? 'Mission unrecorded'} · {b.played_at}</p>
          </Link>
        ))}
    </div>
  )
}

function BattleForm({ campaign, rosters, myRoster }) {
  const { user } = useAuth()
  const nav = useNavigate()
  const [f, setF] = useState({
    attacker_roster_id: myRoster?.id ?? '', defender_roster_id: '',
    mission: '', mission_type: '', battle_size: 'incursion',
    played_at: new Date().toISOString().slice(0, 10),
  })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (f.attacker_roster_id === f.defender_roster_id) return setError('A force cannot fight itself, however grim the times.')
    const { data, error } = await supabase.from('battle')
      .insert({ ...f, campaign_id: campaign.id, created_by: user.id }).select('id').single()
    if (error) return setError(error.message)
    nav(`../${data.id}`)
  }

  return (
    <Panel title="Departmento Munitorum // New battle report" className="max-w-2xl">
      <form onSubmit={submit} className="grid md:grid-cols-2 gap-4">
        <Field label="Attacker">
          <select className="field" value={f.attacker_roster_id} onChange={set('attacker_roster_id')} required>
            <option value="">Select force…</option>
            {rosters.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Defender">
          <select className="field" value={f.defender_roster_id} onChange={set('defender_roster_id')} required>
            <option value="">Select force…</option>
            {rosters.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Mission"><input className="field" value={f.mission} onChange={set('mission')} /></Field>
        <Field label="Battle size">
          <select className="field" value={f.battle_size} onChange={set('battle_size')}>
            <option value="combat_patrol">Combat Patrol</option>
            <option value="incursion">Incursion</option>
            <option value="strike_force">Strike Force</option>
            <option value="onslaught">Onslaught</option>
          </select>
        </Field>
        <Field label="Date played"><input className="field" type="date" value={f.played_at} onChange={set('played_at')} /></Field>
        {error && <p className="text-emberlight text-sm font-mono md:col-span-2">{error}</p>}
        <div className="md:col-span-2"><button className="btn-primary">Create draft</button></div>
      </form>
    </Panel>
  )
}

function BattleDetail({ campaign, rosters, isGM, currentTurn, reload }) {
  const { battleId } = useParams()
  const { user } = useAuth()
  const [battle, setBattle] = useState(null)
  const [bus, setBus] = useState([])
  const [units, setUnits] = useState([])
  const [err, setErr] = useState(null)
  const [disputeOpen, setDisputeOpen] = useState(false)
  const [disputeReason, setDisputeReason] = useState('')

  async function load() {
    const [{ data: b }, { data: rows }] = await Promise.all([
      supabase.from('battle').select('*').eq('id', battleId).single(),
      supabase.from('battle_unit').select('*').eq('battle_id', battleId),
    ])
    setBattle(b); setBus(rows ?? [])
    if (b) {
      const { data: us } = await supabase.from('unit').select('id,name,roster_id,points,is_destroyed,recovering_until_turn')
        .in('roster_id', [b.attacker_roster_id, b.defender_roster_id])
      setUnits(us ?? [])
    }
  }
  useEffect(() => { load() }, [battleId])

  if (!battle) return <Empty>Retrieving report…</Empty>

  const attRoster = rosters.find((r) => r.id === battle.attacker_roster_id)
  const defRoster = rosters.find((r) => r.id === battle.defender_roster_id)
  const myRosterIds = rosters.filter((r) => r.player_id === user.id).map((r) => r.id)
  const isParticipant = myRosterIds.includes(battle.attacker_roster_id) || myRosterIds.includes(battle.defender_roster_id)
  const isReporter = battle.created_by === user.id
  const canEdit = (isGM || isParticipant) && ['draft', 'pending_verification'].includes(battle.status)
  const canVerify = battle.status === 'pending_verification' && (isGM || (isParticipant && !isReporter))

  async function patch(p) {
    setErr(null)
    const { error } = await supabase.from('battle').update({ ...p, updated_at: new Date().toISOString() }).eq('id', battle.id)
    if (error) setErr(error.message); else load()
  }

  async function toggleUnit(unitId, side) {
    const existing = bus.find((x) => x.unit_id === unitId)
    if (existing) await supabase.from('battle_unit').delete().eq('id', existing.id)
    else await supabase.from('battle_unit').insert({ battle_id: battle.id, unit_id: unitId, side })
    load()
  }

  async function setMfG(buId, side) {
    // clear existing MfG on this side first (one per side, DB-enforced)
    const current = bus.find((x) => x.side === side && x.marked_for_greatness)
    if (current && current.id !== buId)
      await supabase.from('battle_unit').update({ marked_for_greatness: false }).eq('id', current.id)
    const target = bus.find((x) => x.id === buId)
    await supabase.from('battle_unit').update({ marked_for_greatness: !target.marked_for_greatness }).eq('id', buId)
    load()
  }

  async function submitForVerification() {
    await patch({ status: 'pending_verification' })
    notifyBattleReported(campaign.webhook_battle_reported, {
      attacker: attRoster?.name, defender: defRoster?.name,
      mission: battle.mission, result: battle.attacker_result, notes: battle.narrative_notes,
    })
  }

  async function verify() {
    setErr(null)
    // Deltas are recomputed server-side inside the RPC — single transaction,
    // tamper-proof. The response carries the applied XP summary for Discord.
    const { data, error } = await supabase.rpc('verify_battle', { bid: battle.id })
    if (error) return setErr(error.message)
    notifyBattleVerified(campaign.webhook_battle_verified, {
      attacker: attRoster?.name, defender: defRoster?.name,
      result: battle.attacker_result, xpSummary: (data?.units ?? []).join('\n'),
    })
    reload(); load()
  }

  async function amend() {
    setErr(null)
    const { error } = await supabase.rpc('amend_battle', { bid: battle.id })
    if (error) return setErr(error.message)
    reload(); load()
  }

  async function dispute() {
    await patch({ status: 'disputed', dispute_reason: disputeReason })
    notifyDispute(campaign.webhook_dispute_raised, {
      attacker: attRoster?.name, defender: defRoster?.name, reason: disputeReason,
    })
    setDisputeOpen(false); setDisputeReason('')
  }

  const side = (rid) => rid === battle.attacker_roster_id ? 'attacker' : 'defender'

  return (
    <div className="space-y-6 max-w-3xl">
      <Panel
        title={`After-action report // ${attRoster?.name} vs ${defRoster?.name}`}
        right={<Badge>{battle.status}</Badge>}
      >
        {battle.status === 'disputed' && (
          <div className="border border-imperial rounded-sm p-3 mb-4">
            <p className="text-emberlight font-mono text-xs">DISPUTED: {battle.dispute_reason || 'no reason given'}</p>
            {isGM && (
              <div className="flex gap-2 mt-2">
                <button className="btn-brass text-xs" onClick={() => patch({ status: 'pending_verification', dispute_reason: null })}>Return for verification</button>
                <button className="btn-ghost text-xs" onClick={() => patch({ status: 'void' })}>Void battle</button>
              </div>
            )}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Mission">
            <input className="field" disabled={!canEdit} value={battle.mission ?? ''}
              onChange={(e) => setBattle({ ...battle, mission: e.target.value })}
              onBlur={(e) => canEdit && patch({ mission: e.target.value })} />
          </Field>
          <Field label="Result (attacker)">
            <select className="field" disabled={!canEdit} value={battle.attacker_result ?? ''}
              onChange={(e) => patch({ attacker_result: e.target.value || null })}>
              <option value="">Undecided</option>
              <option value="victory">Attacker victory</option>
              <option value="defeat">Defender victory</option>
              <option value="draw">Draw</option>
            </select>
          </Field>
          <Field label="Attacker agenda">
            <div className="flex gap-2">
              <input className="field" disabled={!canEdit} defaultValue={battle.agenda_attacker ?? ''}
                onBlur={(e) => canEdit && patch({ agenda_attacker: e.target.value })} />
              <label className="font-mono text-[10px] flex items-center gap-1 whitespace-nowrap">
                <input type="checkbox" disabled={!canEdit} checked={battle.agenda_attacker_achieved}
                  onChange={(e) => patch({ agenda_attacker_achieved: e.target.checked })} /> done
              </label>
            </div>
          </Field>
          <Field label="Defender agenda">
            <div className="flex gap-2">
              <input className="field" disabled={!canEdit} defaultValue={battle.agenda_defender ?? ''}
                onBlur={(e) => canEdit && patch({ agenda_defender: e.target.value })} />
              <label className="font-mono text-[10px] flex items-center gap-1 whitespace-nowrap">
                <input type="checkbox" disabled={!canEdit} checked={battle.agenda_defender_achieved}
                  onChange={(e) => patch({ agenda_defender_achieved: e.target.checked })} /> done
              </label>
            </div>
          </Field>
          <div className="md:col-span-2">
            <Field label="Narrative — from the front">
              <textarea className="field" rows={3} disabled={!canEdit} defaultValue={battle.narrative_notes ?? ''}
                onBlur={(e) => canEdit && patch({ narrative_notes: e.target.value })} />
            </Field>
          </div>
          <label className="font-mono text-xs flex items-center gap-2">
            <input type="checkbox" disabled={!canEdit} checked={battle.is_crushing_defeat}
              onChange={(e) => patch({ is_crushing_defeat: e.target.checked })} />
            Crushing defeat (both commanders agree — loser retreats to nearest friendly territory)
          </label>
        </div>
      </Panel>

      <div className="grid md:grid-cols-2 gap-6">
        {[[attRoster, 'attacker'], [defRoster, 'defender']].map(([r, s]) => (
          <Panel key={s} title={`${s === 'attacker' ? '⚔ Attacker' : '🛡 Defender'} // ${r?.name ?? '?'}`}>
            <ul className="space-y-1 text-sm">
              {units.filter((u) => u.roster_id === r?.id).map((u) => {
                const bu = bus.find((x) => x.unit_id === u.id)
                const unavailable = u.is_destroyed ||
                  (campaign.attrition_enabled && u.recovering_until_turn != null
                    && (currentTurn?.turn_number ?? 0) <= u.recovering_until_turn)
                return (
                  <li key={u.id} className="flex items-center justify-between gap-2">
                    <label className={`flex items-center gap-2 ${unavailable ? 'opacity-40' : ''}`}
                      title={unavailable ? 'Unavailable — destroyed or in recovery' : undefined}>
                      <input type="checkbox" disabled={!canEdit || (unavailable && !bu)} checked={!!bu} onChange={() => toggleUnit(u.id, s)} />
                      <span className={bu ? '' : 'text-ash'}>{u.name}{unavailable ? ' ✚' : ''}</span>
                    </label>
                    {bu && (
                      <span className="flex gap-2 font-mono text-[10px]">
                        <button disabled={!canEdit} onClick={() => setMfG(bu.id, s)}
                          className={bu.marked_for_greatness ? 'text-brasslight' : 'text-ash hover:text-bone'}>
                          {bu.marked_for_greatness ? '★ MARKED' : '☆ mark'}
                        </button>
                        <button disabled={!canEdit}
                          onClick={async () => { await supabase.from('battle_unit').update({ destroyed_in_battle: !bu.destroyed_in_battle }).eq('id', bu.id); load() }}
                          className={bu.destroyed_in_battle ? 'text-emberlight' : 'text-ash hover:text-bone'}>
                          {bu.destroyed_in_battle ? '✖ LOST' : 'lost?'}
                        </button>
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
            <p className="font-mono text-[10px] text-ash mt-3">One ★ Marked for Greatness per side (+{campaign.xp_marked_for_greatness} XP).</p>
          </Panel>
        ))}
      </div>

      {err && <p className="text-emberlight font-mono text-sm">{err}</p>}

      <div className="flex flex-wrap gap-2">
        {battle.status === 'draft' && canEdit && (
          <button className="btn-primary" onClick={submitForVerification} disabled={!battle.attacker_result}>
            Submit for verification
          </button>
        )}
        {canVerify && !disputeOpen && <>
          <button className="btn-primary" onClick={verify}>Verify — apply XP &amp; RP</button>
          <button className="btn-ghost" onClick={() => setDisputeOpen(true)}>Dispute…</button>
        </>}
        {battle.status === 'verified' && (
          <button className="btn-brass" onClick={() => window.print()}>Export report (print / PDF)</button>
        )}
        {isGM && battle.status === 'verified' && (
          <button className="btn-ghost" onClick={amend}>Amend — reverse XP/RP &amp; reopen</button>
        )}
        {battle.status === 'verified' && (
          <span className="font-mono text-[10px] text-ash self-center">
            Verified {new Date(battle.verified_at).toLocaleString('de-AT')}.
            {isGM && ' Amending before turn completion is safe; after, fix territory on the map by hand.'}
          </span>
        )}
      </div>

      {disputeOpen && (
        <div className="panel border-imperial p-4 space-y-3 max-w-xl">
          <p className="eyebrow text-emberlight">Raise dispute — GM adjudicates</p>
          <textarea className="field" rows={3} autoFocus placeholder="Grounds for dispute…"
            value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={!disputeReason.trim()} onClick={dispute}>Submit dispute</button>
            <button className="btn-ghost" onClick={() => { setDisputeOpen(false); setDisputeReason('') }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
