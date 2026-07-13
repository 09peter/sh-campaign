// Army list import parsing. Never silently drop data: anything we can't
// classify lands in raw_notes on the nearest unit or in leftovers.

const KNOWN_KEYWORDS = [
  'VEHICLE','INFANTRY','CHARACTER','MONSTER','MOUNTED','BEAST','SWARM',
  'FLY','TITANIC','WALKER','TRANSPORT','BATTLELINE','EPIC HERO','PSYKER',
];

const ROLE_HINTS = [
  ['HQ', /\bHQ\b/i],
  ['Epic Hero', /epic hero/i],
  ['Character', /character/i],
  ['Battleline', /battleline|troops/i],
  ['Dedicated Transport', /dedicated transport/i],
  ['Elites', /elites/i],
  ['Fast Attack', /fast attack/i],
  ['Heavy Support', /heavy support/i],
];

function detectKeywords(text) {
  const up = text.toUpperCase();
  return KNOWN_KEYWORDS.filter((k) => up.includes(k));
}

function detectRole(text) {
  for (const [role, re] of ROLE_HINTS) if (re.test(text)) return role;
  return null;
}

// ---------- Listforge / generic JSON ----------

function parseJsonExport(obj) {
  // Listforge and similar exporters vary; walk common shapes.
  const units = [];
  const meta = { name: obj.name ?? obj.listName ?? null, faction: obj.faction ?? obj.factionName ?? null };

  const candidates =
    obj.units ?? obj.roster?.units ?? obj.forces?.flatMap((f) => f.units ?? []) ?? [];

  for (const u of candidates) {
    if (!u || typeof u !== 'object') continue;
    units.push({
      name: u.name ?? u.unitName ?? 'Unknown unit',
      points: Number(u.points ?? u.cost ?? u.pts ?? 0) || 0,
      power_level: u.powerLevel != null ? Number(u.powerLevel) : null,
      battlefield_role: u.role ?? u.battlefieldRole ?? detectRole(JSON.stringify(u)),
      unit_type: u.type ?? null,
      model_count: u.modelCount != null ? Number(u.modelCount) : (u.models?.length ?? null),
      keywords: Array.isArray(u.keywords) ? u.keywords : detectKeywords(JSON.stringify(u)),
      wargear_notes: Array.isArray(u.wargear) ? u.wargear.join(', ')
        : typeof u.wargear === 'string' ? u.wargear
        : u.loadout ?? null,
      raw_notes: null,
      confidence: 'high',
    });
  }
  return { meta, units, leftovers: units.length ? null : 'JSON parsed but no units found — check the export shape.' };
}

// ---------- Plain text heuristics ----------

// Matches lines like:  "Leman Russ Battle Tank (170 pts)" / "10x Guardsmen - 65"
const UNIT_LINE = /^\s*(?:(\d+)\s*[x×]\s*)?(.+?)\s*(?:[-–—(\[]\s*(\d{2,4})\s*(?:pts?|points)?\s*[)\]]?)\s*$/i;

function parsePlainText(text) {
  const lines = text.split(/\r?\n/);
  const units = [];
  const leftovers = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(UNIT_LINE);
    if (m && m[3]) {
      current = {
        name: m[2].trim(),
        points: Number(m[3]),
        model_count: m[1] ? Number(m[1]) : null,
        power_level: null,
        battlefield_role: detectRole(line),
        unit_type: null,
        keywords: detectKeywords(line),
        wargear_notes: null,
        raw_notes: null,
        confidence: 'medium',
      };
      units.push(current);
    } else if (current && /^[-•*]/.test(line)) {
      // bullet under a unit → wargear
      current.wargear_notes = [current.wargear_notes, line.replace(/^[-•*]\s*/, '')]
        .filter(Boolean).join(', ');
    } else if (current) {
      current.raw_notes = [current.raw_notes, line].filter(Boolean).join('\n');
    } else {
      leftovers.push(line);
    }
  }

  return {
    meta: { name: null, faction: leftovers[0] ?? null },
    units,
    leftovers: leftovers.length ? leftovers.join('\n') : null,
  };
}

// ---------- Entry point ----------

export function parseImport(text) {
  const trimmed = text.trim();
  if (!trimmed) return { meta: {}, units: [], leftovers: null, format: 'empty' };
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const obj = JSON.parse(trimmed);
      const res = parseJsonExport(Array.isArray(obj) ? { units: obj } : obj);
      return { ...res, format: 'json' };
    } catch {
      // fall through to plain text
    }
  }
  return { ...parsePlainText(trimmed), format: 'text' };
}
