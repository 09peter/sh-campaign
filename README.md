# Sledgehammer Crusade Manager

Warhammer 40,000 Crusade campaign manager for the Sledgehammer gaming club, Vienna.
Tracks rosters, Crusade cards, battles with co-verification, XP/RP, and a turn-based
hex map macro-game. Built per `sledgehammer-crusade-prd.md` v0.1.

**Stack:** React (Vite) + Tailwind · Supabase (Postgres, Auth, RLS) · Cloudflare Pages.

---

## 1. Supabase setup (once)

1. Create a project at https://supabase.com (free tier is fine — it pauses after a week
   of inactivity, which is acceptable per the PRD).
2. Apply the schema — either:
   - `supabase link --project-ref <ref>` then `supabase db push`, or
   - paste `supabase/migrations/0001_init.sql` into the SQL Editor and run it.
3. Auth → Providers: enable **Email**. For a private club you may disable
   "Confirm email" to skip the confirmation step, or configure SMTP
   (Auth → SMTP) so invite/confirmation emails actually send.
4. Copy the project URL and anon key into `.env` (see `.env.example`).

### Making yourself site admin

After your first sign-up, in the SQL editor:

```sql
update profile set role = 'admin' where display_name = 'Peter';
```

## 2. Local development

```bash
cp .env.example .env   # fill in Supabase URL + anon key
npm install
npm run dev
```

## 3. Deploy to Cloudflare Pages

1. Push this repo to GitHub.
2. Cloudflare dashboard → Pages → Create project → connect the repo.
3. Build command `npm run build`, output directory `dist`.
4. Add env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. SPA routing: add a `_redirects` file (already included in `public/`) so deep
   links like `/c/<id>/map` resolve.

---

## Architecture notes

- **`src/lib/xp.js`** is the only place Crusade progression maths lives. When 11th
  edition rules land, update this module and the per-campaign config defaults —
  nothing else. All XP/RP values are per-campaign columns, editable in the GM Console.
- **XP application is server-authoritative:** the client computes deltas with `xp.js`,
  then calls the `verify_battle` Postgres RPC, which checks the caller is the
  opponent or GM before applying anything. Verified battles are immutable to players.
- **Turn resolution** (`src/lib/resolveTurn.js`) runs client-side, triggered by the
  GM's Lock/Complete buttons. RLS restricts every write it makes (armies, hexes,
  battle orders, turns) to GM/admin, so players cannot forge resolutions. This
  matches the PRD: turn advancement is an in-person GM action.
