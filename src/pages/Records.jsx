import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rankFor } from '../lib/xp'
import { Panel, Empty } from '../components/ui'

// Records & statistics — derived entirely from existing tables and the
// chronicle. VP-over-turns comes from turn_completed event payloads. Charts
// are plain SVG to stay dependency-free.

export default function Records({ campaign, rosters }) {
  const [data, setData] = useState(null)
  const active = rosters.filter((r) => r.status !== 'departed')

  useEffect(() => {
    (async () => {
      const [{ data: battles }, { data: turnEvents }, { data: mfg }] = await Promise.all([
        supabase.from('battle').select('attacker_roster_id,defender_roster_id,attacker_result')
          .eq('campaign_id', campaign.id).eq('status', 'verified'),
        supabase.from('campaign_event').select('turn_number,payload')
          .eq('campaign_id', campaign.id).eq('event_type', 'turn_completed')
          .order('turn_number'),
        supabase.from('battle_unit').select('unit_id, marked_for_greatness, battle:battle_id(campaign_id,status)')
          .eq('marked_for_greatness', true),
      ])
      setData({
        battles: battles ?? [],
        vpSeries: (turnEvents ?? []).map((e) => ({ turn: e.turn_number, vp: e.payload?.vp ?? {} })),
        mfgCounts: (mfg ?? []).filter((x) => x.battle?.campaign_id === campaign.id && x.battle?.status === 'verified')
          .reduce((acc, x) => ({ ...acc, [x.unit_id]: (acc[x.unit_id] ?? 0) + 1 }), {}),
      })
    })()
  }, [campaign.id])

  if (!data) return <Empty>Compiling the sector archives…</Empty>
  const { battles, vpSeries, mfgCounts } = data

  // ---- matchup grid (row = force, col = opponent, cell = W–L)
  const record = (a, b) => {
    let w = 0, l = 0
    for (const bt of battles) {
      if (bt.attacker_result === 'draw' || !bt.attacker_result) continue
      const attWon = bt.attacker_result === 'victory'
      if (bt.attacker_roster_id === a && bt.defender_roster_id === b) { attWon ? w++ : l++ }
      if (bt.defender_roster_id === a && bt.attacker_roster_id === b) { attWon ? l++ : w++ }
    }
    return { w, l }
  }

  // ---- XP leaderboard across all units
  const allUnits = rosters.flatMap((r) => (r.unit ?? []).map((u) => ({ ...u, force: r.name })))
  const topXP = [...allUnits].sort((a, b) => b.xp_total - a.xp_total).slice(0, 8)
  const decorated = [...allUnits]
    .map((u) => ({ ...u, honours: u.battle_honours?.length ?? 0, mfg: mfgCounts[u.id] ?? 0 }))
    .sort((a, b) => b.honours - a.honours || b.mfg - a.mfg)
    .filter((u) => u.honours + u.mfg > 0).slice(0, 5)

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Panel title="Strategium // Head-to-head record" className="lg:col-span-2">
        {active.length < 2 || battles.length === 0 ? <Empty>No verified battles yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead>
                <tr className="font-mono text-[10px] uppercase tracking-widest text-ash">
                  <th className="text-left py-2">vs →</th>
                  {active.map((r) => <th key={r.id} className="px-2 text-center">{r.name.slice(0, 12)}</th>)}
                </tr>
              </thead>
              <tbody>
                {active.map((row) => (
                  <tr key={row.id} className="border-t border-line/40">
                    <td className="py-2 pr-2">{row.name}</td>
                    {active.map((col) => {
                      if (row.id === col.id) return <td key={col.id} className="text-center text-ash/30">—</td>
                      const { w, l } = record(row.id, col.id)
                      return (
                        <td key={col.id} className={`text-center font-mono ${
                          w > l ? 'text-brasslight' : l > w ? 'text-emberlight' : 'text-ash'}`}>
                          {w + l === 0 ? '·' : `${w}–${l}`}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Territory // VP over campaign turns">
        {vpSeries.length < 2 ? <Empty>Graph appears after two completed turns.</Empty>
          : <VPChart series={vpSeries} rosters={active} />}
      </Panel>

      <Panel title="Honour roll // Experience leaders">
        {topXP.filter((u) => u.xp_total > 0).length === 0 ? <Empty>No experience earned yet.</Empty> : (
          <ol className="space-y-1.5">
            {topXP.filter((u) => u.xp_total > 0).map((u, i) => (
              <li key={u.id} className="flex justify-between items-baseline text-sm border-b border-line/30 pb-1.5">
                <span>
                  <span className="font-mono text-brass mr-2">{String(i + 1).padStart(2, '0')}</span>
                  {u.name} <span className="text-ash font-mono text-[10px]">· {u.force}</span>
                </span>
                <span className="font-mono text-xs text-brasslight">{u.xp_total} XP · {rankFor(u.xp_total)}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {decorated.length > 0 && (
        <Panel title="Most decorated" className="lg:col-span-2">
          <ul className="grid md:grid-cols-2 gap-2 text-sm">
            {decorated.map((u) => (
              <li key={u.id} className="flex justify-between border border-line/40 rounded-sm px-3 py-2">
                <span>{u.name} <span className="text-ash font-mono text-[10px]">· {u.force}</span></span>
                <span className="font-mono text-[11px] text-brasslight">
                  {u.honours > 0 && `${u.honours}✦ `}{u.mfg > 0 && `${u.mfg}★`}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}

const CHART_COLORS = ['#C0983E', '#A62B21', '#4F7A5B', '#5B6FA6', '#8E5BA6', '#A6785B', '#5BA6A0', '#7A7A4F']

function VPChart({ series, rosters }) {
  const W = 480, H = 180, PAD = 28
  const maxVP = Math.max(1, ...series.flatMap((s) => rosters.map((r) => s.vp[r.id] ?? 0)))
  const x = (i) => PAD + (i / Math.max(1, series.length - 1)) * (W - PAD * 2)
  const y = (v) => H - PAD - (v / maxVP) * (H - PAD * 2)

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#3A3F2A" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#3A3F2A" />
        <text x={PAD - 6} y={PAD + 4} textAnchor="end" fontSize="9" fill="#8B876F" fontFamily="IBM Plex Mono">{maxVP}</text>
        <text x={PAD - 6} y={H - PAD + 3} textAnchor="end" fontSize="9" fill="#8B876F" fontFamily="IBM Plex Mono">0</text>
        {series.map((s, i) => (
          <text key={i} x={x(i)} y={H - PAD + 14} textAnchor="middle" fontSize="9" fill="#8B876F" fontFamily="IBM Plex Mono">T{s.turn}</text>
        ))}
        {rosters.map((r, ri) => {
          const pts = series.map((s, i) => `${x(i)},${y(s.vp[r.id] ?? 0)}`).join(' ')
          return <polyline key={r.id} points={pts} fill="none"
            stroke={CHART_COLORS[ri % CHART_COLORS.length]} strokeWidth="1.8" />
        })}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 font-mono text-[10px]">
        {rosters.map((r, ri) => (
          <span key={r.id} className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 inline-block" style={{ background: CHART_COLORS[ri % CHART_COLORS.length] }} />
            <span className="text-ash">{r.name}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
