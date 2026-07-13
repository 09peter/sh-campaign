import { useEffect, useState, useCallback } from 'react'
import { Routes, Route, NavLink, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/Auth'
import { Badge, Empty } from '../components/ui'
import Overview from './Overview'
import RosterPage from './RosterPage'
import Battles from './Battles'
import MapPage from './MapPage'
import Settings from './Settings'
import Records from './Records'

export default function CampaignLayout() {
  const { id } = useParams()
  const { user, isAdmin } = useAuth()
  const [data, setData] = useState(null)

  const reload = useCallback(async () => {
    const [{ data: campaign }, { data: players }, { data: rosters }, { data: currentTurn }] = await Promise.all([
      supabase.from('campaign').select('*').eq('id', id).single(),
      supabase.from('campaign_player').select('*, profile:user_id(display_name, discord_handle)').eq('campaign_id', id),
      supabase.from('roster').select('*, unit(*)').eq('campaign_id', id),
      supabase.from('campaign_turn').select('id,turn_number,status').eq('campaign_id', id)
        .order('turn_number', { ascending: false }).limit(1).maybeSingle(),
    ])
    setData({ campaign, players: players ?? [], rosters: rosters ?? [], currentTurn: currentTurn ?? null })
  }, [id])

  useEffect(() => { reload() }, [reload])

  // Realtime: campaign, roster, and battle changes refresh the shared layout
  // data (standings, attention strip, roster status) for everyone present.
  useEffect(() => {
    const ch = supabase.channel(`campaign-${id}`)
    for (const table of ['campaign', 'roster', 'battle'])
      ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: table === 'campaign' ? `id=eq.${id}` : `campaign_id=eq.${id}` }, () => reload())
    ch.subscribe()
    return () => supabase.removeChannel(ch)
  }, [id, reload])

  if (!data) return <Empty>Retrieving campaign records…</Empty>
  const { campaign, players, rosters, currentTurn } = data
  if (!campaign) return <Empty>Campaign not found or access denied.</Empty>

  const me = players.find((p) => p.user_id === user.id)
  const isGM = isAdmin || me?.role === 'gm'
  const myRoster = rosters.find((r) => r.player_id === user.id)
  const ctx = { campaign, players, rosters, currentTurn, me, isGM, isAdmin, myRoster, reload }

  const tabs = [
    ['', 'Overview'],
    ['roster', 'Order of Battle'],
    ['battles', 'Battles'],
    ['map', 'Theatre Map'],
    ['records', 'Records'],
    ...(isGM ? [['settings', 'GM Console']] : []),
  ]

  return (
    <div className="pb-16 sm:pb-0">
      <div className="flex flex-wrap items-baseline gap-3 mb-1">
        <h1 className="h-display text-4xl">{campaign.name}</h1>
        <Badge>{campaign.status}</Badge>
        <span className="font-mono text-[11px] text-ash">{campaign.ruleset_label}</span>
      </div>
      <nav className="hidden sm:flex gap-1 border-b border-line mb-6 overflow-x-auto">
        {tabs.map(([path, label]) => (
          <NavLink key={path} to={path} end={path === ''}
            className={({ isActive }) =>
              `h-display text-sm tracking-wider px-4 py-2 border-b-2 -mb-px whitespace-nowrap ${
                isActive ? 'border-brass text-brasslight' : 'border-transparent text-ash hover:text-bone'}`}>
            {label}
          </NavLink>
        ))}
      </nav>
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-slate2/95 backdrop-blur border-t border-line flex">
        {tabs.map(([path, label]) => (
          <NavLink key={path} to={path} end={path === ''}
            className={({ isActive }) =>
              `flex-1 text-center h-display text-[11px] tracking-wider py-3 ${
                isActive ? 'text-brasslight border-t-2 border-brass -mt-px' : 'text-ash'}`}>
            {label.split(' ').pop()}
          </NavLink>
        ))}
      </nav>
      <div className="sm:hidden h-2" />
      <Routes>
        <Route index element={<Overview {...ctx} />} />
        <Route path="roster/:rosterId?" element={<RosterPage {...ctx} />} />
        <Route path="battles/*" element={<Battles {...ctx} />} />
        <Route path="map" element={<MapPage {...ctx} />} />
        <Route path="records" element={<Records {...ctx} />} />
        {isGM && <Route path="settings" element={<Settings {...ctx} />} />}
      </Routes>
    </div>
  )
}
