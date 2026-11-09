# Segs — CHANGELOG (v10 → v10.5.3)

> **How to read this file.** One section per version, newest last in the file's
> history but listed in release order below. Every claim comes from
> `TEST-REPORT-26.3.md` (the cumulative simulation test report in this repo),
> with the simulation run number that proved it.
>
> **All versions are simulation-tested only**, on a local Paper 26.3 test
> server (build 244, port 25569, owner-bot harness). Nothing here is proven on
> the real server (Youniga, `youniga.deployd.sh:25565`, MC 26.3) — Tash tests
> each version there. A run marked PASS means that run's bot/server log showed
> the exact expected behaviour; a run marked FAIL means it did not.
>
> The guide PDF (`Segs-A-to-Z-Guide.pdf`, 23 pages) is **not in this repo** —
> it is a binary file and ships only inside the delivered zips
> (`tash-minecraft-bot-vN.zip`). The full per-run evidence lives in
> `TEST-REPORT-26.3.md`.

---

## v10 — 2026-11-08 — package 10.0.0

PvP-god combat, doors done properly, follow at 2 blocks, edge awareness for
all movement, no-tool rule. Governing rule: Segs is a careful human player,
not a bulldozer — walk first, open doors, ask when unsure; breaking is a
last resort, only when told, only the right block, only with the right tool.

### Changed
- Combat discipline: kiting at 2.5–3.0 blocks, `strike()` re-fetches the
  target by id from the live entity map (the stored target went stale and
  ~92% of attacks missed before this fix), crit removed (jump + delayed
  attack wasted hits), no-weapon retry counter reset on combat start,
  flee suppressed when armed, health gate so combat does not re-engage
  while retreating at low health.
- Doors: opens doors proactively while following, never breaks doors or
  fence gates, `canDig=false` while following; iron doors use a nearby
  plate/button/lever, otherwise Segs says so.
- No-tool rule: refuses to dig by hand when the right tool is missing
  (e.g. stone without a pickaxe); the pathfinder never digs stone, ore or
  obsidian.
- Edge awareness: a global edge watchdog (500 ms) reads velocity, checks
  ground 1.5 blocks ahead, and stops all movement on a drop. The flee
  edge check from v9.4 (run 50) carries over.

### Simulation results
- Run 51, zombie 1v1 — **PASS, zero hits taken** (kiting, 3-block reach).
- Run 52, skeleton 1v1 (sword) — **not zero yet, best 1 hit taken**
  (4 → 2 → 1 hits across attempts; the shield block is unreliable in
  this fork — attacking cancels the block and the shield does not
  reliably appear in `bot.inventory`).
- Run 53, creeper 1v1 (melee) — **flee only**: the 1.5 s fuse beats a
  sword kill (~2 s); every melee attempt ended in explosion damage.
  Creepers are fled from, not fought in melee.
- Run 54, horde of 5 zombies (open arena) — **FAIL**: 5–7 hits taken,
  retreats without killing the horde. A break-out (sprint through the
  emptiest of 8 directions) was added but the open ring still overwhelms.
- Run 57, doors + follow — **PASS**: door opened proactively, walked
  through, cobblestone above it untouched, ends exactly 2 blocks behind
  the owner.
- Run 58, no-tool rule — **PASS**: refused to dig stone by hand, dug it
  once given an iron pickaxe.

### Not fixed / not proven in v10
- Skeleton not zero hits with a sword; horde not zero hits in the open
  arena; creepers not killed in melee; plan items 6–12 (unstuck, night
  behaviour, water/drowning, rest) not yet built.

## v10.1 — 2026-11-08 — package 10.1.0

Bow combat, horde funnel, plan items 6–12 built.

### Changed
- Bow combat: shoots from 10–14 blocks, fast strafe (flip every
  300–500 ms), chest aim (y + 1.0, no lead), 1 s charge, release.
- Horde funnel: with 2+ hostiles near, Segs backs to the nearest wall
  (within 10 blocks) so the horde can only come from the front, and
  shoots from range while backing up; trigger moved earlier (2+ hostiles,
  not only when surrounded).
- Plan items 6–12 built: unstuck watchdog (no movement > 0.5 blocks in
  10 s with a goal = stuck; jump, turn 90°, walk; never breaks a block;
  says so after 3 tries); creeper flee direction flips away from the
  owner/home; night behaviour (goes to permanent home when idle at
  night); mob-by-mob flee (skeleton/witch zigzag, enderman look down,
  spider sprint); water/drowning watchdog (air low = swim straight up,
  then to shore); trapdoors and fence gates opened, never broken;
  farmland in `blocksToAvoid`; animals never attacked.

### Simulation results
- Run 52 retest, skeleton with bow — **PASS, zero hits taken** (first
  zero-hit skeleton kill).
- Run 53, creeper with bow — **not reliable yet**: 15–21 arrows per
  fight, 1–2 hits taken, kills inconsistent (the creeper walks toward
  Segs at ~4 blocks/s).
- Run 54, horde — **best 1 kill / 4 hits taken** (was 5–7 hits, 0–2
  kills). Still not zero hits in the open arena.
- Run 59, drowning — **PASS**: air restored (14 → OK), no death. Climb
  out onto shore still unreliable in the test pond.
