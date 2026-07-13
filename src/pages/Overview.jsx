import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/Auth'
import { Panel, Badge, Empty } from '../components/ui'

export default function Overview({ campaign, players, rosters, isGM, myRoster }) {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    (async () => {
      const [{ data: battles }, { data: hexes }, { data: turn }] = await Promise.all([
        supabase.from('battle').select('id,attacker_roster_id,defender_roster_id,attacker_result,status,created_by').eq('campaign_id', campaign.id),
        supabase.from('hex_tile').select('id,controlled_by,strategic_value').eq('campaign_id', campaign.id),
        supabase.from('campaign_turn').select('*').eq('campaign_id', campaign.id).order('turn_number', { ascending: false }).limit(1).maybeSingle(),
      ])
      let myOrder = null
      let myArmy = null
      if (turn?.status === 'open' && myRoster) {
        const { data: army } = await supabase.from('army').select('id,status').eq('roster_id', myRoster.id).maybeSingle()
        myArmy = army
        if (army) {
          const { data: mo } = await supabase.from('move_order').select('id').eq('turn_id', turn.id).eq('army_id', army.id).maybeSingle()
          myOrder = mo
        }
      }
      setStats({ battles: battles ?? [], hexes: hexes ?? [], turn: turn ?? null, myOrder, myArmy })
    })()
  }, [campaign.id, myRoster?.id])

  if (!stats) return <Empty>Compiling strategic assessment…</Empty>

  const rows = rosters.filter((r) => r.status !== 'departed').map((r) => {
    const verified = stats.battles.filter((b) => b.status === 'verified')
    const asAtt = verified.filter((b) => b.attacker_roster_id === r.id)
    const asDef = verified.filter((b) => b.defender_roster_id === r.id)
    const wins = asAtt.filter((b) => b.attacker_result === 'victory').length
      + asDef.filter((b) => b.attacker_result === 'defeat').length
    const fought = asAtt.length + asDef.length
    const hexesOwned = stats.hexes.filter((h) => h.controlled_by === r.id)
    const vp = hexesOwned.reduce((s, h) => s + (h.strategic_value ?? 0), 0)
    return { roster: r, fought, wins, losses: fought - wins, hexes: hexesOwned.length, vp }
  }).sort((a, b) => b.vp - a.vp || b.wins - a.wins)

  return (
    <div className="space-y-6">
      <Attention campaign={campaign} rosters={rosters} isGM={isGM} myRoster={myRoster} stats={stats} />
      <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Panel title="Strategium // Standings">
          {rows.length === 0 ? <Empty>No forces mustered yet.</Empty> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left font-mono text-[11px] uppercase tracking-widest text-ash border-b border-line">
                  <th className="py-2">Force</th><th>Faction</th>
                  <th className="text-right">Battles</th><th className="text-right">W–L</th>
                  <th className="text-right">Hexes</th><th className="text-right">VP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ roster: r, fought, wins, losses, hexes, vp }, i) => (
                  <tr key={r.id} className="border-b border-line/40">
                    <td className="py-2">
                      <span className="font-mono text-brass mr-2">{String(i + 1).padStart(2, '0')}</span>
                      {r.name}
                    </td>
                    <td className="text-ash">{r.faction ?? '—'}</td>
                    <td className="text-right font-mono">{fought}</td>
                    <td className="text-right font-mono">{wins}–{losses}</td>
                    <td className="text-right font-mono">{hexes}</td>
                    <td className="text-right font-mono text-brasslight">{vp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Chronicle campaign={campaign} rosters={rosters} />
        {campaign.description && (
          <Panel title="Campaign brief">
            <p className="text-sm text-bone/90 whitespace-pre-wrap">{campaign.description}</p>
          </Panel>
        )}
        {campaign.status === 'completed' && campaign.epilogue && (
          <Panel title="Epilogue">
            <p className="text-sm text-bone/90 whitespace-pre-wrap">{campaign.epilogue}</p>
          </Panel>
        )}
      </div>
      <div className="space-y-6">
        <Panel title="Current turn">
          {stats.turn
            ? <div className="flex items-center justify-between">
                <span className="h-display text-3xl">Turn {stats.turn.turn_number}</span>
                <Badge>{stats.turn.status}</Badge>
              </div>
            : <Empty>Campaign has not begun.</Empty>}
          <Link to="map" className="btn-brass w-full mt-4 block text-center">Open theatre map</Link>
        </Panel>
        <Panel title="Commanders">
          <ul className="space-y-2 text-sm">
            {players.map((p) => (
              <li key={p.id} className="flex items-center justify-between">
                <span>{p.profile?.display_name ?? 'Unknown'}</span>
                {p.role === 'gm' && <Badge tone="active">GM</Badge>}
              </li>
            ))}
          </ul>
        </Panel>
        {campaign.status === 'completed' && (
          <Panel title="Archive">
            <button className="btn-ghost w-full" onClick={() => window.print()}>Print / export campaign record</button>
          </Panel>
        )}
      </div>
      </div>
    </div>
  )
}

