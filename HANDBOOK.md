# Sledgehammer Crusade Manager — Handbook

This is the user manual. It covers what the app does and how to run a campaign
with it, for both players and GMs. For installation and deployment, see
`README.md`; for the technical roadmap, see `docs/V2-PRD.md`.

---

## 1. What this is

The Crusade Manager runs a Warhammer 40,000 Crusade campaign as two connected
games:

**The tabletop game** happens at the club as always. The app never adjudicates
dice — it records outcomes, tracks progression, and keeps everyone honest.

**The macro-game** happens on a hex map between sessions. Each campaign turn,
every force issues one movement order. When the GM locks the turn, all orders
resolve simultaneously: armies move, undefended ground changes hands, and
collisions become *engagements* — real tabletop battles the involved players
schedule and fight. Territory produces victory points and requisition; the
first force to meet a victory condition wins the campaign.

A few principles worth knowing up front, because they explain most of the
app's behavior:

- **The record is authoritative.** XP, requisition, and territory only change
  through verified battles and turn resolution. Nobody — including the person
  reporting a battle — can award themselves anything.
- **Two signatures per battle.** Every battle report must be confirmed by the
  opponent (or the GM) before it counts. Until then it changes nothing.
- **The GM does not field a force.** The GM adjudicates disputes, resolves
  turns, and can amend records; the design assumes they are neutral.
- **Everything is chronicled.** Every meaningful event lands in the campaign
  chronicle — it's the story of the campaign and the audit trail in one.
- **The rules are configuration.** XP values, requisition rates, march
  distances, victory conditions — all per-campaign settings, not code. When
  a new edition lands, the GM changes numbers, not software.

## 2. Roles

**Player.** Joins via invite, musters one force (roster), issues movement
orders, files and verifies battle reports, maintains their Crusade cards.

**GM.** Created automatically for whoever founds a campaign. Configures rules
and the map, approves rosters, locks and completes turns, adjudicates
disputes, corrects mistakes, and can edit anything a player can. One campaign
can have several GMs (an existing GM promotes a player in the database; a UI
for this is on the roadmap).

**Site admin.** A club-level role set once in the database (see README). Can
see and manage all campaigns, including archiving them.

## 3. Getting started as a player