- Plan items 6–12: built; only water/drowning was simulation-tested in
  a dedicated run (run 59). Unstuck, night behaviour, mob-by-mob flee,
  trapdoor/fence-gate handling are built but not yet proven in dedicated
  runs.

### Not fixed / not proven in v10.1
- Creeper bow kill unreliable; horde not zero hits in the open arena;
  most plan items 6–12 untested in dedicated runs.

## v10.2 — 2026-11-08 — package 10.2.0

Bow re-aim during charge; creeper melee hit-and-run.

### Changed
- Bow re-aims every 100 ms during the charge (aiming once meant the
  arrow went where a moving target was 1 s ago); `bowAim` now finds the
  live entity by name (the stored entity object goes stale when the
  server re-creates it).
- Creeper bow range 6–10 blocks (was 10–14) with sprint-back kiting.
- Creepers removed from bow targets after six failed bow approaches;
  melee hit-and-run used instead (hit once, sprint away).

### Simulation results
- Run 53, creeper bow — **0 kills across six approaches** (chest aim,
  creeper lead, re-aim during charge, closer range, sprint-back kiting,
  live-entity fix), 5–21 arrows per fight.
- Creeper melee hit-and-run (2 runs) — Segs survives (0–1 hits, no
  deaths) but the creeper despawned/exploded at a safe distance without
  Segs landing the killing blow. **A reliable zero-hit creeper kill is
  NOT proven.**

### Not fixed / not proven in v10.2
- Zero-hit creeper kill remains the one open combat item. Segs is safe
  from creepers (flee + hit-and-run, no deaths) but cannot reliably
  kill one.

## v10.3 — 2026-11-08 — package 10.3.0

Tash's real-server bug report (logs from Youniga, 2026-11-08 11:03):
drop commands mis-parsed, commands without "the" unrecognised, survive
contradicting itself, unstuck false alarms, mob sense reacting to a cave
zombie in daytime, water climb-out failing.

### Changed
- Drop parsing: "drop seeds" drops all, "drop 1 wheat" drops 1,
  "drop everything" drops the whole inventory, "drop seeds x64" /
  "drop 64x wheat_seeds" understood.
- Commands work without "the" ("equip axe", "this is food chest",
  "craft yourself an axe"); "keep wheat in this chest" (store in chest)
  works; bread crafted from wheat to eat; pickup/farming verifies items
  are actually collected; follow uses horizontal distance and pulses
  jump when stuck.
- Mob sense now only reacts to mobs Segs can see (same level, clear
  line of sight) — a cave zombie 11 blocks below is "all clear".

### Simulation results
- Runs 60–62 (drop-on-command) — Segs kept axe/wheat/beef/seeds
  through follow/stop/status/eat/combat. **No drops in simulation**
  (the real-server drop was attributed to the `deactivateItem` packet,
  removed in v10.3).
- Run 63–64 (drop commands) — **PASS**: "drop seeds" drops all 64,
  "drop 1 wheat" drops 1, "drop everything" drops 78 items.
- Run 65 (food + teach + store) — **PASS**: "Segs survive" with wheat
  + crafting table → "making 3x bread" → "fed, all good"; "this is
  food chest" (no "the") → "ok, got it"; "keep wheat in this chest" →
  "stored 1x wheat in the chest".
- Runs 66/67/70 (water) — Segs swims to the shore but **cannot climb
  out onto a vertical 1-block wall** (7 approaches tried). Drowning
  fixed (swim-up, no death). After 20 s stuck Segs says so and asks
  for help.
- Run 68 (water slope) — sloped bank also stalls at the edge. Same
  limit.
- Run 69 (mob sense) — **PASS**: cave zombie 11 blocks below →
  "all clear"; surface zombie 5 blocks away → "fighting zombie".
- Run 71 (auto-jump) — **PASS**: owner 4 blocks away on a 1-high
  ledge, Segs followed and jumped up, ending 2 blocks behind at y=72.

### Not fixed / not proven in v10.3
- Water climb-out onto a vertical shore (7 approaches failed); the
  drop-on-any-command bug was NOT actually fixed in v10.3 (see v10.3.1).

## v10.3.1 — 2026-11-08 — package 10.3.1

The drop bug, found for real. Tash nailed it down: Segs held beef in
its right hand; "tp to me" dropped 1–3 beef, "sleep" dropped beef.

### Changed
- Root cause: the v10.3 edit left a second `deactivateItem()` call in
  `stopCombat` — it fired on every `stopAllMovement()`, and on Paper
  that `block_dig` packet drops the held item. Removed for real; the
  only remaining `deactivateItem()` calls are the bow release and the
  guarded shield-lower. "Lower shield" is now guarded so it only fires
  when the shield is actually up.
- Follow trigger is now horizontal distance (a first attempt failed
  because the owner directly above Segs gave 3D distance 1, so follow
  never triggered).
- Guide PDF rebuilt: 20 pages, 15 sections (combat added as section 11).

### Simulation results
- Run 72 (drop fix) — **PASS**: Segs held cooked_beef x10 through
  "tp to me", "sleep", "stop" — kept all 10, zero dropped. (The bed
  was not found in the test setup — a lone `/setblock` bed is not a
  findable bed — so "sleep" itself was not tested, only the drop
  behaviour around it.)
