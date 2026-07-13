# Sledgehammer Crusade Manager — v2 PRD

**Status:** Draft 0.1 · **Baseline:** v1.8 (migrations 0001–0004)
**Author:** Drafted by Claude for Peter / Sledgehammer gaming club, Vienna

## 1. Context and goals

v1.8 delivered a server-authoritative campaign engine: atomic turn resolution,
tamper-proof XP/RP, an event chronicle, GM correction tools, and a customizable
tactical map. v2 expands the *game* rather than the *platform*: deeper strategic
decisions on the hex map, better long-term engagement, and lower GM overhead
across multiple campaigns.

Guiding constraints carried over from v1: club scale (≤12 players), free-tier
infrastructure, GM-adjudicated in person, edition-agnostic rules config, and
every new rule must be **optional per campaign** — a v2 campaign with all
features off must behave exactly like v1.8.

**Trust-model assumption (decided):** the GM does not field a force. The
entire arbitration surface — dispute adjudication, `amend_battle`, turn
resolution, and fog omniscience — assumes a non-playing GM. The app states
this on campaign creation. Revisit only if the club ever runs GM-as-player
campaigns; the mitigations (dispute co-signing, audited arbiter mode) are
documented in the appendix of this file's history and deliberately not built.

Non-goals for v2: public multi-club hosting, payment/accounts beyond the club,
native mobile apps, automated rules enforcement of tabletop play itself.

## 2. Feature specifications

### 2.1 Fog of war *(strictly optional — off by default, decided)*

**Problem.** Perfect information makes the macro-game solvable; hidden movement
creates scouting, bluffing, and the "where are the Orks?" table talk that
narrative campaigns live on.

**Behavior.**
- Campaign toggle `fog_enabled` (default off). When on, players see: their own
  armies and orders; terrain of all hexes (geography is known); control markers
  and enemy armies only within *visibility range* of their armies and
  controlled hexes (default 2, config `fog_visibility_range`).
- Hexes seen before but not currently visible show **last-known state** with a
  "stale intel" timestamp, not live state.
- The GM always sees everything; a GM "reveal all" toggle supports table-talk
  moments. Completed campaigns drop fog entirely.

**Implementation sketch.** Visibility cannot be enforced by RLS alone at hex
granularity without heavy policy complexity. Approach: a `map_snapshot` RPC
(security definer) returns the fog-filtered map for the calling player and is
the *only* map read path when fog is on (client stops querying `hex_tile` /
`army` directly; RLS on those tables tightens to GM-only select when
`fog_enabled`). Last-known state persisted per player in `player_intel`
(player_id, hex_id, seen_state jsonb, seen_at).

**Risks / open questions.** Realtime updates leak information (event
timing reveals activity even without payloads) — mitigate by debouncing
client refresh through the snapshot RPC rather than direct table subscriptions.
Does the chronicle need fog-filtering too? (Proposal: yes — battle events
publish, movement events don't.) Fog presumes the non-playing GM (see
constraints). Recommendation before building: trial one campaign with analog
fog (GM tracks hidden positions privately) to validate the club actually
enjoys the dynamic — this is the highest-effort feature in the PRD and the
easiest to have gather dust.

### 2.2 Interception & multi-army stacking

**Problem.** v1 armies are one-per-roster tokens that only fight when
co-located. There is no way to defend a border or split forces.

**Behavior.**
- `armies_per_roster` config (default 1 = v1 behavior; max 3). Each army binds
  a subset of the roster (units assigned per army; a unit fights only with its
  army). Supply limit applies per roster, not per army.
- **Interception:** an idle (not force-marching) army may set a *posture* —
  `garrison` (fights only on its hex) or `screen` (intercepts enemy movement
  through adjacent hexes). A screened move stops in the screened hex and
  generates a `meeting engagement` BattleOrder there.
- **Stacking:** max 1 friendly army per hex (keeps the map readable and the
  resolution engine sane). Two of your armies may *swap* hexes in one turn.

**Implementation sketch.** `army.posture` column; `army_unit` join table for
unit assignment; `lock_turn` extended: after computing destinations, run an
interception pass over screening armies before conflict pairing. Movement paths
matter now (a 2-hex force march can be intercepted mid-path), so move orders
store the chosen path (`move_order.path uuid[]`), validated server-side.

**Open questions.** Can a broken roster's second army keep fighting? (Proposal:
yes — "broken" is per army.) XP for intercepting units on a voided battle?

### 2.3 Attrition & casualties

**Problem.** Battles currently have no lasting cost beyond battle scars chosen
narratively; a defeated army bounces back instantly, so aggression is free.

**Behavior.**
- Campaign toggle `attrition_enabled`. On verification, units flagged
  `destroyed_in_battle` enter **recovery** for `recovery_turns` (default 1)
  campaign turns instead of merely being marked destroyed: they cannot be
  fielded, shown greyed on the Crusade card with a countdown.
- Optional **Out of Action table** prompt: when a destroyed unit recovers, the
  app offers the roll result entry (battle scar gained y/n) so the Crusade
  bookkeeping happens at the moment it matters.
- Broken armies (no retreat path) return at muster: GM places them, and the
  roster skips one turn of manufactorum income (config `broken_penalty`).

**Implementation sketch.** `unit.recovering_until_turn int`; recovery decrement
inside `complete_turn`; UI filters in battle-participant pickers.

### 2.4 Campaign templates