**Account.** Sign up with email and password, or use *Sign in with Discord*
if the club has enabled it. Forgot your password? The sign-in page has a
recovery link flow (requires the club's email sending to be configured).

**Joining.** The GM gives you a six-character invite code or a link. Enter the
code on the dashboard or just open the link. Codes expire after seven days and
stop working when the campaign is full.

**Mustering your force.** On the *Order of Battle* tab, create your roster:
name, faction. Your supply limit and starting requisition come from the
campaign settings.

**Importing your list.** Paste your army list into the import box. The parser
accepts Listforge-style JSON exports and plain text in the common formats:

```
Leman Russ Battle Tank (170 pts)
10x Cadian Shock Troops - 65
- Plasma gun, vox-caster
```

Bulleted lines under a unit become its wargear. Click *Parse* to preview
before committing — units the parser is unsure about are flagged `CHECK`.
Nothing is ever silently dropped: lines it can't classify are preserved in
your roster notes and on the unit's card, so you can fix them by hand.

**Approval.** When your list is ready, the GM approves it. From that moment
your force *composition* is locked (units, points, wargear) — but your Crusade
card fields stay editable throughout the campaign: honours, scars, relic,
notes, destroyed/reserve status. If you genuinely need to change composition
(a requisition purchase, say), ask the GM to unlock, edit, and re-approve.

## 4. Crusade cards and progression

Each unit has a card showing its points, role, wargear, XP, rank, and
decorations.

**Experience** is awarded automatically when a battle is verified:

| Source | Default XP |
|---|---|
| Taking part in a battle | +1 |
| Your side achieved its agenda | +1 |
| Marked for Greatness (one unit per side per battle) | +3 |

All values are campaign settings — check your GM Console numbers if your club
houserules them. Ranks follow the 10th edition thresholds (Battle-ready 0,
Blooded 6, Battle-hardened 16, Heroic 31, Legendary 51) and display
automatically. Players cannot edit XP directly — it changes only through
verification or the GM.

**Honours and scars** are added on the unit card (open *Edit*): type a name,
press *+ Honour* or *+ Scar*. The campaign's unique honours appear as
suggestions; if you pick one, the app reminds you to check no other unit
already carries it. Each addition is chronicled. Crusade points display as
honours minus scars.

**Requisition points** belong to the roster: +1 per battle fought, +1 more for
the winner, +1 per controlled manufactorum each turn (all configurable). Spend
them at the table as your Crusade rules dictate; the GM adjusts anything the
app doesn't model directly.

**Relics** are flagged per unit. More than one relic in a force raises a
warning banner (most campaigns restrict to one).

**Battle record.** Open a unit's edit panel to see its personal history —
every verified battle it fought, the result, stars for Marked for Greatness,
and crosses for the times it was put down.

## 5. Running a campaign (GM)

### 5.1 Lifecycle

A campaign moves through five states, changed in the GM Console:

**draft** → setup. Configure everything; players can't meaningfully interact
yet. Victory conditions can only be edited here. → **mustering** → invites
out, rosters in, approvals happen. → **active** → set automatically when you
begin the campaign on the map; turns run. → **completed** → set automatically
when a victory condition is met (or manually). The campaign becomes
read-only and *publicly viewable* — the URL is the shareable archive link.
Add an epilogue in the GM Console. → **archived** → admin-only, hidden.

### 5.2 Configuration

Everything lives in the GM Console:

- **Rules configuration:** all XP/RP values, supply limit, starting
  requisition, force-march distance, Sphere-of-Control hold duration, the
  wasteland mission pool, and the campaign's unique honours list.
- **Victory conditions** (draft only): add any combination of *Domination*
  (control ≥ N% of hexes), *Hold hex* (hold a specific hex N consecutive
  turns), *VP threshold* (first to N VP), and *Highest VP at turn N*. They run
  in parallel; the first met at a turn completion ends the campaign.
- **Attrition module** (optional): see §9.
- **Invites:** generate codes/links, copy, revoke.
- **Webhooks:** see §11.
- **Map appearance:** see §10.

### 5.3 Templates

Setting up a campaign is an evening's work — once. *Save as template* in the
GM Console snapshots the rules, victory conditions, honours, theme, and
optionally the full map into a club-wide library. Founding the next campaign,
any GM can pick a template as the starting point; only the name is asked for.
Templates are frozen snapshots — editing or deleting one never touches
campaigns made from it. Players, rosters, and history are never part of a
template.

### 5.4 The map

With no map yet, the Theatre Map tab offers generation: pick a preset
(*Balanced Sector*, *Hive Sprawl*, *Death World Expedition*) and a player
count; the radius follows the campaign rules (4 players ≈ 61 hexes, 6 ≈ 91,
8 ≈ 127). Presets only seed the board — click any hex afterwards to edit its
terrain, name, VP value, SoC radius, flavour text, controller, and location
art. Take your time here; a named map with flavour text is half the campaign's
atmosphere.

### 5.5 Beginning

*Begin campaign* on the map deploys any force without an army onto spaced-out
edge hexes (each claiming its starting hex), opens Turn 1, and sets the
campaign active. Prefer hand placement? Use the hex inspector's *GM: place
army here* before or after — it's also how you reposition armies and return
broken ones to the field at any point.

## 6. The campaign turn

This is the heartbeat of the macro-game. One full cycle:

**1. Orders (turn open).** Each player opens the map and issues one order for
their army: *Advance* (1 hex) or *Force march* (further — default 2 — but a
force-marching army cannot initiate an attack and suffers an **Ambush** if
attacked). Reachable hexes highlight; death worlds cost 2 movement to enter.
Orders can be changed or rescinded until the lock. No order means hold
position. Everyone sees everyone's arrows — the mind games are the point.

**2. Lock (GM).** *Lock turn…* shows a preview first: exactly which
engagements will be declared and which unopposed hexes will change hands.
Confirming resolves all orders simultaneously in one transaction:

- An army moving onto **unclaimed** ground, or enemy ground outside any enemy
  Sphere of Control, captures it immediately.
- Moving onto enemy ground **inside an enemy SoC** declares an *invasion*
  against the controlling force — defended ground must be fought for even
  when ungarrisoned.
- Moving onto a hex where an enemy army **stands** declares a *siege*
  (they held the ground). Two armies arriving simultaneously fight a
  *meeting engagement*.
- A force-marching defender fights at a disadvantage — the engagement is
  flagged **AMBUSH** for the tabletop setup.

Each engagement carries a suggested mission type from its terrain (see §8).

**3. Battles (turn resolving).** Declared engagements list on the map with a
*File report* button — one click creates the battle pre-filled with attacker,
defender, ground, and suggested mission, linked to the engagement. Play the
game at the club, then complete the report (§7). Territory consequences apply
only once the report is **verified**.

**4. Complete (GM).** *Complete turn…* applies everything at once: winners of
verified battles take the contested hex; losers retreat one hex toward their
nearest friendly territory — or, on an agreed **crushing defeat**, fall all
the way back to it. A loser with no friendly ground anywhere is **broken**:
off the map until the GM redeploys them. Contested SoC holds tick up (stand on
enemy SoC ground unbattled for the configured number of turns and it flips).
Manufactorum income pays out. VP are tallied, victory conditions checked, and
either the next turn opens or the campaign completes. If engagements are still
unresolved, the app warns you explicitly: completing anyway **voids** them —
no territory change, no XP. Usually the right move is to wait until the games
have been played.

Everything updates live on every open device — lock the turn at the club table
and twelve phones repaint together.

## 7. Battle reports

A report can be started from an engagement (preferred — everything pre-fills)
or freely from the Battles tab for off-map games; free battles still award XP
and RP but have no territorial effect.

**Filling it in.** Either participant edits the draft: mission, result
(recorded from the attacker's perspective), each side's agenda and whether it
was achieved, participating units (tick them), one *Marked for Greatness* per
side (star), units *lost* (put out of action), the crushing-defeat flag (only
with both commanders' agreement — it changes the retreat), and narrative
notes. Write the narrative. Future-you reading the chronicle will thank you.

**Verification.** The reporter submits; the *other* participant (or the GM)
reviews and either **verifies** — XP and RP apply instantly, computed
server-side from the campaign settings, and the linked engagement completes —
or **disputes** with stated grounds. A disputed battle goes to the GM, who
returns it for re-verification (after the players fix it) or voids it. The
reporter can never verify their own report.

**Fixing mistakes.** Wrong result verified at 23:00 after beers? The GM's
*Amend* button reverses the applied XP and RP exactly, resurrects units,
clears recovery, and reopens the report for correction and re-verification.
Amend freely *before* the turn is completed; afterwards the numbers still
reverse cleanly but territory and retreats already happened — fix the map by
hand via the hex inspector.

**States at a glance:** `draft` → `pending_verification` → `verified`
(or `disputed` → back, or `void`).

## 8. Reading the map

| Terrain | Effect | Suggested mission |
|---|---|---|
| Wasteland | none | GM pool |
| Ruins | mission modifier | Retrieval / Relic Hunt |
| Manufactorum | +1 RP per turn to controller | Sabotage / Control |
| Settlement | high VP, projects SoC | Siege |
| Fortification | projects SoC, capture requires siege | Siege |
| Reliquary | narrative significance | GM-defined |
| Death World | costs 2 movement to enter | Assassination / Survival |

Hex borders show the controller's colour; the small dashed ring marks a
Sphere of Control source; the gold number is the hex's VP value. Army tokens
carry a force's custom icon or a three-letter abbreviation; `»` marks a force
march, `⚔` an army in battle. Dashed arrows are submitted move orders. Scroll
or pinch to zoom, drag to pan, double-click to reset. Click any hex for its
details — and, as GM, its full editor.

## 9. Attrition (optional module)

Off by default; enable in Rules configuration. With attrition on:

- A unit put out of action doesn't get marked destroyed — it enters
  **recovery** for the configured number of campaign turns. Its card shows
  *Recovering — until T5* and it can't be selected for battles until then.
- When it returns, the chronicle prompts the Out-of-Action roll — record any
  battle scar on the card there and then.
- If *broken forces draw no income* is on, a roster whose army is broken in
  the field skips its manufactorum requisition that turn (chronicled as
  withheld).

The effect at the table: losing units has a real next-battle cost, so
reckless aggression stops being free. Amending a battle reverses recovery
along with everything else.

## 10. Making it yours

The map is a layered display and every layer accepts your own art. All inputs
take either a pasted URL (self-hosted assets work) or a direct upload.

- **Background art** with an opacity slider sits under the grid (GM Console →
  Map appearance).
- **Terrain colours and textures** per terrain type; textures tile inside the
  hexes. Seamless ~256 px squares look best.
- **Location art** per hex (map → click hex → Location art) replaces the
  terrain glyph — roughly a 33 px box, so simple silhouettes beat detail.
- **Army icons** (roster page) render as circular tokens ringed in the force
  colour; square source images work best.
- Glyphs and VP labels can be toggled off if your art carries the
  information. *Reset all to tactical default* returns the flat display
  without deleting any uploads.

## 11. Notifications and the chronicle

**Discord.** Six optional webhooks (GM Console): battle reported, battle
verified, dispute raised, roster approved, turn advanced (with the engagement
list), campaign completed. Paste a Discord webhook URL per event you want.
Failures never block the app.

**The chronicle** on the overview records everything — battles, captures,
flips, broken armies, recoveries, withdrawals, turn summaries — as a timeline.
It doubles as the audit trail: if anyone questions a number, the history of
how it got there is right there. Completed campaigns keep their chronicle on
the public archive page.

**Needs your attention.** The overview surfaces your personal to-dos: battles
awaiting *your* verification, disputes and pending rosters (GM), a turn open
without your orders, an unmustered force. If the strip is empty, you're up to
date.

## 12. When a player leaves

It happens — six-month campaigns meet real life. The GM opens the departing
player's roster and clicks *Evacuate…*: their territory reverts to unclaimed,
their army leaves the map, and the force drops out of standings, VP tallies,
and victory checks. Their battles, units, and chronicle entries remain
forever — history is never deleted — and the withdrawal itself becomes a
chronicle entry. Territory does not come back if they return; the GM can
re-approve the roster and redeploy the army by hand for a fresh start.

## 13. Records

The Records tab is the campaign's statistics annex: a head-to-head grid
showing every force's record against every other, the XP leaderboard with
ranks, the most decorated units (honours and Marked-for-Greatness counts),
and a victory-point graph across every completed turn. It builds itself from
the battle log and chronicle — nothing to maintain.

## 14. Situations and answers

**"I moved next to an enemy hex and nothing happened."** Capture and combat
trigger on *entering* a hex, not adjacency. Also check whether you
force-marched — marching armies can't initiate attacks.

**"I attacked an empty enemy hex and got a battle instead of a capture."**
It sits inside an enemy Sphere of Control. Defended ground must be fought for;
the controller defends even without an army present.

**"We verified the wrong result."** GM → battle → *Amend*. Before turn
completion this is a full clean undo.

**"The turn was completed but one battle was never played."** It was voided —
the warning said so. The game can still be played as a free battle for XP and
RP; the territorial moment has passed.

**"A player can't log in."** *Forgot password?* on the sign-in page, if email
sending is configured; otherwise an admin resets the password in the Supabase
dashboard. Better: enable Discord sign-in.

**"My army is broken. Now what?"** You're in off-map reserve. The GM returns
you to the field via any hex's inspector (*GM: place army here*), typically at
the next turn boundary and on or near friendly ground — that's a table
convention, not app-enforced.

**"Can I have two armies / hide my movements?"** Not yet — multi-army
operations with interception, and optional fog of war, are specced for v2.3
and v2.4 (`docs/V2-PRD.md`).

**"Where do requisition purchases, Out-of-Action rolls, and battle traits
actually get rolled?"** At the table, per your Crusade rules. The app records
outcomes (spend RP via the GM, add honours/scars on the card); it doesn't
replace the rulebook.

## 15. Quick reference

**Battle:** `draft → pending_verification → verified` (or `disputed`/`void`) ·
opponent or GM verifies, never the reporter · GM can amend verified battles.

**Turn:** `open` (orders) `→ locked/resolving` (engagements declared) `→
complete` (territory, retreats, SoC, income, VP, victory check) · GM-only
transitions, both with previews.

**Movement:** advance 1 hex · force march further but no attacking and
ambush-vulnerable · death worlds cost 2 · no order = hold.

**Capture:** unclaimed or un-SoC'd enemy ground = immediate on entry ·
SoC-covered ground = invasion battle · occupied ground = siege · stand on
enemy SoC ground unbattled for the configured turns and it flips.

**XP (defaults):** +1 battle, +1 agenda, +3 Marked for Greatness (one per
side). **RP (defaults):** +1 per battle, +1 victory, +1 per manufactorum per
turn.

**Retreat:** 1 hex toward nearest friendly territory · crushing defeat = all
the way · nowhere to go = broken (GM redeploys).

The Emperor protects — but verify your battle reports anyway.