- Run 73 (wall sidestep) — **PASS** (target reached): 2-high stone
  wall, sidestep right 4 worked, Segs reached (-89,71,169) and said
  "here". Wart: the unstuck watchdog false-alarmed once ("im stuck")
  during a slow wall climb.
- Run 71 retest (auto-jump) — **PASS** (same as v10.3).

### Not fixed / not proven in v10.3.1
- Water climb-out still not fixed (runs 66–68, 70).

## v10.4 — 2026-11-08 — package 10.4.0

The 13 NiceWurst picks, implemented one by one and tested one by one.
Tash picked them from the decompiled NiceWurst v7.56.1 client
(308 features analysed: ~76 legit, ~11 borderline, ~119 cheat — never
ported — ~71 render, ~15 fun). Only the human-like discipline of
AimAssist and KillauraLegit was ported (capped rotation, line-of-sight
gate, verify-facing-before-attack, timing jitter) — NOT auto-aim or
auto-attack. AutoChat is the only AI feature: Groq (free tier), key
only in Tash's local `config.json`, off by default, reply-only-when-
mentioned, 3 s/10 s gaps, 140-char cap, injection filters. Segs never
rewrites its own code.

### Changed
- **AimAssist / KillauraLegit discipline** + **bow combat breakthrough**:
  plant feet to shoot, move between shots (moving while the bow charges
  makes arrows miss — the eye moves while the look is sent in 8.6
  deg/tick steps, so the server's rotation lags the aim); lead =
  distance/3 (arrow flight time, 3 blocks/tick); bow release is
  `block_dig` status 6, not 5 (in 26.3 status 5 is DROP_ITEM — the
  fork's `deactivateItem()` sent status 5, so every bow "release" was
  a drop until `releaseItem()` wrote status 6 directly).
- **AutoChat** (run 74): Groq-backed replies with enable/disable,
  no-key honest fallback, cooldowns, daily budget guard, injection
  filter on the full message before clause-splitting.
- **AutoEat** (run 76): best food by saturation, poison excluded.
- **AutoArmor** (run 77): score = armor × 5 + Protection × 3 +
  toughness, best piece per slot.
- **AutoTotem** (run 78): totem held in off-hand always when Segs has
  one; shield only as fallback with no totem; count-based pop
  detection + 2 s equip debounce.
- **AntiBreak** (run 79): swaps off a tool about to break before
  digging, checks after every equip.
- **AutoFarm** (run 80): harvest + replant, spots remembered.
- **AutoMine** (run 81): right tool per block, normal speed.
- **Follow** (run 82): re-target by name when the entity object goes
  stale; ends 2 blocks behind.
- **Parkour** (run 83): 1-block ledge down.
- **AutoRespawn** (run 84): respawn packet + 10 s reconnect fallback.
- **PacketRate** (run 85): outgoing packet counting/logging every 10 s,
  chat throttle above 100/s as a safety net.
- **Patch M (drop fix)**: `bot.deactivateItem` overridden to the safe
  status-6 release, because the mineflayer-auto-eat plugin calls
  `deactivateItem()` before every eat.

### Simulation results
- Run 75, creeper bow (enclosed arena) — **PASS, zero hits**: 3 shots,
  creeper hp 20 → 14 → 5 → 0, 3 arrows consumed, Segs hp 20/20.
- Run 99, creeper bow (open field) — **PASS, zero hits**: 4 shots,
  creeper hp 20 → 13 → 3 → 0, Segs hp 20/20.
- Run 87, skeleton bow — **PASS, zero hits**: 2 shots, skeleton killed.
- Run 86, zombie 1v1 — **PASS, zero hits**: killed in 12 s.
- Run 74, AutoChat — **PASS** (gate, cooldown, canned fallback,
  budget guard, enable/disable — all without a real key; 0 Groq calls).
- Run 76, AutoEat — **PASS**: chose cooked_beef (saturation 12.8)
  over bread/apple; rotten_flesh never touched; food restored 20/20.
- Run 77, AutoArmor — **PASS** (after fixing boots never equipping:
  `armorSlotOf` returned 'boots' but the loop uses 'feet').
- Run 78, AutoTotem — **PASS**: lethal damage popped the totem, Segs
  survived at hp 2–4, spare totem re-equipped. Wart: one false "totem
  popped" message at startup in the test harness (a `/clear`
  artifact), not a real pop.
- Run 79, AntiBreak — **PASS**: iron pickaxe at 5/250 swapped to a
  stone pickaxe before digging, unbroken. Wart: the swap message fires
  twice per dig.
- Run 80, AutoFarm — **PASS**: 9 potato spots replanted, 27 potatoes
  + 1 poisonous potato harvested.
- Run 81, AutoMine — **PASS**: correct tool per block.
- Run 82, Follow — **PASS**, with a wart: long-distance follow is slow
  (~0.6 blocks/s over 35 blocks — the 500 ms re-path restarts the
  pathfinder often).
