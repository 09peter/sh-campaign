// Turn resolution engine. Runs client-side when the GM locks / completes a
// turn (turn advancement is an in-person GM action per the campaign rules;
// RLS restricts these writes to GM/admin).
//
// lockTurn():   resolve simultaneous move orders → moves, undefended captures,
//               BattleOrders (invasion / siege / ambush flag).
// completeTurn(): SoC hold counters, contested flips, terrain RP income,
//               VP tally, victory-condition check.

import { key, distance, hexesInRange } from './hex';

export const MISSION_BY_TERRAIN = {
  wasteland: 'Standard (GM pool)',
  ruins: 'Retrieval / Relic Hunt',
  manufactorum: 'Sabotage / Control',
  settlement: 'Siege',
  fortification: 'Siege',
  reliquary: 'Narrative (GM defined)',
  death_world: 'Assassination / Survival',
};

const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

/**
 * Resolve move orders at turn lock.
 * Pure function — returns intents; the caller persists them.
 */
export function resolveLock({ hexes, armies, rosters, moveOrders }) {
  const hexById = byId(hexes);
  const armyById = byId(armies);
  const rosterById = byId(rosters);

  // Effective destination per army (no order = stay).
  const dest = {};
  const marching = {};
  for (const a of armies) {
    dest[a.id] = a.hex_id;
    marching[a.id] = false;
  }
  for (const mo of moveOrders) {
    if (!armyById[mo.army_id]) continue;
    dest[mo.army_id] = mo.target_hex_id;
    marching[mo.army_id] = mo.move_type === 'force_march';
  }

  const occupancy = {}; // hex_id -> [army_id]
  for (const a of armies) (occupancy[dest[a.id]] ??= []).push(a.id);

  const armyUpdates = []; // {id, hex_id, status}
  const hexCaptures = []; // {hex_id, controlled_by}
  const battleOrders = []; // {hex_id, attacker_army_id, defender_army_id, conflict_type, suggested_mission_type, is_ambush}

  const factionOf = (armyId) => armyById[armyId].roster_id;
  const moved = (armyId) => dest[armyId] !== armyById[armyId].hex_id;

  for (const [hexId, present] of Object.entries(occupancy)) {
    const hex = hexById[hexId];
    if (!hex) continue;

    if (present.length === 1) {
      const aId = present[0];
      const rosterId = factionOf(aId);
      armyUpdates.push({ id: aId, hex_id: hexId, status: marching[aId] ? 'force_marching' : 'idle' });

      const enemyControlled = hex.controlled_by && hex.controlled_by !== rosterId;
      if (moved(aId) && enemyControlled && !marching[aId]) {
        // Contested if inside an enemy Sphere of Control → invasion battle.
        // Undefended, outside SoC → immediate capture.
        if (isInsideEnemySoC(hex, rosterId, hexes)) {
          battleOrders.push(mkOrder(hexId, aId, null, 'invasion', hex));
        } else {
          hexCaptures.push({ hex_id: hexId, controlled_by: rosterId });
        }
      } else if (moved(aId) && enemyControlled && marching[aId]) {
        // Force marching cannot initiate an invasion — army arrives, no capture.
      } else if (moved(aId) && !hex.controlled_by && !marching[aId]) {
        hexCaptures.push({ hex_id: hexId, controlled_by: rosterId });
      }
    } else {
      // Multiple armies on one hex → engagements. Pair each mover against the
      // holder (or against each other if both moved in).
      const holders = present.filter((a) => !moved(a));
      const movers = present.filter((a) => moved(a));
      const pairs = [];
      if (holders.length && movers.length) {
        for (const m of movers)
          if (factionOf(m) !== factionOf(holders[0])) pairs.push([m, holders[0]]);
      } else if (movers.length >= 2) {
        // meeting engagement: first two hostile movers clash
        for (let i = 0; i < movers.length; i++)
          for (let j = i + 1; j < movers.length; j++)
            if (factionOf(movers[i]) !== factionOf(movers[j])) { pairs.push([movers[i], movers[j]]); i = movers.length; break; }
      }
      for (const [att, def] of pairs) {
        const siege = hex.terrain_type === 'fortification' || !moved(def);
        battleOrders.push({
          ...mkOrder(hexId, att, def, siege ? 'siege' : 'invasion', hex),
          is_ambush: marching[def],
        });
        armyUpdates.push({ id: att, hex_id: hexId, status: 'in_battle' });
        armyUpdates.push({ id: def, hex_id: dest[def], status: 'in_battle' });
      }
      for (const a of present) {
        if (!armyUpdates.find((u) => u.id === a)) {
          armyUpdates.push({ id: a, hex_id: dest[a], status: marching[a] ? 'force_marching' : 'idle' });
        }
      }
    }
  }

  function mkOrder(hexId, att, def, type, hex) {
    return {
      hex_id: hexId,
      attacker_army_id: att,
      defender_army_id: def,
      conflict_type: type,
      suggested_mission_type: MISSION_BY_TERRAIN[hex.terrain_type] ?? 'Standard',
      is_ambush: false,
    };
  }

  function isInsideEnemySoC(hex, rosterId, allHexes) {
    for (const h of allHexes) {
      if (h.soc_radius > 0 && h.controlled_by && h.controlled_by !== rosterId) {
        if (distance(h.q, h.r, hex.q, hex.r) <= h.soc_radius) return true;
      }
    }
    return false;
  }

  const summary = battleOrders.map((bo) => {
    const att = rosterById[factionOf(bo.attacker_army_id)]?.name ?? '?';
    const def = bo.defender_army_id ? rosterById[factionOf(bo.defender_army_id)]?.name : 'undefended ground';
    const hx = hexById[bo.hex_id];
    return `${att} → ${def} at ${hx?.name || `(${hx?.q},${hx?.r})`} [${bo.conflict_type}${bo.is_ambush ? ', AMBUSH' : ''}]`;
  });

  return { armyUpdates, hexCaptures, battleOrders, summary };
}

