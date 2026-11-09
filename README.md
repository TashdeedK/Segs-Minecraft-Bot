# Segs — Free Minecraft Bot — v10.5.3 (NATIVE 26.3, no ViaVersion)

100% free. No paid account, no AI chat. Runs on Node.js 22+.
Talk to it like a person. No `!` needed.

## What's new in v10.5.3 (2026-11-09) — the full pathfinding sweep: idle-jump A/B proof, water prevention, walking sweep, creeper bow, stuck timeout

All simulation-tested on the Paper 26.3 test server (port 25569). Runs 141–163, plus the full regression set (72, 74, 75, 99, 101–105, 109–112, 119–121, 123, 124, 127–133, 136–140) re-run on the final bot: **26 PASS, 2 FAIL (both fixed and retested PASS below), 2 INCONCLUSIVE** (123 and 137 — food never dropped in the window; auto-eat proven by 137–140).

- **Idle jump — A/B PROVEN (runs 141–142).** The v10.5.1 fix was never A/B-proved, so this sweep did it: a scratch copy with the fix reverted (jumpPulse step-gate removed, stopJumpPulse removed from the direct-OK return) jumped **27 times in 60s** on flat land after a goto (run 141); the fixed bot on the same geometry jumped **0 times in 60s** (run 142). The fix is the cause, not luck.
- **Legit jumps — all retested and PASS.** 1-block ledge up (run 143: "here", arrived (-85.3,72,158.5) on the ledge, hp 20/20 — the first attempt's script sent "follow me" instead of "go to", so it proved the ledge climb in follow mode; fixed and re-run as a goto), 2-high wall sidestep on flat land (run 144: "gotoPos OK (final step) at (-89.68,71,170.39)", hp 20/20), dip climb (run 145: "gotoPos OK (after climb assist) at (-127.45,71,160.50)", hp 20/20), stairs UP + DOWN + wall sidestep (run 146: up "gotoPos OK (after climb assist) at (-91.5,74,160.5)", down "gotoPos OK (direct)" in 1s, wall "gotoPos OK (after early sidestep) at (-103.53,71,159.5)", hp 20/20). **Two fixes on the way:** the cancelled UP climb assist used to LEAK and keep driving Segs after a cancel (the original run 146 failure) — climbAssist now captures the goto token and checks it at every step; and the wall leg first failed on the LEFTOVER run-148 river (the bot correctly refused the water) — the test setup now clears it to stone first.
- **Water climb-out — IMPROVED to flaky, NOT fixed (runs 147 + 148).** Honest verdict: 2 OUTs in the last 4 attempts (run 148's climb-out in 8s, run 147-retest's 2nd attempt in 3s; the other two failed with feet pinned at 70.40–70.51). Paper decompile proves why it is a coin flip: the server's player sim never sets `jumping` from the client (ServerPlayer.java has no `jumping` reference at all; `handlePlayerInput` only stores `lastClientInput`, which nothing reads), so the server trusts the client's positions within tolerance and snaps Segs back when his rise is too fast. The fork's climb rise caps at feet ~70.4–70.7 vs the 71.0 shore top — inside the 0.6 step-up range, so it sometimes makes it and sometimes does not. The honest fallback stands (dry detour first, 60s water cap, stop + /tpa offer). **What IS fixed: prevention.** Run 148 (no dry route) now PASSES end-to-end: the A* refuses water (two new fork patches — head-water and no-water-landing), the climb assist bails on liquid (see below), the goto fails honestly instead of reporting "here" in the river, and Segs says "i cant reach there — the way goes through water..." in 18s while staying dry on the west bank at y=71, hp 20/20. Run 149 (dry detour) PASS, zero water lines. **Root causes found on the way (7 attempts):** the test platform was a 1-thick slab over a natural under-slab cave the A* routed into (sealed with an under-fill in the test setup); `bot.blockAt(...).liquid` is ALWAYS undefined (prismarine-block has no `.liquid` property — every climbAssist liquid check was a silent no-op until it was replaced with a name-based `isLiquid` check); and the fork's `goto()` resolved an EMPTY path as SUCCESS (a no-path result from a start with zero neighbours is `[]`) — fixed by a fork patch that only resolves when the goal is actually reached.
- **Walking sweep — all PASS (runs 150–157).** Flat goto 25 blocks in 4s (run 150), lava detour hp 20/20 (run 151), long walk + 3-block drop (run 152), fence barrier (run 153), trees obstacle — routes around, zero logs/leaves broken (run 154), follow-through-door — door opened not broken, through the door (run 155), fast follow — 33 blocks in ≤16s (≥2.1 blocks/s), ends 2 behind, tpa offer sent (run 157). **Two honest limits:** run 156 (60s stuck timeout) first failed twice for test-design reasons — Segs was tp'd INTO the glass floor, then the A* dug through the breakable glass wall (which is what a real player would do). With a BEDROCK box (unbreakable) it PASSES: "i cant reach there, too far or blocked. want me to tp to you?" in 16s, stayed in the box, hp 20/20, never auto-tpa. The non-water "cant reach there" message now offers /tpa too (it used to only offer on water). And run 157's tpa LANDING could not be verified on the test server — it has no working tpa plugin (the /tpaccept produced no teleport); Segs' side is proven (he sent /tpa, the server logged it) and /tpa is already proven on real Youniga (Tash confirmed it in v9.3).
- **Creeper bow — final bot 8/9 arena PASS, zero hits in the 8 wins (runs 158–160, creeper5 + creeper6 + creeper7).** The flake (a release that consumes NO arrow, then Segs takes the explosion) reproduced in 2 of the 5 iterations on the way here and was chased properly: the sprint theory was DISPROVED by diagnostics (charges started while sprinting back consumed fine, 8/8), and the fork's `bot.usingHeldItem` flag is always false in this fork so it cannot tell whether the bow use registered. The mechanism is still unknown — the 8/9 is a clean result on the final bot, not a proven fix for the flake (0/26 consumed:NO shots since creeper3). What the final bot does have: the pending release timer is cancelled when the creeper gets inside fuse range (so a flee never races a release), the release is guarded on the bow still being the held item (so a mid-charge weapon swap can never fire a release on a sword), and a **flee-isn't-working detector** — when Segs has been fleeing a creeper for 500ms without moving more than 0.5 blocks (cornered at a wall), he fights it with the sword instead of standing still; two sword hits kill a creeper before its fuse finishes. The detector fired correctly once (creeper6-160) but 1s was too slow — the 500ms threshold went 3/3 in creeper7 with zero hits taken. Two fixes tried and REVERTED on the way because they made things worse: a charge-start distance gate (starved the offense when cornered) and a no-charge-while-sprinting gate (blocked the killing 3rd shot twice — creeper4 went 0/3 with it, 3/3 without it).
- **Regression caught two real bugs, both fixed and retested PASS.** (1) **Run 127 — the water prevention blocked grave recovery:** Segs died in a river and the recovery goto refused the underwater grave. Fix: a grave-only water exemption (`gotoPos(pos, { allowWater: true })` — the only caller is `recoverGrave`), backed by a fifth fork patch (`pathfinder-allow-water`) that lets the A* swim through water for that one goto only, plus gates on the climbAssist liquid checks, the water watchdog and the progress timer. Clean retest PASS: "got my stuff back from my grave (18 items)" in 24s, hp 20/20, exact items. (2) **Run 75 — cornered creeper:** the flee-detector above, 3/3 in creeper7. **Run 148 note:** the clean re-runs "arrived" in 6s with zero water lines — not a prevention failure. Mid-goto probes showed Segs going around the river's SOUTH end on natural terrain (z>170) — the river only spans the artificial platform, so a dry detour exists and Segs correctly took it. The no-dry-route refusal is still proven by attempt 7 (stayed west, reported in 18s).
- **Five new fork patches ship in this zip** (applied by setup-26.3.sh/.bat + link-prismarine.js, alongside the two v10.5.1 patches): `mineflayer-player-input` (sends the full input state via `player_input` on control change, 26.3 only), `pathfinder-head-water` (water at feet or head level is never a route), `pathfinder-no-water-landing` (never plan a drop into water), `pathfinder-goto-empty-path` (an empty A* path is a failure, not a success), `pathfinder-allow-water` (lets the A* swim through water when — and only when — the bot asks for it, for grave recovery).

## What's new in v10.5.2 (2026-11-09) — ONE bug: the eat-drop, packet-proven and fixed

All simulation-tested on the Paper 26.3 test server (port 25569). Runs 134–140, plus the full v10.5.1 regression set re-run (72, 74, 75, 99, 101–105, 109–112, 119–121, 123, 124, 127–133).

- **The eat-drop — FIXED (runs 134–140).** Tash's real-server log showed it: at 18:53:26 he said "segs eat" and Segs said "yum, done" — while the log line right before it read `eating cooked_beef (food 20/20, deficit=0)`. Eating at FULL hunger is impossible in vanilla; the beef was DROPPED, not eaten. Packet trace (run 134) proved it: every eat sent `block_dig status=5` (DROP_ITEM in 26.3) and left exactly 1 Steak on the ground; server-side `/data get` proved beef 10 → 9 → 8 across two eats at full hunger (run 135). **Root cause:** the v10.4 `deactivateItem` override (status 6 = release) was installed in `createBot()`'s synchronous body, but every plugin — including inventory, which re-assigns the fork's status-5 `deactivateItem` — is only injected at `inject_allowed` (setTimeout 0, AFTER createBot returns). The inject overwrote the override, so the auto-eat plugin's `eat()` called the fork's DROP_ITEM on every eat. (This overturns the v10.5.1 run-122c claim that the drop was not via `deactivateItem` — that claim was wrong; the override was simply dead.) **Fix:** the override is re-installed in `bot.once('spawn')`, after injection, so it survives. **Also fixed:** `eatBestFood()` now refuses at full hunger ("im already full" — a real player cannot eat at 20/20), verifies food actually rose before saying "yum, done" or counting `foodEaten`, and logs beef/food before and after every eat (the old log never did, so the −1 beef was invisible). The health handler, combat retreat, and all six `survive()` eat sites go through one guarded `tryEatOnce()` helper. **Proof:** run 136 — "Segs eat" at food 20/20 says "im already full", beef 10 → 10, 0 dropped; run 137 — three manual beef eats, each food 19 → 20, beef −1 exactly, 0 dropped; run 138 — bread/porkchop/chicken, same, 0 dropped each, plus auto-eat with no command (2 beef eaten, 0 dropped). **Wart found and fixed on the way (run 138 leg E):** when the plugin's own auto-eat was already mid-meal, `tryEatOnce()` hit the plugin's `Already eating!` throw and wrongly said "i tried to eat but my hunger didnt go up" while the meal then restored hunger anyway. It now waits out an in-progress eat (`isEating`) and polls for the rise; runs 139–140 (dense "Segs survive" races) show zero false-failure lines. Honest caveat: the exact wait-out branch was not captured in a run — in both race runs survive() always started at food 19 and ate first. The false line's last occurrence anywhere is run 138 leg E.
- **Test-setup finding:** Paper 26.3 blocks `/data merge` on players ("Unable to modify player data"), so test food levels are set with a hunger effect instead; `/data get` works and is the ground-truth read. Client-side inventory counts are NOT reliable after a drop (the client's window never resyncs when nothing is consumed) — server-side `/data get` is what proves counts.

## What's new in v10.5.1 (2026-11-08) — the 4 leftovers from v10.5, fixed at all cost

All simulation-tested on the Paper 26.3 test server (port 25569). Runs 114+.

- **Water climb-out — STILL FAILS live (runs 114-117), timeboxed after genuine investigation.** The fork's water physics was analysed and patched (a landing-spot check + a 10-tick out-of-liquid boost, gated to 26.3 only, 42/42 fork tests pass) and the patch SHIPS in this zip (patches/ + an applier run by setup-26.3.sh/.bat and link-prismarine.js). In the pure simulation the patched physics climbs out at tick 45; live on Paper it got out once (feet 72.00, x<-95, tick 335) and the server pulled it straight back into the pond. Decompiled Paper source shows why: the server runs its own player simulation with zero movement input (it never sets `jumping` from the client's input, its Motion stays 0), so its `jumpOutOfFluid` never fires and it corrects every client-side rise back to its float level (70.24-70.67). Segs survives (hp 20/20), does not drown, and asks for help after 20s; "Segs tp to me" is the honest fallback. Two fork patches ship and are vanilla-parity correct: the water-climb patch and a mineflayer collision-sync patch (real hasHorizontalCollision flag + position-sync preservation — the last one also fixes the run-107 corner freeze). The per-tick player_input send that was in the first version of the mineflayer patch was DROPPED after a bisection: it degrades creeper-bow combat in combination with hasHorizontalCollision, and the water climb-out fails either way.
- **2-high wall sidestep — PASS (run 107 retest).** The edge watchdog was NOT the blocker (zero `[edge]` events). The real blockers: the climb assist sprinted into the 2-high wall for 6s per run-up because its step check needs the block ABOVE the step to be air (a 2-high wall never qualifies), and the sidestep ran LAST so the run's stop cut it off. Fixes: the climb assist bails immediately on a 2-high wall, and gotoPos now runs the wall sidestep (routeSafe-checked, safe/inland side first) right after the door assist, BEFORE the climb assist. Result: "gotoPos OK (after early sidestep) at (-103.53,71,159.5)" in 3s, hp 20/20, no fall, wall intact. The direct diagonal cut around the corner still stalls (server snap-back, run 118) — the sidestep is the working answer and is tried first.
- **Autobuild house — PASS, 65/65 (run 113 retests).** Fixes: stale pathfinder goal cancelled after each stand move, settle before EVERY place, 3 place attempts with a fresh lookAt + 200ms pause (so the server receives the look before the place fires), never place against a container (a chest/furnace opens instead of placing — the floor cell above the mats chest was refused for this), ref search re-tried after 500ms (the client's world lags the server), one build at a time (a second "build house here" used to start a second loop and neither finished), unstuck watchdog skips during a build, and the chest walk is capped at 6s (the mats chest ends up UNDER the built floor, so an unbounded walk hung the second build for 54s). Result: first build "built house: 65/65 blocks placed, 0 skipped, 0 wrong", all five block checks fired; second build "built house: 0/65 blocks placed, 65 skipped, 0 wrong" — nothing broken, nothing re-placed. Honest note: a 65-block house takes about 5 minutes (~4.7s/block — stand moves + settles dominate).
- **Follow-through-door — PASS (run 57 retest).** The A* will not route through an open door (it routes around the house), and the follow loop's 2s re-path had a bug that capped stuckMs at ~4500 so the 6s door assist never fired. Fixes: separate throttles for the jump pulse and the re-path (lastMove now accumulates to 6s), door-assist search radius 4 -> 6 blocks, stage to 1.5 blocks in front of the door via the pathfinder first (tight 0.3-block radius — the open door's panel is a thin slab at the block's west edge, so Segs must be centred on the doorway's clear part), through-direction computed from the door toward the goal (not Segs' approach), and the walk runs until Segs is 0.5+ blocks PAST the door centre (land first, sprint, re-assert controls). Result: "door assist: moved 5.7 blocks, beyond door 1.4 — through door at (-90, 71, 155)", Segs ended at (-89.50,71,160.5), exactly 2 blocks behind the owner, door verified OPEN (not broken), no "im stuck".
- **Idle jump — PASS (runs 119-121).** Segs jumped every 1-2s while idling on plain flat land. Root cause: a LEAKED gotoPos jumpPulse interval — three return paths (direct-OK, cancelled, after-door-assist) never called stopJumpPulse(), so after ANY successful walk the interval jumped Segs every 2s forever. Fixed (stopJumpPulse on every return) and both jump pulses are now gated on a real 1-block step ahead — no step, no jump, ever. Runs 119 (no command), 120 (following, owner still), 121 (after a goto): **ZERO jumps in 60s each**.
- **Auto-eat — PASS (run 123).** Two bugs: the threshold was 13-14 (now <19: autoEat minHunger 19, health handler ≤18, hunger watchdog <19, 60s cooldown, fires whenever hungry not only when idle), and — the real one — **auto-eat was NEVER ENABLED**. Mineflayer's plugin_loader only runs plugins after `inject_allowed` fires (after login), so `bot.autoEat` was undefined when the old enableAuto() call ran at startup and it silently never ran. The setup now runs in `bot.once('spawn')`. Run 123: food 20/20 → 19/20 → Segs auto-ate on his own (no command) → food 20/20, beef x10 → x8. **Known issue, FIXED in v10.5.2 (runs 134–140, see above):** eating dropped 1 steak per eat (run 123: 1 steak on the ground, 2 beef consumed for 1 point of food). The v10.5.1 note's claim that the drop was "NOT via `bot.deactivateItem`" was wrong — the override was dead on arrival because plugin injection overwrote it; v10.5.2 re-installs it on spawn and the drop is gone (0 dropped in every eat run since).
- **River / water routing — PASS (run 124).** Segs chose the straight path through a river and sat stuck 5 minutes. Root cause: water cost 1 and water not in blocksToAvoid, so a 20-block swim looked cheaper than a 40-block dry detour — but the fork cannot climb out of water onto a vertical shore, so it routed INTO a trap; the unstuck watchdog resets on any >0.5-block jiggle (swimming/bobbing) so it never fired. Fixes: water in blocksToAvoid + liquidCost 10 (dry detour wins), a 60s progress timeout (no walk may sit stuck silently — it stops and reports where and why), a 60s water climb-out cap (then it stops and offers /tpa, never loops), and a water-entry wait in gotoPos. Run 124: Segs took the dry detour, "gotoPos OK (direct) at (-91.57, 71, 160.68)", zero water lines, hp 20/20.
- **Grave recovery — fixed in code, retest pending (run 127).** Sneak+right-click take-all is now PRIMARY (was a fallback after openChest), the search scans a radius-8 cube around the DEATH SPOT (was 5 blocks around Segs) and logs every solid block nearby when it finds nothing (so the next real-server failure is diagnosable), "cant see grave" no longer marks the grave recovered (it retries until the 10-minute expiry, reporting time left), canDig=false for the whole recovery (never digs the riverbank), and the auto-recovery timer now fires from the death handler (it used to live only in the login handler, so a mid-session death never auto-recovered).
- **Inventory / status — PASS (run 128).** Status showed only the first 5 stacks, per-stack counts never summed, and `bot.inventory.items()` silently excludes the offhand (slot 45) and armor (slots 5-8). Fixed: status and inventory now read all 46 slots directly and sum by item name, splitting into multiple chat lines instead of dropping items. Run 128: wheat x152, wheat_seeds x182, cooked_beef x7, baked_potato x64, iron_ingot x15, stick x14, iron_axe x1, totem_of_undying x1 — status and inventory agree exactly.
- **Chest scan — PASS (run 129).** `findNearbyContainers` had no `count` option so the fork's findBlocks defaulted to 1 — Segs only ever saw ONE chest. Fixed: count 100, radius 32, double-chest dedup, a remembered container map in brain (pos + type, not contents) so cook/craft/smelt/sort search remembered containers too, and "Segs list chests" / "Segs check the chests" commands. Run 129: 3 double chests (potato, coal, iron ore 20 blocks away) — "Segs cook potato 4" found potato in A + coal in B; "Segs smelt iron ore 2" walked to the far chest C.
- **Command queue — PASS (runs 130-133).** Tash's log proved commands queued behind each other for 27-94s (go-home result 68s late, sleep 50s late, stop 27s late, three replies bursting at once). Root cause: a serial talkQueue — every command waited for the previous command's ENTIRE execution. Fixed: LATEST COMMAND WINS (a generation token cancels the running command silently), STOP jumps the queue and confirms <1s, queries (status/stats/inventory/help) answer immediately even during a long cook, only ONE /tpa outstanding (a new "tp to me" dedups instead of sending a 2nd/3rd), and the ack is honest ("dropping X, doing Y"). Runs 130 (3 commands 10s apart during a 105-block goto), 131 (the exact 19:03:25 log scene: go-home + tp x3 + stop), 132 (status <2s while cooking 64 potatoes), 133 (aliases) — all PASS, no stale burst. Whole-log sweep aliases added: "segs autoeat", "take items from this chest", "segs deathchest", "segs tp home", "Segs go home a" (checks server homes), "Segs column", "stop jumping" / "start jumping" (60s hold).
- **Guide PDF rebuilt** for v10.5.1: 22 pages, 16 sections (Autobuild now 65/65, water limit updated, follow-through-door note in section 7, idle-jump / auto-eat / river / grave / inventory / chest-scan / command-queue fixes added).

## What's new in v10.5 (2026-11-08) — Tash's "100% at all cost" round: pathfinding sweep, fast follow, instant ack, craft/cook/smelt from chests, view distance 7, Autobuild v1

All simulation-tested on the Paper 26.3 test server (port 25569). Runs 104+.

- **Pathfinding — dip climb FIXED, proven (run 104g).** The known fail (runs 32-35): Segs fell in a dip and could not climb out — the pathfinder timed out. Root cause, found with bare-client probes: at the dip's east edge the bounding box overlaps the wall by ~0.02 while the feet sit exactly at the block's bottom Y, so onGround never latches and a held jump never fires. Fix: climb assist now backs up ~0.7s, then runs at the wall with NO jump until a 1-block step appears 1.5 blocks ahead (checked every 50ms), then jumps — the apex lands OVER the wall instead of at its foot. Run 104g: Segs said "here", hp 20/20 at (-128,71,160), arrived within 2 of (-126,71,160). Stairs UP also fixed the same way (hop-step mode, runs 107c/107d: "gotoPos OK (after climb assist) at (-91.6,74,160)"); stairs DOWN was already fine.
- **Lava detour — PASS (run 105).** Segs went AROUND a lava strip (x=-130, z=171..179), never into lava, "at lavatest", hp 20/20 at (-135,71,175). The pathfinder's blocksToAvoid (lava) works.
- **Long walk + 3-block drop — PASS (run 108).** 50-block flat walk arrived (-101.6,71,160.5), "here"; 3-block drop retest arrived (-90.5,73,169.4), "here", hp 20/20.
- **Water climb-out — STILL FAILS (runs 106/106b). Honest limit, evidence-backed.** Segs swims to the shore and does not drown (hp 20/20), but cannot climb a 2-high wall from the water. Root cause, from the fork source (prismarine-physics): `isInWater` uses a bounding box contracted 0.401 from the bottom, so the water jump stops applying once the feet rise above ~70.6; the feet cap at ~70.68 even with no wall contact, and the shore top is 72.0 — a 0.72-block gap no bot-level control (jump/forward/sprint/strafe, all tried) can bridge. The fork also never models the swimming pose (player height always 1.8). A fork edit would be needed, but fork edits do not ship to Tash (setup re-clones the fork). Segs survives and asks for help after 20s instead of dying.
- **2-high wall sidestep — FAILS (runs 107/107b/107c/107d/107e).** Segs falls off the v9 platform's north edge (z=150) to y=63 while routing around the wall. The edge watchdog was sped up (500ms -> 150ms, lookahead 1.5 -> 3 blocks) and made to check two points ahead (a thin natural ledge 1-2 below fooled the single-point check), and it now fires — but too late to stop the fall once Segs' momentum carries it off. Stairs UP/DOWN in the same run PASS. The go-around-a-wall behaviour itself is proven by the lava detour (run 105).
- **Fast follow — PASS (run 109).** The follow loop now re-paths ONLY when the owner moved >3 blocks, the owner entity changed, or there is no goal (the old 500ms re-path restarted the pathfinder constantly — run 82 crawled at ~0.6 blocks/s). Measured from the owner log: Segs covered 33 blocks in ~16s (>=2.1 blocks/s, 3.5x run 82's speed — a lower bound, it may have arrived sooner between status samples), ending exactly 2 blocks behind the owner at (-107,71,160). If the owner teleports >30 blocks and Segs is stuck >15s, it now offers /tpa ("looks like you teleported far away, want me to tpa to you?") and sends /tpa only when told — proven in run 109 (Segs sent /tpa, owner accepted, Segs landed at (-143,71,160)).
- **Instant ack — PASS (run 110).** Every command now gets an instant short ack ("on it", "coming", "got it", "ok — doing it") before the work starts, then the result follows. Measured in the owner log: "Segs status" said 13:39:27.637, ack "doing it now" at 13:39:27.664 (27ms), result right after; "Segs go to -100 71 160" acked in 5ms and Segs said "here" 1.5s later. Bot-side ack log: 0-1ms. Acks are owner-only, never for greetings/thanks, never twice.
- **Craft from chests — PASS (run 111c).** "Segs craft torch 4" with coal+stick+wheat in a chest: Segs took 1x stick + 1x coal, "here you go, 4x torch ready", torch x4 in inventory. "Segs craft bread 2": took 6x wheat, "here you go, 2x bread ready", bread x2. "Segs craft diamond sword" (no diamond anywhere): honest "i need 2x diamond for 1x diamond_sword — i checked 1 chest(s) nearby". Two real bugs found and fixed on the way: (1) a torch takes coal OR charcoal — the first version gave up on the charcoal variant instead of trying the coal one; (2) the craft reported the ASKED count, not the real one (bot.craft can silently do fewer crafts than asked — it now crafts one at a time with a 500ms settle and reports the real output count).
- **Cook / smelt from chests — PASS (run 112e).** "Segs cook beef 4" with beef+coal in a chest and a smoker nearby: took 4x beef + 1x coal, "got 4x cooked_beef", cooked_beef x4 in inventory. "Segs smelt iron ore 4" with a blast furnace: "got 4x iron_ingot", iron_ingot x4. "Segs smelt gold ore" (none anywhere): honest "i dont have any gold_ore — i checked 1 chest(s) nearby and found none". Three bugs found and fixed: (1) the smelt loop broke after the FIRST output (got 1x iron_ingot from 4x ore — it now polls until all n are out); (2) the chest search only saw loaded chunks, so right after a teleport it found 0 chests (it now retries up to 3 times); (3) the bot used the item name `raw_beef`, which does not exist in Minecraft 1.13+ — the raw item is just `beef` (same for porkchop/chicken/mutton/rabbit/cod/salmon). The owner test script had the same wrong name, so the chest never actually contained beef until both were fixed.
- **View distance 7 / simulation distance 7 — DONE (test server).** server.properties set to 7/7, server restarted, Segs runs fine. Bot side: Mineflayer does send a view-distance client setting, and the bot now sets it to 7. Honest distinction: on Youniga, view/simulation distance is the SERVER owner's setting — Segs cannot change it from the bot.
- **Autobuild schematic tool v1 — PARTIAL (run 113e: 46/65 placed, 0 wrong).** "Segs this is the build site" marks the origin; "Segs build house here" reads schematics/house.json (5x3x5, 65 blocks), gathers mats from chests within 16 blocks (crafting raw mats where it can), reports the exact missing list and STOPS if anything is missing, then builds layer-by-layer at 1 block per tick from outside the footprint, never breaking an existing block. Best run: 46/65 placed, 19 skipped, 0 wrong; WALL-OK, ROOF-OK, DOOR-GAP-OK and FLOOR2-OK verified, FLOOR-OK (the corner cell) not. The remaining failures are on the edge where Segs starts (the corner it stands on) — the place is refused while it is still settling from the step-out — plus Segs getting wedged at the site corner. Fixes applied across runs 113-113e: build-from-outside (never stand in the footprint), 6s cap per stand move, equip-wait (the equip packet resolves before the held item updates — 16 wall blocks lost to that), and a place retry. A second build after re-stocking places 0 and skips 65 — it never breaks or replaces a block that is already right.
- **Regressions re-run (2026-11-08):** Parkour 3-block drop run 101 PASS ("gotoPos OK (direct) at (-90.5,73,169.3)", hp 20/20); Parkour 4-block drop run 103 PASS (pathfinder refused, manual drop-down landed (-90.5,72,170.5), hp 20/20); respawn-in-place run 102 PASS (died at (-90,71,160), status at the same spot hp 20/20, no reconnect); drop fix run 72 PASS (cooked_beef x10 held, zero dropped); AutoChat gate run 74 PASS (no key -> "ai is on but i have no groq key", 0 req / 0 tokens, injection refused); creeper bow run 75 PASS ("[combat] killed creeper", hp 20/20, zero hits). Doors run 57: the door was OPENED not broken ("[door] opened oak_door at (-90,71,155)"), but Segs then got stuck following through it at (-95,71,154) and said "im stuck following you" — the follow loop does not re-plan after a door it just opened. That is a follow-through-door gap, not a door-breaking regression.
- **Guide PDF rebuilt** for v10.5: 22 pages, 16 sections (new section 16 Autobuild), plus the craft-from-chests, fast follow/instant ack, climb-assist and water-limit updates.

## What's new in v10.4.1 (2026-11-08) — the two v10.4 honest limits, fixed + guide rebuilt

- **Parkour 3-block drop — FIXED, proven (runs 101 + 103).** The v10.4
  honest limit is gone. Root cause: the fork pathfinder measures a drop
  against the landing BLOCK's y, so a 3-block feet drop is a 4-block
  difference and only just passes, and a 4-block drop can never be routed.
  The edge watchdog also scanned only 3 blocks below the feet, so it
  never saw the landing of a real 3-block drop. Fixes: watchdog scan
  extended to 4 below (drop = d-1, jump only if drop <= 3, and it skips
  while a manual drop is in progress), plus a manual drop-down fallback
  in gotoPos/followLoop — no pathfinder goal, walk forward off the edge
  and let gravity do it (walk, never jump: a jump adds ~1.25 blocks of
  height). Run 101: 3-block drop, pathfinder routed it, hp 20/20, no
  damage, "here". Run 103: 4-block drop, pathfinder refused, manual
  drop-down landed at (-90,72,168) in 2s, hp 19 at landing (exactly the
  1 hp a 4-block fall costs), "here".
- **AutoRespawn in place — FIXED, proven (run 102).** The v10.4 honest
  limit is gone. Root cause, found by decompiling Paper 26.3's
  ServerGamePacketListenerImpl: Paper disconnects with
  "Invalid move player packet" if a SECOND position-bearing packet
  arrives in one server tick; the per-tick flag is reset ONLY by
  client_tick_end. The fork's delayed respawn reply (1500ms after the
  server's respawn teleport) is sent outside its physics loop with no
  tick_end after it, so the next physics tick's position packet lands
  in the same server tick and Segs is kicked. Fix (in bot.js, 26.3
  only): for 10s after a death, every position/position_look packet is
  immediately followed by a tick_end, so the server's flag is reset
  before any next position packet can arrive. Run 102: /kill Segs ->
  respawn packet sent -> Segs answered status at the same spot,
  hp 20/20, ONE connect in the whole bot.log, no reconnect, no kick.
- **Water watchdog bug — FIXED (found while testing run 103).** The
  water watchdog cleared jump/forward/sprint on EVERY tick whenever
  Segs was NOT in water, silently killing every other manual walk
  (drop-down, door assist, flee). Fix: a waterDriving flag — controls
  are only cleared when the watchdog itself is actually driving a swim.
  This also explains the slow long-distance follow in run 82.
- **"here" honesty — FIXED.** A second go-to-coords handler said "here"
  unconditionally after gotoPos without checking its return value. It
  now says "here" only if gotoPos returns true, else "i cant reach
  there, too far or blocked". gotoPos now logs its outcome.
- **Guide PDF rebuilt** for v10.4: 21 pages, 15 sections, all 13
  NiceWurst picks covered by name, plus the creeper bow kill, the
  status-6 bow release fix, the AutoEat plugin drop fix, the Parkour
  drop-down and the respawn-in-place fix.

## What's new in v10.4 (2026-11-08) — the 13 NiceWurst picks, one by one

Tash picked 13 features from the NiceWurst mod (decompiled 2026-11-08) and
said build them one by one, rechecking every situation until the outcome is
absolute. This version implements all 13. The headline is the **creeper bow
kill, finally proven with zero hits taken** — after the bow was proven to
fire (status 6 release, not status 5) and the aim was proven on a stationary
target, the moving creeper still would not die. The root cause, found by
testing Segs standing still vs moving: **moving (back + strafe) while the bow
is charging makes the arrows miss 10/10** — the eye moves while the look is
sent in 8.6 deg/tick baby steps, so the server's rotation lags the aim. The
fix is human: **plant your feet to shoot** (stand still while charging, move
between shots). Proven (run 75 arena, run 99 open field): creeper hp 20 -> 0
in 3-4 arrows, Segs hp 20/20, zero hits taken. Skeleton bow kill also proven
(run 87, 2 arrows, zero hits).

- **AutoChat (Groq AI, owner-only).** "Segs enable AI" / "Segs disable AI" /
  "Segs ai status". Groq OpenAI-compatible, gpt-oss-20b primary,
  gpt-oss-120b fallback. Key lives ONLY in config.json on your PC
  (config.example.json has the placeholder, never a real key). Reply only
  when mentioned or whispered; canned local replies for status/where/what
  questions (no API call); min 3s between AI replies, 10s unsolicited, 30s
  per person; last 5 chat lines, max 64 tokens out, 140-char cap; de-dup vs
  last 8 replies; injection lines replaced with [Filtered]; never admits it
  is a bot. Daily budget guard (80% of 1000 req/day or 200k tokens/day),
  429 back-off 60s then 5min. Tested WITHOUT a real key (run 74): gate,
  cooldown, canned fallback, enable/disable all proven in bot.log, 0 Groq
  calls made.
- **AimAssist + KillauraLegit discipline ONLY.** No auto-aim/auto-attack.
  Capped rotation 600 deg/s (slowLookAt), LOS gate via canSeeMob, verify
  facing before strike (isFacing, 15 deg), +-100ms Gaussian jitter on the
  attack cooldown, bow ballistics from the decompiled BowAimbot (g=0.006,
  lead = distance * 1/3 so lead time = flight time, pitch solved from the
  vanilla formula, direct aim fallback). Creeper + skeleton bow kills proven
  (runs 75/99/87, zero hits). Zombie 1v1 retest (run 86): killed in 12s,
  zero hits.
- **AutoEat.** Saturation-first ranking (cooked_beef 12.8 > cooked_porkchop
  12.8 > bread 6 > apple 2.4...), eat at food < 13, injured eats uncapped,
  poison food (rotten_flesh etc) never eaten. Tested (run 76): Segs chose
  cooked_beef over bread/apple and never touched rotten_flesh; background
  auto-eat ate 2 beef when hungry and restored food to 20/20. Fixed a real
  bug found while testing: the auto-eat plugin calls bot.deactivateItem()
  (status 5 = DROP_ITEM) before every eat — bot.deactivateItem is now
  overridden to the safe status-6 release so no plugin can drop the held item.
- **AutoArmor.** Score = armor*5 + Protection*3 + toughness, 1 piece per
  tick, 2-tick gap, only while still. Tested (run 77): iron_helmet (10) beat
  leather (5), iron_chestplate (30) beat leather (15), diamond_leggings (32),
  golden_boots (5) — all best pieces worn. Fixed a real bug: armorSlotOf
  returned 'boots' but the loop uses 'feet', so boots were never equipped.
- **AutoTotem.** Polls the off-hand every 500ms; a totem is held in the
  off-hand ALWAYS when Segs has one (a totem only saves Segs from a one-shot
  if it is already there — the first health-gate version left Segs holding
  the shield at full health and it died to lethal damage). If it pops, the
  spare is re-equipped. Shield is the fallback only when there is no totem.
  Tested (run 78): totem held at hp 20, lethal damage popped it, Segs
  survived at hp 2-4, spare re-equipped. (Known wart: one false "totem
  popped" message at startup in the test harness, from /clear removing a
  kept totem from the previous run — not a real pop.)
- **AntiBreak.** Before digging/attacking, if the held tool has <=10% (or 5
  uses) left, swap to the next best tool of the same kind or empty hand and
  say so. Tested (run 79): iron_pickaxe at 5/250 swapped to stone_pickaxe,
  stone dug with the stone pickaxe, iron pickaxe unbroken. Fixed a real bug:
  equipForBlock re-equipped the iron pickaxe after the swap — the check now
  runs AFTER each equip.
- **AutoFarm.** Replant FIRST then harvest, nearest-first, 1 action per
  tick, seed-per-spot remembered (brain.farmSpots), never bone-meals while
  farming. Tested (run 80): 9 potato spots replanted (spot remembered),
  27 potatoes + 1 poisonous potato harvested.
- **AutoMine.** Normal-speed bot.dig with the correct tool per block
  (mineflayer-tool plugin), no super-fast mode. Tested (run 81): dirt dug
  with iron_shovel, stone dug with iron_pickaxe. The no-tool rule still
  applies (stone without a pickaxe is refused).
- **Follow.** Re-targets the owner BY NAME when the entity goes stale
  (resolveOwnerEntity), re-paths every 10 ticks (500ms), stops at exactly 2
  blocks (horizontal distance). Tested (run 82): Segs ended 2 blocks behind
  after the first teleport, and kept following toward the owner after a
  35-block teleport (re-targeted by name). Long-distance follow is slow
  (~0.6 blocks/s over 35 blocks in this run) — a known wart.
- **Parkour.** Auto-jump at a drop ahead ONLY when a goto/follow goal is
  beyond it AND the landing is safe (ground within 3 blocks below, no
  lava/water). The edge watchdog still stops Segs when idle or when there is
  no safe landing. Tested (run 83): 1-block ledge down, Segs walked down to
  y=71 and said "here". v10.4.1: the 3-block drop is now proven (run 101,
  pathfinder routed it, hp 20/20, no damage) and a 4-block drop is proven
  via the manual drop-down fallback (run 103, landed hp 19 — exactly the
  1 hp a 4-block fall costs). The old v10.4 honest limit (run 100) is
  fixed; see "What's new in v10.4.1" above.
- **AutoRespawn.** Respawn packet + 500ms retries + 10s reconnect. Tested
  (run 84): /kill Segs -> respawn packet sent, Segs answered status again
  after reconnect. v10.4.1: respawn IN PLACE is now proven (run 102) — the
  old "fork limit" was wrong. Root cause was Paper's one-position-packet-
  per-server-tick rule vs the fork's delayed respawn reply with no tick_end
  after it; fixed by sending tick_end after every position packet for 10s
  after a death. The 10s reconnect stays as the fallback if a kick ever
  happens for another reason.
- **PacketRate.** Outgoing packets counted per second, rate logged every 10s
  to bot.log (avg, peak 1s window, total). If the rate exceeds ~100/s
  sustained, only CHAT packets are throttled (queued 1 per 500ms) — movement
  and physics packets are never throttled. Tested (run 85 + all runs): idle
  ~22/s, combat peak 63-76/s, never near 100/s, so the throttle is a safety
  net that has not needed to fire.

The v10.3.1 drop fix still holds (run 72 retest: cooked_beef x10 through
"tp to me", "sleep", "stop" — zero dropped). The guide PDF is rebuilt in
v10.4.1 (21 pages, 15 sections, all 13 NiceWurst picks by name).

## What's new in v10.3.1 (2026-11-08) — the drop bug, found for real
Tash nailed it down: Segs held BEEF in its RIGHT hand, "tp to me"
dropped 1-3 beef, "sleep" dropped beef. Root cause found in the code:
my v10.3 edit left a SECOND `deactivateItem()` call in stopCombat
(after the log line) — it fired on EVERY stop, and on Paper that
packet drops the held item. It is removed for real now. Tested (run
72): Segs held cooked_beef, got "tp to me", "sleep" and "stop" — kept
all 10 beef, zero dropped.

- **Land 1-block jump + walls.** "He cant jump up 1 block" on LAND
  too, and "blocked by a 1-2 block wall even tho just at his right or
  left there is open space". Two fixes: gotoPos now pulses jump when
  Segs has not moved in 2s (like follow already did), and a WALL
  SIDESTEP — when the direct path and the staged path both fail, Segs
  tries 4 blocks left, then 4 blocks right, and retries from there.
  Tested (run 73): a 2-high wall across the path, Segs sidestepped
  around it and said "here" at the target.
- **Follow trigger is horizontal distance** (was 3D): if you are 1
  block above Segs, it now jumps up to you instead of standing below
  you forever. Tested (run 71): Segs jumped onto a 1-high ledge and
  ended 2 blocks behind.
- **"beef" now means cooked_beef** (so "Segs hold beef" works).
- **Guide PDF rebuilt** — 20 pages, 15 sections, properly sorted:
  setup, talking, teaching, sorting, columns, paper, moving, junk,
  farming/food, pickup/store, COMBAT (new), crafting, logs,
  troubleshooting, quick reference.

## What's new in v10.3 (2026-11-08) — Tash's real-server bug report
Built from Tash's logs + screenshots on the real youniga server (2026-11-08).
Every fix below is proven in simulation (runs 60-71); the one honest limit
is the water climb-out on a vertical 1-block wall (fork physics).

- **Drop fixed.** "Segs drop seeds" now drops ALL the seeds (was 1).
  "Segs drop 1 seeds" drops just 1. "Segs drop all seeds", "drop seeds
  x64", "drop 64x wheat_seeds" and "drop everything" all work now (they
  all said "i dont have ..." before — the parser treated "all"/"x64" as
  part of the item name). "Drop everything" drops the whole inventory.
- **No more dropping items on any command.** The `deactivateItem()`
  packet sent on every stop is removed (it was the prime suspect for
  Segs throwing the held item when Tash gave any command).
- **Chat is more versatile.** "Segs equip axe" works now (was "didn't
  get that"). "Segs craft yourself an axe" works (was "i dont know
  yourself_axe" — filler words like "yourself" are stripped). "Segs
  this is food chest" / "Segs this is Storage unit" work WITHOUT "the"
  (the old handler required "this is the", so those failed twice).
  "Segs keep wheat in this chest" / "Segs store iron in this chest"
  works (stores the item in the nearest chest). Typos get a suggestion:
  "Segs top" → 'did you mean "segs stop"?'.
- **Food chain fixed.** Wheat is not edible and not cookable, so Segs
  farmed wheat and then said "the farm had nothing ripe to eat" while
  HOLDING 24 wheat. Now it crafts BREAD from wheat (3 wheat = 1 bread)
  and eats it — in the survival routine and when it already holds wheat.
- **Pickup fixed.** "Segs pick up" now VERIFIES it actually got the
  item (says "got it" or "i cant reach that one"). Farming picks up
  each crop drop BEFORE moving to the next crop (so harvested wheat
  does not sit on the ground looking like Segs threw it).
- **Auto-jump + follow.** Segs now pulses jump when it has not moved
  for 2s while following (a 1-block step it was stuck on), and the
  follow trigger uses HORIZONTAL distance (so it jumps up onto a ledge
  when you are above it). If it is stuck 15s while following, it says
  so and stops (instead of standing there silently).
- **Mob sense — no X-ray.** Segs only reacts to mobs it can SEE: same
  level (within 4 blocks up/down) AND a clear line of sight (raycast).
  A zombie in a cave 10 blocks below no longer makes Segs say "mobs
  are there" and try to fight in daytime when nothing is on the surface.
- **Water.** Drowning is fixed (swims up, no death). Segs swims to the
  shore. HONEST LIMIT: the fork's physics cannot jump a full 1 block
  out of water onto a vertical shore, so Segs stalls at the edge. After
  20s stuck in the water it SAYS so and asks you to come get it
  (instead of struggling silently). A gradual riverbank is easier than
  a vertical wall, but the climb-out is not proven.

## What's new in v10.2

**Bow re-aim during charge.** The bow used to aim once, then charge for
1s — during that 1s a moving target walks ~4 blocks, so the arrow went
where it WAS. Now Segs re-aims every 100ms during the charge, tracking
the target's current position (and the live entity by name, not the
stale stored id — the same stale-entity bug that caused the 92% sword
miss rate). This makes the bow hit moving targets, not just standing
skeletons.

**Creeper: bow dropped, melee hit-and-run instead.** Six bow approaches
were tried for the creeper (chest aim, lead, re-aim during charge, closer
range, sprint-back kiting, live-entity fix) — 5–21 arrows per fight, 0
kills. A creeper walks toward Segs, so a 1s bow charge means the aim is
always stale. The sword hit-and-run is now used instead: hit once
(knockback), SPRINT away immediately (fuse resets when Segs is >3 blocks
away), re-approach, hit again. Segs survives creepers safely (0–1 hits
taken, never dies to one), but a reliable zero-hit creeper KILL is still
not proven — the creeper disappears (despawns or explodes at a safe
distance) without Segs landing the killing blow. This is the one
remaining item that is not zero. Segs is safe from creepers; it just
does not reliably kill them yet.

## What's new in v10.1

**Bow combat — Segs shoots from range.** If Segs has a bow + arrows and the
target is a skeleton, creeper, witch, blaze or pillager, it keeps 10–14
blocks, strafes fast (direction flips every 300–500ms so return fire
misses), aims at the target's chest (y + 1.0, no lead — skeletons stand
still while shooting, and a lead made the arrows miss), charges the bow
1s (full charge = max damage) and releases. **Skeleton: ZERO hits taken,
proven** (run 52 retest — Segs shot it and killed it without taking a
hit). **Creeper: Segs shoots it from range** (it is a combat target only
when Segs has a bow + arrows; without a bow Segs still flees creepers).
Creeper kills are not yet reliable — the creeper walks toward Segs and
the arrows miss it more often than the standing skeleton; it is the
hardest bow target. **Horde: funnel** — when 2+ hostiles are near, Segs
backs to the nearest wall (within 10 blocks) so the horde can only come
from the front, and shoots zombies from range too while backing up.
Best horde result so far: 1 kill, 4 hits taken (was 5–7). A 5-zombie
horde in the OPEN arena is still not zero hits — on the real server
Segs fights near walls/doors, which is the funnel it wants.

**Plan items 6–12 — all built.**
- **Unstuck:** if Segs has a goal but has not moved >0.5 blocks in 10s,
  it jumps, turns 90° and walks, jumps again. NEVER breaks a block.
  After 3 tries it says so and waits for you.
- **Creeper rule:** when fleeing a creeper, Segs flees AWAY from you
  and from the permanent home — never leads one to you or the house.
- **Night behaviour:** at night, if Segs is idle, it goes to its
  permanent home (or near you). If you are offline, it goes home and
  waits there — it does not wander alone.
- **Mob-by-mob flee:** skeleton/witch zigzag (their shots are aimed);
  enderman look DOWN and walk away slowly (never look at it, never
  sprint); spider sprint (it is fast).
- **Water & drowning:** if Segs is in water and its air is low, it
  swims STRAIGHT UP first (head above water), then moves to shore.
  Proven: Segs no longer drowns (run 59 — air restored, no death).
  Climbing out onto shore in the test pond is still unreliable
  (floating-platform test setup); the drowning part is fixed.
- **Trapdoors & fence gates:** the door opener now also opens
  trapdoors and fence gates (same rule: open, never break).
- **The rest:** farmland is in blocksToAvoid (Segs never walks on
  crops); animals are never attacked (combat only targets hostiles);
  owner-offline idle (see night behaviour).

## What's new in v10

**Combat — Segs fights like a PvP god.** Threat-prioritised targeting (creeper
first — but creepers are fled from, not meleed, see below), cooldown-timed hits
(sword 650ms, axe ~1050ms, never spam), crits on fresh/tough targets, sword
sweep for hordes, kiting at 2.5–3.0 blocks vs melee (Segs hits from 3, the
zombie can only hit from ~2), sprint-jump close-in + random strafing +
point-blank attack vs ranged (a skeleton backs away at ~5 blocks/s, plain
sprint ~5.6 barely gains — sprint-jumping is ~7), shield equip in off-hand,
surroundings check (never surrounded — it breaks out through the gap), retreat
to heal below 8 health, no weapon = flee + say so (never fight with fists).
Give Segs a sword or an axe (or tell it to make one from your base) and it
keeps it equipped. Combat stats in "Segs stats" (kills / hits taken / hits
landed). PROVEN in simulation: **1v1 zombie — PASS, zero hits taken** (run 51
clean retest). 1v1 skeleton — best 1 hit, killed (not zero yet; the shield
block is unreliable in this Mineflayer fork). **Creepers are fled from, not
fought in melee** — the fuse (1.5s) beats a sword kill (3 hits, ~2s), so
meleeing one means it explodes on Segs; a bow is the correct tool for them.
A 5-zombie horde in the open arena still overwhelms Segs (honest limit — it
needs a doorway/wall funnel).

**Doors properly — Segs never breaks your house to reach you.** While
following, `canDig` is FALSE — Segs opens doors or says it cannot get there,
it never digs the block above a door. Every follow tick it proactively opens
a closed wooden door within 3 blocks (no 6s wait), then re-sets the follow
goal so the pathfinder routes through the open doorway. Iron doors: it presses
a nearby plate/button/lever; if none, it says so and does not break it.
PROVEN in run 57: Segs opened the door, walked through, the cobblestone above
it stayed intact, and Segs ended 2 blocks behind the owner.

**Follow 2 blocks behind.** The follow loop now corrects the moment Segs is
more than 2 blocks behind (was 3), so it stays right behind you, not 4–5
blocks back. PROVEN in run 57.

**Edge awareness for ALL movement.** The flee loop already had an edge check
(v9.4). Now a global edge watchdog runs every 500ms: it reads Segs' velocity,
checks the ground 1.5 blocks ahead, and stops ALL movement at once on a drop
— follow, goto, farming, combat kiting, everything.

**No-tool rule.** Segs never digs stone/ore by hand. "Segs dig stone" with no
pickaxe → it refuses ("i need a pickaxe to dig stone — i wont dig it by
hand"). The pathfinder also never digs stone/ore/obsidian (added to
blocksCantBreak). PROVEN in run 58.

## What's new in v9.4

Three real-server reports from Tash, all fixed (two proven, one honest limit):

**Doors — Segs broke a house door instead of opening it.** The
pathfinder's `canOpenDoors` defaults to false AND its openable set
only holds fence gates, so with `canDig=true` the A* dug through
doors. Worse, the fork's A* can never route through a 2-block door
on its own: it only "opens" the feet-level block and always tries to
break the head-level block. Fixed with a door assist: `canOpenDoors`
is on, wooden doors are in the openable set, doors/fence gates are in
`blocksCantBreak` (Segs never breaks one now), and when a goto or a
follow gets stuck, Segs opens a nearby wooden door and the pathfinder
walks through the open doorway. PROVEN in runs 48/48b: closed door —
Segs opened it and walked out; already-open door — Segs walked
straight through; the door stayed intact in both cases.

**Death — "why does he die and reconnect, cant he just press respawn?"**
Segs DOES press respawn: it sends the vanilla respawn packet the
moment it dies, then every 500ms for 5s. But Paper still kicks the
dead client with "Invalid move player packet received" — the fork's
physics loop keeps sending position packets from the corpse, and no
bot-level stop (pathfinder goal, flee, follow, farm, PvP — all
cancelled first in v9.4) prevents that. The 10s auto-reconnect is the
fallback and it works: Segs rejoins and walks back to recover its
grave. Respawn-in-place on Paper is a fork/physics limit, not a bot
setting — reported honestly, not promised.

**Fleeing off a bridge — Segs fled a phantom on a 1-wide bridge at
Y200 and fell off.** The flee loop steered straight away from the mob
with direct forward/sprint movement and no ground check. Fixed: every
flee tick now checks the ground 1.5 blocks ahead in the flee
direction; a drop (cliff, bridge edge, void) is refused, the other
directions are tried, and if none is safe Segs STANDS STILL — taking
a hit beats a 200-block fall. PROVEN in run 50: Segs held still on
the bridge ("no safe flee direction (edge) — holding still") and
stayed at y=101 instead of falling.

## What's new in v9.3

Tash tested v9.2 on the real youniga server: Segs joined fine, but
"Segs tp to me" just answered "i cant see you right now" and did
nothing — Segs was far away from him (at spawn, Tash at his base).

That was a real bug in Segs, not Tash doing it wrong. The "tp to me"
handler checked "can I see you" BEFORE sending the /tpa request. Far
away, the server never sends Tash's player to Segs, so Segs said "i
cant see you" and never sent the /tpa at all. A /tpa works over any
distance — that is the whole point of it.

Fixed: "Segs tp to me" now sends the /tpa FIRST, with no visibility
check. Tash types /tpaccept Segs and Segs teleports to him. Only the
walking fallback (after 15s with no accept) checks visibility — you
cannot walk to someone you cannot see. Teleport success is detected
by Segs having moved a long way, or the owner being within 5 blocks.
If it still cannot see him after 15s, Segs now says plainly: "i cant
see you right now — type /tpaccept Segs next time, or come closer and
try again".

## What's new in v9.2

Your storage wall is one continuous wall with no gap between columns,
and v9.1's teaching scan picked up the neighbours too. Fixed and
simulation-proven (runs 46/46b, see TEST-REPORT-26.3.md):

1. **Teaching is wall-safe now.** Segs anchors on the nearest chest and
   reads only that column's exact footprint, block by block — so
   teaching the ore column records exactly its 10 chests, not the tools
   or foods columns next door. The old 40-chest scan cap is gone too
   (it would have missed the top chests on your real 160-chest wall).
2. **Re-teaching adds instead of overwriting.** Teach a column from the
   ground floor, then again from a higher floor, and Segs keeps all 10
   — it says "10 chests now (0 new)". Teaching from the other half of
   a double chest does not double-count it either.
3. **A mis-teach is refused.** If you stand at the ores column and say
   "Segs this is the foods column", Segs says those chests are already
   the ores column and changes nothing.

**The hold-off is lifted: you can teach the columns now with v9.2.**
Teach in this order: storage unit, your room, the 16 columns, trash
chest, sugarcane chests, then trading hall and other places. Tools
still fill bottom-first in v9.2 — the best-at-top call is separate and
still yours to make.

## What's new in v9.1

Tash built the real storage unit (16 columns, 10 DOUBLE chests each) and
asked for three things. All three are built and simulation-proven.

1. **ONLY OrewaSegs can command Segs.** It was already true for orders
   (sort, farm, tp, teach...), but the immediate "stop" handler in the
   chat listener had NO owner check — any player could say "Segs stop"
   and cancel Segs' walk / pause a sort mid-way. Fixed: the immediate
   stop now only fires for the owner. A stranger who tries gets nothing
   (the sort keeps going); an owner order from anyone else still gets
   "sorry <name>, only OrewaSegs can tell me what to do". Small talk
   (hi, thanks, who are you) still works for anyone — that's just
   being friendly, not taking orders.

2. **Bottom-first fill, gradually up.** Every column now fills from
   the bottom chest first, then the next one up when the one below is
   full. The old tools top-first reversal is gone — tools fill
   bottom-up like everything else. (The "best tools at the top" tier
   idea is dropped unless Tash says he wants it back as a strict
   tier-to-chest rule.)

3. **Double-chest columns work.** A double chest is two blocks sharing
   one 54-slot inventory — Segs now records ONE chest per double chest
   (a 10-double-chest column is 10 chests, not 20), so it doesn't open
   the same inventory twice per level. The column scan also reaches
   the whole 10-tall column now (search radius 6 -> 12, height range
   -2..+10 -> -10..+10), so teaching from the ground floor finds the
   top chest, and teaching from any floor finds the bottom ones.

## What's new in v9

**Smart sorting — the storage unit.** Your base's big room becomes the
storage unit: one **column** per type of item, each column up to 10 chests
tall with stairways so Segs can climb. Teach it once by walking Segs to a
column and saying `Segs this is the ore column` — it records every chest
in that column and remembers which item goes in which chest, so next time
it doesn't re-check, it just goes straight there.

**The 16 columns.** Yours: flowers, building blocks, ores (raw, ingot or
block), tools (best to worst, top to bottom), foods (raw or cooked), farm
items (wheat, potato and carrot ONLY), paper, woods (logs and planks).
Plus 8 more: redstone, mob drops, nether, valuables (diamond, emerald,
netherite, ancient debris, lapis, amethyst), brewing/potions, armor, seeds
& plants, misc (everything else). Build the 16 columns first, then teach
them. If a category has no column yet and a whole column is empty, Segs
claims that empty column for the category and starts using it.

**Sort your room.** `Segs sort my room` — Segs takes everything out of
your room's chests and moves it, sorted, into the storage unit columns.
`Segs move the ores to the ore column` sorts just one category. Say it
however you like — `Segs sort my room and move to storage unit`, `Segs
move out and sort stuff` — it understands the idea, not one exact phrase.
Teach your room first: stand in it and say `Segs this is my room`.

**Paper, made on its own.** The paper column is special: Segs takes
sugarcane from the sugarcane farm chests (teach them with `Segs this is
the sugarcane farm chest`), crafts it into paper at a crafting table, and
puts the paper in the paper column. `Segs make paper` does it by hand.
Leftover cane goes into the paper column as stock.

**Tools, best to worst.** The tools column fills top-down: netherite at
the top, then diamond, iron, gold, stone, wood at the bottom. (Tell Mu if
gold should sit somewhere else — that order is a guess.)

**Junk, enchanted, shulkers.** Junk goes to the trash chest if you taught
one (`Segs this is the trash chest`), otherwise Segs drops it on the ground
and tells you: rotten flesh, arrows, and non-enchanted wood/stone/iron/
gold tools, weapons and armour. **Enchanted anything is never junk** — it
goes to the misc column, even if it's a wooden sword, so you never lose a
good item. **Shulker boxes are never touched** — Segs doesn't open them,
doesn't move them, just reports them and leaves them alone. Any other
chest or barrel it can open.

**Stop and continue.** Say `Segs stop` mid-sort and Segs puts back what
it was carrying, saves exactly how far it got, and stops. Say `Segs
continue last sorting` and it reports first — `last sorting was your
whole room from my room — i moved N stacks, M left. do you want to
continue this one, or do another sorting?` — and waits for you to confirm
(`continue`, `yes`, or just say which other sort). A fresh sort starts
from the beginning but skips anything already sorted.

**Base map.** Segs remembers the whole base area, not just chests. Walk it
to a place and name it — `Segs this is the trading hall`, `Segs this is
the storage unit` (the storage unit is also its permanent home and the
centre of the map) — and it remembers it. `Segs go to the trading hall`
walks there. `Segs list places` / `Segs list columns` shows what it knows.
`Segs where is the ore column` gives you the coords. It knows about 10
chunks around the base, so it doesn't have to re-check nearby blocks for
every job.

**Climbing.** The storage columns are tall, so Segs now climbs stairways
(it couldn't before — the pathfinder refused to jump up steps). If a
column's upper chests have no stairs yet, Segs says it can't reach them
instead of wandering off.

**It ignores your `/commands`.** If you type a server command that
mentions Segs (like `/enchant Segs sharpness 3`) Segs no longer answers it
with "i didn't get that" — a line starting with `/` is a command, not
chat to Segs.

## What's new in v8

**Bed = spawn point.** `Segs set this bed as your bed` — Segs walks to the
bed and sleeps in it; that bed becomes its respawn point, and it remembers
it. Ask again at another bed and the spawn point moves there. If it's
daytime it says so and remembers the bed, then sleeps in it on its own the
first night it can. (Segs had no spawn point at all before this — it
respawned at the world spawn.)

**Permanent home vs spawn point — two different things.** `Segs remember
this is your permanent home` marks the spot where Segs stands as its
permanent home (its room in your base, with its chests). It stays put even
if the spawn point (bed) moves later. `Segs go home` goes there — by
`/home <name>` first if a server home is linked to it, otherwise by
walking. `Segs where is your permanent home` tells you the coords.

**Grave recovery (SimpleGraves).** When Segs dies it remembers the death
spot. After respawning it walks back on its own, opens the grave like a
chest and takes everything out — inventory back as it was at death. If it
can't reach the spot it says the coords in chat (`i cant reach my grave
at X, Y, Z — my stuff is there, N minutes left on it`), because a grave
only lasts 10 minutes. `Segs get your stuff` does the same trip by hand.

**Pickup.** `Segs pick up the carrot` / `Segs pick up the items` — it
walks right onto the dropped item (not 2 blocks short) and collects it.
Works for anything: food, tools, blocks.

**Store items.** `Segs keep these items at your base` — Segs goes to its
permanent home and puts everything from its inventory into the room
chests. It keeps its tools, weapons and armour (pickaxe, sword, bow,
shield, armour...) and stores the rest.

**Enemies — check and evade.** `Segs check for enemies` scans 20 blocks
and reports what it sees (`i can see: zombie 19 blocks away`, or all
clear). On its own, every 5 seconds, if a hostile gets within 8 blocks
while Segs is idle (4 while it's busy) it **runs away from it, sprinting**,
and says so in chat. It never runs while guarding. (Walking away was not
enough — a zombie walks faster than a player walks, so v8 sprints.)

**Danger blocks.** The pathfinder already avoids fire and lava; v8 also
adds magma blocks, cactus and sweet berry bushes, so Segs routes around
them instead of walking through.

**Hunger-based walk/run.** Segs sprints when its food is 10 or higher
and walks when it's hungry, so it doesn't burn food it doesn't have.
`Segs status` shows hp and food.

**`/home` warmup — it stands still.** A `/home <name>` teleport needs 3
seconds with no movement, or it cancels. Segs now freezes completely
(stops moving, clears all controls) before sending the command, waits
3.5 seconds, and only then checks whether it teleported. It never sends
bare `/home` (that opens a GUI). If the teleport didn't happen it walks
instead and says so honestly.

**`/sethome` reply listening.** After `/sethome <name>` Segs listens to
what the server says back. If the server refuses (same name already set,
or the 3-home limit — the message is in French on your server, e.g.
`Vous n'avez pas la permission d'ajouter un autre home !`) Segs says
so in chat and does **not** pretend the home was set. Every reply is also
written to `logs/` so you can see the exact wording.

## Your server's plugins — what Segs uses (v7)

From the `/plugins` list Tash sent (2026-11-07): AuthMe, CoreProtect,
CreeperBlockProtection, HomePlugin, packetevents, SimpleGraves,
SkinsRestorer, SmoothChat. **No LuckPerms ranks** — so Segs can only use
PLAYER commands, never op commands (`/tp`, `/give`, `/gamemode` will not
work and Segs never tries them). What it does use:
- **AuthMe** — `/login` on join (already in v3+, proven on Paper).
- **/tpa + /tpaccept** — real teleporting. `Segs tp to me` sends you a tpa
  request; you type `/tpaccept Segs`. If you send `/tpa Segs` first, Segs
  auto-accepts it. If nobody accepts within 15s, Segs walks to you instead.
- **HomePlugin — /sethome, /home, /delhome (max 3 homes, overworld only)**.
  `Segs sethome mine` saves a server home; `Segs go to mine` teleports with
  `/home mine` first and walks if the teleport fails; `Segs list homes`
  shows them; `Segs forget home mine` removes one. If it already has 3
  homes and you ask for a 4th, it tells you which one to forget first.
- CoreProtect / CreeperBlockProtection — the world is protected, good for it.
- SimpleGraves — if Segs dies, its items go to a grave (it can be fetched).
- SkinsRestorer / SmoothChat / packetevents — cosmetic / library, nothing
  Segs needs to do.

v7 also fixes a real bug found while wiring this up: `Segs go home` never
reached the go-home code — the "go to" handler caught it first and answered
"i dont know where go home is". It now goes home properly. Two more fixes
from testing: long walks (60+ blocks) failed because the pathfinder cannot
plan into unloaded chunks, so Segs now walks in 16-block stages and only
says "im here" / "at home" when it actually arrived — before, it said so
even after a failed walk. And when Segs dies it now tries to respawn
immediately (vanilla respawn packet); note Paper still kicks it for the
movement packets sent while dead, so on Paper it recovers by auto-reconnect
in 10s — same as v6, just faster to notice.

## The learning system (logs/) — how Segs improves day by day

Everything Segs does is written to a `logs/` folder next to `bot.js`:
- `logs/2026-11-07.log` — one human-readable line per event, per day
- `logs/actions.jsonl` — one JSON object per action (time, action, result, position)
- `logs/chat.jsonl` — every chat message it heard + every reply it sent
- `logs/learning.jsonl` — every new thing it learned (landmark, fact, death, find)
- `logs/stats.json` — running totals (crops farmed, items crafted, deaths, food eaten...)

Logs are small on purpose (one line per event, 30-day rotation, 5MB cap per file)
and never contain the password. `logs/` is gitignored.

**To improve the bot day by day:** zip the `logs/` folder and upload it here.
Mu reads the logs, finds what went wrong or what Segs keeps doing, and fixes the
code. That is the whole learning loop — the bot logs, you upload, the code gets
better. `Segs stats` shows the totals in chat any time.

## Teach it your base (walkthrough)

Call Segs to you, stand next to a thing, and tell it what it is:
- `Segs this is the potato farm` / `Segs this is the wheat farm`
- `Segs this is the food chest` / `Segs this is the coal chest`
- `Segs this is the smoker` / `Segs this is the furnace`
- `Segs what is here` — lists everything it knows nearby

Landmarks are THINGS (farm/chest/furnace/smoker); bases are PLACES
(`Segs remember this is home`, `Segs list bases`).

## Survival — it takes care of itself, and says so in chat

When Segs gets hungry it does not just stand there. It says what it is doing,
then does it: `Segs get food` (or on its own, every 60s when idle and hungry):
1. Eat food it already has.
2. Else go to a potato farm it was shown, harvest ripe potatoes.
3. Cook them in a smoker/furnace it was shown — if it has no coal, it checks
   a chest it was shown for coal first.
4. Eat, and say "fed, all good".
5. If it cannot find food anywhere, it says so in chat and asks you.

It also narrates everything it does in chat, so you always know what it is up to.

## Casual talk

`Segs how are you`, `Segs tell me a story`, `Segs sing a song`,
`Segs are you AI` (honest answer: "im a bot, not AI"), `Segs i love you`,
`Segs what should i do`, `Segs favourite food`, `Segs who is the best player`.
If it does not understand a sentence, it guesses the meaning from the words
and suggests the right command instead of just saying "didn't get that".

## Crops — which can it farm?

Wheat, carrot, potato, beetroot — all 4 replantable crops.
`Segs farm potato` farms one kind, `Segs farm all` farms every ripe crop nearby.
Pumpkins and melons grow on stems and are not replanted the same way, so they
are not in the farm list (it can still dig them if you ask).

**v5 is v4 + a smarter brain.** Same native 26.3 fork build (Misty4119 six-repo
Mineflayer fork, protocol 777), plus:

- **Multiple bases, not one home.** `Segs remember this is home`, `Segs remember this is the mine base`,
  `Segs remember this is base 2` — as many as you want. `Segs list bases` shows them,
  `Segs go to mine` walks there, `Segs go home` goes home. It remembers them in
  `brain.json` even after restarts.
- **It learns (coded memory, not AI).** `Segs remember that the mine is dangerous at night`
  stores a fact. `Segs learn daily means go to the farm and farm wheat and come back`
  teaches it a routine — then `Segs daily` runs the whole thing. `Segs what do you remember`
  lists bases, facts, routines and deaths. It also learns on its own: where it died,
  where it found stone/ores, what worked.
- **More player stuff:** `Segs dig stone`, `Segs mine iron ore`, `Segs chop wood`
  (equips the best tool it has), `Segs place torch`, `Segs fish`, `Segs smelt iron ore`
  (needs furnace + coal), `Segs inventory`, `Segs drop everything`, `Segs dance`, `Segs jump`,
  `Segs look at me`, `Segs tell me a joke`, `Segs who are you`.
- **6 bugs fixed after running it 3 times in simulation** (see TEST-REPORT-26.3.md):
  "do you have iron" now understands iron/gold/wood/etc, "do it again" works after
  real actions, "go to the farm" no longer starts farming, "craft bread" tells you
  exactly what is missing instead of "no recipe", "come back to me" walks to you,
  and "learn / remember that" no longer get eaten by the farm handler.

**Can it really learn like a player?** Honest answer: no real AI training — a free
Node bot cannot train a model while it plays. What it CAN do, and now does, is
remember everything that happens to it (places, facts, routines, deaths, finds)
and use that memory next time. That is learning in the only form a bot like this
can honestly offer. Enchanting, villager trading and riding horses are still out
of scope — it does everything else a normal player does: walk, run, jump, swim,
fight, farm, craft, smelt, fish, dig, place, eat, sleep, guard, AFK, chat.

**v4 is a different bot under the hood from v3.** v3 used npm Mineflayer (26.1 only) + a
`tick_end` wrapper, and it could only join a 26.3 server through ViaBackwards.
Your server has no Via plugins and the owner will never add them, so v3 is dead for
`youniga.deployd.sh`. v4 is a **custom native 26.3 build**: it assembles the
Misty4119 six-repo Mineflayer fork (mineflayer + node-minecraft-protocol +
prismarine-chunk + prismarine-item + prismarine-physics + vendored minecraft-data
for 26.3, protocol 777, dataVersion 5023) and runs Segs on top of it, with the
same chat, farm, craft, guard and AFK brain as v3.

**Tested on a real vanilla 26.3 server** (official Mojang server.jar, SHA-1 verified,
see TEST-REPORT-26.3.md): Segs joined as protocol 777, spawned, sent `tick_end`,
walked 5.39 blocks with pathfinder, chatted, and stayed connected — no
`invalid_player_movement` kick, no "outdated client" kick. That test was on a
local vanilla server, not on `youniga.deployd.sh` yet — the real server is the
last test, and it is yours to run (see below).

## Setup (do this once, on your Mac/PC)

You need Node.js 22+ and Git. Put this repo and the fork side by side:

```
your-home/
  Segs-Minecraft-Bot/     <- this repo
  segs-26.3/              <- created by the setup script
```

**Mac / Linux:**
```bash
bash setup-26.3.sh
```
**Windows:** double-click `setup-26.3.bat`

That clones the six fork repos (pinned to the exact commits tested on 2026-11-07),
installs the fork, installs this bot, and links the fork's prismarine packages
into the bot (`node link-prismarine.js` — also runs automatically after
`npm install`). Why the link step? The pathfinder/pvp/collectblock plugins are
npm packages that pull plain npm prismarine versions which do NOT know 26.3 and
crash with "Do not have data for 26.3". The link step replaces them with the
fork-tested copies. Do not skip it.

Then:
```bash
cp config.example.json config.json
# edit config.json: host is already youniga.deployd.sh, port 25565
# authPassword = the SAME password Segs was registered with on your Mac
# NEVER share config.json or the password. It is gitignored.
node bot.js
```

**Before you run it:** log out as Segs on your Mac first, and play as OrewaSegs.
Same name online twice = one gets kicked.

## Low RAM — 500MB-1GB

The bot asks the server for view distance **5** (`viewDistance: 5` in bot.js).
It does not render anything, so RAM is mostly chunk cache + Node. Measured on
the local vanilla 26.3 test: **~212 MB RSS** for the bot process. The server
itself is separate — on your machine, run the bot only, not a local server.
If your PC is tight, close the Minecraft game client while the bot runs as
Segs, and play as OrewaSegs from another device if you can.

## Talk to it — only OrewaSegs can give orders

```
Segs tp to me
Segs come here
Segs follow me
Segs stop
Segs sleep
Segs wake up
Segs farm wheat
Segs farm carrot
Segs afk
Segs guard me
Segs eat
Segs craft iron pickaxe
Segs craft bread 5
Segs give me iron sword
Segs pickup
Segs status
Segs help
Segs go to 100 64 -200
Segs go to the farm and farm wheat and then come back to me
Segs do you have iron
Segs how much wheat do you have
Segs what time is it
Segs what are you doing
Segs remember this is home
Segs go home
Segs do it again
Segs get me 10 oak logs
Segs kill that zombie
Segs i need an iron pickaxe
```

It replies with varied fixed lines, not AI. Anyone can say "hi Segs", but only
OrewaSegs can order it around.

**"Segs tp to me"** walks to you with pathfinding — it cannot do a real `/tp`
unless it has op. **"Segs sleep"** needs a bed nearby and night time.
**"Segs farm wheat"** harvests only ripe crops and replants if it has seeds.
**"Segs craft ..."** tells you exactly what it is missing, e.g.
`i need 3x iron_ingot, 2x stick for 1x iron_pickaxe`.

## What v4 changed from v3

- `mineflayer` is now `file:../segs-26.3/mineflayer` (the fork), not npm 4.39.0.
- `version` is native `26.3` — no fallback warning, no 26.1 fallback. If the
  fork data ever fails to load, the bot will say so and stop, instead of
  silently speaking the wrong version.
- `tick_end` is now sent natively by the fork's physics loop. The v3 wrapper
  is skipped on 26.3 (it would send `tick_end` twice per tick). It is kept
  only as a fallback for a 26.1 fallback path that v4 does not use.
- `minecraft-data` is resolved **through mineflayer** (`mcDataFor()` in bot.js),
  because npm plugins pull a plain npm minecraft-data that does not know 26.3.
- `link-prismarine.js` fixes the plugin stack the same way (see Setup).
- `viewDistance: 5` in `createBot`.

## If it won't connect to youniga

- **"Outdated client"** — you are running v3 (npm) by mistake. Run the v4
  setup, check the bot log says `asked 26.3, using 26.3` and
  `native 26.3 fork: tick_end handled by physics loop`.
- **Kicked ~1.5s after joining: `invalid_player_movement`** — that was the v2/v3
  bug on npm Mineflayer. On v4 it should not happen; copy me the exact kick
  message and the bot log if it does.
- **"Already logged in" / kicked when you join as Segs on Mac** — same-name
  rule. Log out one of them.
- **Wrong password** — `/login` fails. Use the exact Segs password from your Mac.
- **Server says "Can't keep up"** — that is the server being overloaded, not
  the bot. On the local test VM it happened because the VM only had ~300MB free
  while running a whole server + bot. Your PC will be fine.

## Files

- `bot.js` — the whole bot (Segs brain, v3 chat + v4 native 26.3 wiring)
- `config.json` — your settings (private, gitignored, never commit)
- `config.example.json` — safe template, no real password
- `package.json` — bot deps + `file:../segs-26.3/mineflayer`
- `setup-26.3.sh` / `setup-26.3.bat` — one-command fork setup
- `link-prismarine.js` — fixes the npm plugin stack to use fork packages
- `TEST-REPORT-26.3.md` — exact test evidence for v4, with logs and SHAs
- `brain.json` — created when the bot runs, remembers home / farm / last task

Built for Tash, 2026-11-07, v4. Bot name Segs, owner OrewaSegs, server 26.3,
host youniga.deployd.sh:25565. No ViaVersion, no npm Mineflayer, free.