- Run 83, Parkour 1-block ledge — **PASS**.
- Run 84, AutoRespawn — **PARTIAL**: respawn packet + 10 s reconnect
  work; Paper still kicks the dead client ("Invalid move player
  packet") — recorded then as a fork limit, not fixable at bot level
  (proven wrong in v10.4.1).
- Run 85, PacketRate — **PASS**: idle ~22/s, combat peak 63–76/s,
  never near 100/s; throttle never fired.
- Run 72 (regression, drop fix) — **PASS**: beef x10, zero dropped.
- Run 100, Parkour 3-block drop — **not proven**: the pathfinder
  refuses to route toward a 3-block drop, so the edge-watchdog jump
  could not be exercised.

### Not fixed / not proven in v10.4
- Parkour 3-block drop not simulation-proven (run 100); AutoRespawn
  in place not fixed (run 84 partial); long-distance follow slow
  (run 82 wart); water climb-out still not fixed; guide PDF not
  rebuilt in v10.4 (still the v10.3.1 PDF).

## v10.4.1 — 2026-11-08 — package 10.4.1

The 3 leftovers from v10.4: Parkour 3-block drop, AutoRespawn
in-place, plus a water-watchdog bug found while testing.

### Changed
- Parkour: edge-watchdog scan extended to 4 blocks below the feet;
  new `attemptDropDown()` — walk forward off the edge (do NOT jump,
  jumping adds ~1.25 blocks of height and turns a 3-block drop into a
  ~4.25 fall = 1 hp damage), only when the target is 1–4 blocks below
  and within 12 blocks horizontally, landing is solid ground, and
  there is headroom. Wired into `gotoPos` and `followLoop`. `gotoPos`
  now logs its outcome and go-to handlers only say "here" when it
  returns true.
- AutoRespawn in place: for 10 s after a death, every
  `position`/`position_look` packet is immediately followed by a
  `tick_end` (decompiled Paper: a second position packet in one server
  tick kicks with "invalid_player_movement"; the flag resets only on
  `client_tick_end`). The old "fork limit, not fixable" verdict was
  wrong.
- Water watchdog bug: it cleared jump/forward/sprint on every tick
  when Segs was NOT in water, silently killing manual walks. Fixed
  with a `waterDriving` flag.
- Guide PDF rebuilt: 21 pages, 15 sections.

### Simulation results
- Run 101, Parkour 3-block drop — **PASS**: pathfinder routed it
  directly, dropped 3 blocks, hp 20/20, no fall damage.
- Run 103, Parkour 4-block drop (manual fallback) — **PASS**: walked
  off, landed hp 19 (exactly 1 hp fall cost), said "here".
- Run 102, AutoRespawn in place — **PASS**: killed, respawned at the
  same spot, hp 20/20, one connect only, no reconnect, no kick.
- Run 67 retest (water drowning) — **PASS**: swims, no drowning.
  Climb-out onto a vertical 1-block shore remains the standing limit.
- Run 72 retest (drop fix) — **PASS**: beef x10, zero dropped.

### Not fixed / not proven in v10.4.1
- Water climb-out onto a vertical shore (unchanged); long-distance
  follow speed (run 82 wart) not yet addressed.

## v10.5 — 2026-11-08 — package 10.5.0

Tash's "100% at all cost" round: full pathfinding sweep, fast follow,
instant ack, craft/cook/smelt from nearby chests, view/sim distance 7,
Autobuild v1.

### Changed
- Pathfinding sweep: dip-climb fix (sprint+forward with NO jump, then
  jump when a step appears 1.5 blocks ahead — the fork's `onGround`
  never latches when the feet sit exactly at a block's bottom Y);
  lava in `blocksToAvoid` (detour wins); stair hop-step mode; wall
  sidestep; edge watchdog sped up (500 ms → 150 ms, lookahead 1.5 → 3
  blocks, two-point drop check).
- Fast follow: re-path only when the owner moved > 3 blocks, the
  entity changed, or there is no goal (was: every 500 ms).
- Instant ack: owner-only, varied, 0–1 ms bot-side.
- Craft/cook/smelt from chests: searches nearby containers, takes
  what is needed, uses the right workstation (crafting table, furnace,
  smoker, blast furnace) within 12 blocks, takes output back into
  inventory; never shulkers without explicit permission; honest
  missing-item lists. `doCraft` re-resolves a fresh recipe per craft,
  one at a time with a 500 ms settle, reports the real inventory delta.
- View/sim distance 7 on the test server (was 5/5); the bot sets the
  Mineflayer view-distance client setting to 7. On Youniga this is the
  server owner's setting — Segs cannot change it from the bot.
- Autobuild v1: builds from `schematics/house.json` (65 blocks),
  human-speed (1 block at a time, normal reach, no fast place).

### Simulation results
- Run 104g, rough-terrain dip climb — **PASS**: "here" at (-128,71,160),
  hp 20/20.
- Run 105, lava detour — **PASS**: went around the strip, hp 20/20.
- Run 107c/107d, stairs UP — **PASS**; stairs DOWN — **PASS**.
- Run 108, long walk 50 blocks + 3-block drop — **PASS**, hp 20/20.
- Run 109, fast follow — **PASS**: 33 blocks in ~16 s (≥ 2.1
  blocks/s, 3.5× run 82), ends exactly 2 blocks behind, teleport
  offer works, no auto-tpa.
- Run 110, instant ack — **PASS**: 5–27 ms owner-measured. (Later
  shown in v10.5.1 to have measured only the ack, not result latency —
  see the v10.5.1 command-queue section.)
- Run 111c, craft from chests — **PASS**: torch x4, bread x2, honest
  diamond refusal.
- Run 112e, cook/smelt from chests — **PASS**: cooked_beef x4,
  iron_ingot x4, honest gold_ore refusal.
- Regressions 101/102/103/72 — **PASS**.
- Run 106, water climb-out — **FAIL**: 0.72-block fork physics gap
  (water jump ends ~70.6, shore top 72.0). Segs survives, asks for help.
- Run 107, 2-high wall sidestep on platform edge — **FAIL**: fell to
  y=63.
- Run 113e, Autobuild — **PARTIAL**: 46/65 placed, 0 wrong (failures
  concentrated on the north edge z=160 + an equip-wait bug).
- Run 57, follow-through-door — **PARTIAL**: door opened not broken,
  then stuck — the follow loop did not re-plan after opening a door.

### Not fixed / not proven in v10.5
- Water climb-out FAIL (run 106); wall sidestep on platform edge FAIL
  (run 107); Autobuild PARTIAL (run 113e); follow-through-door
  PARTIAL (run 57). All four became the v10.5.1 scope.

## v10.5.1 — 2026-11-09 — package 10.5.1

The 4 v10.5 leftovers, plus Tash's real-server bug reports from his
2026-11-08 Youniga logs (whole-log re-read, not just the named bugs):
idle jumping, auto-eat + eat-drop, go-home via water, grave recovery,
command delay/queue, status/inventory wrong, chest scan, and a
real-player audit checklist.

### Changed
- **Idle jumping** (runs 119–121): root cause — a leaked `gotoPos`
  jumpPulse interval; three return paths (direct-OK, cancelled,
  after-door-assist) never called `stopJumpPulse()`, so after ANY
  successful walk Segs jumped every ~2 s forever on flat land. Fixed
  (stop on every return; both jump pulses gated on a real 1-block step
  ahead).
- **Wall sidestep** (run 107): climb assist bails on a real 2-high
  wall; routeSafe-checked sidestep (inland side first) runs BEFORE
  climb assist; sidestep gated to real 2-high walls only.
- **Autobuild** (run 113): settle before every place, 3 attempts with
  fresh lookAt + re-equip, never place against a container, one build
  at a time, unstuck watchdog skips during builds, chest-walk capped
  at 6 s.
- **Follow-through-door** (run 57): follow re-paths at stuck > 2 s
  (any cause), door-assist radius 4 → 6, stage to 1.5 blocks in front
  via pathfinder with 0.3-block GoalNear radius, through-direction
  from the door toward the goal, walk until 0.5+ past the door centre.
- **Auto-eat threshold + enable** (run 123): threshold 13–14 → below
  19 (`minHunger` 19, health ≤ 18, watchdog < 19, 60 s cooldown, fires
  whenever hungry, not only when idle). Root cause: auto-eat was NEVER
  enabled — Mineflayer only loads plugins after `inject_allowed`
  (post-login), so the old `enableAuto()` ran at startup when
  `bot.autoEat` was undefined and silently did nothing. Setup now runs
  in `bot.once('spawn')`.
- **River / water routing** (runs 124–126): water in `blocksToAvoid`
  + `liquidCost` 10, 60 s progress timeout, 60 s water climb-out cap
  (then stop + offer /tpa), water-entry wait in `gotoPos`.
- **Grave recovery** (run 127): sneak + right-click take-all is now
  PRIMARY; search scans a radius-8 cube around the death spot and logs
  every solid block nearby when it finds nothing; "can't see grave"
  no longer marks it recovered (retries until the 10-min expiry);
  `canDig=false` for the whole recovery; auto-recovery now fires from
  the death handler (it used to live only in the login handler, so a
  mid-session death never auto-recovered).
- **Inventory / status** (run 128): all 46 slots read directly (the
  old `bot.inventory.items()` silently excluded the offhand slot 45
  and armor slots 5–8), summed by item name, split into multiple chat
  lines; status and inventory agree.
- **Chest scan** (run 129): `findNearbyContainers` fixed to count 100,
  radius 32, double-chest dedup, a remembered container map in brain;
  new commands "Segs list chests" / "Segs check the chests". (Root
  cause: `bot.findBlocks` with no `count` defaults to 1 — it only ever
  saw ONE chest.)
- **Command queue** (runs 130–133): serial `talkQueue` replaced with
  LATEST COMMAND WINS (a generation token cancels the running command
  silently, no stale result); STOP jumps the queue (< 1 s); queries
  (status/stats/inventory/help) answer immediately even during a long
  cook; only ONE /tpa outstanding; honest ack ("dropping X, doing Y").
  Aliases added: "stop jumping" / "start jumping" (60 s hold),
  "segs autoeat", "take items from this chest", "segs deathchest",
  "segs tp home", "Segs go home a" (checks server homes), "Segs column".
- **Fork patches shipped** (applied by setup + link scripts):
  `patches/prismarine-physics-water-climb.patch` (landing-spot check +
  10-tick out-of-liquid boost, gated to 26.3 only) and
  `patches/mineflayer-collision-sync.patch` (real
  `hasHorizontalCollision` flag + position-sync preservation). The
  per-tick `player_input` send was DROPPED after a bisection — it
  degrades creeper-bow combat in combination with
  `hasHorizontalCollision`, and water climb-out fails either way.

### Simulation results
- Run 107, wall sidestep — **PASS**: "gotoPos OK (after early
  sidestep)", ends (-104,71,159), hp 20/20, no fall, wall intact.
  Direct diagonal corner cut still stalls (server snap-back, run 118).
- Run 113, Autobuild — **PASS**: 65/65 placed, 0 wrong; second build
  on the same site: 0 placed, 65 skipped, nothing broken. Wart: ~5 min
  per 65-block house (~4.7 s/block).
- Run 57, follow-through-door — **PASS**: door opened not broken,
  Segs ends exactly 2.0 behind the owner, no "im stuck".
- Runs 119–121, idle jump — **PASS**: zero jumps in 60 s each.
  (A/B proof + legit-jump retests still to do — see v10.5.3.)
- Run 123, auto-eat — **PASS (threshold + enable)**: food 20 → 19 →
  Segs auto-ate on his own, back to 20/20, beef x10 → x8.
- Run 124, river dry detour — **PASS**: dry route taken, zero water
  lines, hp 20/20.
- Run 125, no dry route — **PARTIAL**: Segs reports "i cant reach
  there — the way goes through water…" in 35 s and stops, but it
  enters the river trench before the reactive abort fires; a truly
  preventive fix needs the A* to treat water-at-head-level as unsafe
  (fork-level).
- Run 126, fence barrier — **PASS**: "here" in 5 s, hp 20/20.
- Run 127 retest, grave recovery — **PASS**: "got my stuff back from
  my grave (18 items)", status and inventory exactly wheat x10 +
  cooked_beef x5 + iron_ingot x3. Wart: Segs said "im stuck in the
  water" on the way to the grave — it still recovered.
- Run 128, inventory/status — **PASS**: wheat x152, wheat_seeds x182,
  cooked_beef x7, baked_potato x64, iron_ingot x15, stick x14,
  iron_axe x1, totem_of_undying x1 — status and inventory agree.
- Run 129, chest scan — **PASS**: cook found potato + coal in adjacent
  chests; smelt walked to a far chest 20 blocks away.
- Runs 130–133, command queue — **PASS**: 3 commands during a
  105-block goto; the exact 19:03:25 log scene replayed (go-home +
  tp x3 + stop) with no stale burst; status answered < 2 s while
  cooking 64 potatoes; aliases all work.
- Real-player audit checklist added to the test report (walk/follow/tp/
  stop, idle, eat, inventory, see+remember, chests/craft/cook/smelt,
  farm, mine, place/build, sleep, fight/flee, swim/lava, doors/stairs/
  ladders, grave, pickup, command understanding + promptness, AFK/
  guard, player-like chat).
- Final regression (final bot.js + final patches): **12 PASS, 1 FAIL**
  — run 75 creeper bow arena FAIL (creeper to hp 4.0, second shot
  consumed NO arrow, Segs took 7 hp to 13/20, got stuck; flaky —
  it passed in v10.4 and once in a bisection, and run 99 passed in
  this same regression), run 99 PASS (creeper killed, hp 20/20,
  zero hits), runs 72/74/101/102/103/104/105/109/110/111/112 PASS.

### Not fixed / not proven in v10.5.1
- **Water climb-out onto a vertical 1-block shore: FAIL live** (runs
  106, 114–117, timeboxed). The fork patch climbs in pure simulation,
  but Paper's server sim never sets `jumping` from the client, so it
  pulls Segs back. Segs survives (hp 20/20), doesn't drown, asks for
  help after 20 s; the watchdog + /tpa fallback is the honest fallback.
- **Eat-drop: NOT fixed.** Run 123: 1 steak on the ground after
  eating, and 2 beef consumed to restore 1 point of food (19 → 20).
  Proven NOT via `bot.deactivateItem` in run 122c (the status-6
  override was installed but `releaseItem` never fired during eats) —
  culprit unknown at this point. (Resolved in v10.5.2: run 122c was
  wrong — see below.)
- Creeper bow run 75 flaky in the final regression; run 125 partial;
  sleep fake-fast (5 s "morning"), survive-routine contradictory
  messages, and the unexplained hp 20 → 16 drop in Tash's log still
  uninvestigated; idle-jump A/B proof + legit-jump retests still to do.

## v10.5.2 — 2026-11-09 — package 10.5.2

One bug: the eat-drop. Tash's log (2026-11-08-2.log): at 18:53:26 he
said "segs eat" and Segs said "yum, done" — while the log line right
before it reads `[autoeat] eating cooked_beef (saturation 12.8, food
20/20, injured=false, deficit=0)`. Eating at full hunger (deficit 0)
is impossible in vanilla; any beef that left his inventory there was
dropped, not eaten. The log never recorded inventory before/after an
eat, and status never listed beef — so the −1 beef was invisible.

### Changed
- Root cause, packet-proven (runs 134–135): the v10.4 patch-M override
  of `bot.deactivateItem` was installed in `createBot()`'s synchronous
  body, but plugins are only injected at `inject_allowed` (a
  `setTimeout(..., 0)` after `createBot()` returns), so the inventory
  plugin's assignment overwrote the override and every `eat()` called
  the fork's status-5 DROP_ITEM function. This overturns the v10.5.1
  run-122c claim that the drop was "not via deactivateItem" — that
  claim was wrong. Side finding: after a status-5 drop, Segs' own
  client inventory desyncs (stays x10 while the server says x9) —
  client counts can't be trusted for this bug; server-side `/data get`
  is the ground truth.
- Fix: the override is re-installed in `bot.once('spawn')`, after
  injection (`bot.deactivateItem = () => { releaseItem() }`, status 6).
- New `tryEatOnce()`: single guarded eat — refuses at food ≥ 20; waits
  out an in-progress plugin eat via the plugin's `isEating` getter (up
  to 4 s); polls up to ~2 s for food to actually rise before reporting
  success.