// "Needs your attention" — the difference between a tool people update and
// one they forget. Every item links straight to where it's handled.
function Attention({ campaign, rosters, isGM, myRoster, stats }) {
  const { user } = useAuth()
  const base = `/c/${campaign.id}`
  const items = []

  const mine = new Set(rosters.filter((r) => r.player_id === user.id).map((r) => r.id))
  const toVerify = stats.battles.filter((b) =>
    b.status === 'pending_verification' && b.created_by !== user.id &&
    (mine.has(b.attacker_roster_id) || mine.has(b.defender_roster_id)))
  for (const b of toVerify)
    items.push({ to: `${base}/battles/${b.id}`, tone: 'brass', text: 'A battle report awaits your verification' })

  if (isGM) {
    const disputed = stats.battles.filter((b) => b.status === 'disputed')
    for (const b of disputed)
      items.push({ to: `${base}/battles/${b.id}`, tone: 'red', text: 'A dispute requires GM adjudication' })
    const pendingRosters = rosters.filter((r) => r.status === 'pending_approval' && (r.unit?.length ?? 0) > 0)
    for (const r of pendingRosters)
      items.push({ to: `${base}/roster/${r.id}`, tone: 'brass', text: `Roster "${r.name}" awaits approval` })
  }

  if (campaign.status === 'mustering' && !myRoster)
    items.push({ to: `${base}/roster`, tone: 'brass', text: 'Muster your force — the campaign is forming' })

  if (stats.turn?.status === 'open' && stats.myArmy && !stats.myOrder && stats.myArmy.status !== 'broken')
    items.push({ to: `${base}/map`, tone: 'brass', text: `Turn ${stats.turn.turn_number} is open — no orders submitted for your army` })

  if (!items.length) return null
  return (
    <div className="panel border-brass/60">
      <div className="panel-head"><span className="eyebrow">Priority transmissions // Needs your attention</span></div>
      <ul className="p-2">
        {items.map((it, i) => (
          <li key={i}>
            <Link to={it.to}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-sm font-mono text-xs hover:bg-slate2 ${
                it.tone === 'red' ? 'text-emberlight' : 'text-brasslight'}`}>
              <span>{it.tone === 'red' ? '⚠' : '▸'}</span> {it.text}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}


// Campaign chronicle: the event log rendered as a narrative timeline.
function Chronicle({ campaign }) {
  const [events, setEvents] = useState(null)

  useEffect(() => {
    const fetchEvents = () =>
      supabase.from('campaign_event').select('*')
        .eq('campaign_id', campaign.id)
        .order('created_at', { ascending: false }).limit(30)
        .then(({ data }) => setEvents(data ?? []))
    fetchEvents()
    const ch = supabase.channel(`chronicle-${campaign.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'campaign_event', filter: `campaign_id=eq.${campaign.id}` }, fetchEvents)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [campaign.id])

  if (!events?.length) return null
  const ICONS = {
    turn_locked: '🗺', turn_completed: '⏱', battle_verified: '⚔', battle_amended: '✎',
    hex_flipped: '⚑', army_broken: '☠', campaign_completed: '🏆',
    roster_approved: '📜', honour_gained: '✦', scar_gained: '✖',
  }
  return (
    <Panel title="Campaign chronicle" right={<span className="font-mono text-[10px] text-ash">latest 30 entries</span>}>
      <ol className="space-y-2">
        {events.map((e) => (
          <li key={e.id} className="flex gap-3 text-sm border-b border-line/30 pb-2">
            <span className="shrink-0 w-5 text-center">{ICONS[e.event_type] ?? '·'}</span>
            <div className="min-w-0">
              <p className="text-bone/90">{e.message}</p>
              <p className="font-mono text-[10px] text-ash">
                {e.turn_number != null && `Turn ${e.turn_number} · `}
                {new Date(e.created_at).toLocaleString('de-AT')}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