**Problem.** Setting up a campaign (rules, map, victory conditions, honours,
webhooks) takes the GM a full evening; the club will run several campaigns a
year and wants continuity between them.

**Behavior.**
- "Save as template" on any campaign (GM): captures rules config, map theme,
  terrain layout (optionally), victory conditions, mission pool, unique
  honours — not players, rosters, or history.
- "New campaign from template" at creation. Club-wide template library
  (visible to all club GMs), plus 2–3 shipped presets ("Planetstrike",
  "Sector War", "Expedition").
- Templates are versioned snapshots (jsonb blob), not live links — editing a
  template never touches past campaigns.

**Implementation sketch.** `campaign_template` table (name, created_by,
config jsonb, map jsonb nullable); two RPCs (`save_template`,
`instantiate_template`). Small, low-risk, high GM-love.

### 2.5 Stats & records dashboards

**Problem.** The chronicle tells the story; players also want the numbers —
and between-session engagement is where campaign apps die.

**Behavior.**
- Per-campaign **Records** tab: win rates per force and per matchup, XP
  leaderboard, "most decorated unit", biggest upset (win probability proxy via
  W-L differential), territory graph over turns, RP economy over time.
- Per-unit career page across campaigns (same roster name linking is manual —
  units are campaign-scoped; a "lineage" field lets a player link a unit to its
  predecessor).
- Club **Hall of Fame** on the dashboard: completed campaigns, their winners,
  legendary (51+ XP) units ever.

**Implementation sketch.** All derivable from existing tables + `campaign_event`;
one materialized view (`campaign_stats`) refreshed on turn completion keeps
queries trivial. Charts: recharts, already in the artifact ecosystem — or plain
SVG sparklines to stay dependency-light (preferred).

### 2.6 Mobile & PWA pass

**Problem.** Orders get submitted from the couch and battles reported at the
table; the desktop layout stacks acceptably but isn't *designed* for phones.

**Behavior.** PWA manifest + install prompt; bottom tab bar under 640px; map
gestures (shipped in v1.8) tuned with larger touch targets for tokens; battle
report form as a single-column stepper; offline read-only cache of the last
loaded campaign (service worker, stale-while-revalidate) — *writes* stay
online-only to avoid sync conflicts.

### 2.7 OAuth (Discord)

**Problem.** The club lives on Discord; email+password is friction and the
password-reset flow depends on SMTP config.

**Behavior.** "Sign in with Discord" via Supabase OAuth. Existing email
accounts can link Discord in profile settings. Discord avatar/handle
auto-populate the profile. Email login remains as fallback.

**Implementation sketch.** Supabase dashboard config + one client call; the
work is the account-linking UI and profile merge rules. Half a day.

### 2.8 Player dropout — roster evacuation

**Problem.** A six-month campaign will lose a player. Today a departed
player's roster freezes territory and an army on the map forever, distorting
the strategic picture and every VP calculation.

**Behavior (decided: simple evacuation).**
- GM action "Evacuate force" on any roster: all hexes controlled by the roster
  revert to **unclaimed**, its armies are removed from the map, and the roster
  moves to a `departed` status — hidden from standings and move flows, but its
  battles, units, and chronicle entries are preserved (history is never
  deleted).
- One chronicle entry marks the withdrawal ("The Cadian 8th withdraws from the
  sector — their ground lies abandoned").
- Evacuation is reversible only in the trivial sense: the GM can set the
  roster back to approved and redeploy the army by hand; territory does not
  return.
- Deliberately **not** built: gradual territory decay, roster adoption by a
  replacement player. Both add state-machine complexity for a case the simple
  version already handles; revisit only if evacuation proves too abrupt in
  practice.

**Implementation sketch.** `evacuate_roster(rid)` security-definer RPC
(GM-only, transactional, event-logged); `roster.status` gains `departed`.
Size: S.

## 3. Sequencing & sizing

| Phase | Features | Rationale | Size |
|---|---|---|---|
| v2.0 | 2.8 Dropout, 2.4 Templates, 2.7 OAuth, 2.5 Stats | Zero rules risk, immediate quality-of-life, ships between campaigns | S–M |
| v2.1 | 2.6 Mobile/PWA | Independent of rules work, benefits everything after | M |
| v2.2 | 2.3 Attrition | Smallest rules change; validates the "optional module" pattern in `complete_turn` | M |
| v2.3 | 2.2 Interception & stacking | Big `lock_turn` surgery; needs the test suite grown first | L |
| v2.4 | 2.1 Fog of war | Largest architectural change (read-path inversion); last so it layers on stable rules | L |

Every phase extends `supabase/tests/state_machine_test.sql` before merging —
the v1.8 harness is the regression safety net that makes 2.2/2.1 tractable.

## 4. Data-model delta summary

New tables: `player_intel`, `army_unit`, `campaign_template`,
`campaign_stats` (matview). New roster status: `departed`. New columns: `campaign.fog_enabled`,
`.fog_visibility_range`, `.armies_per_roster`, `.attrition_enabled`,
`.recovery_turns`, `.broken_penalty`; `army.posture`; `move_order.path`;
`unit.recovering_until_turn`, `.lineage_note`. No breaking changes to v1.8
tables; all flags default to v1.8 behavior.

## 5. Explicitly deferred beyond v2

Automated mission generation, points-integration with external list builders'
APIs, spectator mode with live battle feeds, multi-club federation, AI-written
chronicle prose (fun, but the club's own words are the point).