- `eatBestFood()`: deficit-0 guard returns `'full'` before touching
  food; verifies food rose before saying "yum, done" or counting
  `foodEaten`; permanent before/after beef+food log lines around every
  eat (closes the logging gap that made the −1 beef invisible).
- All eat call sites routed through it: "Segs eat" handler (`'full'` →
  "im already full"), health handler, combat retreat, all 7 `survive()`
  eat sites.

### Simulation results
- Run 134 (DIAG, pre-fix) — drop proven: `block_dig` status=5 on
  every eat; server beef 10 → 9 → 8 across two eats at full hunger;
  exactly 1 Steak entity on the ground after each.
- Run 135 (DIAG, pre-fix) — drop proven server-side: `/data get`
  beef 10 → 9 → 8, dropped entity `{id: "minecraft:cooked_beef",
  count: 1}`.
- Run 136 (post-fix) — **PASS**: "Segs eat" at food 20/20 → "im
  already full", beef 10 → 10, 0 dropped. (Hungry legs inconclusive
  in this run — Paper blocks `/data merge` on players, so food was set
  with a hunger effect instead.)
- Run 137 (post-fix, beef) — **PASS**: 3 manual eats, each food 19 →
  20, beef −1 exactly (10 → 9 → 8 → 7), 0 dropped.
