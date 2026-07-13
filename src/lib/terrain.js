// Terrain presentation + preset map templates.

export const TERRAIN = {
  wasteland:     { label: 'Wasteland',     fill: '#23271A', glyph: '',   note: 'No effect.' },
  ruins:         { label: 'Ruins',         fill: '#2E3322', glyph: '▦', note: 'Defender mission modifier: Ruins.' },
  manufactorum:  { label: 'Manufactorum',  fill: '#3B3320', glyph: '⚙', note: '+1 RP per turn to controller.' },
  settlement:    { label: 'Settlement',    fill: '#403A24', glyph: '⌂', note: 'High VP. Projects Sphere of Control.' },
  fortification: { label: 'Fortification', fill: '#33291F', glyph: '▲', note: 'Projects SoC. Capture requires Siege.' },
  reliquary:     { label: 'Reliquary',     fill: '#3A2430', glyph: '✠', note: 'Narrative significance, GM-defined.' },
  death_world:   { label: 'Death World',   fill: '#1F2A22', glyph: '☠', note: 'Costs 2 movement to enter.' },
}

// Preset seeds: fraction of hexes per special terrain (~30% special total).
export const MAP_PRESETS = {
  balanced_sector: {
    label: 'Balanced Sector',
    weights: { ruins: 0.08, manufactorum: 0.06, settlement: 0.05, fortification: 0.04, reliquary: 0.02, death_world: 0.05 },
  },
  hive_sprawl: {
    label: 'Hive Sprawl',
    weights: { ruins: 0.14, manufactorum: 0.08, settlement: 0.06, fortification: 0.02 },
  },
  death_world_expedition: {
    label: 'Death World Expedition',
    weights: { death_world: 0.18, ruins: 0.06, reliquary: 0.04, fortification: 0.02 },
  },
}

export function generatePreset(coords, presetKey, rng = Math.random) {
  const weights = MAP_PRESETS[presetKey]?.weights ?? {}
  return coords.map(([q, r]) => {
    let terrain = 'wasteland'
    let roll = rng()
    for (const [t, w] of Object.entries(weights)) {
      if (roll < w) { terrain = t; break }
      roll -= w
    }
    const soc = terrain === 'settlement' || terrain === 'fortification' ? 1 : 0
    const vp = terrain === 'settlement' ? 3 : terrain === 'fortification' ? 2 : terrain === 'manufactorum' ? 1 : 0
    return { q, r, terrain_type: terrain, soc_radius: soc, strategic_value: vp }
  })
}
