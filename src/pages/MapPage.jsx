import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { key, axialToPixel, hexCorners, hexesInRadius, radiusForPlayers, reachable, moveCost, distance } from '../lib/hex'
import { TERRAIN, MAP_PRESETS, generatePreset } from '../lib/terrain'
import { resolveLock, MISSION_BY_TERRAIN } from '../lib/resolveTurn'
import { notifyTurnAdvanced, notifyCampaignCompleted } from '../lib/discord'
import { Panel, Badge, Field, Empty } from '../components/ui'
import AssetInput from '../components/AssetInput'
import { useToast } from '../context/Toast'

const SIZE = 30
const ROSTER_COLORS = ['#C0983E', '#A62B21', '#4F7A5B', '#5B6FA6', '#8E5BA6', '#A6785B', '#5BA6A0', '#7A7A4F', '#A65B7C', '#6B8E23', '#4682B4', '#B8860B']

export default function MapPage({ campaign, rosters, isGM, myRoster, reload }) {
  const [state, setState] = useState(null)
  const [selected, setSelected] = useState(null) // hex id
  const [moveMode, setMoveMode] = useState(null) // 'standard' | 'force_march' | null
  const toast = useToast()
  // zoom/pan: null = fit-all; otherwise an explicit viewBox
  const [view, setView] = useState(null)
  const gesture = useRef({ pointers: new Map(), moved: false, panStart: null, pinchStart: null })
  const svgRef = useRef(null)

  const load = useCallback(async () => {
    const [{ data: hexes }, { data: armies }, { data: turn }] = await Promise.all([
      supabase.from('hex_tile').select('*').eq('campaign_id', campaign.id),
      supabase.from('army').select('*').eq('campaign_id', campaign.id),
      supabase.from('campaign_turn').select('*').eq('campaign_id', campaign.id)
        .order('turn_number', { ascending: false }).limit(1).maybeSingle(),
    ])
    let moveOrders = []
    let battleOrders = []
    if (turn) {
      const [mo, bo] = await Promise.all([
        supabase.from('move_order').select('*').eq('turn_id', turn.id),
        supabase.from('battle_order').select('*').eq('turn_id', turn.id),
      ])
      moveOrders = mo.data ?? []; battleOrders = bo.data ?? []
    }
    setState({ hexes: hexes ?? [], armies: armies ?? [], turn, moveOrders, battleOrders })
  }, [campaign.id])
  useEffect(() => { load() }, [load])

  // Realtime: any campaign-scoped change refreshes the map for everyone
  // present — no pull-to-refresh at the club table. Debounced because turn
  // resolution fires many writes in a burst.
  const debounce = useRef(null)
  useEffect(() => {
    const refresh = () => {
      clearTimeout(debounce.current)
      debounce.current = setTimeout(load, 400)
    }
    const ch = supabase.channel(`map-${campaign.id}`)
    for (const table of ['hex_tile', 'army', 'campaign_turn', 'battle_order'])
      ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `campaign_id=eq.${campaign.id}` }, refresh)
    // move_order has no campaign_id column; unfiltered is fine at club scale
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'move_order' }, refresh)
    ch.subscribe()
    return () => { clearTimeout(debounce.current); supabase.removeChannel(ch) }
  }, [campaign.id, load])

  const colorOf = useMemo(() => {
    const m = {}
    rosters.forEach((r, i) => { m[r.id] = ROSTER_COLORS[i % ROSTER_COLORS.length] })
    return m
  }, [rosters])

  if (!state) return <Empty>Rendering auspex feed…</Empty>
  const { hexes, armies, turn, moveOrders, battleOrders } = state

  if (hexes.length === 0) {
    return isGM
      ? <GenerateMap campaign={campaign} onDone={load} />
      : <Empty>The GM has not charted the theatre yet.</Empty>
  }

  const tileByKey = Object.fromEntries(hexes.map((h) => [key(h.q, h.r), h]))
  const hexById = Object.fromEntries(hexes.map((h) => [h.id, h]))
  const myArmy = myRoster && armies.find((a) => a.roster_id === myRoster.id)
  const myOrder = myArmy && moveOrders.find((mo) => mo.army_id === myArmy.id)
  const sel = selected ? hexById[selected] : null

  // Reachable hexes when picking a move
  let reach = {}
  if (moveMode && myArmy?.hex_id) {
    const from = hexById[myArmy.hex_id]
    const max = moveMode === 'force_march' ? campaign.force_march_max : 1
    reach = reachable(key(from.q, from.r), max, tileByKey, moveCost)
  }

  async function clickHex(h) {
    if (moveMode && myArmy && reach[key(h.q, h.r)] !== undefined && turn?.status === 'open') {
      // optimistic: show the arrow immediately, reconcile via load()
      const optimistic = { id: `tmp-${h.id}`, turn_id: turn.id, army_id: myArmy.id, target_hex_id: h.id, move_type: moveMode }
      setState((st) => ({ ...st, moveOrders: [...st.moveOrders.filter((m) => m.army_id !== myArmy.id), optimistic] }))
      const mode = moveMode
      setMoveMode(null)
      const { error } = await supabase.from('move_order').upsert(
        { turn_id: turn.id, army_id: myArmy.id, target_hex_id: h.id, move_type: mode },
        { onConflict: 'turn_id,army_id' })
      if (error) toast(`Order failed: ${error.message}`, 'error')
      else toast(`Orders logged: ${mode === 'force_march' ? 'force march' : 'advance'} to ${h.name || `(${h.q},${h.r})`}.`)
      load()
    } else {
      setSelected(h.id === selected ? null : h.id)
    }
  }

  // ---- zoom & pan (wheel, drag, pinch; double-click resets)
  function currentBox() {
    return view ?? { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }
  function clientToSvg(e) {
    const rect = svgRef.current.getBoundingClientRect()
    const box = currentBox()
    return {
      x: box.x + ((e.clientX - rect.left) / rect.width) * box.w,
      y: box.y + ((e.clientY - rect.top) / rect.height) * box.h,
    }
  }
  function zoomAt(pt, factor) {
    const box = currentBox()
    const w = Math.min(Math.max(box.w * factor, (maxX - minX) / 8), (maxX - minX) * 1.5)
    const h = w * (box.h / box.w)
    setView({ x: pt.x - (pt.x - box.x) * (w / box.w), y: pt.y - (pt.y - box.y) * (h / box.h), w, h })
  }
  function onWheel(e) {
    e.preventDefault()
    zoomAt(clientToSvg(e), e.deltaY > 0 ? 1.15 : 0.87)
  }
  function onPointerDown(e) {
    const g = gesture.current
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    g.moved = false
    if (g.pointers.size === 1) g.panStart = { client: { x: e.clientX, y: e.clientY }, box: currentBox() }
    if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()]
      g.pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), box: currentBox() }
      g.panStart = null
    }
  }
  function onPointerMove(e) {
    const g = gesture.current
    if (!g.pointers.has(e.pointerId)) return
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (g.pointers.size === 2 && g.pinchStart) {
      const [a, b] = [...g.pointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (Math.abs(dist - g.pinchStart.dist) > 4) {
        g.moved = true
        const box = g.pinchStart.box
        const factor = g.pinchStart.dist / dist
        const w = Math.min(Math.max(box.w * factor, (maxX - minX) / 8), (maxX - minX) * 1.5)
        const h = w * (box.h / box.w)
        const cx = box.x + box.w / 2; const cy = box.y + box.h / 2
        setView({ x: cx - w / 2, y: cy - h / 2, w, h })
      }
    } else if (g.pointers.size === 1 && g.panStart) {
      const dx = e.clientX - g.panStart.client.x
      const dy = e.clientY - g.panStart.client.y
      if (Math.abs(dx) + Math.abs(dy) > 5) {
        g.moved = true
        const rect = svgRef.current.getBoundingClientRect()
        const box = g.panStart.box
        setView({ x: box.x - dx * (box.w / rect.width), y: box.y - dy * (box.h / rect.height), w: box.w, h: box.h })
      }
    }
  }
  function onPointerUp(e) {
    const g = gesture.current
    g.pointers.delete(e.pointerId)
    if (g.pointers.size < 2) g.pinchStart = null
    if (g.pointers.size === 0) g.panStart = null
  }

  // ---- viewBox
  const pts = hexes.map((h) => axialToPixel(h.q, h.r, SIZE))
  const minX = Math.min(...pts.map((p) => p.x)) - SIZE * 1.2
  const maxX = Math.max(...pts.map((p) => p.x)) + SIZE * 1.2
  const minY = Math.min(...pts.map((p) => p.y)) - SIZE * 1.2
  const maxY = Math.max(...pts.map((p) => p.y)) + SIZE * 1.2

  // ---- theme (GM Console → Map appearance). Everything optional;
  //      flat tactical display is the zero-config default.
  const theme = campaign.map_theme ?? {}
  const terrainStyle = (t) => theme.terrain?.[t] ?? {}
  const fillOf = (t) => terrainStyle(t).texture_url
    ? `url(#tex-${t})`
    : terrainStyle(t).fill ?? TERRAIN[t]?.fill ?? '#23271A'
  const showGlyphs = theme.show_glyphs !== false
  const showVP = theme.show_vp !== false

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <TurnBar {...{ campaign, turn, moveOrders, battleOrders, armies, rosters, hexes, isGM, load, reload }} />
        <div className="panel p-2 touch-none select-none">
          <svg ref={svgRef} className="w-full cursor-grab"
            viewBox={view ? `${view.x} ${view.y} ${view.w} ${view.h}` : `${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
            onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerLeave={onPointerUp}
            onDoubleClick={() => setView(null)}
            onClickCapture={(e) => { if (gesture.current.moved) { e.stopPropagation(); gesture.current.moved = false } }}>
            <defs>
              {Object.entries(theme.terrain ?? {})
                .filter(([, v]) => v?.texture_url)
                .map(([t, v]) => (
                  <pattern key={t} id={`tex-${t}`} patternUnits="userSpaceOnUse"
                    width={SIZE * 2} height={SIZE * 2}>
                    <image href={v.texture_url} width={SIZE * 2} height={SIZE * 2}
                      preserveAspectRatio="xMidYMid slice" />
                  </pattern>
                ))}
              <clipPath id="armyClip"><circle r="8" /></clipPath>
            </defs>

            {/* Layer 0 — background art */}
            {theme.background?.url && (
              <image href={theme.background.url}
                x={minX} y={minY} width={maxX - minX} height={maxY - minY}
                preserveAspectRatio="xMidYMid slice"
                opacity={theme.background.opacity ?? 0.5} pointerEvents="none" />
            )}

            {/* Layer 1 — hex terrain */}
            {hexes.map((h) => {
              const { x, y } = axialToPixel(h.q, h.r, SIZE)
              const inReach = reach[key(h.q, h.r)] !== undefined
              const owner = h.controlled_by ? colorOf[h.controlled_by] : null
              return (
                <g key={h.id} onClick={() => clickHex(h)} className="cursor-pointer">
                  <polygon points={hexCorners(x, y, SIZE - 1)}
                    fill={fillOf(h.terrain_type)}
                    stroke={selected === h.id ? '#E0BE6A' : owner ?? '#3A3F2A'}
                    strokeWidth={selected === h.id ? 2.5 : owner ? 2 : 1}
                    opacity={moveMode && !inReach ? 0.35 : 1} />
                  {h.soc_radius > 0 && (
                    <circle cx={x} cy={y} r={SIZE * 0.22} fill="none"
                      stroke={owner ?? '#8B876F'} strokeWidth="1" strokeDasharray="2,2" />
                  )}
                  {showGlyphs && !h.image_url && TERRAIN[h.terrain_type]?.glyph && (
                    <text x={x} y={y - 6} textAnchor="middle" fontSize="11" fill="#8B876F">{TERRAIN[h.terrain_type].glyph}</text>
                  )}
                  {showVP && h.strategic_value > 0 && (
                    <text x={x} y={y + SIZE * 0.72} textAnchor="middle" fontSize="7" fill="#C0983E" fontFamily="IBM Plex Mono">
                      {h.strategic_value} VP
                    </text>
                  )}
                  {inReach && <circle cx={x} cy={y} r={3} fill="#E0BE6A" />}
                </g>
              )
            })}

            {/* Layer 2 — location art (per-hex images, GM-attached) */}
            {hexes.filter((h) => h.image_url).map((h) => {
              const { x, y } = axialToPixel(h.q, h.r, SIZE)
              return (
                <image key={`img-${h.id}`} href={h.image_url}
                  x={x - SIZE * 0.55} y={y - SIZE * 0.75}
                  width={SIZE * 1.1} height={SIZE * 1.1}
                  preserveAspectRatio="xMidYMid meet" pointerEvents="none"
                  opacity={moveMode && reach[key(h.q, h.r)] === undefined ? 0.35 : 1} />
              )
            })}

            {/* Layer 3 — armies (custom icon if set, tactical token fallback) */}
            {armies.filter((a) => a.hex_id && a.status !== 'broken').map((a) => {
              const h = hexById[a.hex_id]; if (!h) return null
              const { x, y } = axialToPixel(h.q, h.r, SIZE)
              const roster = rosters.find((r) => r.id === a.roster_id)
              const color = colorOf[a.roster_id]
              return (
                <g key={a.id} pointerEvents="none">
                  {roster?.icon_url ? (
                    <g transform={`translate(${x},${y + 8})`}>
                      <circle r="9" fill="#101208" stroke={color} strokeWidth="2" />
                      <image href={roster.icon_url} x={-8} y={-8} width={16} height={16}
                        clipPath="url(#armyClip)" preserveAspectRatio="xMidYMid slice" />
                    </g>
                  ) : (
                    <>
                      <rect x={x - 8} y={y + 2} width={16} height={11} rx={1.5}
                        fill={color} stroke="#101208" strokeWidth="1" />
                      <text x={x} y={y + 10.5} textAnchor="middle" fontSize="7" fill="#101208" fontWeight="700"
                        fontFamily="Barlow Condensed">
                        {(roster?.name ?? '?').slice(0, 3).toUpperCase()}
                      </text>
                    </>
                  )}
                  {a.status === 'force_marching' && <text x={x + 11} y={y + 11} fontSize="8" fill="#E0BE6A">»</text>}
                  {a.status === 'in_battle' && <text x={x + 11} y={y + 11} fontSize="8" fill="#D0483A">⚔</text>}
                </g>
              )
            })}

            {/* Layer 4 — move order arrows */}
            {moveOrders.map((mo) => {
              const a = armies.find((x) => x.id === mo.army_id); if (!a?.hex_id) return null
              const from = hexById[a.hex_id]; const to = hexById[mo.target_hex_id]
              if (!from || !to) return null
              const p1 = axialToPixel(from.q, from.r, SIZE); const p2 = axialToPixel(to.q, to.r, SIZE)
              return <line key={mo.id} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                stroke={colorOf[a.roster_id]} strokeWidth="1.5" strokeDasharray="4,3" opacity="0.8" markerEnd="" />
            })}
          </svg>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-ash">
          {Object.entries(TERRAIN).map(([k, t]) => (
            <span key={k}><span style={{ color: '#C0983E' }}>{t.glyph || '·'}</span> {t.label}</span>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {/* Move orders */}
        {myArmy && turn?.status === 'open' && (
          <Panel title="Issue orders">
            <p className="font-mono text-[11px] text-ash mb-3">
              {myOrder
                ? `Current order: ${myOrder.move_type === 'force_march' ? 'force march' : 'advance'} → ${hexById[myOrder.target_hex_id]?.name || 'target hex'}`
                : 'No orders logged — army will hold position.'} Scroll/pinch to zoom, drag to pan, double-click to reset.
            </p>
            <div className="flex gap-2">
              <button className={moveMode === 'standard' ? 'btn-primary' : 'btn-brass'}
                onClick={() => setMoveMode(moveMode === 'standard' ? null : 'standard')}>Advance (1)</button>
              <button className={moveMode === 'force_march' ? 'btn-primary' : 'btn-brass'}
                onClick={() => setMoveMode(moveMode === 'force_march' ? null : 'force_march')}>
                Force march ({campaign.force_march_max})
              </button>
            </div>
            {moveMode && <p className="font-mono text-[10px] text-brasslight mt-2">Select a highlighted hex. Force-marching armies cannot invade and suffer Ambush if attacked.</p>}
            {myOrder && (
              <button className="btn-ghost w-full mt-2 text-xs"
                onClick={async () => { await supabase.from('move_order').delete().eq('id', myOrder.id); load() }}>
                Rescind orders
              </button>
            )}
          </Panel>
        )}
        {myArmy?.status === 'broken' && (
          <Panel title="Army status"><p className="text-emberlight font-mono text-xs">Your force is BROKEN and in off-map reserve. The GM will return it to the field.</p></Panel>
        )}
        {!myArmy && myRoster && isGMDeployNeeded(rosters, armies) && (
          <Panel title="Deployment"><p className="text-ash font-mono text-xs">Awaiting deployment — the GM places armies during setup (GM Console → Deploy armies, or select a hex here as GM).</p></Panel>
        )}

        {/* Hex inspector */}
        {sel && (
          <HexInspector hex={sel} campaign={campaign} rosters={rosters} isGM={isGM}
            armies={armies} colorOf={colorOf} onChange={load} />
        )}

        {/* Pending battle orders */}
        {battleOrders.filter((bo) => bo.status === 'pending').length > 0 && (
          <Panel title="Engagements declared">
            <ul className="space-y-2 text-xs font-mono">
              {battleOrders.filter((bo) => bo.status === 'pending').map((bo) => (
                <EngagementRow key={bo.id} bo={bo} armies={armies} rosters={rosters}
                  hexById={hexById} campaign={campaign} />
              ))}
            </ul>
            <p className="font-mono text-[10px] text-ash mt-2">Filing a report pre-fills participants, ground, and mission from the engagement.</p>
          </Panel>
        )}
      </div>
    </div>
  )
}

const isGMDeployNeeded = (rosters, armies) =>
  rosters.some((r) => r.status === 'approved' && !armies.find((a) => a.roster_id === r.id))

function EngagementRow({ bo, armies, rosters, hexById, campaign }) {
  const nav = useNavigate()
  const [err, setErr] = useState(null)
  const attArmy = armies.find((a) => a.id === bo.attacker_army_id)
  const defArmy = bo.defender_army_id ? armies.find((a) => a.id === bo.defender_army_id) : null
  const att = rosters.find((r) => r.id === attArmy?.roster_id)
  const def = defArmy
    ? rosters.find((r) => r.id === defArmy.roster_id)
    : rosters.find((r) => r.id === hexById[bo.hex_id]?.controlled_by)
  const h = hexById[bo.hex_id]

  async function file() {
    setErr(null)
    const { data, error } = await supabase.rpc('file_battle_for_order', { order_id: bo.id })
    if (error) return setErr(error.message)
    nav(`/c/${campaign.id}/battles/${data}`)
  }

  return (
    <li className="border border-line rounded-sm p-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-bone">{att?.name} → {def?.name ?? 'undefended'} · {h?.name || `(${h?.q},${h?.r})`}</p>
          <p className="text-ash">{bo.conflict_type}{bo.is_ambush ? ' · AMBUSH' : ''} · {bo.suggested_mission_type}</p>
        </div>
        {bo.battle_id
          ? <button className="btn-ghost text-[10px] whitespace-nowrap" onClick={() => nav(`/c/${campaign.id}/battles/${bo.battle_id}`)}>Open report</button>
          : <button className="btn-brass text-[10px] whitespace-nowrap" onClick={file}>File report</button>}
      </div>
      {err && <p className="text-emberlight mt-1">{err}</p>}
    </li>
  )
}

function TurnBar({ campaign, turn, moveOrders, battleOrders, armies, rosters, hexes, isGM, load, reload }) {
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null) // {type:'lock', res} | {type:'complete', pending}
  const [notice, setNotice] = useState(null)

  async function startCampaign() {
    setBusy(true)
    const occupied = new Set(armies.map((a) => a.hex_id))
    const maxDist = Math.max(...hexes.map((h) => distance(0, 0, h.q, h.r)))
    const edge = hexes.filter((h) => distance(0, 0, h.q, h.r) === maxDist && !occupied.has(h.id))
    let i = 0
    for (const r of rosters.filter((r) => !armies.find((a) => a.roster_id === r.id))) {
      const spawn = edge[Math.floor((i / Math.max(1, rosters.length)) * edge.length) % edge.length]
      i++
      if (spawn) {
        await supabase.from('army').insert({ campaign_id: campaign.id, roster_id: r.id, hex_id: spawn.id })
        await supabase.from('hex_tile').update({ controlled_by: r.id }).eq('id', spawn.id)
      }
    }
    await supabase.from('campaign_turn').insert({ campaign_id: campaign.id, turn_number: 1, status: 'open' })
    await supabase.from('campaign').update({ status: 'active' }).eq('id', campaign.id)
    setBusy(false); reload(); load()
  }

  // Dry-run first, commit on confirm — locking is irreversible.
  function previewLock() {
    setPreview({ type: 'lock', res: resolveLock({ hexes, armies, rosters, moveOrders }) })
  }

  async function commitLock() {
    setBusy(true); setPreview(null)
    // Single transaction server-side; the JS resolver above was only the preview.
    const { data, error } = await supabase.rpc('lock_turn', { tid: turn.id })
    setBusy(false)
    if (error) return setNotice(`Lock failed: ${error.message}`)
    notifyTurnAdvanced(campaign.webhook_turn_advanced, { turn: turn.turn_number, conflicts: data?.summary ?? [] })
    load()
  }

  function previewComplete() {
    const pending = battleOrders.filter((bo) => bo.status === 'pending' && bo.defender_army_id)
    if (pending.length) setPreview({ type: 'complete', pending })
    else commitComplete()
  }

  async function commitComplete() {
    setBusy(true); setPreview(null)
    const { data, error } = await supabase.rpc('complete_turn', {
      tid: turn.id, p_void_pending: true,
    })
    setBusy(false)
    if (error) return setNotice(`Completion failed: ${error.message}`)
    const winners = data?.winners ?? []
    if (winners.length) {
      const w = winners[0]
      const standings = rosters.map((r) => `${r.name}: ${data.vp?.[r.id] ?? 0} VP`).join('\n')
      notifyCampaignCompleted(campaign.webhook_campaign_completed, { winner: `${w.name} (${w.condition})`, standings })
      setNotice(`CAMPAIGN COMPLETE — ${w.name} wins: ${w.condition}`)
    } else {
      setNotice(`Turn ${turn.turn_number} complete. Turn ${turn.turn_number + 1} is open for orders.`)
    }
    reload(); load()
  }

  return (
    <div className="panel p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {turn
            ? <><span className="h-display text-xl">Turn {turn.turn_number}</span><Badge>{turn.status}</Badge></>
            : <span className="h-display text-xl text-ash">Campaign not started</span>}
          {turn?.status === 'open' && <span className="font-mono text-[10px] text-ash">{moveOrders.length} order(s) logged</span>}
        </div>
        {isGM && !preview && (
          <div className="flex gap-2">
            {!turn && <button className="btn-primary" disabled={busy} onClick={startCampaign}>Begin campaign — deploy &amp; open turn 1</button>}
            {turn?.status === 'open' && <button className="btn-primary" disabled={busy} onClick={previewLock}>Lock turn…</button>}
            {(turn?.status === 'locked' || turn?.status === 'resolving') &&
              <button className="btn-primary" disabled={busy} onClick={previewComplete}>Complete turn…</button>}
          </div>
        )}
      </div>

      {preview?.type === 'lock' && (
        <div className="border border-brass rounded-sm p-3 space-y-2">
          <p className="eyebrow">Lock preview — irreversible once confirmed</p>
          <ul className="font-mono text-xs space-y-1">
            <li className="text-bone">{preview.res.battleOrders.length} engagement(s) will be declared:</li>
            {preview.res.summary.map((s, i) => <li key={i} className="text-ash pl-3">• {s}</li>)}
            {preview.res.hexCaptures.length > 0 && (
              <li className="text-brasslight">{preview.res.hexCaptures.length} unopposed hex(es) change control immediately.</li>
            )}
            {preview.res.summary.length === 0 && preview.res.hexCaptures.length === 0 && (
              <li className="text-ash">No contact — armies redeploy unopposed.</li>
            )}
          </ul>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy} onClick={commitLock}>Confirm — lock turn</button>
            <button className="btn-ghost" onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}

      {preview?.type === 'complete' && (
        <div className="border border-imperial rounded-sm p-3 space-y-2">
          <p className="eyebrow text-emberlight">Unresolved engagements</p>
          <p className="font-mono text-xs text-bone">
            {preview.pending.length} engagement(s) have no verified battle. Completing the turn will VOID them —
            no territory changes, no XP.
          </p>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy} onClick={commitComplete}>Complete anyway — void them</button>
            <button className="btn-ghost" onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}

      {notice && (
        <p className="font-mono text-xs text-brasslight border border-brass/50 rounded-sm p-2 flex justify-between gap-2">
          {notice}
          <button className="text-ash hover:text-bone" onClick={() => setNotice(null)}>✕</button>
        </p>
      )}
    </div>
  )
}

function HexInspector({ hex, campaign, rosters, isGM, onChange }) {
  const [h, setH] = useState(hex)
  useEffect(() => setH(hex), [hex.id])
  const set = (k) => (e) => setH({ ...h, [k]: e.target.value })

  async function save() {
    const patch = {
      terrain_type: h.terrain_type, name: h.name, flavour_text: h.flavour_text,
      strategic_value: Number(h.strategic_value), soc_radius: Number(h.soc_radius),
      controlled_by: h.controlled_by || null, notes: h.notes,
      image_url: h.image_url || null,
    }
    await supabase.from('hex_tile').update(patch).eq('id', hex.id)
    onChange()
  }

  return (
    <Panel title={`Hex (${hex.q}, ${hex.r})`}>
      {isGM ? (
        <div className="space-y-3">
          <Field label="Terrain">
            <select className="field" value={h.terrain_type} onChange={set('terrain_type')}>
              {Object.entries(TERRAIN).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Name"><input className="field" value={h.name ?? ''} onChange={set('name')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="VP value"><input className="field" type="number" value={h.strategic_value} onChange={set('strategic_value')} /></Field>
            <Field label="SoC radius"><input className="field" type="number" min="0" max="3" value={h.soc_radius} onChange={set('soc_radius')} /></Field>
          </div>
          <Field label="Controlled by">
            <select className="field" value={h.controlled_by ?? ''} onChange={set('controlled_by')}>
              <option value="">Unclaimed</option>
              {rosters.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="GM: place army here">
            <select className="field" value="" onChange={async (e) => {
              if (!e.target.value) return
              await supabase.from('army').update({ hex_id: hex.id, status: 'idle' }).eq('id', e.target.value)
              onChange()
            }}>
              <option value="">— select an army —</option>
              {armies.map((a) => {
                const r = rosters.find((x) => x.id === a.roster_id)
                return <option key={a.id} value={a.id}>{r?.name ?? '?'}{a.status === 'broken' ? ' (broken — returns to field)' : ''}</option>
              })}
            </select>
          </Field>
          <Field label="Flavour text"><textarea className="field" rows={2} value={h.flavour_text ?? ''} onChange={set('flavour_text')} /></Field>
          <AssetInput label="Location art (replaces glyph)" value={h.image_url}
            onChange={(url) => setH({ ...h, image_url: url })}
            campaignId={campaign.id} prefix={`hex-${hex.q}_${hex.r}`} />
          <button className="btn-primary w-full" onClick={save}>Save hex</button>
        </div>
      ) : (
        <div className="text-sm space-y-2">
          <p className="h-display text-lg">{hex.name || TERRAIN[hex.terrain_type]?.label}</p>
          <p className="font-mono text-[11px] text-ash">{TERRAIN[hex.terrain_type]?.label} · {hex.strategic_value} VP
            {hex.soc_radius > 0 && ` · SoC ${hex.soc_radius}`}</p>
          <p className="font-mono text-[11px] text-ash">
            {hex.controlled_by ? `Held by ${rosters.find((r) => r.id === hex.controlled_by)?.name}` : 'Unclaimed'}
          </p>
          {hex.flavour_text && <p className="text-ash italic">{hex.flavour_text}</p>}
          <p className="font-mono text-[10px] text-ash/70">{TERRAIN[hex.terrain_type]?.note} Suggested mission: {MISSION_BY_TERRAIN[hex.terrain_type]}</p>
        </div>
      )}
    </Panel>
  )
}

function GenerateMap({ campaign, onDone }) {
  const [preset, setPreset] = useState('balanced_sector')
  const [players, setPlayers] = useState(campaign.max_players)
  const [busy, setBusy] = useState(false)

  async function generate() {
    setBusy(true)
    const coords = hexesInRadius(radiusForPlayers(Number(players)))
    const tiles = generatePreset(coords, preset)
    await supabase.from('hex_tile').insert(tiles.map((t) => ({ ...t, campaign_id: campaign.id })))
    setBusy(false); onDone()
  }

  return (
    <Panel title="Cartographae // Chart the theatre" className="max-w-lg">
      <div className="space-y-4">
        <Field label="Preset template">
          <select className="field" value={preset} onChange={(e) => setPreset(e.target.value)}>
            {Object.entries(MAP_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Player count (map radius = players + 1)">
          <input className="field" type="number" min="2" max="12" value={players} onChange={(e) => setPlayers(e.target.value)} />
        </Field>
        <p className="font-mono text-[11px] text-ash">
          {players} players → radius {radiusForPlayers(Number(players))} → {hexesInRadius(radiusForPlayers(Number(players))).length} hexes.
          Edit every hex freely after generation.
        </p>
        <button className="btn-primary" disabled={busy} onClick={generate}>Generate map</button>
      </div>
    </Panel>
  )
}
