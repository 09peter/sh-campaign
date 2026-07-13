// Axial hex coordinate math (pointy-top). Pure functions, no deps.

export const DIRECTIONS = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

export const key = (q, r) => `${q},${r}`;

export function neighbors(q, r) {
  return DIRECTIONS.map(([dq, dr]) => [q + dq, r + dr]);
}

export function distance(aq, ar, bq, br) {
  return (Math.abs(aq - bq) + Math.abs(aq + ar - bq - br) + Math.abs(ar - br)) / 2;
}

// All axial coords within `radius` of origin (radius 0 = 1 hex).
export function hexesInRadius(radius) {
  const out = [];
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r++) out.push([q, r]);
  }
  return out;
}

// Coords within `range` of a given hex (for sphere of control).
export function hexesInRange(q, r, range) {
  return hexesInRadius(range).map(([dq, dr]) => [q + dq, r + dr]);
}

// Pointy-top axial → pixel centre.
export function axialToPixel(q, r, size) {
  return {
    x: size * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r),
    y: size * (3 / 2) * r,
  };
}

export function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + size * Math.cos(angle)).toFixed(2)},${(cy + size * Math.sin(angle)).toFixed(2)}`);
  }
  return pts.join(' ');
}

// Map radius from player count, matching the PRD's hex-count table
// (4 players → 61 hexes, 6 → 91, 8 → 127). In ring-distance terms that is
// radius 4 / 5 / 6, i.e. floor(players/2) + 2.
export const radiusForPlayers = (players) => Math.floor(players / 2) + 2;

// BFS movement distance honouring terrain costs (death_world costs 2 to enter).
export function reachable(startKey, maxCost, tileByKey, costOf) {
  const frontier = [[startKey, 0]];
  const best = { [startKey]: 0 };
  while (frontier.length) {
    const [cur, cost] = frontier.shift();
    const [q, r] = cur.split(',').map(Number);
    for (const [nq, nr] of neighbors(q, r)) {
      const nk = key(nq, nr);
      const tile = tileByKey[nk];
      if (!tile) continue;
      const c = cost + costOf(tile);
      if (c <= maxCost && (best[nk] === undefined || c < best[nk])) {
        best[nk] = c;
        frontier.push([nk, c]);
      }
    }
  }
  delete best[startKey];
  return best; // { "q,r": cost }
}

export const moveCost = (tile) => (tile.terrain_type === 'death_world' ? 2 : 1);