/**
 * Retreat destination after a defeat.
 * standard: 1 hex toward nearest friendly-controlled hex.
 * crushing: teleport to nearest friendly-controlled hex.
 * none exist → broken (off-map).
 */
export function retreatDestination({ army, hexes, crushing }) {
  const hexById = byId(hexes);
  const from = hexById[army.hex_id];
  const friendly = hexes.filter((h) => h.controlled_by === army.roster_id && h.id !== army.hex_id);
  if (!friendly.length) return { broken: true, hex_id: null };
  friendly.sort((a, b) => distance(from.q, from.r, a.q, a.r) - distance(from.q, from.r, b.q, b.r));
  const target = friendly[0];
  if (crushing) return { broken: false, hex_id: target.id };
  // step 1 hex toward target
  let best = null; let bestD = Infinity;
  for (const h of hexes) {
    if (distance(from.q, from.r, h.q, h.r) !== 1) continue;
    const d = distance(h.q, h.r, target.q, target.r);
    if (d < bestD) { bestD = d; best = h; }
  }
  return { broken: false, hex_id: best?.id ?? target.id };
}

/**
 * Turn completion: SoC hold tracking, terrain income, VP, victory check.
 */
export function resolveComplete({ campaign, hexes, armies, rosters, turnNumber }) {
  const socHold = campaign.soc_hold_turns ?? 2;

  // 1. SoC hold counters + contested flips
  const armyUpdates = [];
  const hexCaptures = [];
  for (const a of armies) {
    if (!a.hex_id || a.status === 'broken') continue;
    const hex = hexes.find((h) => h.id === a.hex_id);
    if (!hex) continue;
    const held = { ...(a.consecutive_turns_held ?? {}) };
    const contested = hex.controlled_by && hex.controlled_by !== a.roster_id &&
      isInsideSoC(hex, hex.controlled_by, hexes);
    if (contested && a.status !== 'in_battle') {
      held[hex.id] = (held[hex.id] ?? 0) + 1;
      if (held[hex.id] >= socHold) {
        hexCaptures.push({ hex_id: hex.id, controlled_by: a.roster_id });
        delete held[hex.id];
      }
    }
    // prune counters for hexes we're no longer on
    for (const k of Object.keys(held)) if (k !== hex.id) delete held[k];
    armyUpdates.push({ id: a.id, consecutive_turns_held: held });
  }

  function isInsideSoC(hex, controllerRosterId, allHexes) {
    return allHexes.some((h) =>
      h.soc_radius > 0 && h.controlled_by === controllerRosterId &&
      distance(h.q, h.r, hex.q, hex.r) <= h.soc_radius);
  }

  // 2. Terrain income: +1 RP per controlled manufactorum
  const rpIncome = {};
  for (const h of hexes) {
    if (h.terrain_type === 'manufactorum' && h.controlled_by) {
      rpIncome[h.controlled_by] = (rpIncome[h.controlled_by] ?? 0) + 1;
    }
  }

  // 3. VP tally per roster
  const vp = {};
  for (const r of rosters) vp[r.id] = 0;
  for (const h of hexes) {
    if (h.controlled_by) vp[h.controlled_by] = (vp[h.controlled_by] ?? 0) + (h.strategic_value ?? 0);
  }

  // 4. Victory conditions
  const totalHexes = hexes.length;
  const winners = [];
  for (const cond of campaign.victory_conditions ?? []) {
    if (cond.type === 'domination') {
      for (const r of rosters) {
        const owned = hexes.filter((h) => h.controlled_by === r.id).length;
        if (totalHexes && (owned / totalHexes) * 100 >= cond.threshold_pct) {
          winners.push({ roster_id: r.id, condition: `Domination ≥ ${cond.threshold_pct}%` });
        }
      }
    } else if (cond.type === 'hold_hex') {
      // relies on SoC-style counters stored on armies for the target hex
      for (const a of armies) {
        const held = a.consecutive_turns_held?.[cond.hex_id] ?? 0;
        const hex = hexes.find((h) => h.id === cond.hex_id);
        const controls = hex && hex.controlled_by === a.roster_id;
        if (controls && held + 1 >= cond.turns_required) {
          winners.push({ roster_id: a.roster_id, condition: `Held objective hex ${cond.turns_required} turns` });
        }
      }
    } else if (cond.type === 'vp_threshold') {
      for (const r of rosters) {
        if ((vp[r.id] ?? 0) >= cond.vp_target) {
          winners.push({ roster_id: r.id, condition: `Reached ${cond.vp_target} VP` });
        }
      }
    } else if (cond.type === 'vp_at_time') {
      if (turnNumber >= cond.turn_limit) {
        const top = rosters.slice().sort((a, b) => (vp[b.id] ?? 0) - (vp[a.id] ?? 0))[0];
        if (top) winners.push({ roster_id: top.id, condition: `Highest VP at turn ${cond.turn_limit}` });
      }
    }
  }

  return { armyUpdates, hexCaptures, rpIncome, vp, winners };
}
