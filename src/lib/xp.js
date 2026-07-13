// XP / RP engine — the ONLY place where Crusade progression maths lives.
// Reads campaign config + a battle record + battle_unit rows, returns deltas.
// Update this module when 11th edition Crusade rules land. Never hardcode
// XP values anywhere else in the app.

/**
 * @param {object} campaign  campaign row (xp_*, rp_* config fields)
 * @param {object} battle    battle row
 * @param {Array}  battleUnits  battle_unit rows joined with unit.roster_id
 * @returns {{units: {unit_id: string, xp: number}[], rosters: {roster_id: string, rp: number}[]}}
 */
export function computeBattleDeltas(campaign, battle, battleUnits) {
  const units = [];

  for (const bu of battleUnits) {
    let xp = campaign.xp_per_battle;
    const agendaAchieved = bu.side === 'attacker'
      ? battle.agenda_attacker_achieved
      : battle.agenda_defender_achieved;
    if (agendaAchieved) xp += campaign.xp_agenda_achieved;
    if (bu.marked_for_greatness) xp += campaign.xp_marked_for_greatness;
    units.push({ unit_id: bu.unit_id, xp });
  }

  const rosters = [];
  const winnerRosterId =
    battle.attacker_result === 'victory' ? battle.attacker_roster_id
    : battle.attacker_result === 'defeat' ? battle.defender_roster_id
    : null;

  for (const rosterId of [battle.attacker_roster_id, battle.defender_roster_id]) {
    let rp = campaign.rp_per_battle;
    if (rosterId === winnerRosterId) rp += campaign.rp_for_victory;
    rosters.push({ roster_id: rosterId, rp });
  }

  return { units, rosters };
}

// Crusade rank thresholds (10th ed defaults; informational only).
export const RANKS = [
  { min: 0, label: 'Battle-ready' },
  { min: 6, label: 'Blooded' },
  { min: 16, label: 'Battle-hardened' },
  { min: 31, label: 'Heroic' },
  { min: 51, label: 'Legendary' },
];

export const rankFor = (xp) =>
  [...RANKS].reverse().find((r) => xp >= r.min)?.label ?? 'Battle-ready';

// Crusade points = honours − scars (informational).
export const crusadePoints = (unit) =>
  (unit.battle_honours?.length ?? 0) - (unit.battle_scars?.length ?? 0);