- **Import parsing** (`src/lib/parser.js`) handles Listforge-style JSON and plain
  text heuristics. Nothing is silently dropped: unparsed lines go to roster notes
  or the unit's `raw_notes`. Newrecruit JSON mostly falls under the generic JSON
  walker; add a dedicated branch once you have a sample export (PRD open question #1).
- **Roster locking:** after GM approval, only Crusade-card fields (XP, honours,
  scars, relic, status, notes) stay editable by the owner; composition fields are
  hidden in the UI. GMs can unlock.
- **Exports:** post-battle and post-campaign exports use the browser print dialog
  (print → save as PDF) for MVP. Swap in `jsPDF` later if you want styled PDFs.
  Completed campaigns are publicly readable (RLS grants anonymous SELECT), so the
  campaign URL doubles as the shareable read-only link.

## Config defaults vs. PRD open questions

| Question | Default shipped | Where to change |
|---|---|---|
| Force march distance | 2 hexes | GM Console → Rules |
| SoC hold duration | 2 turns | GM Console → Rules |
| Wasteland mission pool | empty, GM-configurable list | GM Console → Rules |
| XP/RP values | 10th-ed placeholders | GM Console → Rules |
| Hex library | none — hand-rolled axial math + SVG (`src/lib/hex.js`), no dependency | — |

## v2 backlog (stubbed, not built)

Fog of war, interception, multi-army stacking, attrition, campaign templates,
stats dashboards, mobile-optimised layout, PWA, OAuth — per PRD §14.

## Visual customization (migration 0002)

Everything renders in layered SVG; the flat tactical display is the zero-config
default and every layer below is optional:

| Asset | Where it's set | Stored on |
|---|---|---|
| Map background art (+ opacity slider) | GM Console → Map appearance | `campaign.map_theme.background` |
| Terrain colours (per type) | GM Console → Map appearance | `campaign.map_theme.terrain[type].fill` |
| Terrain textures (tiled image fills) | GM Console → Map appearance | `campaign.map_theme.terrain[type].texture_url` |
| Glyph / VP label toggles | GM Console → Map appearance | `campaign.map_theme.show_glyphs / show_vp` |
| Location art (per hex, replaces glyph) | Theatre Map → click hex → Location art | `hex_tile.image_url` |
| Army icon (circular map token) | Roster page (owner or GM) | `roster.icon_url` |

Layer order: background → hex terrain → SoC/VP overlays → location art →
army tokens → move-order arrows.

Every asset input accepts a **pasted URL** (self-hosted assets work fine) or a
**direct upload** to the `map-assets` Supabase Storage bucket (public read,
authenticated upload, created by migration 0002). "Reset all to tactical
default" clears the theme without touching uploaded files.

## UX patch (migration 0003)

- **Engagement → battle linkage:** pending engagements on the map now have a
  "File report" button (`file_battle_for_order` RPC) that creates the battle
  pre-filled with participants, hex, and suggested mission, and links it back
  to the BattleOrder — so territory changes and retreats actually apply at
  turn completion. SoC invasions of ungarrisoned ground resolve the hex
  controller as defender.
- **Attention strip:** the campaign overview surfaces per-role action items —
  battles awaiting your verification, disputes (GM), rosters pending approval
  (GM), missing move orders, unmustered forces — each linking to where it's
  handled.
- **Realtime:** map and campaign pages subscribe to Supabase Realtime, so turn
  locks, moves, and roster changes appear on every open device without a
  refresh (debounced; migration 0003 adds the tables to the realtime
  publication).
- **Turn-lock preview:** locking now shows a dry run (engagements to be
  declared, unopposed captures) before committing; completing with unresolved
  engagements shows an explicit void warning. No browser confirm()/prompt()
  dialogs remain anywhere.
- **Password reset:** "Forgot password?" on sign-in emails a recovery link
  landing on `/reset`. Requires working email (Supabase SMTP or the built-in
  dev-tier sender).

## v1.8 (migration 0004) — server-authoritative core

- **Atomic state machine:** `lock_turn`, `complete_turn`, `verify_battle`, and
  `amend_battle` are Postgres functions — one transaction each. The JS modules
  in `src/lib/` remain only as the dry-run preview engine for the lock dialog.
- **Tamper-proof progression:** verification deltas are recomputed server-side
  from campaign config; triggers block direct player writes to
  `roster.requisition_points` and `unit.xp_total` (GM overrides allowed).
- **Campaign chronicle:** `campaign_event` records every meaningful action;
  rendered as a timeline on the overview (realtime), doubles as the audit trail.
- **GM correction tools:** "Amend" on verified battles reverses applied XP/RP
  exactly and reopens the report (safe before turn completion; afterwards fix
  territory on the map by hand). GM can place any army — including broken
  ones — via the hex inspector.
- **Polish:** toasts replace silent saves; optimistic move orders; map
  wheel-zoom / drag-pan / pinch with double-click reset; per-unit battle
  records on Crusade cards; `supabase/seed_demo.sql` stands up a complete test
  campaign in one run.
- **Tests:** `supabase/tests/` contains a 13-assertion functional suite that
  runs the entire state machine against a scratch Postgres (see its README).
  Executed green against PostgreSQL 16 before shipping.

## v2

See `docs/V2-PRD.md` — fog of war, interception/stacking, attrition,
templates, stats, PWA, Discord OAuth, with sequencing and data-model deltas.

## v2.0–v2.2 (migration 0005)

Per `docs/V2-PRD.md`, phases v2.0–v2.2 are implemented and tested; every rules
change is a per-campaign toggle defaulting to v1.8 behavior. **Trust model:
the GM does not field a force** (stated assumption of disputes, amendments,
and any future fog).

- **Player dropout (2.8):** GM "Evacuate" on any roster — territory reverts to
  unclaimed, armies leave the map, roster becomes `departed` and drops out of
  standings and VP tallies. Battles, units, and chronicle stay; the withdrawal
  itself is chronicled.
- **Campaign templates (2.4):** save any campaign's rules/victory
  conditions/map/theme to a club-wide library (GM Console); "Found a campaign"
  offers templates as starting points via `instantiate_template`.
- **Attrition (2.2, opt-in):** with `attrition_enabled`, destroyed units enter
  recovery for `recovery_turns` campaign turns (badge on the Crusade card,
  unavailable in battle pickers) and their return is chronicled with an
  Out-of-Action reminder. Broken forces optionally draw no manufactorum income
  (`broken_income_penalty`, logged as `income_withheld`).
- **Records tab (2.5):** head-to-head matchup grid, XP leaderboard, most
  decorated units, and a VP-over-turns chart reconstructed from
  `turn_completed` chronicle payloads. Dependency-free SVG.
- **Discord OAuth (2.7):** sign-in button ships; enable the Discord provider
  in Supabase → Auth → Providers (client ID/secret from a Discord application)
  for it to work. Email login remains the fallback.
- **PWA (2.6):** installable manifest + icon, mobile bottom tab bar, and a
  deliberately conservative service worker (static assets only — campaign
  data and writes are never cached, stale writes would corrupt turns).

Tests: `supabase/tests/v2_test.sql` (7 assertions) runs after the v1.8 suite —
evacuation semantics, template round-trip, attrition recovery + amend
reversal, broken income penalty, departed-roster VP exclusion.

**Not yet built (per PRD sequencing):** 2.3 interception/stacking and 2.1 fog
of war. Both gate on growing the test suite first; fog additionally awaits an
analog trial campaign.

## Handbook

`HANDBOOK.md` is the user manual — concepts, roles, the full turn cycle,
battle reporting and verification, progression, attrition, customization,
and a situations/FAQ section. Share it with the club; this README stays
about installation and architecture.