- Run 138 (post-fix) — **PASS**: bread 10 → 7 (3 eats), porkchop
  10 → 8 (2), chicken 10 → 7 (3), auto-eat beef 10 → 8 (2, no
  command), 0 dropped each. Wart found and fixed in leg E: when the
  plugin's own auto-eat was already mid-meal, `tryEatOnce()` hit the
  plugin's `Already eating!` throw and wrongly said "i tried to eat
  but my hunger didnt go up" while the meal then restored hunger
  anyway. Fixed by waiting out `isEating` + polling for the rise.
  Honest caveat: the exact wait-out branch was not captured in a run
  (in runs 139–140 survive() always started at food 19 and ate first);
  the observable contract holds — zero false-failure lines across
  ~200 survive calls since the fix.
- Runs 139–140 (post-fix, survive races) — **PASS**: zero
  false-failure lines, 0 dropped.
- Full regression (v10.5.2 bot, 25 runs): **24 PASS, 1 INCONCLUSIVE,
  0 FAIL after retests.** Run 123 INCONCLUSIVE by test design (food
  reached 19, not < 19, in its 85 s window; auto-eat proven by runs
  137–140). Batch failures in 75, 99, 103 were flakes/harness
  artifacts, all PASS on retest.

### Not fixed / not proven in v10.5.2
- Water climb-out live FAIL (unchanged); horde zero-hits in the open
  arena unmet; creeper bow arena flaky; sleep fake-fast; survive
  contradictions; hp 20 → 16 unexplained drop; idle-jump A/B proof +
  legit-jump retests still to do.

## v10.5.3 — 2026-11-09 — package 10.5.3

The full pathfinding sweep, on top of the v10.5.2 bot (the v10.5.2 eat
code is untouched — the sweep's bot.js changes are all in climbAssist,
gotoPos, combatTick, and two chat lines). Runs 141–162.

### Changed
- Idle-jump A/B proof (runs 141–142): revert the fix → 27 jumps/60 s;
  restore it → 0 jumps/60 s. The fix is the cause, not luck.
- Legit-jump retests (runs 143–146): 1-block ledge up, 2-high wall
  sidestep, dip climb, stairs up/down + wall sidestep — all PASS.
  Fix found on the way: a cancelled climb assist leaked and kept
  running (it had no access to gotoPos's token) — climbAssist now
  captures `moveToken` and checks cancellation at run-up entry, inside
  both loops, and between run-ups; `finally` clears control states.
- Water prevention (runs 147–149): Paper decompile proves the
  server-side player sim never sets `jumping` from the client (no
  `jumping` reference in `ServerPlayer.java`; `handlePlayerInput` only
  stores `lastClientInput`, which has no callers). Four new fork
  patches: `mineflayer-player-input` (send the full input state via
  `player_input` on control-state change), `pathfinder-head-water`
  (`safeOrBreak` returns 100 for liquid — no A* move routes through
  liquid at feet or head level), `pathfinder-no-water-landing`
  (drop-down/forward moves reject liquid landings), `pathfinder-goto-
  empty-path` (an empty A* path no longer resolves as SUCCESS).
  ClimbAssist liquid checks fixed (a `bot.blockAt(...).liquid` check
  was a silent no-op — prismarine-block has no `.liquid` property —
  replaced with a name-based `isLiquid` helper) and now also check the
  block below feet ahead, with a corridor scan and a skip when in
  water.
- Stuck timeout (run 156): the non-water "cant reach there" message
  now also offers /tpa (it used to only offer on water).
- Creeper bow: flee-isn't-working detector (bot.js combatTick) —
  when the too-close flee finds a direction but Segs hasn't moved
  > 0.5 blocks, the flee is a dead end and he sword-fights instead
  (threshold tightened 1000 ms → 500 ms after the 1000 ms version was
  1 s too slow against the fuse); release guard (the release timer
  checks `bot.heldItem.name === 'bow'` before releasing).
- Grave recovery exemption: `gotoPos(pos, { allowWater: true })` +
  fifth fork patch `pathfinder-allow-water` (gates all six water
  blocks on `!this.allowWater`) — `recoverGrave` is the only caller.
  The run-148 water prevention had blocked grave recovery (run 127
  FAIL in the regression).

### Simulation results
- Runs 141–142, idle-jump A/B — **PASS**: revert = 27 jumps/60 s,
  fix restored = 0 jumps/60 s.
- Runs 143–146, legit jumps — **PASS**: ledge up 143, wall sidestep
  144 (wall intact — no dig lines), dip climb 145, stairs up/down +
  wall sidestep 146.
- Run 147, water climb-out — **IMPROVED to flaky, NOT fixed**: 2 OUTs
  in the last 4 attempts (run 148's climb-out OUT in 8 s; run
  147-retest 2nd attempt OUT in 3 s; batch2-147 and 147-retest-1st
  failed). Proven server-blocked (see decompile above); the honest
  fallback stands (dry detour first, 60 s cap, stop + /tpa offer).
- Run 148, no dry route — **PASS on attempt 7** (after 6 attempts
  that each found a real root cause): water message in 18 s, stays
  y=71 on the west side, never enters the water during the goto, hp
  20/20. Clean re-runs later showed Segs going around the river's
  south end on natural terrain (z > 170) in ~6 s, dry, hp 20/20 — the
  river only spans the artificial platform (z 150–170), so the "no dry
  route" premise was false for that geometry; the attempt-7 refusal
  still stands as the refusal proof.
- Run 149, dry detour — **PASS**: arrived (-91.57,71,160.68), hp
  20/20, zero water lines.
- Runs 150–157, walking sweep — **all PASS**: flat goto 4 s, lava
  detour, long walk + drop, fence, trees (0 broken), follow-through-
  door, fast follow 33 blocks ≤ 16 s ending 2 behind, stuck timeout
  16 s with /tpa offer (bedrock box; glass was the wrong material —
  the A* dug through it, which is what a real player would do).
  Tpa landing unproven on the test server (no tpa plugin) — proven
  on Youniga in v9.3.
- Creeper bow, final-bot arena tally — **8/9 PASS** (creeper5 3/3,
  creeper6 2/3, creeper7 3/3), 25/26 shots consumed, zero hits in 8
  of 9 runs. The consumed:NO flake has not reproduced since creeper3
  — mechanism still unknown, do NOT claim fixed. The cornered-creeper
  sword-fight path has been exercised once (creeper6-160, 1 s too
  late) — improved, not proven.
- Full regression (30 runs): **26 PASS, 2 FAIL, 2 INCONCLUSIVE.**
  Both FAILs were real bugs found by the regression, fixed, and
  retested PASS: run 127 (water prevention blocked grave recovery →
  grave-only allowWater exemption + 5th fork patch; clean retest
  18/18 items in 24 s) and run 75 (cornered creeper → flee-detector,
  3/3 in creeper7). Inconclusive: 123 and 137 (food never dropped in
  the window; auto-eat proven by 137–140 in v10.5.2).

### Not fixed / not proven in v10.5.3
- **Water climb-out live: IMPROVED to flaky, NOT fixed** (2 OUTs in
  last 4 attempts). Proven server-blocked; dry detour first + 60 s
  cap + stop + /tpa offer stands.
- Horde 5 zombies zero-hits in the open arena (best 1 kill / 4 hits,
  v10.1); creeper bow flake mechanism unknown (final bot 8/9 arena
  PASS, 0/26 consumed:NO shots since creeper3); cornered-creeper
  sword-fight path exercised once — improved, not proven; sleep
  fake-fast; survive contradictions; hp 20 → 16 unexplained drop;
  tpa landing on the test server (needs Youniga).
- Open follow-up, not a blocker: a stale-grave swim can drown Segs
  (watchdog gated during recovery — needs an air-low pause).

---

## Standing limits (all versions, unchanged)

- Water climb-out onto a vertical 1-block shore: flaky live, not fixed.
  Proven server-blocked (Paper's player sim never sets `jumping` from
  the client). Fallback: dry detour first, 60 s cap, stop + /tpa offer.
- Horde of 5 zombies, zero hits taken, in the open arena: not met
  (best 1 kill / 4 hits, v10.1).
- Creeper bow `consumed:NO` flake: mechanism unknown, not reproduced
  since creeper3.
- Sleep fake-fast (5 s "morning"), survive-routine contradictory
  messages, hp 20 → 16 unexplained drop in Tash's log: still
  uninvestigated.
- Everything above is simulation proof only. Real-server testing on
  Youniga by Tash is still pending for v10–v10.5.3.
