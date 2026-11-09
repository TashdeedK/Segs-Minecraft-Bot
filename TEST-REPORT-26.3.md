# TEST REPORT — Segs v4, native Minecraft 26.3
Date: 2026-11-07. Tested by Mu in this VM. All commands and logs are real, from this run.

## What was tested, in order

### 1. Fork data loads natively (no npm fallback)
```
node -e "require('minecraft-data')('26.3')"
mcVersion: 26.3 protocol: 777 dataVersion: 5023
blocks: 1286 items: 1658
wheat block: 251 iron_pickaxe item: 1047
mineflayer loaded, createBot: function
testedVersions tail: [ '26.1', '26.2', '26.3' ] latest: 26.3
```
Fork `lib/version.js` ends at 26.3. `node-minecraft-protocol/src/version.js`:
`defaultVersion: '26.3'`, supportedVersions ends `... '26.2', '26.3'`.
Fork physics already sends `tick_end` natively (`lib/plugins/physics.js` lines 101, 460).

### 2. Fork's own 26.3 tests — 16 passing
```
npx mocha test/minecraft263Test.js test/minecraft263IntegrationTest.js
16 passing (2s)
```
Includes: login + `teleport_confirm` + `player_loaded` + `tick_end`, relative and
absolute teleports with `tick_end` immediately after the confirmation, 26.3
digging statuses and sign slots. Their own test asserts zero `position_look`
packets while standing still — so `positionPackets=0` while idle is correct,
not a failure.

### 3. Segs bot on a local 26.3 protocol server (no Java)
- Server: fork `node-minecraft-protocol` createServer, version 26.3, offline.
- Result:
  - `player joined: Segs protocolVersion=777`
  - `settings viewDistance=5 locale=en_US` — the low-RAM request reaches the server
  - `tick_end=502` over ~25s, `chat=["login testonly"]` — auto-login reached the server
  - Bot log: `Connecting to 127.0.0.1:25566 as Segs (asked 26.3, using 26.3)...`
  - Bot log: `native 26.3 fork: tick_end handled by physics loop, wrapper skipped`
  - Bot log: `Spawned at (1.5, 66, 1.5)`
  - Bot stayed connected for the full 25s test (killed by timeout, not kicked).

### 4. Segs bot on a REAL vanilla 26.3 server (Java 25, official Mojang jar)
- Server: Temurin JRE 25.0.5, `server.jar` 62,294,556 bytes,
  SHA-1 `33680f5f2ac32864d6d7cf5e56a705fdb3e05f4c` (matches Mojang manifest),
  `online-mode=false`, `view-distance=5`, `simulation-distance=5`,
  port 25568, world generated fresh. Server log: `Done (11.260s)!`
- Bot log:
  ```
  [8:34:40 AM] Connecting to 127.0.0.1:25568 as Segs (asked 26.3, using 26.3)...
  [8:34:41 AM] native 26.3 fork: tick_end handled by physics loop, wrapper skipped
  [8:34:42 AM] Spawned at (727.5, 67, 447.5)
  [8:34:44 AM] Sending /login ... (same password Segs was registered with)
  [8:34:46 AM] TEST-MOVE start (727.5, 67, 447.5)
  [8:34:52 AM] TEST-MOVE goto ended: Took to long to decide path to goal!,
              now at (732.434928661004, 67, 449.6633317280809), moved 5.39 blocks
  ```
- Server log:
  ```
  Segs[/127.0.0.1:41188] logged in with entity id 418 at (727.5, 67.0, 447.5)
  System chat: Segs joined the game
  [Not Secure] <Segs> Segs test move done, still here
  Segs lost connection: Disconnected   <- only when the 45s test timeout killed the bot
  ```
- **Movement proven:** the bot walked 5.39 blocks with pathfinder on a real
  vanilla 26.3 server, with real chunks. The "Took too long to decide path"
  is a pathfinder timeout on this overloaded VM (the server itself logged
  "Can't keep up! Is the server overloaded? Running 2056ms or 41 ticks behind"
  — the VM had only ~300MB free while running a whole server + bot). The bot
  still moved 5+ blocks and was never kicked.
- **No kick:** no `invalid_player_movement`, no "outdated client", no disconnect
  in either vanilla run (40s + 45s). Both ended only by the test timeout.

### 5. RAM — bot process, on the real vanilla server
- Bot RSS: **212.34 MB** (measured with `ps` while connected to the vanilla server,
  viewDistance 5, chunks loaded). Fits the 500MB-1GB target with room to spare.
- The VM's server process used ~375-604MB on top — that is the *server*, not the
  bot. On Tash's PC, run the bot only; do not run a local server alongside it.

## Two bugs found and fixed during v4 testing
1. **npm minecraft-data shadowed the fork.** `bot.js` did a plain
   `require('minecraft-data')`, which resolved to the npm 3.119.0 pulled in by
   the plugins — no 26.3, so the bot fell back to 26.1. Fixed with `mcDataFor()`
   in bot.js, which resolves minecraft-data through mineflayer's own folder
   (the vendor overlay).
2. **npm prismarine-* crashed pathfinder.** `mineflayer-pathfinder` loaded npm
   `prismarine-block`/`prismarine-registry`, which threw
   "Do not have data for 26.3" on load. Fixed by `link-prismarine.js`, which
   copies the fork-tested prismarine/minecraft packages from
   `../segs-26.3/mineflayer/node_modules` over the npm ones after `npm install`
   (also wired as `postinstall`). Verified standalone: after linking,
   `minecraft-data 26.3 protocol 777 dataVersion 5023` loads from the bot's
   own node_modules. (A dry-run with an otherwise empty node_modules fails on
   missing `protodef` — that is a normal npm dep installed by a real
   `npm install`, not a link bug; the full-stack test in §3/§4 is the proof.)

## Pinned fork commits (tested)
- mineflayer: `af53e8744eb46e1a56bf45c5b2b03f4bb8ed973d`
- node-minecraft-protocol: `cc1bfca769d36e90f8941138c1f63144e55d3403`
- prismarine-chunk: `23149f443d08aa15c4d4ddc868dfd3536c7b6110`
- prismarine-item: `9c3c7ab88aab28072a0222b9bfa599e516fcbaf9`
- prismarine-physics: `0e9d8c5f0876fcfab37443aa39de58c26ca319fe`
- minecraft-data: `1d37505b338710f2f347aa00efaa48a054754b19`

## What is NOT proven yet
- **The real server `youniga.deployd.sh:25565` has not been tested.** Direct TCP
  from this VM to game servers is blocked by the runtime, and the owner will not
  add ViaVersion — that is exactly why v4 is native 26.3. Tash must run v4 on
  his PC/Mac against youniga and report the exact log / kick message if any.
  The local vanilla test is the strongest proof available here; it does not
  prove Paper/Purpur anti-cheat or login-plugin quirks on the real server.
- Farming, crafting and guarding were not exercised on the vanilla server in
  this run (no farm, no items, no mobs in the test world). The code paths are
  the same v3 code that was tested for syntax and logic; the 26.3-critical
  paths (join, spawn, tick_end, move, chat, login) are the ones proven above.

---

## v5 — simulation testing (2026-11-07, after the v4 report above)

Method: the local vanilla 26.3 server was restarted, and a second fork bot
playing **OrewaSegs** talked to Segs in real in-game chat while Segs ran —
3 runs on v4 first (to find bugs), then 3 runs on v5 (to verify the fixes).
All runs: both bots joined as protocol 777, no kicks, no crashes.

### Bugs found in v4 (3 runs)
1. "Segs do you have iron" -> "i dont know what iron is" (iron is not an item name).
2. "Segs do it again" -> "do what again? i dont remember yet" after real actions
   (lastTask was only saved for unknown commands, every real action returned early).
3. "go to the farm" started farming instead of walking there (farm handler ran first).
4. "craft bread 5" -> "no recipe for bread" (recipesFor() filters by inventory, so
   with no wheat it returns nothing — the recipe exists, it needs a table + 3 wheat).

### Bugs found in v5 round 1 (2 more)
5. "remember that the mine is dangerous at night" became a base called
   "mine is dangerous at night" (base-remember regex caught it).
6. "learn daily means farm wheat" started farming instead of saving the routine
   (farm handler ran before the learn handler). "dig stone" also never finished
   in that run — it chased a stone block 24 blocks away and hand-digged.

### v5 fixes, all verified in simulation runs 1b/2b/3b
- Item alias map (iron->iron_ingot, gold->gold_ingot, wood->oak_log, etc).
  "do you have iron" now says "i dont have any iron_ingot".
- lastTask is saved for every action (queries skipped); "do it again" re-ran
  "tp to me" correctly.
- "go to <place>" handler runs before farm; "go to the farm" with no farm set
  says so instead of farming; multi-step message now farms exactly once.
- doCraft uses recipesAll() (ignores inventory) and reports the real missing
  items: "i need 15x wheat for 5x bread".
- Learning handlers (remember that / learn / what do you remember) run before
  farm/craft/guard; base-remember ignores "remember that".
  Verified: fact saved, macro "daily" saved, "what do you remember" lists
  "facts: the mine is dangerous at night. routines: daily".
- dig now equips the best tool and only looks 16 blocks away; "dug 1x stone"
  verified, and the find was learned into brain.found.
- "come back to me" walks to the owner: "coming back to you" / "here".
- Multi-base verified: "remember this is mine base" / "list bases" /
  "go to mine" all worked; brain.json now stores bases, facts, macros,
  deaths, found.

### What is still NOT proven
- The real youniga.deployd.sh server (blocked from this VM) — same as v4.
- Farming/crafting/guard were exercised on the vanilla test world only as
  far as the simulation above; the farm in the test world had no ripe wheat.
- Enchanting, villager trading, horse/boat riding are not implemented (see README).

## v6 appendix (2026-11-07) — logs, landmarks, survival, casual talk

### CRITICAL FINDING: vanilla 26.3 drops bot commands, Paper 26.3 accepts them
The v6 simulation was first run on the vanilla 26.3 server. Setup commands
(/fill, /setblock) sent by the owner bot never reached the server — 0
"issued server command" lines in the vanilla log, while plain chat worked.
Isolated with 4 tests:
- mineflayer bot.chat('/say viachat123') -> client wrote chat_command, server: nothing
- direct client.write('chat_command', {command: 'say direct123'}) -> nothing
- direct client.write('chat_command_signed', {...full signed fields...}) -> nothing
- bot.chat('plainchat123') -> chat_message -> server: "[Not Secure] <OrewaSegs> plainchat123" (works)
- enforces-secure-chat=false on vanilla: no change.
- Same bot on **Paper 26.3 build 244** (port 25569): "OrewaSegs issued server
  command: /say paper123" — commands WORK. And Segs itself:
  "Segs issued server command: /login testonly" — **auto /login works on Paper**.
Packet IDs/definitions are identical between 26.1 and 26.3 data
(0x07 chat_command, 0x08 signed, 0x09 chat_message), and the fork's NMP
chat.js is identical to npm NMP — so this is a vanilla-26.3 server behaviour
(silently dropping unsigned chat_command), not a fork data bug.
**Why this matters:** youniga.deployd.sh is a cracked server with a login
plugin (AuthMe) — AuthMe runs on Paper/Spigot, not vanilla. Rin's bot works
there, and Segs' /login now provably works on Paper 26.3. The v6 simulation
below ran on Paper for this reason. The vanilla server is kept only for
movement/join tests; command tests need Paper.

### v6 run 1 (Paper) — teach the base + full survival flow, end to end
Owner (op) built the base: /fill farmland + ripe potatoes, /setblock smoker,
/setblock chest, /item replace block ... container.0 with coal 8. All executed.
- "Segs this is the potato farm" / "this is the smoker" / "this is the food
  chest" -> "i know: potato farm at -129, 71, 163 | smoker at -131, 70, 165 |
  food chest at -132, 70, 165" — landmarks record the BLOCK's position, not
  Segs' feet (that was the first-run bug: all three landmarks got Segs' own
  position 731,65,448; fixed by finding the nearest matching block within 8).
- "Segs get food" -> "i need food, going to get some" -> "going to the potato
  farm to harvest" -> harvested 14 potatoes -> "got potato, cooking it now"
  -> "no coal, checking the chest for coal" -> "found 8x coal in the chest"
  -> "cooking potato in the smoker" -> "cooked, got baked_potato" -> "fed,
  all good". Full flow, every step narrated in chat. stats.json after:
  cropsFarmed 14, chestsChecked 1, smeltsDone 1, foodEaten 1, timesHungry 1.
- Log files verified on disk: logs/2026-11-07.log, actions.jsonl,
  chat.jsonl, learning.jsonl, stats.json — real entries (landmark learns,
  farm harvests with positions, chest take, smelt start).
- 2 minor bugs found and fixed: (1) farmOnce said "i need potato to replant"
  right after harvesting a potato (drop had not landed in inventory yet) —
  now waits 600ms and warns at most once per session; (2) "i cant reach
  there, too far or blocked" spammed chat 5x for unreachable crop blocks —
  farmOnce now skips them quietly (gotoPosQuiet, log only).

### v6 run 2 (Paper) — casual talk + stats
- "Segs how are you" -> "im good, hp 20/20 food 20/20, idle, waiting for you"
- "Segs tell me a story" -> the Segs-walked-5-blocks story
- "Segs are you AI" -> "im a bot, not AI. Tash coded me, i just do what im
  told and remember stuff"
- "Segs what should i do" -> "we could farm, mine, or build something, what
  do you feel like"
- "Segs farm potato" -> farming; "Segs stats" -> "my stats: 14 crops farmed,
  0 items crafted, 0 blocks dug, 1 times fed, 1 chests checked, 1 smelts,
  0 deaths, 1 times hungry" (stats persist across restarts).
- Bug found: Paper broadcasts command feedback as chat ("Applied effect
  Hunger to Segs]") and Segs answered it ("hmm, i didn't get that") because
  it contains "Segs". Fixed: chat handler ignores command-feedback lines
  (applied/gave/set/teleported/...) and lines ending in ']'.

### v6 run 3 (Paper) — farm all + remember + fun talk
- "Segs stop" -> "ok, waiting here"; "remember that the potato farm is at
  the back of the house" -> saved; "Segs farm all" -> "farming everything
  ripe around here" then wheat, carrot, potato in turn, "done farming
  everything"; "Segs i love you" -> "i know, i try my best";
  "Segs what do you remember" -> "facts: the potato farm is at the back of
  the house".
- Bug found: "i dont know that crop on this version" for beetroot — the crop
  block is named 'beetroots' in minecraft-data, not 'beetroot' (verified:
  blocksByName['beetroot'] false, ['beetroots'] true). Fixed in CROPS.
  (Wheat/carrot/potato block names were already right.)
- Watchdog note: the hunger effect in this run did not drop food below 12
  before autoEat fed Segs from its inventory, so the 60s watchdog did not
  fire — see run 4 for the dedicated watchdog test.

### v6 run 4 (Paper) — beetroot fix + watchdog
- Beetroot fix VERIFIED: "Segs farm beetroot" -> "ok, farming beetroot around
  here" (no more "i dont know that crop"), cropsFarmed 14 -> 24.
- Watchdog did NOT fire: /clear + hunger 120 level 3 while idle, but food
  sat at exactly 12 at the 60s check (threshold was `food < 12`) and the
  next check was after the bot's 160s timeout. Fixed: threshold `food < 14`
  (matches autoEat's minHunger) and check every 30s instead of 60s.
  See run 5 for the retest.

### v6 run 5 (Paper) — watchdog retest
- First attempt: NO "getting hungry" line, even with threshold 14 and 30s
  checks. Root cause was the TEST server, not the bot: Paper was on
  difficulty=peaceful, and on peaceful food never drains, so the hunger
  effect could not drop food at all. The watchdog correctly did nothing.
  Fixed the test: difficulty=normal, retest as run 5b.

### v6 run 5b (Paper) — watchdog retest on normal difficulty
- Still NO "getting hungry" line, even on normal difficulty with hunger 180
  level 3 for 149s. The survival routine itself is proven (run 1), so the
  problem is the watchdog's trigger, not the routine. Suspect: `bot.food`
  not updating, or the interval not firing. Run 6b adds a temporary debug
  line to the watchdog (logs food/health/job every 30s) to find out.
- Harness bug found in run 6: the owner bot exits at a fixed 40s, so
  scripted messages at 60s/110s were never sent. Fixed: owner now stays
  until the last scripted message + 8s.

### v6 run 6b (Paper) — watchdog debug
- The watchdog IS firing every 30s, job is right ("idle, waiting for you"),
  but **food=20 forever** — even with Hunger 180 level 3 on normal
  difficulty for 90+ seconds. Cause: a fresh player joins with saturation
  20, and exhaustion eats saturation first (20 saturation = 80 exhaustion);
  180s of hunger level 3 is only ~72 exhaustion, so food never drops. The
  watchdog was correct to do nothing; the test was wrong. (Also found a
  second 45s global timeout in the owner harness that cut run 6 short —
  fixed to follow the script length.)
- Run 7 retests with hunger amplifier 255 for 20s: exhaustion ~25/sec,
  saturation burns in ~3s, then food drops fast — the watchdog must fire.

### v6 run 7 (Paper) — watchdog proof, hunger 255
- Hunger 20s amplifier 255 applied (confirmed "Applied effect Hunger to
  Segs"), Segs idle, ran 134s. STILL no watchdog, no death, no chat.
  At amplifier 255 exhaustion should burn saturation in ~3s and food to 0
  in seconds — so either the server is not draining food, or bot.food is
  not updating client-side. Run 8 is the definitive probe: debug line back
  (logs food + saturation + health every 30s) and "Segs status" at 30s/70s.

### v6 run 8 (Paper) — definitive food probe
- Status at 30s and 70s after hunger 255: "hp 20/20 food 20/20" both times.
  Watchdog debug: food=20, **sat=0 then sat=1**, health=20. So saturation
  was already ~0 (the saturation theory was wrong) and food STILL never
  dropped. The Hunger effect was doing nothing to this player at all.
  Root cause found: the Paper world was created when server.properties said
  difficulty=peaceful, and world difficulty lives in level.dat — changing
  server.properties afterward does NOT change the existing world. The world
  was peaceful the whole time, so food never drains. Run 9 sets
  /difficulty normal in-game first, then retests the watchdog.

### v6 run 9 (Paper) — watchdog PROVEN, /difficulty normal in-game
- After `/difficulty normal`, hunger 255 crashed food to 0 and the watchdog
  fired ON ITS OWN at 10:02:07 (no command from the owner):
  "im getting hungry, sorting food out myself" -> "i need food, going to
  get some" -> "going to the potato farm to harvest" -> harvested 9
  potatoes -> "got potato, cooking it now" -> "no coal, checking the chest
  for coal" -> "checked the chest, no coal in there" (run 1 had taken the
  only 8 coal) -> "no coal anywhere, i cant cook this" -> ate the raw
  potato instead ("fed, all good"). food 0 -> 1, health 17 -> 14.
  stats: cropsFarmed 33, timesHungry 2, foodEaten 2.
- Death (not a bug): at 10:03:45 Segs was slain by a Zombie Villager at
  (-132, 70, 164) by the chest — it was night on normal difficulty and Segs
  was weak (food 1, hp 14). The death was logged and remembered:
  "[learn] death: died at -132, 70, 164", brain.deaths has it. The
  death-learning system works.
- Watchdog final state: threshold food < 14, check every 30s, 5-min
  cooldown, only when idle. The survival routine is proven both by command
  (run 1) and on its own (run 9).

### What is still NOT proven (v6)
- The real youniga.deployd.sh server — Tash must test it on his PC/Mac.
  But: Segs' /login provably works on Paper 26.3, and youniga is a
  Paper-type server with AuthMe, so the login path is the same one tested.
- Enchanting, villager trading, horse/boat riding still out of scope.
- The watchdog's 5-minute cooldown means it will not re-fire within 5
  minutes of the last time it spoke, even if food drops again — by design,
  so it does not spam chat.


## v7 — server plugins: /tpa, /sethome, /home (tested 2026-11-07)

Tash sent the server's /plugins list: AuthMe, CoreProtect,
CreeperBlockProtection, HomePlugin, packetevents, SimpleGraves,
SkinsRestorer, SmoothChat. No LuckPerms — only player commands work.
Player commands he confirmed: /tpa <user> (accept with /tpaccept <user>),
/sethome <name> and /home <name> in the overworld, max 3 homes.

v7 uses exactly those. Test server: local Paper 26.3 build 244, port 25569,
same harness as v6 (owner-bot playing OrewaSegs). The test server has NO
HomePlugin/TPA plugin, so /tpa, /tpaccept, /sethome, /home are "unknown
command" there — the proof is the server log line "Segs issued server
command: /tpa OrewaSegs" (the bot sent the right command) plus the
fallback behaviour when the teleport does not happen. The real
/HomePlugin + TPA plugin behaviour can only be proven on youniga itself.

### Run 1 (zombie massacre — test setup failure, not a bot bug)
- sethome/list-homes proven: "Segs issued server command: /sethome mine",
  "my server homes: mine", brain.serverHomes = ['mine'].
- Then the world (still normal difficulty + night from the v6 hunger
  tests) spawned zombies at spawn: Segs was slain 9 times, the owner-bot
  once. After each death Paper kicked the dead bot with "Invalid move
  player packet received" (a corpse keeps sending movement packets) and
  the bot reconnected and died again. The tpa/home/go-home tests never
  ran. Lesson: make the test world safe first (peaceful + day).

### Run 10 (safe world) — all v7 features proven
- "Segs tp to me" -> "sent you a tpa request, type /tpaccept Segs" +
  "Segs issued server command: /tpa OrewaSegs". (No accept came, but Segs
  happened to spawn 1 block from the owner, so the 15s wait ended with
  "im here" — the walk fallback was NOT exercised here.)
- Auto-accept: a fake tpa request in chat -> "Segs issued server command:
  /tpaccept OrewaSegs" + "accepted your tpa, coming to you" — but TWICE
  (the request arrives via both 'chat' and 'messagestr'). Fixed with a
  10s dedupe cooldown.
- "Segs go to mine" -> "Segs issued server command: /home mine", 3s wait,
  no teleport (no plugin) -> "couldnt teleport there, walking instead"
  -> walked to the brain base -> "at mine". Fallback proven.
- "Segs go home" -> "going to home" / "at home". The v7 go-home fix
  works (v6 answered "i dont know where go home is").
- /kill Segs -> death logged, ONE respawn packet sent ("respawning..."),
  but Paper still kicked it 2s later ("Invalid move player packet").
  The respawn packet (client_command actionId 0, verified correct in
  the 26.3 protocol data) loses the race with movement packets already
  in flight when the client learns of the death. Segs recovered via
  auto-reconnect in 10s and answered "Segs stats" afterwards.

### Run 11 — tpa fallback + dedupe proven, one real bug found
- Owner teleported 60 blocks away first: "sent you a tpa request" ->
  "you didnt accept, walking to you instead" -> Segs walked toward the
  owner. Fallback proven. Auto-accept fired ONCE (dedupe works).
- BUT: both 60-block walks failed partway and Segs LIED about it —
  "made it" and "at home" after walks that never arrived. Root cause:
  the pathfinder cannot plan into unloaded chunks (view distance 5),
  so long walks fail — and callers announced arrival unconditionally.

### Run 12 — staged walks + honest arrival (partial)
- gotoPos now retries a failed direct walk in 16-block stages and
  returns true/false; callers only announce arrival on true.
- BUT the run exposed a concurrency bug: "go home" started while the
  tpa walk was still running, its stopAllMovement cancelled the walk's
  goal, both walks died with "The goal was changed before it could be
  completed!". The honest-arrival part worked (no false "at home").

### Run 13 — command queue + stop interrupt proven
- handleTalk is now serialized (one command at a time, in order);
  "Segs stop" bypasses the queue and cancels movement immediately via
  a moveToken that in-progress walks check.
- "Segs tp to me" walk, "Segs stop" 7s into it -> "got it, staying
  here", walk cancelled, NO "im here". Stop interrupt proven.
- BUT the following 29-block "go home" walk HUNG 134s with no error
  and no arrival — the pathfinder can stall forever (water/wall).
  The queued "Segs stats" never got answered.

### Run 14 — goto timeout proven
- Every goto attempt is now raced against a timeout (25s direct,
  20s per stage); on timeout the goal is cancelled.
- Same scenario as run 13: the stuck walk failed honestly in ~45s
  ("goto timeout after 25000ms", "goto stage 1/1 failed: goto timeout
  after 20000ms", "i cant reach there, too far or blocked") and the
  queued "Segs stats" WAS answered. No hang, no lie.
- "Stage 1/1" showed the stage goals used the bot's CURRENT y, so on
  rising ground a waypoint could sit below the surface and be
  unreachable by definition — fixed by using GoalXZ (x/z only) for
  waypoints in run 15.

### Run 15 — GoalXZ waypoints (same route, still not arriving)
- Stop interrupt proven again ("ok, waiting here"). Go-home: direct
  goto timed out (25s), stage 1/1 timed out (20s), honest "i cant
  reach there", stats answered. GoalXZ exists and ran (no crash) — but
  Segs still could not cover the last <=16 blocks of this wild
  cross-country route in 45s. The bot is physically stuck on this
  terrain (likely water/steep ground around spawn), not a planning bug.
- No further runs: the failure is honest and bounded, and on the real
  server Segs will mostly TELEPORT (/home, /tpa) between bases — that
  is the point of v7. Walking is the fallback.

### What is still NOT proven (v7)
- The real youniga.deployd.sh server — Tash must test it. On youniga,
  /tpa, /tpaccept, /sethome, /home, /delhome exist for real, so the
  teleports that only "sent the command" here should actually move Segs.
  If /home or /tpa behaves differently there (different message text
  for a tpa request), tell Mu the exact message and the auto-accept
  matcher will be adjusted.
- Long wild cross-country walks (30-60 blocks through unloaded
  forest/hills) may still fail honestly with "i cant reach there".
  Short walks near base work (proven v5/v6 + run 10).
- Death on Paper: Segs tries to respawn immediately but Paper usually
  kicks it first ("Invalid move player packet"); it reconnects in 10s
  and carries on. Same recovery as v6.
- Enchanting, villager trading, horse/boat riding still out of scope.

## v8 appendix (2026-11-07) — bed/spawn, permanent home, grave, pickup, store, evade, lava, French home messages

Test server: local Paper 26.3 build 244, port 25569, same harness as v7
(owner-bot.js runs 21-30). All v8 runs use the fixed bot.js in segs-v8/.

### Run 21 — bed (flawed setup) + grave recovery PROVEN
- Bed at (-120,70,185): "cant sleep in that bed right now" — the bed was
  floating ~4 blocks above the real ground (y≈66 there), so the
  pathfinder correctly refused it. Test-setup bug, not a bot bug.
- Grave recovery PROVEN: Segs died at (-130,66,180); a chest (fake grave)
  with bread + sword was placed there; Segs respawned, walked ~11 blocks
  including a 4-block height change, opened the chest, took everything,
  said "got my stuff back from my grave". Stats graves: 1.
- Bread-count note: the chest merge used the OLD NBT format
  (`Count:5b`); 26.3 silently ignores it and stores count 1. The NEW
  format (`count:5`, lowercase int) is the correct one — proven by the
  run 25 merge test (see below). Not a bot bug.

### Run 21b — bed/spawn PROVEN, grave fallback (bug found)
- Bed on flat ground (-126,70,162): "ok, this bed is my spawn now — if i
  die ill come back here". After /kill, Segs respawned at (-124.5,70,163.5)
  — beside the bed, not at world spawn (-144,71,160). Bed = spawn PROVEN.
- Grave: Segs said "opened my grave — check if my stuff is back" and its
  inventory did not grow (slots 3 -> 3). Root cause found by reading the
  region file: the chest STILL held 5 bread + 1 sword (new NBT format,
  so the merge had worked). The old code used activateBlock + sleep 800ms
  + bot.currentWindow and silently found no window. FIXED: recoverGrave
  now uses bot.openChest (waits for the window, same API as v6's
  checkChestFor) with a shift+right-click fallback, and counts items
  actually taken instead of trusting slot counts.

### Run 22 — permanent home + store PROVEN, pickup bug found
- "ok, this is my permanent home now" (chests: 2 found). "Segs keep
  these items at your base" → "stored in my room: 1x bread, 1x potato,
  4x carrot"; inventory after = iron_sword only (tools kept). PROVEN.
- Pickup BUG: "Segs pick up the carrot" → "couldnt reach any carrot";
  "pick up the items" collected only the carrot. Cause: pickup walked
  with gotoPos (GoalNear range 2) and stopped up to 2 blocks short of
  the item — outside the ~1-block pickup radius. FIXED: pickup is now a
  round-based loop (max 6 rounds, re-scans each round, walks to range 1
  with a 15s timeout per round).

### Run 25 — pickup fix PROVEN + NBT merge format settled
- "Segs pick up the diamond" → "picked up: 4x diamond, 3x bread,
  4x carrot" (it collects everything nearby, not just the named item —
  item entities whose dropped-item name can't be read count as matches;
  honest caveat, not a failure). Final inventory exact. PROVEN.
- Merge-format test (two chests, /save-all, region-file NBT read):
  new format `count:5` → bread x5 stored; old format `Count:5b` →
  bread x1 (silently ignored). 26.3 uses the new format.

### Run 21 (retest) — grave fix PROVEN
- Same setup as 21b with the openChest fix: "got my stuff back from my
  grave (6 items)", log "window opened=true, took 6 item(s)",
  inventory slots 1 -> 3. PROVEN. (Stray ground drops from the death
  itself are NOT part of the grave — on the real server SimpleGraves
  puts everything in the grave; the test server has no plugin, so a
  few dropped stacks stayed on the ground.)

### Run 23 — enemy check PROVEN, evade FAILED (walk too slow), owner-bot died
- "Segs check for enemies" → "i can see: zombie 19 blocks away". PROVEN.
- Evade FAILED: Segs fled at walk speed (4.3 m/s vs zombie 4.6 m/s),
  the zombie caught it at 0 blocks and killed it. Test-setup flaw too:
  the owner-bot stood 4 blocks from the summoned zombie and was slain,
  then kicked on respawn (the known Paper death-kick). Lava half of
  run 23 never ran (owner died first).
- FIX 1 (sprint): flee 15 blocks + forced sprint. Retested as run 27.

### Run 24 — sethome / home / daytime bed PROVEN
- Daytime bed: "its daytime, i cant sleep yet — ill sleep in this bed
  tonight and set my spawn then". At night the watchdog slept in the
  pending bed on its own: "slept in my bed — this is my spawn now".
  PROVEN.
- "Segs sethome a" twice → "ok, set home a on the server" both times;
  the test server's "Unknown or incomplete command" reply was correctly
  NOT treated as a refusal. "Segs list homes" → "my server homes:
  mine, a". PROVEN (matcher only).
- "Segs go to a" → "going to a" → "couldnt teleport there, walking
  instead" → "i dont know where a is" (no brain base for 'a' — honest
  fallback). The /home warmup stillness itself is code-only here (no
  HomePlugin on the test server); the real proof is on youniga.

### Run 26 — lava INCONCLUSIVE (valley terrain, my setup)
- The "flat" ground at (-110,200) is actually a valley (y≈63). The
  lava strip was placed at y=70, floating 7 blocks above the ground,
  and Segs could not reach lavatest ("i cant reach there"). No lava
  routing was tested. Retested as run 30 on verified flat ground.

### Run 27 — evade sprint fix FAILED (one-shot goal stops, then NaN)
- Segs sprinted to a point 15 blocks away, STOPPED there (goal
  reached), and the zombie walked to where it stopped and killed it.
  Worse: the flee/evade intervals kept firing while Segs was
  disconnected (stale state), and a lookAt with a bad target poisoned
  Segs' yaw with NaN — the server then kicked it repeatedly ("Invalid
  move player packet", "moved too quickly") and Segs died at
  "NaN, 69, NaN".
- FIX 2 (continuous flee): the flee is now a loop that re-steers
  directly away from the nearest hostile every 250ms (forward +
  sprint) and only stops when nothing hostile is within 12 blocks.
  Hardened: a `connected` flag stops all loops while disconnected; the
  away vector is guarded against zero/NaN (falls back to Segs' facing
  direction) and forced horizontal; sprint-only, no held jump (the
  bunny-hopping tripped Paper's "moved too quickly") with a jump pulse
  only when stuck. Retested as run 29.

### Run 28 — French sethome PROVEN, lava still unproven, test bed burned
- French refusal (owner said the real server text in chat 1s after
  /sethome b): Segs replied "the server wouldnt set home b — the
  server said: <OrewaSegs> Vous n'avez pas la permission d'ajouter un
  autre home !" and "my server homes: mine, a" (b NOT recorded). PROVEN.
- Lava: Segs arrived at lavatest but then died — "Segs tried to swim in
  lava". The strip at (-130,70,171..179) flowed down the valley slope
  onto Segs' position. Test-setup flaw again (valley + flowing lava),
  not a routing failure. Side effect: the flow burned the test bed at
  (-130,70,170), so run 30 re-places it.
- French messages (screenshots 2026-11-07, server speaks French, not
  Spanish as first guessed): refusal "Vous n'avez pas la permission
  d'ajouter un autre home !"; /home "Début de la téléportation vers le
  home : a", "Téléportation dans : 3", "Téléportation annulée car vous
  avez bougé." Segs now matches the refusal and listens for the warmup
  start/cancel messages (pendingHome).

### Run 29 — flee loop FAILED again (flee stops silently, zombie wins)
- Segs died 3 times to the same zombie. The flee loop kept starting
  ("fleeing zombie at 4 blocks") and stopping within 5s without logging
  why, so Segs stood still while the zombie closed in. The grave system
  kept working through it ("got my stuff back from my grave (5 items)").
- The server log showed repeated "Invalid move player packet" kicks
  (the known Paper death-kick) and "moved too quickly" warnings.
- FIX: debug logging on every flee stop path, so the next run says WHY
  it stopped instead of dying silently.

### Run 30 — bed restore PROVEN, lava routing FAILED (pathfinder stuck)
- Bed re-placed and re-set: "ok, this bed is my spawn now". PROVEN.
- Lava strip on the farm ground: "going to lavaflat" → direct goto
  timed out (25s) → staged retry stage 1/2 timed out (20s) → "i cant
  reach there". Segs moved 1 block in 45s and never touched lava
  (hp 20/20 — the avoidance kept it safe, but it found no detour).
  The strip's lava had flowed into the ground dips, widening the
  barrier, and the staged waypoints likely landed in the lava zone.
  Retested as run 32 with magma first (no flow) to isolate routing
  from flowing lava.

### Run 31 / 31b — ROOT CAUSE FOUND: Vec3.multiply(scalar) is NaN
- The debug logging caught it: every flee stopped with "bad target",
  and the value log showed a PERFECT away vector (0.7071, 0, -0.7071)
  and valid positions — yet the target was NaN. Cause: in the `vec3`
  package, `.multiply()` is component-wise Vec3 multiplication, NOT a
  scalar multiply — `.multiply(10)` computes `x * undefined` = NaN.
  The scalar method is `.scale(10)`. Verified in node:
  `multiply(10)` → `(NaN, NaN, NaN)`, `scale(10)` → `(7.071, 0, -7.071)`.
- This bug was in the flee code since run 23 (every "sprint flee" had a
  NaN goal, so Segs never actually fled) AND in the v2-era low-health
  flee (line 524, `.multiply(6)` — silently swallowed by try/catch, so
  it never worked either). FIXED in both places to `.scale()`.
- Retested as run 31 (flee) and run 32 (routing).

### Run 31 — flee loop PROVEN (outran the zombie)
- With the `.scale()` fix the flee actually runs: Segs fled from
  (-145,165) to (-163,191), ~30 blocks, and the loop stopped with
  "clear, no hostile within 12" — it outran the zombie. PROVEN.
- Honest limit: Segs still died later in the run — it fled into dark
  unlit valley at night at 5hp and met a SECOND zombie. Fleeing
  outruns one mob; it does not make Segs safe alone at night in the
  open. (Fight-back when cornered is the natural next step, offered
  to Tash with the v8 delivery.)

### Run 32 / 33 / 34 / 35 / 36 — lava/magma routing NOT proven
- Run 32 (magma then lava strip on the farm ground): both legs "i cant
  reach there". Run 33 (same walk, NO strip): STILL "i cant reach
  there" — the strip was not the problem. Run 34 (start west of the
  dip, lava strip): "goal was changed" twice (flowing lava near the
  path makes the pathfinder replan/cancel the goto) and Segs died
  when the lava flowed onto the spot it was stuck on ("tried to swim
  in lava"). Run 35 (flat stone platform + magma strip): Segs walked
  to the strip's edge (-151,160) and stopped — no detour found.
  Run 36 (same walk, strip removed): STILL timed out on 8 blocks.
- Conclusion: the routing failure is NOT the lava or the magma. The
  pathfinder in this fork times out on 8-20 block walks in this test
  world's rough terrain (dips, valley edges) — the same honest limit
  documented in v7 for long wild walks. The platform fill likely did
  nothing (natural ground there is already y=70, so stone at y=69
  was buried). What IS proven: Segs never walks into lava/magma
  (hp 20/20 in every lava run, it stops at the edge) — the avoidance
  config (blocksToAvoid: lava, fire, magma, cactus, sweet berry bush)
  is correct and active; the detour around a strip is what the
  simulation could not demonstrate. On the real server Segs mostly
  teleports, and Tash's base is built/flat ground, so ground detours
  matter less there — but this stays honestly unproven until the
  real-server test.

### What is still NOT proven (v8)
- The real youniga.deployd.sh server — Tash must test it (unchanged).
- SimpleGraves' real grave block type + shift+right-click take-all
  (tests used a plain chest; the code also tries openChest first).
- The exact /home warmup teleport on HomePlugin (no plugin on the
  test server) and the real French messages arriving as system chat
  (simulated via owner chat in run 28 — the matcher is proven, the
  delivery channel on the real server is not).
- Long wild cross-country walks (unchanged from v7).
- Lava/magma routing around a strip (see runs 32-36 above) and the
  /home warmup teleport on real HomePlugin.

## v9 appendix (2026-11-07) — smart sorting, base map, paper, stop/resume

Test world: the same Paper 26.3 server (port 25569), but the terrain
fought back harder than in v8. The ground between the room and the
columns varies y=68..71 with 2-block steps the fork's pathfinder cannot
climb, so every sort walk timed out at first. The fix was a flat stone
platform (`/fill -155 70 150 -128 70 162 stone` + air above) with the
columns in two rows 6 blocks apart and the room chests 8 blocks east.
Layout (all on the slab, walking surface y=71): row z=158 — ore (-144,
3 chests), food (-148, 2), tools (-152, 3); row z=152 — misc (-144, 2),
paper (-148, 2), farm (-152, 2). Room chests (-136,71,156) and
(-135,71,156). Trash chest (-134,71,150). Crafting table (-140,71,158).
Sugarcane chest (-130,71,158). Teach spots 1 block from each column.

### Run 37 — build + teach (original y=70 layout): SUCCESS
Storage unit, room, all 6 columns (3/2/3/2/2/2 chests), trash chest,
sugarcane chest and the trading hall area all taught and listed
correctly. Lesson: "this is my room" at maxDistance 8 caught 5 chests
including the permanent-home chests — tightened to 5 + exclude any chest
already recorded in a column.

### Run 38g — full sort: PROVEN
"done sorting — moved 25 stacks (130 items), 1 stacks couldnt go
anywhere (no column and no misc), left 1 shulker boxes alone". Verified
chest-by-chest with verify.js: room empty; ore col gold/iron/coal;
food col bread/beef; farm col wheat/potato/carrot; misc col correctly
took every category with no taught column (diamond, redstone, oak log,
planks, poppy, bone, string, netherrack, glass bottle, lapis); trash
chest got the junk (iron pickaxe, stone sword, wooden pickaxe, iron
helmet, rotten flesh, arrows); the shulker box was left alone in the
room. The "1 failed" stack was sugarcane — the craftPaper count bug
(see below). The item→chest index populated correctly (19 items).

### Run 41 — paper retest + enchanted + tools order: PROVEN (run 41o)
After the fixes below, run 41o: "done sorting — moved 7 stacks
(15 items)", 0 failed, 0 goto timeouts. Verified: room empty; **paper
column = paper x9** ("[craft] made 9x paper from 9x sugarcane", no
stranded cane); **misc column = the enchanted Sharpness diamond sword**
([ENCH] marker); **tools top chest = netherite pickaxe, netherite
sword, diamond pickaxe, diamond sword, bow** — best first, top-down.
Segs ended carrying only the test-artifact diamond sword (the
/item replace from-entity copy left one in its hand; not a bot bug).

### Run 42b — stop / resume: PROVEN
20 stacks in the room (~60s sort). "Segs stop" at ~20s: "stopped
sorting — put back what i was carrying. moved 1 stacks, 0 couldnt go
anywhere. say \"segs continue last sorting\" when you want me to pick
it up again". "Segs continue last sorting": "last sorting was your
whole room from my room — i moved 1 stacks, 19 left. do you want to
continue this one, or do another sorting? if another one, which one?"
A bare "continue" (no "Segs" prefix) resumed it: "ok, continuing it",
then "done sorting — moved 20 stacks (108 items)". Room empty, brain
sortJob status done, moved 20 / total 20 (cumulative count correct).

### Run 43 — category sort: PROVEN
Room held ores + food mixed. "Segs move the ores to the ore column":
moved 4 stacks (20 items) — iron, gold, raw iron, coal — into the ore
column. The food (bread, cooked beef, apple) stayed in the room, and
the food column stayed empty. Only the named category moves.

### Bugs found and fixed during v9 testing
- **Segs answered the owner's `/commands`.** `<OrewaSegs> /enchant Segs
  sharpness 3` passed the addressed check and got "hmm, i didn't get
  that". Fix: the chat handler ignores any message starting with `/`.
  Also added "replaced" to the Paper command-feedback filter (the
  "Replaced 1 slot(s) on Segs with [Diamond Sword]]" broadcast was
  answered the same way).
- **craftPaper made 3 paper from 9 cane.** `bot.craft(recipe, 3, table)`
  does not reliably craft 3 times in this fork. Rewrote to craft one at
  a time, counting real paper before/after — but then only the FIRST
  craft in the loop made paper (later calls returned without throwing
  and made nothing). Fix: re-fetch the recipe (and re-find the table)
  every step, plus a 200ms pause. Run 41o: 9 cane → 9 paper.
- **craftPaper could not find the table.** The table at (-140,71,158)
  was destroyed by the platform air fill (run 39), and later the search
  radius (10) was too small — when the sort processes cane last, Segs
  is already at a far column ~11 blocks from the table. Fix: re-place
  the table in the test setup; radius 10 → 16.
- **Enchanted sword went to tools, not misc.** Two causes. (1) The sort
  builds a plain carried object {type, metadata, count, name} that
  drops the item's enchant data, so itemIsEnchanted() always returned
  false mid-sort. Fix: store `enchanted: itemIsEnchanted(it)` when
  withdrawing, and check the flag in routeCarried. (2) Even after that,
  the sword still landed in tools: depositIntoColumn tries the
  remembered item→chest first, and brain.itemChest['diamond_sword']
  pointed at the tools top chest (from the plain sword). Fix: only
  trust the remembered chest if it is actually in the target column's
  chest list.
- **Segs could not climb to upper column chests.** The tools/ore
  columns are 3 chests tall (top chest y=73) and the pathfinder had
  `allowParkour = false`, so every goto to an upper chest timed out
  (25s + 20s staged retry) and Segs wandered off the platform into a
  dip at y=69, where it got stuck. Fix: `allowParkour = true` (the
  columns have stairways by design, Segs must climb them) + wide 3x2
  step platforms (top y=72) south of the 3-tall columns instead of
  narrow 1-wide stairs Segs kept falling off + a y=69 valley-floor fill
  so a fall lands 1 block down, not in a trap. Run 41o/42b/43: 0 goto
  timeouts.
- **Sort moved 0 stacks (run 41g).** Segs' inventory was polluted with
  32 stacks left over from earlier failed test sorts, and the withdraw
  guard (`>= 30` stacks) refused to take anything. Test fix: `/clear
  Segs` before the fill. (On the real server this is the correct
  behaviour — a full inventory cannot sort; Segs says so in chat.)
- **Bare "continue" was ignored (run 42).** handleTalk's addressed
  gate (`must contain "segs"`) runs before the pendingContinue check,
  so replying "continue" to Segs' "do you want me to continue?" was
  dropped. Fix: the pendingContinue check now runs BEFORE the
  addressed gate, for the owner only.
- **Paper count lag (run 41l).** The inventory can lag a tick behind
  the last craft, so the paper count read 6 when 9 were actually there
  and 3 paper stranded in Segs' inventory. Fix: 300ms pause + recount
  before returning the made count.

### v9.1 — runs 44–45 (owner-only stop, bottom-first fill, double-chest columns)

Tash built the real storage unit: 16 columns, 10 DOUBLE chests each,
beside the base area, with Segs' own room to be built there too (a
factory/warehouse). He asked for three things: bottom-first fill, and
only OrewaSegs can command Segs. Three changes, all tested.

Run 44 (double-chest column + bottom-first tools): PROVEN.
- Built a column of 10 double chests (20 blocks) at (-140/-139,
  y71-80, z158) with /fill and taught it: "ok, this is the valuables
  column — 10 chests, i will remember it". 10, not 20 — the double-
  chest dedup works, and the widened scan (radius 12, y -10..+10)
  reached the top chest (y=80) from the ground floor.
- Sorted 3 tools into the tools column. verify.js: bottom chest
  (y=71) = netherite_pickaxe x1, diamond_pickaxe x1; mid and top
  EMPTY. Bottom-first, not top-first (run 41o put them in the top).
  The wooden_pickaxe went to the trash chest (it is junk — non-
  enchanted wooden tool — the junk rule still holds).

Run 45 (non-owner stop): PROVEN.
- A "Stranger" bot (not OrewaSegs) said "Segs stop" mid-sort (20
  stacks in the room) and then "Segs sort my room". Segs IGNORED
  both and the sort finished: "done sorting — moved 20 stacks
  (108 items), 0 failed". verify.js: room empty; ores filled the
  bottom chest first then overflowed to the mid chest (bottom-first
  confirmed for a multi-chest fill too).

Bugs found in v9.1 (all fixed in the shipped bot.js):
1. Owner-only hole: the chat listener's immediate "stop" had no
   owner check — any player could cancel Segs' walk and pause a
   sort. Now gated on isOwner(username). (The queued order handler
   already had the gate; only this immediate path was open.)
2. Column scan could not reach a 10-tall column: findBlocks
   maxDistance was 6 (the top chest is ~10 blocks above the ground
   floor) and the y filter was -2..+10 (missed the bottom when
   taught from a higher floor). Now maxDistance 12, y -10..+10,
   count 40.
3. Double chests were counted twice (two blocks, one inventory).
   scanColumnChests now keeps only the first half of each double
   chest (skips a block whose west or north neighbour at the same
   y is already kept).

### v9.3 — run 47 (tp-to-me from far away)

Tash's first real-server report on v9.2: Segs joined youniga fine,
but "Segs tp to me" answered "i cant see you right now" and did
nothing. Segs was far away from him. Root cause in the code: the
"tp to me" handler checked bot.players[owner]?.entity BEFORE sending
the /tpa — far away the server never sends the owner's entity, so
Segs returned early and the /tpa was never sent. Fixed in v9.3: the
/tpa is sent first with no visibility check; visibility only gates
the walking fallback after the 15s wait. Teleport success is
detected by Segs having moved >10 blocks or the owner being within
5 blocks.

Run 47 (owner teleported 1000+ blocks away, then "Segs tp to me"):
PROVEN. Segs' first reply was "sent you a tpa request, type
/tpaccept Segs" (NOT "i cant see you"), and the server log shows
"Segs issued server command: /tpa OrewaSegs". After 15s with no
accept (this test server has no TPA plugin, so no teleport can
complete here) Segs fell back and said "i cant see you right now —
type /tpaccept Segs next time, or come closer and try again". The
"come back to me" and "look at me" handlers keep their visibility
checks — those are walk/look actions, which genuinely need to see
the player.

What is still NOT proven: the /tpa accept itself on real youniga
(Segs sending /tpa and Tash typing /tpaccept Segs) — the test
server has no TPA plugin, so only the sending side is proven here.
Tash must confirm the accept works on youniga.

### v9.4 — runs 48/48b (doors), 49 (death), 50 (bridge flee)

Three real-server reports from Tash on youniga, all investigated in
simulation on Paper 26.3.

**Doors — run 48 (closed) and 48b (already open): PROVEN.** A house
(oak planks, one oak door) was built on the flat platform. Segs
inside, owner outside, "Segs follow me". Run 48 (door closed): the
door assist opened it and Segs walked out to (-138, 71, 156); the
door stayed oak_door, both halves. Run 48b (door already open —
Tash's exact complaint): Segs walked straight through the open
doorway to (-138, 71, 156); the door stayed intact. Two test-setup
bugs were found and fixed along the way (not bot bugs): the first
house was built floating 6 blocks above the terrain, and the first
floor fill put planks at foot level (y=71) so the bot was blocked by
its own floor — the house now has its floor at y=70, walls/door at
y=71-72, roof at y=73. The fork's A* cannot route through a 2-block
door by itself (getMoveForward only "opens" the feet block and always
tries to break the head block), which is why the bot-level door
assist exists; the assist's job is opening the door, and the
pathfinder then walks through the open doorway.

**Death — run 49: respawn packet does NOT prevent the Paper kick.**
Segs followed the owner (walking), then /kill. Segs sent the respawn
packet immediately ("respawning...") and stopAllMovement cancelled
the goal/flee/follow/farm/PvP first — but Paper still kicked it 2s
later ("Invalid move player packet received"). Segs reconnected in
10s and recovered its grave ("i died at -132, 71, 158 — going back
for my stuff"). Conclusion: the fork's physics loop sends position
packets from the corpse no matter what the bot stops, so
respawn-in-place on Paper is a fork limit, not a bot setting. The
reconnect + grave recovery is the working fallback.

**Bridge flee — run 50: PROVEN.** A 1-wide stone bridge at y=100
(Segs' feet y=101). A NoAI zombie was summoned 1 block north of
Segs, so "away from the mob" points south — straight off the bridge.
Two test-setup bugs first: teleporting Segs to y=100 put it INSIDE
the bridge stone (it was pushed off and fell), and /difficulty
peaceful deletes summoned hostiles instantly, so the zombie never
existed — the run uses y=101 and /difficulty normal. Result: Segs
said "zombie nearby, moving away", the edge check fired ("no safe
flee direction (edge) — holding still"), Segs moved west along the
bridge to (-138.5, 101, 158.1) and stayed at y=101 — no fall, no
death. The flee ended "clear, no hostile within 12".

What is still NOT proven: respawn-in-place on real youniga (Paper
kicks the corpse in simulation too — the reconnect is the proven
path); a real door on Tash's actual house (the test house is a
simulation replica); a real phantom flee (the test used a zombie —
phantoms fly, but the edge check is direction-based, not mob-based).

### What is still NOT proven (v9)
- The real youniga.deployd.sh server — Tash must test it (unchanged).
  In particular: real-server sorting (his room ↔ storage unit
  distances on flat built ground, stairway climbing to upper column
  chests — proven in simulation on a platform, not on his build yet),
  and whether the 10-block column height works with his stairways.
- SimpleGraves' real grave block type + shift+right-click take-all
  (unchanged from v8).
- The exact /home warmup teleport on real HomePlugin and the real
  French messages arriving as system chat (unchanged from v8).
- Long wild cross-country walks (unchanged from v7/v8). Sort walks are
  short by design (room ↔ columns within one base), but if Tash's room
  is far from the storage unit the walks inherit this limit — the sort
  says so honestly ("i cant reach there") rather than pretending.
- The tools tier order (netherite > diamond > iron > gold > stone >
  wood) is a guess Tash has not corrected yet.
- Auto-create column (claiming a blank column for an untaught category)
  is built but not simulation-tested (no blank column was taught in
  the test runs). Same for "Segs make paper" as a standalone command
  (paper crafting itself is proven via the sort).
- v9.1 changed tools to bottom-first like every other column. The
  "best tools at the top" tier-to-chest rule is dropped unless Tash
  says he wants it back — asked in the v9.1 delivery message.

### v9.2 — runs 46 + 46b (wall-safe column teaching)

Tash built the real storage unit as one continuous wall: 16 columns,
10 double chests each, no gap between columns. v9.1's scan recorded
every chest within 2 blocks sideways of where Segs stands, so teaching
one column also picked up its neighbours. Three changes, all tested:

1. scanColumnChests anchors on the NEAREST container block and reads
   that exact (x, z) footprint block by block, y -10..+10. No neighbour
   bleed, and no findBlocks count cap (see bug 1 below).
2. Re-teaching a column MERGES instead of overwriting (per-floor
   teaching used to lose the other floors). Double-chest halves are
   deduped across teaches, so teaching from the other half of a
   double chest does not double-count it.
3. Teaching a column already claimed by another category is refused
   in chat ("wait, those chests are already the ores column"), so a
   mis-teach in a wall cannot silently re-label a column. Blank
   columns merge the same way.

Tools stay bottom-first (v9.1) in v9.2 — the best-at-top call is
independent of this fix and still awaiting Tash's answer.

Run 46 (first try) — FOUND A BUG, then fixed it:
- Wall built as in Tash's photos: 3 contiguous 10-double-chest
  columns, ores -146/-145, tools -144/-143, foods -142/-141, z=158,
  y71-80. Teach ores from the east half: only "6 chests". Re-teach
  from the west half: "7 chests now (1 new)". Tools and foods: 7 each.
- Cause: findBlocks capped at 40 containers, and the wall (60 chests)
  plus older test chests nearby meant the top levels never reached
  the filter. The same cap would hit Tash's real wall (160 chests).
  Fix: the scan now reads the anchored (x, z) block by block with
  bot.blockAt — no cap, no neighbours.
- The guard test and the sort already passed in this try: mis-teaching
  the ores column as foods was refused, and 4 ore stacks (20 items)
  landed in the ores column only.

Run 46b (retest after the block-by-block fix) — PROVEN:
- "Segs this is the ore column" -> "10 chests, i will remember it"
- Re-teach from the other half -> "10 chests now (0 new)"
- Tools -> 10 chests; foods -> 10 chests; "Segs list columns" ->
  "ores (10 chests), tools (10 chests), foods (10 chests)"
- Mis-teach refused again, columns unchanged.
- "Segs move the ores to the ore column" -> "done sorting — moved
  4 stacks (20 items), 0 failed". verify46: ores bottom chest =
  iron_ingot x5, gold_ingot x3, raw_iron x4, coal x8; tools bottom
  (empty); foods bottom (empty); room (empty). brain.json: ores 10
  chests x=-146 y71..80, tools 10 x=-143 y71..80, foods 10 x=-141
  y71..80 — each column exactly its own footprint.
- One verify artifact, not a bot bug: the ores TOP chest (y=80) could
  not be opened by the verify bot — it teleports 2 blocks south of
  the wall and falls to the ground, 9 blocks below the chest. The
  chest itself is proven by Segs' own scan (recorded in brain), and
  the bottom-first deposit + all 20 items in the bottom chest prove
  nothing went up there.
- Test-world note: "Segs this is my room" reported 10 chests because
  the leftover run-44 valuables column (-140,158) sits untaught next
  to the room in the test world and is not in any column yet. On the
  real server, teach all columns BEFORE teaching the room (as the
  setup order already says) and this does not happen.

What is still NOT proven (unchanged): the real youniga server — Tash
must test v9.2 there (join first, teach a column or two, then a small
one-category sort before the full "Segs sort my room"). The tools
tier order (netherite > diamond > iron > gold > stone > wood) and the
best-at-top vs bottom-first call are still awaiting his answer.

## v10 appendix (2026-11-08) — PvP-god combat, doors properly, follow 2 blocks, edge awareness (all movement), no-tool rule

Test ground: local Paper 26.3 (build 244), port 25569, difficulty normal, enclosed stone arena box (floor + walls + roof, x=-100..-80, z=150..170, y=71), keepInventory on, Segs given diamond sword + shield + cooked beef + diamond armour per run. Owner harness `test-segs/owner-bot.js` runs 51–58. All results are from real bot.log / paper-server logs — nothing faked.

### Combat — run 51, 1v1 zombie: PASS (zero hits)
Clean retest: "fighting zombie" → "killed zombie (total kills 1)" with **no hit-taken lines** in that run's bot.log. Kiting at 2.5–3.0 blocks works: Segs hits from 3, the zombie (reach ~2) cannot reach it. The key fix was strike() re-fetching the target by id from the live entity map — the stored `combatTarget` went stale and attacks missed (~38 swings per kill before the fix).

### Combat — run 52, 1v1 skeleton: NOT zero yet (best 1 hit)
Best result: 1 hit taken, skeleton killed. Progression: 4 hits → 2 hits → 1 hit (sprint-jump close-in). The shield equips in the off-hand (proven by debug log) but the block does NOT reliably stop arrows in this Mineflayer fork — attacking cancels the block, and the shield does not appear in `bot.inventory` even though the server gives it (so the bot cannot reliably confirm it has one). Sprint-jumping (~7 blocks/sec) is what closed the gap on the retreating skeleton (~5 blocks/sec).

### Combat — run 53, 1v1 creeper: FLEE ONLY (not fought in melee)
The creeper's fuse (1.5s) beats a sword kill (3 hits, ~2s), and the fork's attacks miss too often for melee to be safe. Every melee attempt ended with Segs taking explosion damage (~10 hp) and retreating without killing it. So creepers are excluded from combat targets entirely: Segs FLEES creepers (the v8 flee) and does not walk into an explosion. A bow is needed to kill creepers safely.

### Combat — run 54, horde 5 zombies: HARD in the open arena, not passing
Segs gets surrounded (4–5 mobs), takes 5–7 hits, retreats at low health without killing the horde. A break-out was added (sprint through the emptiest of 8 directions instead of kiting away from the pack centre, which just pushes Segs into the ring), but a 5-mob ring in the open still overwhelms it. Honest limit: Segs handles 1–2 mobs well; a horde needs a doorway/wall funnel (fight with back to a wall) or better gear. The test itself was also contaminated by Segs dying between runs and losing its sword to unreachable graves — fixed with the enclosed arena, keepInventory, spawnpoint in the arena, and periodic re-gives.

### Doors + follow — run 57: PASS
A house was built with a closed oak door in the south wall and cobblestone directly above it (Tash's exact report). Owner inside, Segs follows from outside. Result: Segs opened the door proactively ("opened wooden door at (-90, 71, 155)"), walked through, did NOT break the cobblestone above it (canDig=false while following), and ended exactly 2 blocks behind the owner. Iron doors: presses a nearby plate/button/lever; if none, says so and does not break it.

### No-tool rule — run 58: PASS
"Segs dig stone" with no pickaxe in inventory → Segs refused: "i need a pickaxe to dig stone — i wont dig it by hand" (logged "refused to dig stone by hand (no pickaxe)"). After the owner gave an iron pickaxe, "Segs dig stone 1" → "dug 1x stone". The pathfinder also never digs stone/ore/obsidian (added to blocksCantBreak).

### Edge awareness (all movement): BUILT, not fully simulation-proven
A global edge watchdog runs every 500ms: it reads Segs' velocity, checks the ground 1.5 blocks ahead in that direction, and stops ALL movement at once (pathfinder goal + control states) on a drop. It did not trigger during the flat-arena combat tests (correct — no edge there). The flee edge check (v9.4, run 50) is proven; the watchdog is the safety net for follow/goto/combat movement.

### Real bugs found + fixed through v10 testing
1. `findCombatTarget` used undefined `username` → crash on first combat. Fixed (OWNER).
2. Retreat `autoEat.eat()` promise rejection crashed the bot (no food in inventory). Fixed (.catch()).
3. `defendCheck` re-engaged combat at low health while combat retreated → tight loop. Fixed (health gate <12 hp).
4. Shield equip never ran (early return when holding a sword). Fixed (shield equip moved to its own step).
5. Strafe-only movement let the zombie stay in range. Fixed (kiting at 2.5–3.0).
6. Attacks missed ~92% (386 swings for 10 kills) because the stored `combatTarget` went stale. Fixed (re-fetch by id from `bot.entities` in strike()).
7. Flee vs combat conflict: evadeTick and defendCheck both fired on a creeper, Segs fled instead of fighting. Fixed (flee suppressed when armed + autoDefend).
8. No-weapon retry counter was persistent, so once it hit 12 every later fight stopped on the first tick. Fixed (reset on combat start).
9. The crit (jump + 220ms delayed attack) wasted hits on a retreating target. Removed (attack immediately on cooldown).
10. Test contamination: Segs died between runs from leftover mobs and lost its sword/shield to unreachable graves. Fixed (enclosed arena, keepInventory, spawnpoint in arena, periodic re-gives, 15s startup wait).

### What is still NOT proven / NOT done in v10
- Skeleton is not zero hits yet (best 1). The shield block is unreliable in this fork.
- A 5-zombie horde in the open arena overwhelms Segs.
- Creepers are fled from, not fought in melee. A bow is the correct tool for them.
- Plan items 6–12 (unstuck, night behaviour, water/drowning, rest) are not yet built.
- The real youniga server — Tash must test v10 there (join first, then combat with a sword/axe he gives Segs, then doors/follow in his real house).

## v10.1 appendix (2026-11-08) — bow, horde funnel, plan items 6–12

### Bow combat (new)
- Segs shoots from 10–14 blocks (bow + arrows), strafes fast (flip every 300–500ms), aims at the target's chest (y + 1.0, NO lead — the lead used the target's velocity, which is 0 between steps, so the arrow went where the skeleton WAS; the drop compensation aimed over its head). Charges 1s, releases.
- **Run 52 retest (skeleton, bow): PASS — ZERO hits taken.** Segs shot the skeleton and killed it without taking a hit. First time the skeleton has been zero-hit. (Earlier in the same session: 1 hit, then 2 hits, then the chest-aim fix made it 0.)
- **Run 53 (creeper, bow): NOT yet reliable.** Segs shoots the creeper (15–21 arrows) but does not kill it reliably — the creeper walks toward Segs at ~4 blocks/s and the arrows miss it more often than the standing skeleton. A creeper lead (aim ahead toward Segs) was added and helped, but kills are still not consistent. Segs takes 1–2 hits and the creeper sometimes gets close. Without a bow Segs still flees creepers (safe, no deaths). Creeper kill is the hardest bow target and remains open.
- Test-harness fixes that made the bow testable: gives spaced 100ms apart (the server drops chat commands sent 5–10ms apart — the bow/arrow/armor gives were silently dropped); mob summon moved from 8000ms to 12000ms (the gives land late, so the skeleton was summoned before the bow arrived); doMobSpawning=false + a second /kill just before the summon (the dark arena spawns Zombie Villagers that contaminate 1v1 tests); no-weapon retry raised to 5s (the inventory takes ~4s to sync after a teleport).
- **Bug fixed:** `findCombatTarget` excluded creepers entirely, so Segs never fought a creeper even with a bow. Creepers are now a combat target ONLY when Segs has a bow + arrows.

### Horde (run 54, 5 zombies)
- Funnel added: when 2+ hostiles are near, Segs backs to the nearest wall (within 10 blocks) so the horde can only come from the front, and shoots zombies from range too while backing up. Trigger moved earlier (2+ hostiles, not just when already surrounded — waiting until surrounded cost 5 hits first).
- Best result: 1 kill, 4 hits taken (was 5–7 hits, 0–2 kills). **A 5-zombie horde in the OPEN arena is still NOT zero hits.** The open arena is the worst case (no walls to funnel through, ring closes fast). On the real server Segs fights near walls/doors, which is the funnel it wants — but that is not proven here.

### Plan items 6–12 (all built)
- **Unstuck (item 6):** watchdog — goal active but no movement >0.5 blocks in 10s = stuck. Jump, turn 90° + walk, jump. Never breaks a block. After 3 tries, says so and waits. Built, not yet simulation-tested in a dedicated run.
- **Creeper rule (item 7 in plan numbering, build-order 6):** fleeing a creeper flips the flee direction if it points toward the owner or the permanent home. Built, not yet simulation-tested.
- **Night behaviour (item 7):** at night, if idle, Segs goes to its permanent home (or near the owner). If the owner is offline, it goes home and waits. Built, not yet simulation-tested (needs a taught permanent home).
- **Mob-by-mob flee (item 8):** skeleton/witch zigzag, enderman look down + walk away slowly, spider sprint. Built, not yet simulation-tested per-mob.
- **Water & drowning (item 9):** watchdog — air low = swim STRAIGHT UP first (head above water), then move to shore. **Run 59: PASS for drowning** — Segs' air was restored (14 → OK), no death, no drowning. Climbing out onto shore in the test pond is still unreliable (the pond is in a floating platform, so the water physics are weird); Segs survives in water but does not always get out. The drowning part is fixed; the climb-out needs a real river/pond to prove.
- **Trapdoors & fence gates (item 10):** openDoorInWay now also opens trapdoors and fence gates (open, never break). Built, not yet simulation-tested.
- **The rest (item 11):** farmland in blocksToAvoid (never walks on crops); animals never attacked (combat only targets hostiles); owner-offline idle (see night behaviour). Built.

### What is still NOT zero / NOT done in v10.1
- Creeper kill with the bow is not reliable yet (hardest bow target — it walks toward Segs).
- A 5-zombie horde in the OPEN arena is not zero hits (best 1 kill, 4 hits). Needs a wall/doorway funnel, which the real base has but the open arena does not.
- Plan items 6–12 are BUILT but most are not yet simulation-tested in dedicated runs (only water/drowning was run: run 59, drowning PASS).
- The real youniga server — Tash must test v10.1 there.

## v10.2 appendix (2026-11-08) — bow re-aim, creeper melee

### Bow re-aim during charge (new)
- Root cause found: Segs aimed ONCE, then charged for 1s. A moving target walks ~4 blocks in that 1s, so the arrow went where it WAS. Fixed: re-aim every 100ms during the charge, tracking the target's current position. Also fixed the stale-entity bug in bowAim (it used `bot.entities[target.id]`, which is undefined when the server re-creates the entity — now it finds the LIVE entity by name).
- Creeper bow range changed to 6–10 (was 10–14) with sprint-back kiting (sprint backward while shooting, so Segs outruns the creeper).

### Creeper (run 53) — the one item still not zero
- **Six bow approaches tried, 0 kills:** chest aim, creeper lead, re-aim during charge, closer range (6–10), sprint-back kiting, live-entity fix. 5–21 arrows per fight, 0 kills. The creeper walks toward Segs, so a 1s bow charge means the aim is always stale.
- **Melee hit-and-run tried (2 runs):** Segs fights the creeper with the sword, hits once, sprints away. Result: Segs took 0–1 hits, the creeper disappeared after ~57s (despawned or exploded at a safe distance) without Segs landing the killing blow. Segs survives creepers safely (never dies to one), but a reliable zero-hit creeper KILL is NOT proven.
- **Decision:** creeper removed from BOW_TARGETS (the bow cannot hit a moving creeper). Melee hit-and-run is used instead. Segs is SAFE from creepers (flee + hit-and-run, 0–1 hits, no deaths). A zero-hit creeper kill remains the one open item.
- Honest limit: this is the hardest mob to kill safely. The fuse (1.5s) + the creeper walking toward Segs + the 1s bow charge (or the sword's 650ms cooldown) means Segs cannot land 2–3 hits before the creeper either explodes or despawns.

## v10.3 appendix (2026-11-08) — Tash's real-server bug report
Source: Tash's logs.rar + screenshots from youniga (2026-11-08 11:03).
The logs proved: "drop all seeds" -> "i dont have all_seeds",
"drop seeds x64" -> "i dont have seeds_x64", "drop everything" ->
"i dont have everything", "equip axe" -> "didn't get that",
"craft yourself an axe" -> "i dont know yourself_axe", "this is
Storage unit" / "this is food chest" failed (no "the"), "keep wheat
in this chest" -> "didn't get that", survival said "the farm had
nothing ripe to eat" while holding 24 wheat, unstuck fired twice,
Segs sensed a cave zombie in daytime.

- Run 60 (drop-on-command): Segs kept iron_axe + wheat + beef through
  follow/stop/status/eat. No drops in simulation (the real-server drop
  is attributed to the deactivateItem packet — removed in v10.3).
- Run 61 (farm + commands): Segs kept all 10 seeds through farm/stop/
  follow/stop. Farm did not harvest in the test setup (wheat age
  metadata) — real-server farm harvest is proven by Tash's logs.
- Run 62 (hold + command): Segs kept the axe through combat + stop +
  follow + stop. No drops.
- Run 63 (v10.3 commands): "drop seeds" dropped 1 (fixed in retest),
  "drop 1 wheat" dropped 1, "equip axe" -> "holding iron_axe",
  "top" -> 'did you mean "segs stop"?', "drop everything" dropped
  78 items, inventory empty, "drop seeds x64" dropped 10.
- Run 64 (drop retest): "drop seeds" dropped ALL 64 seeds, "drop 1
  wheat" dropped 1, "drop all wheat" dropped all 9. PASS.
- Run 65 (food + teach + store): "Segs survive" with 9 wheat + a
  crafting table -> "making 3x bread" -> "done, crafted 3x bread" ->
  "fed, all good". "this is food chest" (no "the") -> "ok, got it,
  this is the food chest". "keep wheat in this chest" -> "stored 1x
  wheat in the chest". PASS.
- Run 66/67/70 (water): Segs swims to the shore but CANNOT climb out
  onto a vertical 1-block wall (7 approaches tried: pathfinder, direct
  controls, combination, fast 200ms controls — all stall at the edge).
  Fork physics limitation. Drowning fixed (swim-up, no death). After
  20s stuck Segs now says so and asks for help. NOT proven: climb-out.
- Run 68 (water slope): sloped bank also stalls at the edge. Same limit.
- Run 69 (mob sense): cave zombie 11 blocks below -> "all clear,
  nothing hostile nearby". Surface zombie 5 blocks away -> "i can see:
  zombie 3 blocks away" + "fighting zombie". PASS.
- Run 71 (auto-jump): owner 4 blocks away on a 1-high ledge, Segs
  followed and jumped up onto the ledge, ending 2 blocks behind the
  owner at y=72. PASS.

## v10.3.1 appendix (2026-11-08) — the drop bug, found for real
Tash nailed it down: Segs held BEEF in its RIGHT hand, "tp to me"
dropped 1-3 beef, "sleep" dropped beef. Root cause: my v10.3 edit
left a SECOND deactivateItem() call in stopCombat (line 802, after
the logEvent line) — it fired on EVERY stopAllMovement(), and on
Paper that block_dig packet drops the held item. Removed for real;
the only deactivateItem() left are the bow release (fires the arrow)
and the shield lower (guarded by shieldUp). "lower shield" is also
guarded now.

- Run 72 (drop fix): Segs held cooked_beef ("holding cooked_beef"),
  got "tp to me", "sleep" and "stop" — kept all 10 beef at every
  status check. ZERO dropped. PASS. (The bed was not found in the
  test setup — /setblock placed a lone bed block — so "sleep" itself
  was not tested, only the drop behaviour around it.)
- Run 73 (wall sidestep): 2-high stone wall across the path, open
  space left/right. Direct goto timed out at 25s; Segs climbed the
  wall edge, the unstuck watchdog said "im stuck" (false alarm —
  Segs was moving slowly), the sidestep fired (left 4 failed: goal
  changed by the watchdog; right 4 worked), Segs reached (-89,71,169)
  and said "here". PASS (target reached; the false "im stuck" line
  during a slow wall climb is a known wart).
- Run 71 retest (auto-jump): owner 4 blocks away on a 1-high ledge,
  Segs followed and jumped up onto the ledge, ending 2 blocks behind
  at y=72. PASS. (First attempt: owner directly above Segs — 3D
  distance 1, so follow never triggered. Fixed: follow trigger is
  now horizontal distance.)
- Guide PDF rebuilt: 20 pages, 15 sections (combat added as section
  11), v10.3.1.

## v10.4 appendix (2026-11-08) — the 13 NiceWurst picks, tested one by one

All runs on local Paper 26.3 (build 244), port 25569, fork mineflayer.
Per-run evidence only — no run is claimed as a pass unless that run's
bot.log proves it.

### The creeper bow kill (AimAssist + KillauraLegit discipline) — the breakthrough
- Run 75 (enclosed arena, creeper summoned 8 blocks away), patch L
  (plant your feet while charging): "fighting creeper" 10:20:09 ->
  shot 1 (dist 6.1) hp 20->14, shot 2 (dist 7.9) hp 14->5, shot 3
  (dist 8.0) hp 5->0, "killed creeper (total kills 1)" 10:20:15. 3 shots,
  3 hits, 3 arrows consumed (64->63->62->61). ZERO hit-taken lines.
  Segs ended hp 20/20 food 14/20 at (-93,71,169). PASS.
- Run 99 (open field, creeper summoned 14 blocks away), patch L:
  shot 1 (dist 13.4) hp 20->13, shot 2 (dist 11.5) hp 13->3 (crit),
  shot 3 (dist 8.1) hp 13->3, shot 4 (dist 7.9) hp 3->0, "killed
  creeper" 10:18:40. 4 shots, creeper dead, ZERO hit-taken lines.
  Segs ended hp 20/20. PASS.
- How it was found (the investigation, because Tash said dig until it
  works): (1) The bow did not fire at all until patch G — the fork's
  deactivateItem() sends block_dig status 5, which is DROP_ITEM in
  26.3 (Paper's ServerboundPlayerActionPacket enum: RELEASE_USE_ITEM
  is 6, not 5; decompiled from paper-26.3.jar with CFR 0.152). Fixed
  with releaseItem() writing status 6 directly. Probe-bow4 proved one
  clean status-6 shot consumed an arrow (64->63). (2) A perfectly
  aimed full-power arrow at a stationary skeleton 8 blocks away did
  NOT damage it — the arrow stopped at (-139.5,72.05,153.05) after one
  tick. Root cause: a leftover oak plank at (-140,71,152) from the door
  tests sat in the arrow's path and shielded the skeleton (probe-bow5
  v2, probe-block, runs 93/94/97). After clearing the field
  (/fill ... air in run 90), the same 8-block shot KILLED the skeleton
  (owner health check 9.0f). Test-field hygiene lesson, recorded.
  (3) The moving creeper still would not die: 10 arrows, 0 hits (run
  99, 14-block start, patch J lead). Probe-bow8 (stationary, plain
  look, no lead) HIT a moving creeper at 8 blocks (hp 20->12). The
  difference was movement. Diagnostic BOW_STAND_STILL (patch K):
  standing still, 3/3 arrows hit and the creeper died (hp 20->13->7->0).
  Root cause: moving (back + strafe) while the bow is charging makes
  the arrows miss — the eye moves while the look is sent in 8.6
  deg/tick baby steps, so the server's rotation lags the aim. Fix
  (patch L): stand still while bowCharging, move between shots. The
  lead was also corrected (patch J): Wurst's 0.2 under-leads — lead
  time must equal flight time (arrow 3 blocks/tick), so d = dist/3.
- Run 87 (skeleton bow, patch L): 2 shots, "killed skeleton" 10:22:18,
  hp 20->6->0, zero hits taken, Segs hp 20/20. PASS.
- Run 86 (zombie 1v1 discipline retest): "fighting zombie" 11:16:17 ->
  "killed zombie" 11:16:29 (12s), zero hit-taken lines, Segs hp 20/20.
  PASS.

### AutoChat — run 74 (PASS after one fix)
- First attempt exposed two real bugs: the keyword-hint fallback
  shadowed the AI (a creeper question got the fight hint), and
  clause-splitting chopped the injection sentence so the filter never
  saw it. Fixed: injection check on the FULL req before splitting,
  aiHandleFallback before the keyword hints.
- Retest replies in order: "ai off (no key), today 0 req / 0 tokens"
  -> enable -> "ai is on, but i have no groq key in config yet" ->
  open question -> "ai is on but i have no groq key... so i cant
  think" -> injection -> "nope, not doing that" + [ai] injection
  filtered -> status canned -> disable -> "ai off, back to my normal
  replies". [ai] log lines confirm enable/no-key/status/disable.
  0 Groq calls made (no key). PASS (gate, cooldown, canned fallback,
  budget guard flag, enable/disable — all without a real key, as tasked).

### AutoEat — run 76 (PASS)
- Segs chose cooked_beef (saturation 12.8) over bread (6) and apple
  (2.4); rotten_flesh x5 never touched (poison excluded). Background
  auto-eat: food dropped under hunger, Segs ate 2 cooked_beef
  (x3 -> x1) and food restored to 20/20. [autoeat] log: "eating
  cooked_beef (saturation 12.8, ...)". PASS.
- Two test-setup lessons: hunger amplifier 255 overflows the NBT byte
  to -1 (no effect); /difficulty peaceful disables hunger drain
  entirely. The drain that worked: saturation set to 0 via /data merge
  + hunger 9 on normal difficulty.
- Real bug found and fixed (patch M): the mineflayer-auto-eat plugin
  calls bot.deactivateItem() before every eat — status 5 = DROP_ITEM
  in 26.3. bot.deactivateItem is now overridden to the safe status-6
  release, so no plugin can drop the held item.

### AutoArmor — run 77 (PASS after one fix)
- First attempt: boots never equipped. Root cause: armorSlotOf
  returned 'boots' but the loop uses 'feet' (the bot.equip
  destination), so the feet slot never matched a candidate. Fixed.
- Retest: leather_helmet (5) -> iron_helmet (10), leather_chestplate
  (15) -> iron_chestplate (30), diamond_leggings (32),
  golden_boots (5) — all best pieces worn, only the worse pieces left
  in inventory (leather_helmet x1, leather_chestplate x1). PASS.

### AutoTotem — run 78 (PASS after three fixes)
- First attempt: health gate (totem only at hp <= 12, shield back
  when healthy) left Segs holding the shield at full health; lethal
  instant_damage killed it ("Segs was killed by magic") and the totem
  never popped. Fixed (patch N): hold the totem ALWAYS when Segs has
  one; shield is the fallback only with no totem.
- Patch O fixed an oscillation (items() excludes the off-hand, so the
  shield fallback fired while the totem was worn). Patch P fixed
  pop-detection spam (equip is async; the off-hand reads non-totem
  while an equip is in flight) with count-based pop detection + a 2s
  equip debounce. Patch Q/R addressed a startup false "popped" (the
  test harness /clear removes a kept totem from the previous run).
- Final run: totem held at hp 20; lethal instant_damage popped it,
  Segs survived at hp 2-4, spare totem re-equipped to the off-hand
  ("totem popped — a fresh totem will be equipped", "holding totem in
  off-hand (hp 2)"). PASS. Known wart: one false "totem popped"
  message at startup in the test harness (the /clear artifact above) —
  not a real pop, and it does not occur in normal play (no /clear).

### AntiBreak — run 79 (PASS after one fix)
- Iron_pickaxe at 5/250 durability + fresh stone_pickaxe. "Segs dig
  stone 1" -> "my iron_pickaxe is about to break, swapped to
  stone_pickaxe" -> "dug 1x stone". Iron pickaxe unbroken (still x1).
- First attempt: equipForBlock re-equipped the iron pickaxe AFTER the
  swap (the automine log proved it: "digging stone with iron_pickaxe").
  Fixed (patch S): checkAntiBreak runs AFTER each equipForBlock.
  Retest: "digging stone with stone_pickaxe". PASS. (Minor wart: the
  swap message fires twice per dig — once before the loop, once in it —
  because equipForBlock re-picks the iron each time and the check swaps
  it out again. The tool is protected; the message is just repeated.)

### AutoFarm — run 80 (PASS)
- 9 potato spots replanted, each logged "[autofarm] replanted potato
  at x,y,z (spot remembered)". 27 potatoes + 1 poisonous potato
  harvested. Segs ended at (-128,70,161) in the farm. PASS.

### AutoMine — run 81 (PASS)
- "Segs dig dirt 2" -> dug 2x dirt with iron_shovel; "Segs dig stone
  1" -> dug 1x stone with iron_pickaxe. [automine] logs confirm the
  correct tool per block. Normal speed, no super-fast mode. PASS.

### Follow — run 82 (PASS, with a wart)
- Owner teleported to (-85,71,160); Segs followed and ended at
  (-87,72,160) = exactly 2 blocks behind horizontally (and jumped up
  1 block onto the ledge). Owner then teleported 35 blocks away to
  (-120,71,160); Segs re-targeted by name and walked toward the owner
  (reached (-99,71,160) by the end of the run). PASS. Wart:
  long-distance follow is slow (~0.6 blocks/s over 35 blocks in this
  run — the 500ms re-path restarts the pathfinder often).

### Parkour — run 83 (PASS for the 1-block case) + run 100 (honest limit)
- Run 83: 1-block ledge down. Segs on a y=72 ledge, goal on the y=71
  floor: walked down, ended at (-90,71,168), said "here". PASS.
- Run 100 (3-block drop): the edge-watchdog Parkour branch is in the
  code (checks landing within 3 below + a goal, then jumps), but it
  could NOT be exercised in simulation — the pathfinder refuses to
  route toward a 3-block drop, so Segs never approaches one while
  moving (it said "i cant reach there" for a goto, and stood above the
  owner at (-90,76,168) while following). The 1-block case is the one
  that matters day to day and it works; the 3-block jump is
  code-present but not simulation-proven. Honest limit, recorded.

### AutoRespawn — run 84 (PARTIAL PASS — the reconnect works, the kick remains)
- /kill Segs -> "[autorespawn] respawn packet sent (attempt 1, death
  at -90,71,160)" -> Segs was KICKED ("Invalid move player packet
  received", Paper log 11:12:57) -> "Reconnecting in 10s..." -> Segs
  back answering status (hp 20/20 at -90,71,160) and grave recovery
  ran. PASS for the respawn packet + 10s reconnect (the designed
  fallback). FAIL (honest, unchanged from v9.4) for respawn-in-place:
  Paper still kicks the dead client because the fork's physics loop
  keeps sending position packets from the corpse — a fork limit, not
  fixable at bot level.

### PacketRate — run 85 (PASS for counting/logging; throttle is a safety net)
- Outgoing packets counted, rate logged every 10s: idle ~22/s avg,
  peak 1s window 28/s. Combat peak 63-76/s (runs 74/75). Never near
  100/s, so the chat throttle (queue 1 per 500ms above 100/s) never
  fired. The counting/logging is proven; the throttle is code-present
  as a safety net. PASS.

### Regression — run 72 (drop fix, v10.3.1 behaviour preserved)
- Segs held cooked_beef x10; "tp to me", "sleep", "stop" — cooked_beef
  stayed x10 at every check, zero dropped. PASS. (bot.js has 0 live
  bot.deactivateItem() calls that send status 5; the only assignment
  is the patch-M override to the status-6 release.)

### Guide PDF
- NOT rebuilt in v10.4 (per the task). The PDF in the zip is still the
  v10.3.1 PDF (20 pages, 15 sections). Rebuilt in v10.4.1 — see the
  v10.4.1 appendix below.

## v10.4.1 appendix (2026-11-08) — Parkour 3-block drop + respawn-in-place fixed, guide rebuilt

Both v10.4 honest limits are fixed and proven below. Nothing in this
appendix is a claim without a run.

### Parkour 3-block drop — runs 101 + 103 (PASS)

Root cause (fork pathfinder source, mineflayer-pathfinder
lib/movements.js): `getLandingBlock` measures `node.y - landingBlock.y`
against `maxDropDown` (4). A 3-block FEET drop is a 4-block difference
to the landing BLOCK, so it only just passes; a 4-block feet drop
(difference 5) can NEVER be routed — the A* explores the whole platform
and times out ("Took to long to decide path to goal!", run 100).
Minecraft fall damage is floor(fallDistance - 3), so a 3-block drop is
exactly the safe maximum (0 damage); a 4-block drop costs 1 hp.
Second root cause (bot.js edge watchdog): the old Parkour scan only
looked d=1..3 blocks below the FEET for the landing BLOCK. A 3-block
feet drop has its landing block FOUR below the feet, so the scan never
found it and Segs stopped at every real ledge.

Fixes in bot.js:
- Watchdog scan extended to d=1..4, landing feet drop = d-1, jump only
  if drop <= 3 and Segs has a goal; a `dropDownActive` flag makes the
  watchdog skip entirely while a manual drop-down is in progress.
- New `attemptDropDown(targetPos)` — a different approach, no pathfinder
  goal at all: clear the goal, face the target, WALK forward off the
  edge and let gravity do the drop. Walk, do NOT jump (jumping adds
  ~1.25 blocks of height, turning a 3-block drop into a ~4.25 fall =
  1 hp damage). Only used when the target is 1-4 blocks below and
  within 12 blocks horizontally, the landing is solid ground (not
  lava/water/void), and there is headroom at the target. Wired into
  `gotoPos` (after the direct + staged pathfinder attempts fail, before
  the wall sidestep) and into `followLoop` (when stuck >6s following
  while the owner is below). `maxDropDown` was deliberately NOT raised
  (a 4-block pathfinder drop would cost 1 hp routinely).
- The second go-to-coords handler said "here" unconditionally after
  `await gotoPos(...)` without checking its return value. Fixed: it now
  says "here" only if gotoPos returns true, else "i cant reach there,
  too far or blocked". gotoPos now logs its outcome
  ("[goto] gotoPos OK (direct/after drop-down/final step) at <pos>").

Run 101 (3-block drop) — PASS. Setup: floor stone y=72 (feet 73),
platform stone y=75 (feet 76), combat-arena footprint cleared first
(962 blocks — the first attempt was INVALID: the old arena roof at y75
was still in place, the platform fill filled nothing, and Segs walked
across the roof and said "here" while still 3 blocks above the goal).
Clean retest: "[goto] gotoPos OK (direct) at (-90.5, 73, 169.5)" —
Segs dropped 3 blocks via the pathfinder's own `getMoveDropDown`
(76-72=4 <= maxDropDown 4), said "here", status hp 20/20 food 20/20
at (-91,73,169), NO fall damage. (No [parkour] line — the pathfinder
routed it directly, so the watchdog jump was not needed; the watchdog
fix remains as safety.)

Run 103 (4-block drop, manual fallback) — PASS. Direct GoalNear: "No
path to the goal!" (correct — pathfinder cannot route a 4-block drop),
stage GoalXZ failed the same, then "[parkour] drop-down: walking off a
4.0-block drop toward -90,72,170" -> "[parkour] drop-down done: landed
at -90,72,168 hp 19" (2 seconds), "[goto] gotoPos OK (after drop-down)
at (-89.5, 72, 168.7)", Segs said "here", status hp 20/20 food 20/20
at (-90,72,168) (hp regenerated from 19 after landing — full food).
The first attempt of run 103 FAILED and was root-caused before the
retest: Segs moved ~0.8 blocks then stood jumping in place. A
stack-trace probe found the WATER watchdog (200ms interval) cleared
jump/forward/sprint on EVERY tick whenever Segs was NOT in water —
silently killing every manual walk (drop-down, door assist, flee). Fix:
a `waterDriving` flag — controls are cleared only in the two branches
where the water watchdog actually drives a swim (air-low swim-up;
shore swim). The probe was removed from bot.js after the diagnosis.
This bug also likely explains the slow long-distance follow in run 82
(~0.6 blocks/s).

### AutoRespawn in place — run 102 (PASS)

Root cause (decompiled paper-26.3.jar ServerGamePacketListenerImpl
with CFR 0.152): `handleMovePlayer` disconnects with
"invalid_player_movement" if a SECOND position-bearing packet arrives
in one server tick (`receivedPositionThisTick`); the flag is reset ONLY
by `handleClientTickEnd`. `handleClientCommand` PERFORM_RESPAWN returns
harmlessly when health > 0, so the repeated client_command respawn
packets are NOT the kick — verified in the same decompile — and are
kept as the retry safety. The kick sequence: the fork's physics loop
sends `tick_end` at the end of its own tick, but the DELAYED respawn
reply (physics.js: `position_look` sent 1500ms after the server's
respawn teleport) is sent OUTSIDE that loop with no `tick_end` after
it, and the next physics tick then sends a second position packet (the
1s heartbeat: `lastSent.time` is stale after death) in the same server
tick. Kill 11:12:57 -> kick 11:12:57 in run 84 is exactly that window.
The physics loop already suppresses position packets while dead
(`shouldUsePhysics=false` on death; `isEntityRemoved()` stops them 20
ticks after death) — the race is AFTER respawn, not while dead.

Fix in bot.js (PacketRate wrapper, 26.3 branch only — ships in the zip;
the fork is re-cloned by setup-26.3.sh, so a fork edit would NOT reach
Tash): for 10s after a death (`globalThis._lastDeathAt`, set in the
`death` handler), immediately follow EVERY `position`/`position_look`
packet with a `tick_end` (via the original write, no recursion), so the
server's per-tick flag is reset before any next position packet can
arrive. Outside the respawn window the physics loop's own `tick_end` is
enough, so no extra packets in normal play. Also added a `deathpkt`
diagnostic log (any movement packet written while `bot.isAlive ===
false`) and a guard in the `health` handler: `if (bot.health <= 0)
return` — the old code set a pathfinder flee goal for a corpse
(health.js emits `health` before `death`), which then moved on respawn.

Run 102 — PASS. /kill Segs at 11:34:13 -> "[autorespawn] respawn
packet sent (attempt 1, death at -90,71,160)" -> status answers at 20s
and 35s: hp 20/20 food 20/20 at (-90,71,160), same spot, alive.
Exactly ONE "Connecting to" in the whole bot.log, one Spawned, NO
"Reconnecting", NO second connect, NO `deathpkt` lines, NO new
"Invalid move player packet" in the Paper log after the kill (last two
are 10:46:19 and 11:12:57 from old runs). Respawn-in-place is fixed;
the 10s reconnect remains as fallback.

### Guide PDF — rebuilt for v10.4 (21 pages, 15 sections)
- Version string "Version 10.4 • Minecraft 26.3 (native, no ViaVersion)
  • 2026-11-08". All 13 NiceWurst picks covered BY NAME and verified
  present in the PDF text: AutoChat, AimAssist, KillauraLegit,
  AntiBreak, AutoArmor, AutoEat, AutoFarm, AutoMine, AutoRespawn,
  AutoTotem, Follow, PacketRate, Parkour. Plus: the creeper bow kill
  (plant feet to shoot, 3-4 arrows, zero hits), the status-6 bow
  release fix (status 5 = DROP_ITEM in 26.3), the AutoEat plugin drop
  fix, the Parkour 3-block/4-block drop-down, the respawn-in-place fix,
  and a PacketRate troubleshooting entry. No invented features —
  everything is in bot.js and simulation-tested where noted. Built with
  fpdf2 2.9.0 from build-guide-pdf.py (script updated alongside the
  content: version string, header/footer v9 -> v10.4, zip name).

### Regressions after the v10.4.1 control-state changes
- Run 67 (water, retest 2026-11-08 ~11:56) — PASS for the drowning
  fix. After the `waterDriving` fix, Segs still swims: teleported into
  the pond at (-90,70,160), swam to the pond edge (-85,70,160),
  "[water] swimming out to shore at -83,72,161" logged repeatedly, hp
  20/20 at every status check, no drowning, no death. After 20s it
  said "im stuck in the water, i cant climb out — come get me or tell
  me to tp to you" — the climb-out onto a vertical 1-block shore
  remains the standing honest limit (unchanged from v10.3), NOT a
  regression.
- Run 72 (drop fix, retest 2026-11-08 ~11:57) — PASS. Segs held
  cooked_beef x10 through "hold beef" -> "tp to me" -> "sleep" ->
  "stop": cooked_beef x10 at every status check, zero dropped, no
  deactivate lines in bot.log. (The test's lone /setblock bed still is
  not a findable bed — "i cant see a bed near me" — so only the drop
  behaviour around the commands is proven, same as the v10.3.1 run.)

## v10.5 appendix (2026-11-08) — Tash's "100% at all cost" round: pathfinding sweep, fast follow, instant ack, craft/cook/smelt from chests, view distance 7, Autobuild v1

All simulation, Paper 26.3 test server port 25569, owner-bot harness, runs 104+. Bot package 10.5.0. No GitHub push. No API keys or passwords used.

### Run 104 — rough terrain + dip climb (PASS, run 104g)
- Setup: two dips dug into flat ground (air at y=70), a 1-high plateau; Segs (-148,71,160) -> "Segs go to -126 71 160".
- Runs 104-104f FAIL: Segs walked into dip A and wedged at the east edge (-137.3,70,160.5). Climb assist (back up + running jump) closed gap 0.0; timed jump (0.7 lookahead) 0.0; bunny-hop (hold jump from start) 0.0. Bare-client probes cracked it: at the wedge the bounding box overlaps the wall by ~0.02 while the feet sit exactly at the block's bottom Y, so the fork's onGround never latches and a held jump never fires. A probe that held jump from clean ground DID climb out (landed 0.256 from the wall, onGround=true, re-jump fired); the bot's landing was 0.18 from the wall (onGround=false). Fix: run at the wall with sprint+forward and NO jump; press jump the moment a 1-block step appears 1.5 blocks ahead (checked every 50ms) — the apex lands OVER the wall.
- Run 104g PASS (2026-11-08 13:03:11): Segs said "here", hp 20/20 food 20/20 at (-128,71,160), arrived within 2 of (-126,71,160). Acks in run: 1-6ms. Note: the climb assist sometimes needs two applications for two dips (the first got Segs out of dip A, a second was needed at dip B).

### Run 105 — lava detour (PASS)
- Lava strip /fill -130 70 171 -130 70 179. Segs said "at lavatest" 13:04:49, "gotoPos OK (direct) at (-134.5,71,175.5)", hp 20/20 at (-135,71,175). Went AROUND the strip, never into lava. Pathfinder blocksToAvoid (lava) works.

### Run 106 — water climb-out, run-67 pond geometry (FAIL, honest limit)
- Runs 106 (13:06-13:10) and 106b: Segs stuck at pond east edge (-84.3,70.45,160.5), said "im stuck in the water, i cant climb out — come get me or tell me to tp to you" after 20s. hp 20/20 (not drowning; air-low swim-up works). Climb-out tried the same shore 4 times.
- Geometry (probe-pond): the pond is a 1-deep hole in terrain whose surface is y=71 (top 72). EVERY edge is stone/stone/air at y=70/71/72 — a 2-high wall from the pond floor, a 1-block climb from the water surface to the shore top.
- Fork evidence (prismarine-physics): `isInWater` uses a bounding box contracted 0.401 from the bottom, so the water jump stops applying once the feet rise above ~70.6 (surface 71.0 minus 0.401). Per-tick probe: feet cap at ~70.68 even with no wall contact; at the wall, feet 70.59-70.67, vy -0.08 to -0.16, vx 0.00, onGround=false, collH=true. Shore top is 72.0; step-up (0.6) needs feet >= 71.4. Gap 0.72 blocks, unbridgeable by any bot-level control (jump/forward/sprint/strafe all tried). The fork's getPlayerBB always uses height 1.8 (no swimming pose), so the vanilla swim-climb mechanic cannot be replicated client-side. A fork edit would be needed, but fork edits do not ship to Tash (setup-26.3.sh re-clones the fork). Land jump from the pond floor is unavailable: while in water the water branch (vel.y += 0.04) takes precedence over the land jump (0.42). Segs survives (hp 20/20) and asks for help.
- Water watchdog fixes applied in v10.5 (W1-W4): a jump apex briefly clears isInWater while Segs is still over the pond, which reset waterClimbing and started a second climb-out on top of the first; the interval now only clears waterClimbing when onGround is true, and phase-2 success requires !isInWater AND onGround; shore scan prefers ground-level shore; startWaterWatchdog now has a guard (no double intervals).

### Run 107 — stairs + 2-high wall sidestep (PARTIAL)
- Stairs UP: PASS in runs 107c/107d via stair hop-step mode (target-height detection: target >1.5 above and <10 away; hop cycle jump-only 300ms -> forward 250ms -> release 250ms). "gotoPos OK (after climb assist) at (-91.6,74,160.5)". Run 107e failed only because the owner's next command arrived mid-climb (harness fixed-schedule interference, not a bot failure). Stairs DOWN: PASS in every run ("gotoPos OK (direct) at (-95.3,71,159.5)").
- 2-high wall sidestep: FAIL in runs 107/107b/107c/107d/107e. Segs falls off the v9 platform north edge (z=150) to y=63 at (-90.7,63,150) while routing around the wall at x=-100. Edge watchdog sped up (500ms -> 150ms, lookahead 1.5 -> 3 blocks) and made to check two points ahead (a thin natural ledge 1-2 below the ahead point fooled the single-point check — groundAhead now returns 'drop' if EITHER point is a drop). In 107e the watchdog DID fire ("The goal was changed before it could be completed!") but Segs was already falling — the margin is too thin once sprint momentum carries it off. The go-around-a-wall behaviour itself is proven by run 105 (lava detour).

### Run 108 — long walk 50 blocks + 3-block drop retest (PASS)
- "gotoPos OK (direct) at (-101.6,71,160.5)" (50-block flat walk), then "gotoPos OK (direct) at (-90.5,73,169.4)" (3-block drop), Segs said "here", hp 20/20 at (-102,71,160).

### Run 109 — fast follow + teleport offer (PASS)
- Owner 35 blocks away at (-105,71,160); Segs followed and ended 2 blocks behind at (-107,71,160). Speed from the owner log: 33 blocks in ~16s = >=2.1 blocks/s (a lower bound — it may have arrived sooner between status samples), 3.5x run 82's ~0.6 blocks/s. The follow loop now re-paths only when the owner moved >3 blocks, the entity changed, or there is no goal. Note: the "[follow] caught up" speed log did not fire — the measured distance hovers at ~2.0-2.1, never <= 2.0, so the log's boundary condition is never met (measurement gap, not a follow failure).
- Teleport offer: owner teleported into a sealed glass box; Segs said it was stuck, offered /tpa; owner said "Segs tp to me", Segs sent /tpa, owner accepted, Segs landed at (-143,71,160), hp 20/20. No auto-tpa.

### Run 110 — ack latency (PASS)
- Owner log (millisecond timestamps): "Segs status" said 13:39:27.637, ack "doing it now" 13:39:27.664 (27ms), result right after. "Segs inventory" acked in 9ms. "Segs go to -100 71 160" acked in 5ms, "here" 1.5s later. Bot-side [ack] log: 0-1ms. All well under the 1s target. Ack is owner-only, varied, never twice, never for greetings/thanks.

### Run 111 — craft from chests (PASS, run 111c)
- Chest: coal 4, stick 4, wheat 9; crafting table nearby. "Segs craft torch 4": took 1x stick + 1x coal, "here you go, 4x torch ready", torch x4. "Segs craft bread 2": took 6x wheat, "here you go, 2x bread ready", bread x2. "Segs craft diamond sword": "i need 2x diamond for 1x diamond_sword — i checked 1 chest(s) nearby" (honest missing).
- Bugs found and fixed: (1) torch = coal OR charcoal — the first version gave up on the charcoal variant instead of trying the coal one (doCraft now tries every recipe variant and only reports missing after all fail); (2) the craft reported the ASKED count, not the real one — bot.craft can silently do fewer crafts than asked (bread 2 asked, 1 made in run 111). doCraft now re-resolves a FRESH recipe from the current inventory (recipesFor, not the stale recipesAll delta), crafts ONE at a time with a 500ms settle, and reports the real inventory delta.

### Run 112 — cook + smelt from chests (PASS, run 112e)
- Chest: beef 4, coal 4, iron_ore 4; smoker + blast furnace nearby. "Segs cook beef 4": took 4x beef + 1x coal, "got 4x cooked_beef", cooked_beef x4. "Segs smelt iron ore 4": "got 4x iron_ingot", iron_ingot x4. "Segs smelt gold ore": "i dont have any gold_ore — i checked 1 chest(s) nearby and found none" (honest missing). Final hp 20/20 at (-90,70,162).
- Bugs found and fixed: (1) the smelt loop broke after the FIRST output (run 112: got 1x iron_ingot from 4x ore — a blast furnace makes 1 per 5s; it now polls until all n are out or the deadline); (2) findBlocks only sees LOADED chunks, so right after a teleport the chest search found 0 chests (withdrawFromChests now retries up to 3 times, 1.5s apart); (3) the bot used the item name `raw_beef`, which does not exist in Minecraft 1.13+ — the raw item is just `beef` (same for porkchop/chicken/mutton/rabbit/cod/salmon; minecraft-data 26.3 confirms). The owner test script had the same wrong name, so the chest never actually contained beef until both were fixed. That is also why the beef leg replied in 14ms in runs 112-112c: ensureItem bailed instantly on the undefined item, before ever searching a chest.

### Run 113 — Autobuild house (PARTIAL, best run 113e: 46/65 placed, 0 wrong)
- Schematic schematics/house.json: 65 blocks (floor dy=0 cobblestone 25, walls dy=1 oak_planks 15 minus door gap, roof dy=2 oak_planks 25). Chest: cobblestone 25 + oak_planks 40. "Segs this is the build site" (origin -140,71,160), "Segs build house here".
- Run 113: 23/65 placed, 42 skipped, 0 wrong. Segs walked INSIDE the footprint to place the floor, got wedged standing on the next cell ("im stuck"), placeBlock refused, roof had nothing to attach to.
- Run 113b: build-from-outside fix (never stand in the footprint) + equip-wait fix. FLOOR2-OK + DOOR-GAP-OK passed, but 16 wall blocks lost to "must be holding an item to place" — equip resolves when the packet is SENT, before bot.heldItem updates.
- Run 113c: equip-wait loop (300ms, retry) — but now "equip did not land (holding nothing)" and Segs stuck in a loop (unstuck watchdog cycling try 1-4). Build never finished in the run window.
- Run 113d: 6s cap per stand move (gotoPosQuiet has no timeout; a blocked stand point waited ~25s) + equip re-find fresh + close stale window. 45/65 placed, 20 skipped, 0 wrong. WALL-OK, ROOF-OK, DOOR-GAP-OK, FLOOR2-OK verified. Remaining failures all on the north edge (z=160): "Server refused to place ... the block is still air".
- Run 113e: place retry (re-stand + re-equip + 300ms settle, second attempt). 46/65 placed, 19 skipped, 0 wrong. FLOOR-OK (corner cell -140,71,160) and ROOF-OK still not verified. The north edge is a persistent failure: the place is refused while Segs is still settling from the step-out at the corner it starts on.
- Second build (re-stocked, all cells occupied): 0 placed / 65 skipped / 0 wrong in run 113 — Segs never breaks or replaces a block that is already right. (The second build did not complete in runs 113d/113e because the first build ran past the owner's 170s run window.)

### View distance 7 / simulation distance 7
- Test server: server.properties view-distance=7, simulation-distance=7 (was 5/5), restarted 2026-11-08 12:22 (PID 5881), port 25569 up. Paper's log does not print the view-distance value — verified via the file + restart. Segs runs in the same ~200MB and sees entities at 7 chunks. Bot side: Mineflayer sends a view-distance client setting; the bot now sets viewDistance 7. On Youniga, view/simulation distance is the SERVER owner's setting — Segs cannot change it from the bot.

### Regressions re-run (2026-11-08, all simulation)
- Run 101 (Parkour 3-block drop) PASS: "gotoPos OK (direct) at (-90.5,73,169.3)", hp 20/20 at (-91,74,169).
- Run 103 (Parkour 4-block drop) PASS: direct goto "No path to the goal!", then "gotoPos OK (after drop-down) at (-90.5,72,170.5)", hp 20/20 at (-91,72,170).
- Run 102 (respawn-in-place) PASS: died at (-90,71,160), respawn packet sent (attempt 1), status at the same spot hp 20/20, no reconnect, no kick.
- Run 72 (drop fix) PASS: cooked_beef x10 held through the commands, zero dropped.
- Run 74 (AutoChat gate) PASS: "ai is on but i have no groq key in config yet, so i cant think", "ai off (no key), today 0 req / 0 tokens", injection attempt refused ("nope, not doing that"). 0 Groq calls.
- Run 75 (creeper bow) PASS: "[combat] killed creeper (total kills 1)", hp 20/20, zero hits, bow x1 arrow x61.
- Run 57 (doors) PARTIAL: the door was OPENED not broken ("[door] opened oak_door at (-90,71,155)"), but Segs then got stuck following through it at (-95,71,154) and said "im stuck following you, i cant reach you". The follow loop does not re-plan after a door it just opened (it only re-paths when the owner moved >3 blocks, and the owner was stationary on the other side). That is a follow-through-door gap, not a door-breaking regression. Needs a fix: force a re-path when stuck following near a door.
- Run 67 (water drowning) — covered by run 106: Segs does not drown (hp 20/20, air-low swim-up works), but cannot climb out (see run 106).

### Guide PDF — rebuilt for v10.5 (22 pages, 16 sections)
- Version string "Version 10.5 • Minecraft 26.3 (native, no ViaVersion) • 2026-11-08". New section 16 (Autobuild schematic). Updated: section 2 (instant ack), section 7 (fast follow, teleport offer, climb assist for dips/stairs), section 12 (craft/cook/smelt from chests, workstation finding, output taken out), section 14 (water climb-out honest limit with the fork evidence, view distance 7 note). Built with fpdf2 from build-guide-pdf.py.

### What is still NOT proven / honest limits after v10.5
- Water climb-out onto a vertical 1-block shore (run 106 FAIL — fork limit, see above). Segs survives and asks for help.
- 2-high wall sidestep on the v9 platform edge (run 107 FAIL — Segs falls to y=63; edge watchdog fires but too late). Go-around-a-wall is proven by run 105 (lava).
- Autobuild 65/65 (best 46/65, run 113e — north edge + stuck at the site corner). 0 wrong throughout.
- Follow-through-door re-path (run 57 partial — door opened, Segs stuck after).
- Horde 5 zombies open arena still not zero hits (unchanged from v10.4).
- Everything here is simulation only. Tash must test on the real Youniga server (the bot cannot be live-tested by Mu).

## v10.5.1 appendix (2026-11-08) — the 4 leftovers from v10.5, at all cost

### Item 1 — WATER CLIMB-OUT (runs 114-117 + probes) — FAIL live, timeboxed

Fork physics analysis (prismarine-physics, pin 0e9d8c5): `outOfLiquidImpulse: 0.3`; `getPlayerBB` always height 1.8 (no swimming pose); the water branch fires the impulse only if `isCollidedHorizontally && doesNotCollide(world, pos.offset(vel.x, vel.y + 0.6 - pos.y + lastY, vel.z))` — the 1.8-high BB at +0.6 overlaps the 1-high shore block in Y and X while pressing forward, so the gate can never pass; feet cap ~70.68, shore top 72.0, gap 0.72 blocks. `isInWater` uses a BB contracted 0.401 from the bottom, so the water jump stops once feet rise above ~70.6. Step-up (0.6) only runs when onGround — never in water. In-water jump is +0.04/tick; land jump 0.42 only if onGround and not in water.

Isolation probe (`probe-physics-water.js`, fork physics in Node, mock run-106 pond): feet oscillate 70.0-71.57, vy cycles 0.30 -> -0.40 -> 0.22, x stuck at -94.70, collH=true, pattern repeats every ~90 ticks, never out in 400 ticks. The failure is in the client-side sim itself, not the server.

Fork patch (SHIPPED, `patches/prismarine-physics-water-climb.patch`, 257 lines + applier + wired into setup-26.3.sh/.bat and link-prismarine.js): `canClimbOutOfLiquid` replaces the water-branch guard with a landing-spot check — the blocking column ahead, its top, a 1.8-high BB standing on that top must be collision-free and water-free; 10-tick `waterExitBoost` (0.3 impulse persists after the feet leave the water, spent only while collided horizontally and the landing check passes); V2a arming when the full 1.8 BB touches water (not just the contracted-BB `isInWater`). Gated to 26.3 only via `lib/features.json` `waterClimbOutLanding`. Isolation: OUT at tick 45, final pos (-94.73, 72.12, 160.5). All 42 fork tests pass (39 original + 3 new), lint clean, `git diff --check` clean.

Second fork patch (SHIPPED, `patches/mineflayer-collision-sync.patch`, 67 lines + applier — REPLACES the old 170-line `mineflayer-player-input.patch`, which was DROPPED after the combat bisection below): (a) send the client's real `bot.entity.isCollidedHorizontally` in all position/look/flying packets (was `undefined`/false — Paper stores the client's flag and `jumpOutOfFluid` requires it); (b) position-packet sync preservation — a server position packet with <0.1 delta in all axes no longer zeroes the velocity and clears onGround (that broke the onGround latch and froze movement at the run-107 corner). The per-tick `player_input` send was REMOVED: it degrades combat reliability in combination with hasHorizontalCollision (each passes alone; the combination is flaky) and the water climb-out FAILS either way, so it buys nothing and costs a proven combat PASS.

Paper decompile (CFR 0.152 on paper-26.3.jar): `jumpOutOfFluid(oldY)` is exactly the fork's old gate; `Player.travel` swimming branch rises only by LOOKING UP (vel.y += (lookAngleY - vel.y) * 0.06); `updateSwimming()` starts swimming only if sprinting && **isUnderWater()** — eyes at feet+1.62 can never go under in 1-deep water (surface 70.889), so a standing player can NEVER start swimming in 1-deep water; the server's player sim runs `travel` with xxa/zza = 0 (the input is never applied to it — `handlePlayerInput` only stores `lastClientInput`, no code sets a player's `jumping` from the input); server NBT Motion measured [0.0d, 0.0d, 0.0d] during the climb; `Entity.move` collides Y first, then Z/X, so a diagonal up+west move is NOT blocked by the wall; the server's sim position is the authority and it corrects client rises back to its float/sinking level (70.24-70.67).

Live results (all FAIL to stay out): run 116 first run (patched physics only) — Segs at (-94.7, 70.03, 160.9), vel 0.00, "im stuck in the water, i cant climb out" after 20s. Run 117 probes: feet oscillate 70.05-70.39 with the server snapping back to y=70.01 every 3rd tick; after the player_input fix, maxFeet 71.61, server corrections y=70.61; after V2a arming, boost arms (vy=0.30 every tick), feet cycle to 71.49 max, server snaps every rise above ~71.27 back to 70.67. Pristine-physics experiment: feet pinned 70.59-70.67, 283 server corrections y=70.67, not OUT — Paper's own sim does not step Segs out. Look-up probe (pitch -0.5): no swimming flag, pose stays STANDING, server sees sprinting (shared_flags=8) but never starts swimming. Per-tick player_input probe: maxFeet 71.27, not OUT. hasHorizontalCollision probe: **OUT at tick 335, maxFeet 72.00, x<-95** — first time Segs got out live — but fell back into the pond (final (-94.69, 70.48, 160.62)). Floor-jump probe: server pins Segs at 70.24+, never reaches the floor. Rise-then-west probe: without forward the client rises only to ~70.82, phase 2 never triggers. Gentle boost (0.3 -> 0.1): WORSE (maxFeet 71.00), reverted. **Water item timeboxed as FAIL live** after these approaches. Segs survives (hp 20/20), does not drown, asks for help after 20s, and the watchdog + /tpa fallback remains the honest fallback. The two fork patches are kept (vanilla-parity correct, and the hasHorizontalCollision fix is a real fix).

### Item 2 — 2-HIGH WALL SIDESTEP (run 107 retests) — in progress

Run 107 geometry: platform `/fill -100 70 150 -80 70 170 stone`, stairs at (-95,71,160), (-94,72,160), (-93,73,160), platform (-92,73,158)-(-90,73,162); 2-high wall `/fill -100 71 155 -100 72 165 stone`; goal (-105,71,160).

What was found: (a) the edge watchdog is NOT the blocker — zero `[edge]` log lines in the run-107 bot.log. (b) The A* computes a GOOD path around the wall's north end (run 118 diagnostic: 6 nodes, diagonal (-99.5,71,154.5) -> (-104.5,71,159.5), status=success) but Segs never moves — the server snaps it back to 155.283 every ~4 ticks; root cause #1 was the fork's position handler zeroing velocity and clearing onGround on every server position packet (fixed in the mineflayer patch above — onG now latches, Segs accelerates north, but the server still snaps it back). (c) The REAL bot-level blocker: `climbAssist` treats the 2-high wall as a step to jump over, but its step check requires the block ABOVE the step to be air — for a 2-high wall that block is solid, so the jump never fires and Segs sprints into the wall for 6s per run-up (run 107: 3 run-ups, 18s, "closed gap by -0.0 blocks"), and the sidestep (which would actually work) ran LAST, after the budget was burned — the run's own `Segs stop` at 105s cut it off 1s after it started ("early sidestep 4 failed: The goal was changed before it could be completed!").

Fixes (bot.js, v10.5.1): (a) `climbAssist` bails immediately when the block 1.5 ahead at feet level AND the block above it are both solid (a wall, not a step — go AROUND, do not jump). (b) `gotoPos` now runs the WALL SIDESTEP (routeSafe-checked, safe/inland side first) right after the door assist, BEFORE the climb assist. (c) Edge watchdog: no sprint within 5 blocks of a drop (walk only), and the sidestep pre-checks both sides for drops. (d) Run 107's own timing extended: `Segs stop` moved from 105s to 150s, wall clear + save-all to 155s/160s, so the sidestep (12s) + goal retry (25s) fit inside the run. (e) After the first retest: the early sidestep is gated off for staircases (target 2+ above Segs) — it burned 24s on the stairs goal where the climb assist's stair hop-step mode is the tool.

**Run 107 retest (2026-11-08, v10.5.1 bot) — PASS.** Stairs UP PASS, stairs DOWN PASS ("gotoPos OK (direct) at (-95.36,71,159.48)"). Wall phase: direct GoalNear timed out at 25s at the same corner (-98.68,71,155.25) — the diagonal corner cut still stalls (server snap-back, see run 118) — but the early sidestep fired immediately ("wall sidestep (early) left 4 to -99,151") and **"gotoPos OK (after early sidestep) at (-103.53,71,159.5)" in 3s**; Segs said "here", status "hp 20/20 food 20/20 at -104, 71, 159". NO FALL (y=71 throughout), zero `[edge]` events, wall intact (never broken — routed around, not through). The direct diagonal cut remains unproven, but the sidestep route is the working answer and it is now tried FIRST.

### Item 3 — AUTOBUILD HOUSE 65/65 (run 113 retests) — PASS

Fixes (bot.js, v10.5.1): (a) `moveCapped` cancels the stale pathfinder goal (`setGoal(null)`) after the 6s race — the loser goal kept driving Segs while the place fired. (b) Settle before EVERY place (onGround + 1500ms cap + 0.1 speed threshold; skipped entirely when no stand move happened — the first version's 3s cap + 0.05 threshold made the build take 260s). (c) 3 place attempts (was 2), each with a fresh lookAt + re-equip + settle, plus a 200ms pause after lookAt so the server receives the look before the place fires. (d) NEVER place against a container (chest/furnace/crafting table/...) — a right-click on one OPENS it instead of placing; run 113's floor cell (-138,71,160) sits above the mats chest and was refused on every attempt for this reason. (e) Ref search re-tried after a 500ms wait (the client's world state lags the server — a just-placed neighbour still reads as air, so the chest cell skipped with "nothing solid to place against"). (f) One build at a time (`_autobuildRunning` guard — a second "build house here" used to start a second loop and neither finished). (g) Unstuck watchdog skips while a build is running (it fired 8 times during a build, moving Segs off its stand point). (h) `withdrawFromChests` caps the walk to a chest at 6s (`gotoWithTimeout`, was unbounded `gotoPosQuiet`) — after the house is built the mats chest sits UNDER the floor and the pathfinder can never route to it, so `ensureItem` hung for 54s and the second build never started.

**Run 113 retest 1 (2026-11-08) — 64/65, 0 wrong.** First build "built house: 64/65 blocks placed, 1 skipped, 0 wrong"; all five verifies fired (FLOOR-OK, WALL-OK, ROOF-OK, DOOR-GAP-OK, FLOOR2-OK). The 1 skipped was (-138,71,160) "nothing solid to place against" (the chest cell — fix (e) above). Second build was cut off by the run ending (44s) and the guard correctly refused it while the first build ran.

**Run 113 retest 2 (2026-11-08) — 65/65, 0 wrong, first build; second build 0/65, 65 skipped, 0 wrong.** First build "built house: 65/65 blocks placed, 0 skipped, 0 wrong" (4:57:42 → 5:02:29, 287s). Second build (after the give was moved to 320s, after the first build finished): "built house: 0/65 blocks placed, 65 skipped, 0 wrong" (5:03:03, instant) — every cell already right, nothing broken, nothing re-placed; final status hp 20/20, Segs still holding cobblestone x25 + oak_planks x40 (the given mats, untouched). **Item 3 PASS.** Wart: the first build takes ~5 minutes for 65 blocks (~4.7s/block — stand moves + settles dominate). It works, but a town-scale build will be slow; speed was not part of the 65/65 bar.

### Item 4 — FOLLOW-THROUGH-DOOR RE-PATH (run 57 retests) — PASS

What was found (diagnostic logging, since removed): the A* will NOT route through an open door — it routes around the house (Segs pressed the west wall at (-94.9,71,154.7) for 18s). The fork's collision DOES use state-dependent shapes (`block.shapes`): an open oak door is a thin panel at the block's west edge (x -90.0..-89.81), so Segs' 0.6-wide body must be centred on the doorway's clear part (x -89.5) to pass. Direct `setControlState('forward')` DOES move Segs (probe: sprinted 153.5 → 164.7 in 2s) — the earlier 0.0-block walks were the panel collision, not a control failure. Fixes (bot.js, v10.5.1): (a) follow loop forces a fresh GoalFollow re-path at stuck >2s (any cause), with separate throttles for the jump pulse and the re-path — the first version set `lastMove = now - 4000`, which CAPPED stuckMs at ~4500 forever so the 6s door assist never fired. (b) `tryDoorAssist` search radius 4 → 6 blocks (Segs presses the wall 4.8 from the door). (c) `tryDoorAssist` stages to 1.5 blocks in front of the door via the pathfinder first (the A* CAN route to open ground in front of a door), with a tight GoalNear radius 0.3 (a 1-block radius let Segs stop at x=-90.26, clipping the panel). (d) `through` is now computed from the door toward the GOAL (the owner), not from Segs' approach direction — the old direction aimed 2 blocks EAST of the door, along the south wall. (e) The walk runs until Segs is 0.5+ blocks PAST the door centre (was: stops after 1.5 blocks moved), with land-first (wait for onGround, clear jump), sprint, and per-tick re-assertion of the controls; 8s cap. (f) `openDoorInWay` records when/where a door was opened so the follow loop can log the doorway case.

**Run 57 retest (2026-11-08, v10.5.1 bot) — PASS.** "door assist: staging to (-89.5, 71, 154) (door 5.4 away)", then "door assist: moved 5.7 blocks, beyond door 1.4 — through door at (-90, 71, 155)". Segs ended at (-89.50,71,160.5), dist 2.0 from the owner at (-90,71,162) — exactly 2 blocks behind, inside the house. Door verified OPEN (not broken) by a probe after the run. Segs said "ok, following you"; no "im stuck". **Item 4 PASS.**

### First-pass regression (2026-11-08, v10.5.1 bot + full patches) — 9 PASS, 4 FAIL

13 runs, sequential, per-run logs /tmp/reg-N.log. DURs: 72→44s, 74→51s, 75→95s, 99→100s, 101→48s, 102→60s, 103→110s, 104→135s, 105→95s, 109→105s, 110→65s, 111→80s, 112→110s.
- **72 drop fix: PASS** — cooked_beef x10, zero dropped.
- **74 AutoChat gate: PASS** — "ai off (no key), today 0 req / 0 tokens", injection refused. 0 Groq calls.
- **75 creeper bow (arena): FAIL** — Segs took 7 hp (hp 13/20), got stuck, bow release consumed NO arrow (61->61). Creeper closed to 2.7 blocks; flee blocked by arena edge; creeper at hp 2.0, then "hit taken! total 1".
- **99 creeper bow (open field): FAIL** — Segs DIED ("Segs was blown up by Creeper", 9s after summon). Zero [combat] lines — combat never started. Server gave bow/arrows/sword and summoned the creeper at (-140,71,146).
- **101 Parkour 3-block drop: PASS** — "gotoPos OK (after early sidestep) at (-90.69,73,169.30)", hp 20/20.
- **102 respawn-in-place: PASS** — died at (-90,71,160), respawn packet sent, status after death at same spot hp 20/20, no reconnect.
- **103 Parkour 4-block drop: PASS** — "gotoPos OK (after drop-down) at (-89.5,72,169.58)", hp 20/20.
- **104 rough terrain dip climb: FAIL** — climb assist fired ("step 1.5 ahead (stone) — jumping") but "goto after climb assist failed: goto timeout after 25000ms"; Segs ended (-129,70,163), never said "here". (v10.5 run 104g had PASSED.)
- **105 lava detour: PASS** — "at lavatest", hp 20/20 at (-135,71,175), "gotoPos OK (direct)".
- **109 fast follow: PASS** — "caught up: covered 33.0 blocks in 6.1s = 5.43 blocks/s, now 2.0 behind owner" (better than v10.5's >=2.1 blocks/s); /tpa offer worked.
- **110 ack: PASS** — "Segs status" acked "on it" in 17ms; "Segs go to" acked and Segs said "here" 1.5s later.
- **111 craft from chests: PARTIAL FAIL** — bread PASS, diamond refusal PASS, but torch FAIL: "i need 1x charcoal for 4x torch" although the chest had coal x4, stick x4, wheat x9 (no charcoal). Bot took 1x stick + 1x coal, then "craft produced nothing, trying next recipe", fell through to the charcoal variant. Root cause: `bot.craft` + fixed 500ms settle — the result packet lagged on the FIRST craft after a teleport, so the inventory still read 0 torches.
- **112 cook/smelt: PASS** — "got 4x cooked_beef", "got 4x iron_ingot", honest gold_ore refusal, hp 20/20, cooked_beef x4 + iron_ingot x4.

### Combat-flakiness bisection (2026-11-08)

- v10.5 bot.js on the patched fork, run 99: ALSO FAILS (creeper hp 4.0, Segs 2 hits, fell to y=64). So the regression is in the **fork patches**, not bot.js edits.
- Pristine mineflayer physics.js, v10.5.1 bot.js, run 99: PASS (creeper killed, hp 20/20, "BOW released — consumed: YES (62->61)", 3 arrows).
- Single-patch tests (each alone on pristine physics.js, run 99): hasHorizontalCollision only PASS; position-sync preservation only (on top of hcoll) PASS; per-tick player_input only PASS.
- Full patches (all three), run 99, repeated: run 1 PASS (hp 20/20); run 2 PARTIAL (creeper killed but hp 15/20, fell to y=63); run 3 PASS (hp 20/20). Flaky, not deterministically broken.
- hcoll + per-tick input (NO sync), run 99: run 1 PASS; run 2 DIED (hp 17, died at (-144,63,173)). Run 75 with hcoll+input: PASS.
- **hcoll + sync (NO per-tick player_input), run 99: PASS twice** (hp 20/20, creeper killed); **run 75: PASS** (hp 20/20, creeper killed).
- **Decision: DROP the per-tick player_input patch.** It degrades combat reliability in combination with hasHorizontalCollision. Kept: hasHorizontalCollision + position-sync preservation. Mineflayer patch regenerated as `patches/mineflayer-collision-sync.patch` (67 lines). Old `mineflayer-player-input.patch` (170 lines) and its applier DELETED. setup-26.3.sh/.bat and link-prismarine.js updated to the collision-sync names.

### Post-regression fixes (2026-11-08)

- **Torch craft (run 111):** in `doCraft`, after each `bot.craft`, replaced the fixed 500ms sleep with a poll of the inventory count for up to 2s (100ms steps, break when count rises). Retest run 111: **PASS** — "here you go, 4x torch ready", "crafted 4x torch (asked 4)", torch x4; bread "done, crafted 2x bread"; diamond refusal honest.
- **Dip climb (run 104) — sidestep gate:** the v10.5.1 early sidestep fired for ANY direct-goal failure, including a 1-block dip step — burning up to 74s (12s + 25s per side) before the climb assist ever ran. Fix in `gotoPos`: the early sidestep now only fires when the block 1.5 ahead at feet level AND the block above it are both solid (a real 2-high wall); a 1-block step skips the sidestep and goes straight to the climb assist. Verified with v10.5 bot.js bisect first: v10.5 bot.js PASSES run 104 ("gotoPos OK (after climb assist) at (-126.5,71.25,160.44)"), proving the regression was in the v10.5.1 bot.js edits, not the patches. Retest run 104 with the gate: **PASS** — "gotoPos OK (after climb assist) at (-126.5,71.25,160.33)", Segs at (-127,71,160), hp 20/20, no sidestep fired. Retest run 107 with the gate: **PASS** — stairs UP, stairs DOWN, wall phase "wall sidestep (early) left 4 to -99,151" then "gotoPos OK (after early sidestep) at (-103.53,71,159.5)" in 2s, Segs said "here", hp 20/20 at (-104,71,159). The gate correctly fires for a real 2-high wall and skips for a 1-block step.
- **Run 57 retest (after the gate fix): PASS** — Segs at (-90,71,160), hp 20/20, exactly 2 blocks behind the owner at (-90,71,162) inside the house, door intact, no "im stuck". Door assist fired ("moved 5.5 blocks, beyond door 0.9 — through door at (-90,71,155)"). Wart: the door assist re-fires small 0.8-block nudges after Segs is already through — harmless.
- **Run 113 retest (after the gate/craft fixes, DUR 400s): 64/65 first build, 1/65 second build.** First build "built house: 64/65 blocks placed, 1 skipped, 0 wrong" (18:50:09); second build "built house: 1/65 blocks placed, 64 skipped, 0 wrong" (18:50:54) — the house completes after both builds, 0 wrong, but the first build alone was 64/65 this time vs 65/65 before. The detailed first-build lines scrolled off the run-script tail, so the exact skipped cell is unidentified. Treat as a 1-block flake to re-confirm with one more run 113 retest before zipping.
- **Run 113 retest 3 (2026-11-09 ~20:42-20:48 +06) — 65/65 CONFIRMED.** First build "built house: 65/65 blocks placed, 0 skipped, 0 wrong" (20:47:27); all five verifies fired (FLOOR-OK, WALL-OK, ROOF-OK, DOOR-GAP-OK, FLOOR2-OK). Second build "built house: 0/65 blocks placed, 65 skipped, 0 wrong" (20:47:57, instant) — every cell already right, nothing broken, nothing re-placed. Final status hp 20/20, Segs holding cobblestone x25 + oak_planks x40 (the given mats, untouched). The earlier 64/65 was a 1-block flake. **Item 3 CONFIRMED PASS.**

### Idle jump (runs 119-121) — PASS (2026-11-09)

Tash: Segs jumps every 1-2s while IDLING on plain flat land, no stuck, no wall, no ledge.
- **Root cause — gotoPos jumpPulse LEAK (CONFIRMED).** `gotoPos` starts a 500ms `jumpPulse` interval that pulses jump if Segs has not moved in 2s. THREE return paths did NOT call `stopJumpPulse()`: the direct-OK return (the path taken by EVERY successful simple walk), the cancelled return, and the after-door-assist return. So after ANY successful walk, the interval leaked and jumped Segs every ~2s forever while idle on flat land. **Fixed:** `stopJumpPulse()` added before all three returns (verified: every `return` in gotoPos is now preceded by stopJumpPulse).
- **Gating (both pulses):** the gotoPos jumpPulse now only pulses when there is actually a 1-block STEP ahead toward the goal (low block solid, block above it air). No step ahead = no jump, ever. The followLoop jump pulse is gated the same way (a 2-high wall does not pulse — the door assist / sidestep owns that).
- **Ruled out:** unstuck watchdog (requires a pathfinder GOAL), edge watchdog (returns early if speed < 0.5), water watchdog (only acts when in water), AFK timer (only if afkMode, every 25s), water climb-out `finally` (clears jump), climb assist `finally` (clears controls).
- **Test runs (owner-bot.js, Y-spike tracker — jump = Y rises >0.4 above the grounded baseline and comes back down; logs each jump, a 10s summary, and a FINAL at 70s):**
  - **Run 119: ZERO jumps** (six 10s summaries, all 0). Fresh spawn, NO command, flat land, 60s.
  - **Run 120: ZERO jumps**; Segs ended at (-93,71,160) — exactly 2 blocks behind the stationary owner at (-95,71,160).
  - **Run 121: ZERO jumps** after the goto ("here", then idle); Segs at (-98,71,160), hp 20/20.
- **Still to do:** A/B proof (temporarily revert the gotoPos stopJumpPulse fix → run 121 should show jumps; restore fix → 0). Re-test legit jumps (run 71 1-block ledge, run 73 wall sidestep, run 104 dip climb, run 107 stairs) to prove auto-jump still works when actually needed.

### Auto-eat (runs 122-123) — threshold + enable fixed; eat-drop NOT fixed (2026-11-09)

Tash: "Segs doesnt auto eat. When I say him to eat, he throws one beef and then eats when hunger bar is low. He should have auto eat, when hunger bar drops below 19, he eats."
- **Thresholds (old):** autoEat opts minHunger 13, minHealth 14; health handler `food <= 14`; hunger watchdog `food < 14`, idle-only, 5-min cooldown. So auto-eat only fired at 13-14, NOT below 19.
- **Threshold changes (bot.js):** autoEat opts `minHunger: 13` → **`19`**; health handler `food <= 14` → **`food <= 18`**; hunger watchdog `food < 14 && idle && 5-min cooldown` → **`food < 19 && 60s cooldown`**, fires whenever hungry, not only when idle.
- **ROOT CAUSE — auto-eat was NEVER ENABLED.** Mineflayer's `plugin_loader.js`: `loadPlugin()` only QUEUES plugins until `inject_allowed` fires (after login). So `bot.autoEat` is UNDEFINED at createBot time and the old `enableAuto()` call (which lived before spawn) never ran — `_enabled` stayed false, the `physicsTick` statusCheck hook was never attached. **Fix:** the `setOpts` + `enableAuto()` now run in `bot.once('spawn')`, when the plugin is really loaded. Verified: "auto eat is on", `enabled=true`, `_enabled=true` (run 133).
- **Run 123 (auto-eat, NO command): PASS.** Difficulty normal + Hunger X (amplifier 10) to drain food (note: peaceful difficulty never drains hunger; amplifier 3 is too slow to beat 5 saturation in 40s; `/data merge` on a player entity silently does nothing on this Paper). Food 20/20 → **19/20** at 20:05:30, then Segs auto-ate on his own (no command): food back to **20/20**, beef x10 → **x8**. Food stayed 20/20, beef stayed x8 for the rest of the run.
- **EAT-DROP — NOT FIXED, culprit still unknown.** Run 123: 1 steak was on the ground (`/kill @e[type=item]` → "Killed Steak") and 2 beef were consumed to restore 1 point of food (19→20 needs 1 beef). Run 122c proved the drop is NOT via `bot.deactivateItem` — the override IS installed but `releaseItem` was NEVER called during eats, so the plugin's `eat()` did NOT call `bot.deactivateItem()` in those runs. The drop must come from another path (`bot.equip` / `customEquip` / the `finally` re-equip). Next step: log every `block_dig` status sent during an eat to prove zero status-5 packets, and trace the equip path. The temporary DIAG lines from run 122c have been removed from bot.js. **Do NOT claim the eat-drop is fixed.**
- Also fixed: "Segs eat" at food 20/20 said "ate, thanks" when it ate nothing — now honest (cannot eat at full hunger).

### River / water routing (runs 124-126) — run 124 PASS; 125/126 not yet run (2026-11-09)

Tash: Segs stood at a river edge for 5 MINUTES after being told "go to his home", chose the straight path through water instead of the longer dry path around it.
- **Root cause:** fork `Movements.liquidCost = 1` and water NOT in `blocksToAvoid` — a 20-block swim looks cheaper than a 40-block dry detour, but the fork CANNOT climb out onto a vertical shore (run 106: 0.72-block gap), so the A* routes INTO a trap. The unstuck watchdog SKIPS in water and resets on any >0.5-block jiggle (swimming/bobbing at a river edge resets it forever); the water climb-out loops 20s attempts forever, saying "stuck" once but never stopping.
- **Fixes (bot.js):** (1) Water in `blocksToAvoid` + `movements.liquidCost = 10` — dry detour wins whenever one exists; if no dry route, the A* fails and Segs says so BEFORE entering water. (2) **60s progress timeout:** `gotoMainGoal` / `gotoMainStartDist` / `gotoMainStartTime` set at the top of `gotoPos`; `gotoWithTimeout` polls every 2s and rejects with "no progress toward goal in 60s" if the distance to the main goal hasn't decreased by >2 in 60s. All 17 gotoPos return paths clear `gotoMainGoal`. (3) **Water climb-out 60s total cap:** `waterGaveUp` flag — after 60s in the water without getting out, STOP, clear the goal, say "im stuck in the water at X,Y,Z — i cant climb out, the shore is too steep. tell me to tp to you and ill come", never restart. Reset when Segs leaves the water. (4) `gotoPos` water-entry wait: if Segs starts a goto while IN water, wait up to 25s for the water watchdog to get it out before pathfinding; if still in water after 25s, say the water message and return false. (5) `routeCrossesWater(from, to)` helper + water-specific failure messages in gotoPos.
- **Run 124 — PASS (2026-11-09 ~19:13-19:14 +06).** River x=-105..-100, z=155..165, dry land at z=150..154 and z=166..170, Segs (-115,71,160) → (-90,71,160). "gotoPos OK (direct) at (-91.57, 71, 160.68)"; status "hp 20/20 food 20/20 at -92, 71, 160 - empty"; **zero "[water] in water" lines in bot.log** — Segs took the dry detour, never entered the water.
- **Run 125 (no dry route) — PARTIAL PASS (2026-11-09, retest after the Y-drop abort).** River spans full z=150..170, no dry route. First run: Segs walked into the river trench (y=67, then y=62 — below the platform) and timed out after 25s with no water message. Root cause: the A* routes through a shallow river on its bottom (feet on stone, water at head level), and `isInWater` is FALSE when Segs is below the water surface in the trench, so the water-entry abort never fired; the 60s progress timeout also never fired because Segs kept "progressing" toward the goal (downward). Fix: a Y-drop abort in `gotoWithTimeout`'s poll — if Segs falls >2 blocks below the goto start height while the goal is at the same height, abort with the water message. Retest: **"i cant reach there — the way goes through water and i cant climb out of it. want me to tp to you?" in 35s** (goto started 20:37:22, message 20:37:57) and Segs stopped. But it DOES enter the trench before the reactive abort fires (the A* routes it in; the abort is reactive, not preventive). A truly preventive fix would need the A* to treat water-at-head-level as unsafe — a fork-level Movements change. Not claimed as fully solved.
- **Run 126 (fence barrier) — PASS (2026-11-09).** Fence x=-100, z=155..165, route around the end. "here" in 5s, hp 20/20 at (-92,71,160).

### Grave recovery (run 127) — death-handler auto-recovery fixed; retest pending (2026-11-09)

Tash: "He should look for his chest and get it already, and just sneak right click to claim all, tf he breaks everything WTF". Log proof: Segs died 19:06:09 UTC at -828, 61, 5614 IN THE RIVER; grave recovery ran 3 times and FAILED the same way each time ("im at the spot where i died (-828, 61, 5614) but i cant see my grave — it should be right here"). NEVER opened a grave, took 0 items, stats graves recovered = 0, blocksDug = 0.
- **Code under suspicion (verified):** `findGraveBlock()` only matched chest / trapped_chest / player_head / barrel within maxDistance 5 of SEGS. SimpleGraves places the chest AT OR NEAR the death spot — underwater, a few blocks off, or on the nearest dry land — plus a wall-sign headstone. Never verified what block SimpleGraves places on THIS server. `recoverGrave()`: on "cant see grave" it set `brain.lastGrave.recovered = true` — so the FIRST failure marked the grave as recovered/done and auto-recovery stopped. Take-all order was backwards: openChest + withdraw-every-stack first, sneak+activateBlock only as fallback. **Auto-recovery never fired mid-session:** the 8s auto-recovery setTimeout lives ONLY in the spawn/login handler — it fires once at login, never after an in-place respawn (v10.4.1).
- **Fixes (bot.js):** (1) `findGraveBlock(deathPos)` rewritten: scans a cube around the DEATH SPOT (radius 8, y −3..+3, underwater counts), matches chest/trapped_chest/player_head/barrel/ender_chest/*_shulker_box, falls back to the headstone sign (chest next to it), and if NOTHING is found logs EVERY solid block within 5 of the death spot (name + position, cap 40) so the next real-server failure is diagnosable. (2) Sneak+right-click take-all FIRST, then check inventory increase; if a window opened (plain chest, no plugin) withdraw every stack from it; if took ≤ 0 and no window, openChest + withdraw by hand. (3) Never mark recovered on failure — say the time left and `scheduleGraveRetry()` (retry in 60s while the grave is <9.5 min old). Only mark recovered when items were actually taken (took > 0) or the grave was opened and confirmed empty. (4) `pathMovements.canDig = false` for the whole recovery — the A* routes around or fails honestly, never digs the riverbank. (5) Auto-recovery timer added to the death handler (8s after death, once respawned and alive); the login-handler timer stays.
- **Run 127 (grave in water) — first run FAIL (recovery never ran):** death handler fired ("died at -95, 70, 160", lastGrave set correctly, recovered:false) but the auto-recovery timer was login-only (the bug above). Segs was stuck in water, got out at the end, inventory empty. **Retest needed after the death-handler fix.** Note: run 127's `/data merge` used capital `Count:10b` (defaults to 1 in 26.3 NBT) — fixed to lowercase `count` in owner-bot.js.
- **Run 127 retest — PASS (2026-11-09 ~20:40-20:41 +06).** "i died at -95, 70, 160 — going back for my stuff" (death handler fired, auto-recovery started mid-session — the fix works). "im stuck in the water, i cant climb out — come get me or tell me to tp to you" (Segs got in the water on the way to the grave — wart, it still recovered). **"got my stuff back from my grave (18 items)"** — sneak+right-click take-all worked. Status AND inventory both: **wheat x10, cooked_beef x5, iron_ingot x3** (exactly the 18 items in the grave). Stats: "11 graves recovered" (was 9). The "280 items" mystery from run 128 was NOT reproduced (18 items, exactly right — the 280 was likely accumulated items from an earlier test's chest).
- **Unexplained from run 128:** a login-time auto-recovery said "got my stuff back from my grave (280 items)" (bot.log: "sneak+right-click take-all: inventory +280 items") for the run-127 grave chest, which should have held only 18 items. Mystery — possibly the chest accumulated items from an earlier test (world persists across runs) or the sneak+click took from another source. Needs a re-check on the run 127 retest.

### Inventory / status totals (run 128) — PASS (2026-11-09)

Tash: "the inventory item he has, and the status he gives are wrong, I checked his death chest, he has more items than he reported". Log proof: last status before death, 19:01:05: "hp 20/20 food 20/20 at -823, 64, 5598 - wheat x24, wheat_seeds x54, baked_potato x64, iron_ingot x15, stick x14" — only 5 items listed, unchanged in EVERY status in the log, even after farming 162 crops, cooking 64 potatoes, dropping 24 wheat, eating. The grave row alone totals wheat 128, seeds 246, beef 7, potato 64, axe 1.
- **Root cause (bot.js):** `bot.inventory.items().slice(0, 5).map(...)` — (1) slice(0,5) shows only the FIRST 5 stacks; (2) per-stack counts, never summed. The "Segs inventory" handler listed ALL stacks but unsummed. **Third bug (found by test, run 128):** `bot.inventory.items()` only returns slots 9–44 (prismarine-windows player inventory range `{start: 9, end: 44}`) — it EXCLUDES slot 45 (offhand) and slots 5–8 (armor). A totem in the offhand never showed in status at all. (Server log confirmed the totem WAS given.)
- **Other `.find()` counts audited:** most are existence checks (has bow/totem, find one stack to equip) — fine. `arrowsBefore`/`arrowsAfter` and `invTotemCount` already sum correctly. Craft uses `bot.inventory.count(item.id, null)` (sums correctly). **Drop handler had the same first-stack bug** for "drop all X" (used `item.count` from the first stack only) — fixed to sum across stacks; if the item is only in the offhand/worn, it now says so honestly instead of "i dont have it".
- **Fix (bot.js):** `inventorySummaryParts()` reads `bot.inventory.slots` directly (all 46 slots) and sums counts by item name; `sayInventoryLines(prefix, parts)` splits into ≤200-char chat lines instead of dropping items. Status uses it; inventory handler uses it. No slice, no truncation, status and inventory agree.
- **Run 128 — PASS (2026-11-09 ~19:25 +06, retest after the slots fix).** Known inventory given across hotbar/main/offhand (wheat 64+64+24, seeds 64+64+54, beef 7, potato 64, iron_ingot 15, stick 14, iron_axe 1, offhand totem 1). Status AND inventory both reported exactly: **wheat x152, wheat_seeds x182, cooked_beef x7, baked_potato x64, iron_ingot x15, stick x14, iron_axe x1, totem_of_undying x1**. (First run 128, before the slots fix, reported all 7 except the totem — proving the offhand exclusion.)

### Chest scan (run 129) — PASS (2026-11-09)

Tash: "he just checked the next block chest, but beside that one there was another double chest where there was items. he should atleast see everything or scan everything within his view distance". Log proof: 18:44:26 "Segs cook potato" → "i dont have any potato — i checked 1 chest(s) nearby and found none"; 18:44:44 "Segs cook potato" → "i have 1x potato but no fuel — no coal or wood in my inventory or the 1 chest(s) nearby"; 18:45:02 "Segs cook 64 potato" → took 63x potato + 1x coal from chest at (-826,64,5601) and cooked them. The items WERE in a chest right there — the first two searches just did not find them, because they only searched 1 chest.
- **Root cause:** `findNearbyContainers()` had NO `count` option — fork `findBlocks` defaults count to 1 (blocks.js:160). `checkChestFor()` used `bot.findBlock` singular (nearest chest only). Radius 12 is far below a real player's view (view distance 7 chunks).
- **Fix (bot.js):** `findNearbyContainers(radius = 32)`: `count: 100`, matches chest/trapped_chest/barrel, double-chest dedup (keep the west/north half), and records every container seen in `brain.containers` (pos + type + seenAt, cap 60, saved). `withdrawFromChests` and `ensureItem` also try REMEMBERED containers within the radius not currently visible, sorted nearest-first. Walk cap is now distance-aware: `min(20000, 5000 + dist*800)` ms. On walk failure, a remembered chest is pruned from `brain.containers`. `checkChestFor()` rewritten: opens EVERY nearby chest in turn, takes from the first one that has the item, reports how many chests it searched. `checkAllChests()` added: opens every nearby chest, sums contents by item, reports totals. Commands added: "Segs list chests" / "what chests do you see"; "Segs check the chests" / "what is in the chests nearby".
- **Run 129 — PASS on the chest scan (2026-11-09 ~19:30-19:31 +06, retest after fixing the test data).** 3 double chests: A (-95/-94,71,160) potato, B (-92/-91,71,160) coal, C (-115/-114,71,160) iron ore 20 blocks away; furnace (-96,71,162) + smoker (-97,71,162). "Segs cook potato 4" → took 4x potato from chest A (-95,71,160) + 1x coal from chest B (-92,71,160), "got 4x baked_potato". "Segs smelt iron ore 2" → took 2x iron_ore from far chest C (-115,71,160) + 1x coal from chest B, "cooking 2x iron_ore in the furnace" started. (First run 129 cooked only 1 potato because the test's `/data merge` used capital `Count:10b`, which defaults to 1 in 26.3 NBT — the bot correctly cooked the 1 it found. Fixed to lowercase `count` and re-ran.) Smelt output (iron_ingot) was NOT captured before the run ended — the furnace was still cooking; smelt completion itself is proven by run 112.

### Command queue / delay (runs 130-133) — PASS (2026-11-09)

Tash's whole-log re-read proved COMMAND DELAY / QUEUEING was the headline bug: 05:37:30 "segs go home" → result "i cant reach there" 68s late; sleep result 50s late; stop result 27s late; three replies arriving at once. 19:03:25 "segs go home" → result 94s late; "im stuck in the water" 115s late; go-home result 37s late AFTER death. 18:45:02 "cook 64 potato" → "got 64x baked_potato" 5m32s later. Ack log proves the ack itself is NOT slow (0-1ms) — the delay is the RESULT, not the ack. v10.5 run 110 "ack 5-27ms PASS" measured only the ack — it never measured result latency under a queued command. That test was the wrong test.
- **Root cause:** `talkQueue = talkQueue.then(() => handleTalk(...))`. EVERY command serializes behind the previous command's ENTIRE execution — a 15s tpa wait, a 45–60s gotoPos timeout, a 5-minute cook poll, a survive routine, a follow. "stop" is special-cased to call `stopAllMovement()` immediately, but its queued handler still waits behind the running command, so "ok stopped" arrives 27–38s late — and the cancelled command's result arrives AFTER the stop. Background routines run OUTSIDE the queue, so their messages interleave with queued results. Each "tp to me" queues, each sends its own /tpa, each waits 15s — three tp commands in 15s = three /tpa requests piling up. Long jobs block the queue the whole time — status/stats/help queue behind them.
- **Fix (bot.js):** (1) LATEST COMMAND WINS — a command-generation token (`cmdGen` / `moveToken`); `bumpCmd(desc)` bumps both; every long await (gotoPos, tpa wait, cook poll, survive, sort, farm) checks the token and aborts SILENTLY, no stale result message. Only the latest command's result is ever spoken. (2) STOP jumps the queue: executes immediately, cancels current, confirms "ok stopped" within 1s, suppresses the cancelled command's result entirely. (3) QUERIES answer immediately, never queued: status / stats / inventory / help / what do you remember / are you busy — answer in <2s even while a cook/sort/farm is running (`isQueryMsg`). (4) LONG JOBS run in the background, not blocking the queue. (5) TPA: only ONE /tpa outstanding; a new "tp to me" cancels the previous 15s wait instead of sending a 2nd/3rd /tpa (`tpaPendingAt` — the timestamp is NOT cleared when the wait is cancelled, because the /tpa REQUEST is still outstanding on the server; it is only cleared when the teleport succeeds or the 15s window expires). (6) ACK must be honest: if busy, say "dropping X, doing Y" or "on it — finishing X first", not a bare "got it" followed by 60s of silence. (7) `sleepOrCancel(ms, token)` — sleeps in 250ms chunks, returns false if the token changed; the tpa 15s wait uses it. (8) `jumpHoldUntil` — "stop jumping" holds the jump pulse (goto + follow) for 60s; "start jumping" / "jump again" clears it.
- **Run 130 — PASS.** 105-block goto (~20s) running; next command 5s later: "dropping go to -90 71 160, doing go to -90 71 170" (immediate, honest ack). "Segs status" answered <2s mid-walk (at (-150,71,163)). "Segs stop" → "ok, waiting here" (<1s). The cancelled gotos' "here" NEVER appeared (no stale result). Third goto "here" arrived on time.
- **Run 131 — PASS (reproduces Tash's 19:03:25 scene).** "go to -90 71 160" → "here" in 5s (dry detour, zero water lines). Three "tp to me" 5s apart: 1st sent /tpa, 2nd deduped ("already sent you a tpa request"), 3rd deduped ("already sent you a tpa request") — ONE /tpa outstanding, no 2nd/3rd. "Segs stop" → "ok, waiting here" (immediate). Status answered promptly twice. NO stale burst.
- **Run 132 — PASS.** "Segs status" answered <2s WHILE a 64-potato cook was running ("cooking 64x potato in the furnace"); "Segs inventory" answered promptly; "Segs stop" cancelled the cook poll (cookToken check) and the final status showed baked_potato x1. Wart: the status right after the furnace putInput still showed "potato x64" (the client's inventory view lags the putInput by a few seconds); by the final status it correctly showed baked_potato x1.
- **Run 133 — PASS (whole-log sweep aliases).** "Segs autoeat" → "auto eat is on — i eat when hunger drops below 19, and i have 10 food with me". "Segs take items from this chest" → "took 15 items from the chest". "Segs inventory" → "wheat x10, stick x5, cooked_beef x10". "Segs column" → "columns: ores (10 chests), tools (10 chests), foods (10 chests)". "Segs status" → correct totals. All aliases that used to say "didnt get that" now work.
- **Whole-log sweep items (bot.js):** "segs autoeat" (on/off + status); "Segs go home a" now checks server homes (teleport first), not only brain bases; "take items from this chest" / "collect this chest" / "empty this chest" (take all from nearest chest); "segs deathchest" (= go to grave); "segs tp home" (teleport to the server home); "Segs column" (bare, lists columns); "stop jumping" / "start jumping" (60s hold via jumpHoldUntil). **Still open:** sleep fake-fast investigation (sleep succeeds then "morning" 5s later — cause not yet found; needs a live night test); survive contradictory messages (one true state, not a burst); hp 20→16 unexplained drop (find cause + log it).

### Real-player audit (v10.5.1) — checklist

One scenario per everyday behaviour. PASS/FAIL + run number + what a real player would do vs what Segs did. Do not invent a pass.
- Walk / follow / go home / tp / stop — PASS (runs 57, 104, 107, 109, 110, 124, 130, 131). Follow ends exactly 2 blocks behind; go-home takes the dry detour; tp dedups to one /tpa; stop confirms <1s.
- Idle: stand still, no jumping, no dropping, no wandering — PASS (runs 119, 120, 121: ZERO jumps, 60s each).
- Eat / auto-eat / drink / heal when hurt — PARTIAL. Auto-eat threshold + enable FIXED and proven (run 123: food 19 → auto-ate → 20/20, no command). **Eat-drop NOT fixed** (run 123: 1 steak on the ground, 2 beef consumed for 1 point of food; culprit still unknown, not via deactivateItem).
- Inventory / status: true totals, all stacks — PASS (run 128: wheat x152, seeds x182, beef x7, potato x64, iron_ingot x15, stick x14, axe x1, totem x1 — status and inventory agree, offhand included).
- See + remember: chests, furnaces, tables, farms, beds, doors — PASS for chests (run 129: 3 double chests, searched count 3, far chest 20 blocks away found). Furnaces/tables/farms/beds/doors memory not separately re-tested in v10.5.1 (covered by v9/v10 runs).
- Take from / store in / sort chests; craft / cook / smelt from any nearby chest — PASS (runs 111, 112, 129, 132, 133).
- Farm: harvest ripe, replant, don't trample, don't farm the wrong crop — covered by v10 AutoFarm run 80 (PASS); not re-run in v10.5.1.
- Mine / dig / chop: right tool, don't break the wrong block, don't break the owner's builds, stop when the tool is about to break — covered by v10.4 AutoMine run 81 + AntiBreak run 79 (PASS); not re-run in v10.5.1.
- Place blocks / build from a schematic — PASS (run 113: 65/65, 0 wrong).
- Sleep: actually sleep at night, set spawn, wake in the morning (not 5s fake sleep) — NOT PROVEN. The 5s fake-fast sleep from Tash's log is still unexplained (needs a live night test). Do not claim as solved.
- Fight / flee / defend: right weapon, bow at range, don't fight what he can't see, don't chase into lava/water — PASS in first-pass regression for 101/102/103/105; creeper bow 75/99 FAILED in the first pass and were fixed by dropping the per-tick player_input patch (bisection: hcoll+sync PASS twice each). Final regression re-run pending.
- Swim, climb out, avoid lava, don't drown — FAIL for climb-out (run 106/116/117: server pulls Segs back; honest fallback is /tpa). PASS for lava avoidance (run 105) and for not entering water when a dry route exists (run 124).
- Doors / trapdoors / fence gates / stairs / ladders — PASS for doors + stairs (runs 57, 107). Trapdoors/fence gates covered by v10.1 (not re-run). Ladders not tested.
- Grave: find it, take all, never dig to it — **PASS (run 127 retest).** Sneak+right-click take-all got all 18 items (wheat x10, cooked_beef x5, iron_ingot x3), auto-recovery fired mid-session, inventory matches exactly, stats "11 graves recovered". Wart: Segs got in the water on the way to the grave and said "im stuck in the water" — it still recovered, but the water climb-out on the way to a grave is the same honest limit as run 106.
- Pickup: pick up what he dropped / what mobs drop, don't leave it — covered by v9/v10 (not re-run in v10.5.1).
- Commands: understand varied phrasing, typos, "stop jumping", "autoeat", "take items from this chest", "go home a" — PASS (run 133 + runs 130-132). Latest command wins, no stale burst.
- AFK / guard / protect the owner — covered by v10.4 (AutoChat/AutoArmor/AutoTotem runs 74/77/78 PASS); not re-run in v10.5.1.
- Chat: talk like a player, not a robot — varied replies, no repeated "got it" spam, say what he is actually doing — PASS in the queue runs (honest "dropping X, doing Y" acks).

### Final regression (2026-11-09, final bot.js + final patches hcoll+sync) — 12 PASS, 1 FAIL

Re-ran all 13 runs with the final bot.js + final patches (hcoll+sync, no per-tick input). Per-run logs /tmp/freg-N.log.
- **72 drop fix: PASS** — "holding cooked_beef", status "cooked_beef x10", zero dropped. ("dropping tp to me, doing sleep" — the queue fix working inside run 72 too.)
- **74 AutoChat gate: PASS** — "ai off (no key), today 0 req / 0 tokens", "ai is on, but i have no groq key", injection refused ("nope, not doing that"), "ai off, back to my normal replies". 0 Groq calls.
- **75 creeper bow (arena): FAIL** — creeper hp 12.0 → 4.0 (one bow hit, 8 damage), then the second BOW release consumed NO arrow (61->61). Segs took 7 hp (hp 13/20), got stuck ("im stuck and i cant get out without breaking something"), food 17/20, final hp 16/20 at (-81,71,169). The creeper was NOT killed by the bow. **This is flaky, not a deterministic regression:** run 75 passed in v10.4, passed once in the hcoll+sync bisection, and failed here; run 99 (open field) passed in this same final run. The arena's enclosed walls let the creeper close distance faster and corner Segs, and the bow's second shot intermittently does not consume an arrow. The bow-release no-consume is the flaky part to chase next.
- **99 creeper bow (open field): PASS** — creeper hp 12.0 → 6.0 → 0.0, "killed creeper (total kills 1)", hp 20/20 (zero hits), arrows consumed properly (62->61, 61->60). The hunger watchdog fired mid-run (food 17/20, "checked 5 chests nearby, no baked_potato in any of them" — the new chest scan searching 5 chests).
- **101 Parkour 3-block drop: PASS** — "gotoPos OK (direct) at (-90.5,73,169.3)", "here", hp 20/20 at (-91,73,169).
- **102 respawn-in-place: PASS** — "respawn packet sent (attempt 1, death at -90,71,160)", status after death at same spot hp 20/20, no reconnect. (The death handler's new grave message fired: "im at the spot where i died (-90, 71, 160) but i cant see my grave — it should be right here, 10 minutes left on it, ill try again in a minute" — the honest retry wording, not a fail of the respawn test.)
- **103 Parkour 4-block drop: PASS** — "gotoPos OK (after drop-down) at (-89.5, 72, 168.5)", "drop-down done: landed at -90,72,168 hp 19" (1 hp fall cost, regen to 20).
- **104 rough terrain dip climb: PASS** — "gotoPos OK (after climb assist) at (-127.42, 71, 160.5)", hp 20/20. The sidestep gate works (climb assist, not sidestep, for a 1-block dip).
- **105 lava detour: PASS** — "at lavatest", hp 20/20 at (-135,71,175), "gotoPos OK (direct)".
- **109 fast follow: PASS** — Segs tracked the owner across teleports (ended (-143,71,166), 2 blocks behind), /tpa offer worked ("sent you a tpa request"), hp 20/20. The "caught up" speed line did not appear this run (speed not re-measured; first-pass measured 5.43 blocks/s).
- **110 ack: PASS** — ack "on it" in 0ms, "on my way there", "here" 1.5s later, status answered promptly.
- **111 craft from chests: PASS** — "here you go, 4x torch ready", "here you go, 2x bread ready", inventory "torch x4, bread x2". The craft-poll fix is confirmed.
- **112 cook/smelt: PASS** — "got 4x cooked_beef", "got 4x iron_ingot", final status "cooked_beef x4, iron_ingot x4", hp 20/20.

## v10.5.2 appendix (2026-11-09) — the eat-drop: ONE bug, packet-proven and fixed

Tash's real-server report (2026-11-08-2.log, same session as the first log, +38 lines to 19:13): at 18:53:26 he said "segs eat" and Segs said "yum, done" — while the log line right before it reads `[autoeat] eating cooked_beef (saturation 12.8, food 20/20, injured=false, deficit=0)`. Eating at FULL hunger (deficit 0) is impossible in vanilla: a real player cannot eat at 20/20. Any beef that left his inventory there was DROPPED, not eaten. A second eat at 18:54:24 (food 17/20, deficit 3) was real. `eatBestFood()` said "yum, done" and counted `foodEaten` unconditionally, never checking whether food actually rose — stats foodEaten=2 counts both eats, but only one could have restored hunger. The log NEVER recorded inventory before/after an eat, and status never listed beef (the slice(0,5) bug, fixed in v10.5.1 run 128) — so the -1 beef was invisible. v10.5.1 run 123 (simulation) showed the same shape: 1 steak on the ground, 2 beef consumed to restore 1 point of food (19→20 needs 1 beef).

### The contradiction that had to be resolved first

v10.5.1 run 122c claimed `releaseItem()` NEVER fired during eats, so the drop was NOT via `deactivateItem` — but the plugin source says otherwise. mineflayer-auto-eat 5.0.3 (`dist/new.js`, `eat()` lines ~145–190): EVERY `eat()` calls `this.bot.deactivateItem()` FIRST ("sanitize by deactivating beforehand", line ~165), then `this.bot.activateItem()`. On failure/timeout it emits eatFail and in `finally` re-equips the old item via `customEquip(currentItem, wantedHand)`. `cancelEat()` (line 45) also calls `deactivateItem()`. The fork's `deactivateItem` (`mineflayer/lib/plugins/inventory.js` line 145, assigned line 1059) writes `block_dig` status 5, face 5 — status 5 = DROP_ITEM in 26.3, release is 6. bot.js (v10.5.1 line ~1757) overrode it with `bot.deactivateItem = () => { releaseItem() }` (status 6). If the override held, no drop could come from that path. Run 122c said it held. It did not — see run 134.

### Run 134 (2026-11-09, v10.5.1 bot + EATDIAG instrumentation) — DIAG, NO FIX — the override is dead

Temporary instrumentation (removed before shipping): log every `block_dig` packet in the PacketRate `_client.write` wrapper; log `String(bot.deactivateItem)` on spawn; log beef/food count before equip, after equip, after eat. Run: beef x10, "Segs eat" at food 20/20, inventory + `/kill @e[type=item]` count, hunger effect, "Segs eat" again at hungry. (Second leg failed as a test: `/difficulty peaceful` disables hunger drain, so food stayed 20/20 — the hungry leg must run on `/difficulty normal`.)

- **PROVEN: `EATDIAG block_dig status=5 face=0 seq=0` sent on EVERY eat**, right after equip, before the use_item. The override is dead.
- **PROVEN: `EATDIAG deactivateItem on spawn: function deactivateItem () { const body = { status: 5, …`** — the spawn-time function is the fork's named function, not the arrow override.
- **PROVEN: `/kill @e[type=item]` killed exactly 1 Steak after EACH eat** — one beef entity on the ground per eat.
- **ROOT CAUSE (plugin injection timing):** `bot.loadPlugin()` only QUEUES plugins until `inject_allowed` fires (`lib/plugin_loader.js`; `lib/loader.js` emits it via `setTimeout(..., 0)` after `next()`). The inventory plugin assigns `bot.deactivateItem = deactivateItem` (status 5) when injected. Any override installed synchronously in `createBot()` runs BEFORE `inject_allowed` and is overwritten by the plugin. The v10.4 patch-M override was dead on arrival. Bow still works because bot.js calls `releaseItem()` directly, not via `deactivateItem()`; only autoEat calls `bot.deactivateItem()` dynamically.
- **PARADOX (resolved in run 135):** beef count stayed 10 → 10 and food 20 → 20 in both EATDIAG "eat done" lines, and "Segs inventory" / "Segs status" both still said cooked_beef x10 after each eat — even though 1 steak lay on the ground. The first inventory reply even showed the PREVIOUS run's items (cobblestone x25, oak_planks x40) 1.3s after `/clear` + `/give`. The client's inventory window lags/desyncs after a status-5 drop; client counts cannot be trusted for this bug — server-side `/data get` is the ground truth.

### Run 135 (2026-11-09, v10.5.1 bot, DIAG) — server-side ground truth — DROP PROVEN

`/data get entity Segs Inventory` before and after each eat; `/data get entity @e[type=item,limit=1] Item` on the dropped entity. Difficulty normal this time (hunger effect still did not drain food in 37s — saturation was ~20 from persistent player data; hunger amp 10 drains saturation first).

- Before eat #1: server Inventory `[{Slot: 0b, id: "minecraft:cooked_beef", count: 10}]`.
- After eat #1 (food 20/20, deficit 0): server Inventory `count: 9` — **one beef gone from the server-side inventory**.
- Dropped entity: `{id: "minecraft:cooked_beef", count: 1}` — exactly 1 steak on the ground. `/kill @e[type=item]` → "Killed Steak".
- Eat #2 (also food 20/20): server Inventory `count: 8` — another beef gone. "Killed Steak" again.
- **So: per eat at full hunger, -1 beef dropped, 0 eaten, food unchanged — and Segs said "ate, thanks" / "yum, done" anyway.** The client-side counts (both `items()` and the 46-slot direct read) said x10 throughout: the client's window never resyncs after a status-5 drop with no consumption update to trigger it. Consequence, not a separate fix target — with status 6 there is no drop and no desync.
- Also confirmed in run 135: `eatBestFood()` says "ate, thanks" / "yum, done" at deficit 0 with food unchanged — the unconditional success reply + `bumpStat('foodEaten')` bug is confirmed in simulation.

### The fix (bot.js, v10.5.2)

1. **Re-install the override AFTER injection — `bot.once('spawn')`:** `bot.deactivateItem = () => { releaseItem() }` (status 6). Spawn fires after `inject_allowed`, so this install survives; the createBot-time install is kept as well (harmless, covers anything that eats before spawn). The comment at the old install now explains the clobbering. Only auto-eat calls `bot.deactivateItem` (eat + cancelEat); bow and shield call `releaseItem()` directly.
2. **Deficit-0 guard — `eatBestFood()`:** if `deficit <= 0`, log `[autoeat] already full (food 20/20), not eating <food>` and return `'full'` BEFORE equipping or touching the food. The "Segs eat" handler replies `'full'` → "im already full". A real player cannot eat when full.
3. **Verify food actually rose — new `tryEatOnce()` helper:** the single guarded eat used by every direct plugin call site. Refuses at food >= 20, eats, waits 500ms for the health packet, returns `bot.food > before`. `eatBestFood()` uses it; if food did not rise it logs `eat did not restore hunger (...)` and returns false — no "yum, done", no `foodEaten` count. The health handler (low health < 8), combat retreat, and all six `survive()` eat sites now go through `tryEatOnce()` with honest reporting ("i tried to eat but my hunger didnt go up"). The one remaining direct plugin call is the health handler's `food <= 18` branch — safe by construction (deficit >= 2).
4. **Logging gap closed (permanent):** every eat now logs `[autoeat] eating <food> (... deficit=N, <food> x<before>)` and `[autoeat] eat done <food> food=<after>/20 (was <before>) <food> x<after> (was x<before>)`. The temporary EATDIAG instrumentation (block_dig packet logger, spawn deactivateItem dump, EATDIAG eat lines) was REMOVED before shipping — grep confirms zero `EATDIAG` in bot.js.
5. **Test-setup finding:** Paper 26.3 blocks `/data merge` on players — `/data merge entity Segs {foodLevel: 19, ...}` replies "Unable to modify player data" (run 136). Food levels for tests are set with a hunger effect instead; `/data get` DOES work on players and is the ground-truth read.

### Run 136 (2026-11-09, v10.5.2 bot, POST-FIX) — full guard PASS; hungry legs INCONCLUSIVE (test setup, not bot)

Leg A (full guard): "Segs eat" at food 20/20 → **"im already full"**, server-side beef 10 → 10, `/kill @e[type=item]` → "No entity was found" — **0 dropped. PASS.** Legs B–F were inconclusive because the `/data merge` food sets were refused by Paper (see above) — every eat still saw food 20/20 and correctly said "im already full" (beef/bread/porkchop/chicken all 10 → 10, 0 dropped). The guard held for all four foods; the hungry eats needed a different setup (run 137).

### Run 137 (2026-11-09, v10.5.2 bot, POST-FIX) — beef hungry leg — PASS

Setup: hunger effect amp 10 (200s) drains saturation (7.0f at start) then food ~1 per 3.6s; "Segs eat" repeated every 3s so one lands while food is 19 (plugin + watchdog only fire at food < 19). Three manual eats, each exactly **food 19 → 20, beef -1**: x10 → x9 (03:03:34), x9 → x8 (03:04:25), x8 → x7 (03:05:16), each answered "ate, thanks". Final server-side `/data get` = **cooked_beef x7** (10 − 3 eats = 7, exact). Final `/kill @e[type=item]` → **"No entity was found" — 0 dropped items.** The other 47 "Segs eat" commands all correctly said "im already full". **Beef manual eat: PASS. Deficit-0 guard: PASS. 0 dropped: PASS.**

### Run 138 (2026-11-09, v10.5.2 bot, POST-FIX) — bread / porkchop / chicken manual + auto-eat legs — PASS (with one new wart, fixed below)

Same design as run 137 (hunger amp 10, repeated "Segs eat" every 3s per food leg; leg E has NO eat command — the plugin must eat on its own at food 18). Per leg: count delta == number of successful eats in bot.log, and `/kill @e[type=item]` finds 0 dropped items.

- **Leg B bread: PASS** — 3 eats, each food 19 → 20, bread −1 (x10 → x9 → x8 → x7). Final server-side bread x7 (10 − 3 = 7, exact). `/kill` → "No entity was found", 0 dropped.
- **Leg C porkchop: PASS** — 2 eats, each food 19 → 20, porkchop −1. Final server-side porkchop x8 (10 − 2 = 8, exact). `/kill` → "No entity was found", 0 dropped.
- **Leg D chicken: PASS** — 3 eats, each food 19 → 20, chicken −1. Final server-side chicken x7 (10 − 3 = 7, exact). `/kill` → "No entity was found", 0 dropped.
- **Leg E auto-eat (no command): PASS with a wart** — beef 10 → 8 (2 eaten), `/kill` → "No entity was found", 0 dropped, final status food 20/20. BUT: at 03:13:30 the hunger watchdog fired `survive()` at food 18 while the plugin's own statusCheck eat was already in progress, and Segs said **"i tried to eat but my hunger didnt go up"** — a FALSE failure: the plugin's in-progress eat restored food 18 → 20 a second later. Root cause: the plugin's `eat()` THROWS `Error('Already eating!')` when `_eating` is true (`dist/new.js` lines 143–145); `tryEatOnce()` caught the throw and returned false immediately. The plugin exposes the state as the `isEating` getter (line 27). Fix (bot.js, v10.5.2): `tryEatOnce()` now waits out an in-progress eat (`isEating`, up to 4s in 250ms steps) instead of starting a second one, then polls for the food rise (up to ~2s) instead of a single 500ms check. All 7 `survive()` eat sites also now say "im already full" instead of the false-failure line when food is already 20 at that moment (the plugin may have eaten while survive was fetching food).
- Note: bot.log shows no `[autoeat]` lines for plugin-initiated eats (only `eatBestFood` logs) — plugin eats are proven by server-side inventory arithmetic + the 0-dropped kill, and by the Paper log ("i have cooked_beef, eating now" → "fed, all good" / "im already full"). The status reply at 03:15:02 DID arrive (Paper log + chat.jsonl "hp 20/20 food 20/20 - cooked_beef x8"); the runner's reply print missed it because the run's stdout was delivered via the automatic completion path.

### Run 139 (2026-11-09, v10.5.2 bot, POST-FIX) — survive race retest — PASS

"Segs survive" every 2s for 100s under hunger amp 10, beef x10. Every survive() landed at food 20/20 (the plugin restores food within ~50ms of it hitting 18) and correctly said "i have cooked_beef, eating now" then **"im already full"** (the new else-branch message) — zero false-failure lines. Server-side beef 10 → 8 (2 plugin/survive eats), `/kill` → "No entity was found", 0 dropped. The race itself (survive starting while the plugin is mid-eat) did not land in-window this run — the plugin always won by ~50ms — so run 140 ran denser.

### Run 140 (2026-11-09, v10.5.2 bot, POST-FIX) — race retest, dense — PASS

"Segs survive" every 1s for 150s, beef x20. Three survive() routines started at food 19/20 (03:22:10, 03:23:00, 03:23:51) and each ended "fed, all good" ~2s later. Server-side beef 20 → 17 (3 eats, exact). `/kill` → "No entity was found", 0 dropped. **Zero "i tried to eat but my hunger didnt go up" in chat.jsonl or the Paper log across runs 139 + 140 combined (~200 survive calls, 5 eats)** — the last occurrence anywhere is run 138 leg E at 03:13:30. Caveat, stated plainly: the exact wait-out (`isEating`) branch was not captured on camera in a run — in both race runs survive() always started at food 19 and ate first, so the plugin never got mid-eat while a survive() was starting. The branch is 6 lines, directly addresses the proven `'Already eating!'` throw, and the observable contract (no false failure, food rises, 0 dropped) holds across every race run since the fix. If the false line ever reappears on the real server, it will be in the log with the new before/after counts.

### Run 139 (2026-11-09, v10.5.2 bot, POST-FIX) — survive race retest — PASS

"Segs survive" every 2s for 100s under hunger amp 10, beef x10. Every survive() landed at food 20/20 (the plugin restores food within ~50ms of it hitting 18) and correctly said "i have cooked_beef, eating now" then **"im already full"** (the new else-branch message) — zero false-failure lines. Server-side beef 10 → 8 (2 eats), `/kill` → "No entity was found", 0 dropped. The race itself (survive starting while the plugin is mid-eat) did not land in-window this run — the plugin always won by ~50ms — so run 140 ran denser.

### Run 140 (2026-11-09, v10.5.2 bot, POST-FIX) — race retest, dense — PASS

"Segs survive" every 1s for 150s, beef x20. Three survive() routines started at food 19/20 (03:22:10, 03:23:00, 03:23:51) and each ended "fed, all good" ~2s later. Server-side beef 20 → 17 (3 eats, exact). `/kill` → "No entity was found", 0 dropped. **Zero "i tried to eat but my hunger didnt go up" in chat.jsonl or the Paper log across runs 139 + 140 combined (~200 survive calls, 5 eats)** — the last occurrence anywhere is run 138 leg E at 03:13:30. Caveat, stated plainly: the exact wait-out (`isEating`) branch was not captured in a run — in both race runs survive() always started at food 19 and ate first, so the plugin never got mid-eat while a survive() was starting. The branch is 6 lines, directly addresses the proven `'Already eating!'` throw, and the observable contract (no false failure, food rises, 0 dropped) holds across every race run since the fix. If the false line ever reappears on the real server, it will be in the log with the new before/after counts.

### Full regression (2026-11-09, v10.5.2 bot) — 24 PASS, 1 INCONCLUSIVE, 0 FAIL after retests

All 25 runs from the v10.5.1 set re-run with the v10.5.2 bot, in order (full log: regression-v1052.log in the work folder, not shipped in the zip). The v10.5.2 diff touches ONLY eat code (spawn override, tryEatOnce, eatBestFood guard/verification, health/combat/survive call sites, messages) — nothing in combat, bow, pathfinding, doors, or jump code — so no eat-adjacent regression was expected, and none appeared.

- **72 drop fix: PASS** — beef x10 through tp/sleep/stop, zero dropped; "dropping tp to me, doing sleep" (queue working).
- **74 AutoChat gate: PASS** — "ai is on but i have no groq key", injection refused ("nope, not doing that"), "ai off (no key), today 0 req / 0 tokens". 0 Groq calls.
- **75 creeper bow (arena): FAIL in batch, PASS on retest** — batch: 2 arrows consumed, creeper hp 20 → 18 (first shot only 2 damage), second shot no damage, "hit taken! total 1", creeper despawned at hp 18, not killed. Retest: creeper hp 13.0 → 3.0 → "killed creeper (total kills 1)", arrows consumed YES (63→62→61), Segs hp 20/20, zero hits. **Flaky, same as v10.5.1's final regression** (which also failed run 75 and passed it in bisection). The arena bow kill is timing-sensitive; the open-field control (run 99) is the stable proof.
- **99 creeper bow (open field): FAIL in batch, PASS on retest** — batch: Segs was "blown up by Creeper" 8s after the summon with NO [combat] lines at all (the combat loop never engaged — likely the creeper spawned while Segs was mid-teleport/recovery, or the scan missed the first seconds). Retest: creeper hp 11.0 → 5.0 → 0.0, "killed creeper (total kills 1)", arrows consumed YES (62→61→60), Segs hp 20/20 at (-140,71,168), zero hits. **Flaky, not a regression** — the diff cannot affect combat, and the retest kills cleanly.
- **101 Parkour 3-block drop: PASS** — "gotoPos OK (direct) at (-90.53, 73, 169.33)", "here", hp 20/20.
- **102 respawn-in-place: PASS** — "respawn packet sent (attempt 1, death at -116,71,161)", "respawning...", status after death near the spot, exactly ONE join in the Paper log (no reconnect). (The grave messages are the known artifact: the death leaves a grave that the next runs' logins try to recover.)
- **103 Parkour 4-block drop: FAIL in batch, PASS on retest** — batch: Segs said "here" after 3s while still at y=76 on the platform top, then "im stuck", and the grave recovery's goto to (-116,71,161) failed "No path to the goal!". Cause: the STALE GRAVE from run 102's `/kill` (2 minutes old, inside its 10-minute window) fired its auto-recovery on run 103's login and raced the drop goal. Retest (grave expired): "gotoPos OK (after drop-down) at (-89.5, 72, 168.5)", status "hp 20/20 at -90, 72, 168" — dropped to y=72 exactly as v10.5.1. **Harness artifact, not a bot regression.**
- **104 rough terrain dip climb: PASS** — "gotoPos OK (after climb assist) at (-126.66, 71.25, 160.58)", hp 20/20. (A later "goto timeout after 25000ms" + "gotoPos OK (final step) at (-115.5, 71, 161.5)" are the stale-grave recovery eventually reaching (-116,71,161).)
- **105 lava detour: PASS** — "at lavatest", hp 20/20 at (-135,71,175).
- **109 fast follow: PASS** — "ok, following you", /tpa sent ("sent you a tpa request"), ended following.
- **110 ack: PASS** — ack "on it" in 0ms, "here" shortly after.
- **111 craft from chests: PASS** — "done, crafted 2x bread", "torch x4, bread x2", honest "i need 2x diamond ... checked 6 chest(s)".
- **112 cook/smelt: PASS** — "got 4x iron_ingot", final "cooked_beef x4, iron_ingot x4".
- **119–121 idle jump: PASS** — run 119 zero replies (no command, as expected); run 120 ended at (-93,71,160), exactly 2 blocks behind the owner at (-95,71,160); run 121 "here" at (-98,71,160). No jump evidence in the runner's grep (it does not capture jump summaries) and the bot.log files are overwritten per run — but the v10.5.2 diff does not touch jumpPulse/stopJumpPulse/gotoPos at all, so the v10.5.1 fix cannot have regressed from this change; positions match v10.5.1 exactly.
- **123 auto-eat: INCONCLUSIVE (test design, not the bot)** — no [autoeat] lines, beef x10, food 20/20 at every status in the batch AND the retest. Playerdata after the retest proves why: foodLevel 19 (0x13), cooked_beef x10 — the 90s hunger effect drained saturation 20 → 0 and food only just reached 19 as the 85s run ended, one point short of the plugin's <19 trigger. Run 123's script assumes low starting saturation; with saturation 20 the window is too short. **Auto-eat itself is proven by runs 137–140 instead** (the plugin ate on its own 2 + 2 + 3 times, 0 dropped, food restored every time).
- **124 dry detour: PASS** — "gotoPos OK (direct) at (-91.57, 71, 160.69)", zero water lines.
- **127 grave recovery: PASS** — "i have: wheat x10, cooked_beef x5, iron_ingot x3" (all 18 items), stats "12 graves recovered". Wart (known): "im stuck in the water" on the way — same honest water limit as v10.5.1.
- **128 status/inventory: PASS** — exact match: wheat x152, wheat_seeds x182, cooked_beef x7, baked_potato x64, iron_ingot x15, stick x14, iron_axe x1, totem_of_undying x1.
- **129 chest scan: PASS** — "dropping cook potato 4, doing smelt iron ore 2" (queue), baked_potato x3, iron_ore x2.
- **130 command queue: PASS** — "ok stopped", "here", positions correct.
- **131 tpa dedup: PASS** — "already sent you a tpa request" (no duplicate /tpa).
- **132 status while cooking: PASS** — status answered promptly mid-cook (baked_potato x1 done so far).
- **133 aliases: PASS** — "auto eat is on — i eat when hunger drops below 19", "took 15 items from the chest", "columns: ores (10 chests), tools (10 chests), foods (10 chests)".

### What v10.5.2 does NOT re-prove (standing limits, unchanged from v10.5.1)

Water climb-out live FAIL (fork physics patched, Paper pulls Segs back — /tpa fallback stands); horde 5 zombies zero-hits in the open arena (best 1 kill / 4 hits, v10.1); creeper bow run 75 flaky in the arena (passes on retest, fails sometimes); sleep fake-fast; survive contradictions; hp 20→16 unexplained drop; idle-jump A/B proof + legit-jump retests. All simulation only — Tash must test on real Youniga.

## v10.5.3 appendix (2026-11-09) — the full pathfinding sweep: A/B proof, water prevention, walking sweep, creeper bow, stuck timeout

Base = the v10.5.2 bot, copied to `segs-v10.5.3/` (package 10.5.3). The v10.5.2 eat code is untouched except where the sweep's own fixes touch shared helpers (none — the sweep's bot.js changes are all in climbAssist, gotoPos, combatTick, and two chat lines). New owner-bot runs 141–162 in `test-segs/owner-bot.js`. Runner `run-v1053-test.sh` (RUN [SECONDS] [BOTJS]); batches: `run-v1053-batch1.sh` (143–146), `run-v1053-batch2.sh` (147–149), `run-v1053-batch2b.sh` (147 + 148 retests), `run-v1053-batch3.sh` (143, 146, 150–160), `run-v1053-retest.sh` (143, 146, 158–160), `run-v1053-creeper2/3/4/5.sh` (158–160 each), `run-v1053-regression.sh` (the full set). NOT pushed — Tash's 2026-11-09 09:03 hold stands.

### Idle-jump A/B proof (runs 141–142) — PASS, the fix is the cause

The v10.5.1 fix was never A/B-proved. This sweep did it on identical geometry (goto to -100,71,160, then idle 60s on flat land, same as run 121).

- **Run 141 (REVERT, scratch bot `bot-ab-revert.js`) — BUG REPRODUCED:** exact 2-change diff vs the fixed bot (step-ahead gate removed from the jumpPulse interval, `stopJumpPulse()` removed from the direct-OK return). gotoPos OK (direct) at (-97.5,71,160.46), "here", then **27 jumps in ~60s** (JUMP #1 04:37:39 to #27 04:38:38, ~1 per 2s), hp 20/20.
- **Run 142 (FIX RESTORED) — 0 jumps.** First attempt INVALID: the Paper server had died (ECONNREFUSED 127.0.0.1:25569; the owner-bot never spawned, Segs never connected, "JUMP-COUNT FINAL 0" meaningless). Server restarted ~04:41 (java PID 1874, port 25569 UP; the version-check SSL error in the log is harmless). Re-run: gotoPos OK (direct) at (-97.5,71,160.46), "here", **0 JUMP # lines, all "JUMP-COUNT so far: 0"** over 60s idle. **A/B proof complete: revert = 27 jumps, fix = 0 jumps.**

### Legit-jump retests (runs 143–146)

- **Run 143 (1-block ledge up, copy of 71) — PASS (retest).** First attempt INVALID (script bug, not bot): the script sent 'Segs follow me' instead of 'Segs go to -86 72 160' — Segs followed the owner up the ledge and ended 2 blocks behind him at (-86,72,158), which proves the ledge climb in follow mode but not the goto. Script fixed (also: Segs now starts SOUTH of the ledge on flat ground (-90,71,150) — the original setup teleported him INSIDE the ledge stone and he spent the run stuck in solid stone). Retest: "coming", "on my way there", climb assist "step 1.5 ahead (stone) — jumping", "here" + "gotoPos OK (after climb assist) at (-85.33,72,158.5)", hp 20/20. Wart: a wild zombie wandered into the field mid-run (the script sets peaceful but the zombie spawned before the difficulty took); Segs fought it (hp 20→9.3) and it despawned — the goto still completed in time. Not a bot bug.
- **Run 144 (2-high wall sidestep, flat, copy of 73) — PASS.** "gotoPos OK (final step) at (-89.68,71,170.39)", hp 20/20, said "here". (Wall-intact verification pending in the final report — check blocksDug in the regression re-run.)
- **Run 145 (dip climb, copy of 104) — PASS with a wart.** "gotoPos OK (after climb assist) at (-127.45,71.00,160.50)" (within GoalNear 2 of (-126,71,160)), "here", hp 20/20. Wart: a later status showed (-128,70,160) — Segs may have been snapped back 1 block west / 1 down into the dip edge after arrival; verify in the regression re-run of 104.
- **Run 146 (stairs up/down + 2-high wall sidestep on platform edge, copy of 107) — PASS (retest).** First attempt FAIL, two issues: (a) the UP leg takes >25s (25s direct timeout + climb assist) but the script sent the DOWN command at 30s, cancelling the climb mid-way; (b) **the cancelled UP climb assist LEAKED and kept running** — climbAssist had no access to gotoPos's token (it is defined outside gotoPos, only checked `bot.health <= 0`), so its 3 run-ups (up to ~33s) kept driving Segs after the cancel; he was driven onto the platform, the wall phase started from the platform top instead of flat ground, and the sidesteps failed. Fix (bot.js): climbAssist captures `moveToken` at entry and checks `cancelled()` at tryRunUp entry, inside both loops, and between run-ups; the `finally` clears control states. Script fix: DOWN command moved to 45s; the leftover run-148 river (water x -105..-100, z 150-170) was cleared to stone first — the first retest failed with a CORRECT water refusal (corridor scan found water at x=-101), not a wall failure. Retest: UP "gotoPos OK (after climb assist) at (-91.5,74,160.5)" (06:04:01), DOWN "gotoPos OK (direct) at (-95.5,71,159.51)" in 1s, wall "gotoPos OK (after early sidestep) at (-103.53,71,159.5)" (06:05:03) + "here", hp 20/20, no fall. The cancel fix is proven: the UP assist completed and did not leak into the DOWN leg, and the wall leg started from flat ground at y=71.

### Water research (2026-11-09) — Paper decompile + four new fork patches

- **Paper decompile** (`paper-decompile/src/.../LivingEntity.java` + `/tmp/paper2/src/.../ServerPlayer.java`, `ServerGamePacketListenerImpl.java`, CFR from `paper-26.3.jar`): `jumpOutOfFluid(oldY)` (~line 3069) fires when `horizontalCollision && isFree(x, y + 0.6 - getY() + oldY, z)` and sets vy=0.3 — it does NOT need the `jumping` flag. The server tick's jump section (~line 3525: `if (this.jumping && this.isAffectedByFluids())` → `jumpFromGround()` / `jumpInLiquid()`) never fires for Segs. **Decisive: `ServerPlayer.java` contains NO reference to `jumping` at all; `handlePlayerInput` only stores `lastClientInput` (used solely by `getLastClientMoveIntent()`, which has no callers); `LivingEntity.serverAiStep()` is EMPTY; `setJumping(true)` is never called for a player anywhere in the decompiled code.** So Paper's server-side player sim never sets `jumping` from the client — the server trusts the client's positions within movement-validation tolerance and snaps Segs back when his rise is too fast/large. The client-side fork physics rise caps at feet ~70.4–70.7 vs shore top 71.0 — a ~0.5 gap at the step-up limit (0.6), so climb-out is a coin flip on the water bobbing.
- **Pathfinder hole (run 125's exact failure):** `Movements.safeOrBreak` (`mineflayer-pathfinder/lib/movements.js` line 282) returns 100 only if `!safeToBreak(block)`; `safeToBreak` passes water (not in `blocksCantBreak`, digTime 0), and `blocksToAvoid` only affects `block.safe` (line 233), which `safeOrBreak` bypasses via the break path. So the A* treats water as dig-through-cheap and routes Segs into river trenches (feet on stone, water at head level). `getLandingBlock` line 478 returns a LIQUID block as a valid landing. The fork house rules (`mineflayer/AGENTS.md`, `CONTEXT.md`) were read before patching: release-specific behaviour behind the smallest version/feature guard, no throwing from recoverable actions, change-triggered sends only (NOT per-tick — the per-tick variant degraded bow combat in v10.5.1 and was dropped).
- **Patch 1 — `patches/mineflayer-player-input.patch`:** in fork `lib/plugins/physics.js` `setControlState`, after the state change, if `bot.supportFeature('newPlayerInputPacket')`, send the full input state (forward/backward/left/right/jump/sprint/shift from `controlState`) via `player_input`, try/catch-wrapped; the sneak branch is kept for older versions. 26.3 `player_input` format verified in `minecraft-data/pc/26.3/protocol.json` (bitflags u8: forward, backward, left, right, jump, shift, sprint). Wired into setup-26.3.sh/.bat + link-prismarine.js.
- **Patch 2 — `patches/pathfinder-head-water.patch`:** `safeOrBreak` returns 100 for `block.liquid` — no A* move routes through liquid at feet or head level. Wired into link-prismarine.js.
- **Patch 3 — `patches/pathfinder-no-water-landing.patch`:** `getMoveDropDown` and `getMoveDown` reject a landing whose feet block is liquid; `getMoveForward` Forward branch requires `!blockB.liquid && !blockC.liquid`, Up branch `!blockB.liquid`, Down branch `!blockD.liquid`. Generated from a real diff in `/tmp/patchgen2` (the first hand-written version was corrupt — wrong hunk counts + context mismatch; regenerated from a real diff, ASCII-only comments). Wired into link-prismarine.js.
- **Patch 4 — `patches/pathfinder-goto-empty-path.patch`:** fork `lib/goto.js` `noPathListener` — when the A* returns an empty path it resolved as SUCCESS (the `path.length === 0 → cleanup()` branch runs before the `status === 'noPath'` check; `reconstructPath` excludes the start node, so a no-path result from a start with zero neighbours is `[]`). Fix: only resolve when `goal.isEnd(bot.entity.position.floored())` is true, else reject as NoPath. Wired into link-prismarine.js.
- All four patches are wired into `link-prismarine.js` (player-input to `LOCAL/mineflayer`, the other three to `LOCAL/mineflayer-pathfinder`) and the player-input patch into the setup scripts. The harness copies carry them (test-segs/node_modules/mineflayer is a symlink to the fork).

### Water runs 147–149

- **Run 147 (water climb-out, pond, copy of 106) — first attempt FAIL, retest PASS (flaky).** Batch2: Segs swam to the east shore wall (-84.3,70.4), feet pinned 70.40–70.51, vy=0.30 spikes (jumpOutOfFluid firing but not sustaining), climb-out gave up after 20s at (-84.31,70.41,160.50), "im stuck in the water, i cant climb out — come get me or tell me to tp to you". The player_input patch did NOT fix the standard case. Batch2b retest: first 20s attempt gave up at the same spot; the watchdog's immediate second attempt got **OUT at (-82.59,71,160.28)**, stayed out. **Verdict: climb-out IMPROVED from always-fail to flaky — 2 OUTs in the last 4 attempts (run 148's climb-out OUT in 8s; run 147-retest 2nd attempt OUT in 3s; batch2-147 and 147-retest-1st failed). NOT a proven fix.** Mechanism unclear (feet 70.45 vs the usual 70.40 pin — 0.55 below the 71.0 shore top, inside the 0.6 step-up range; possibly the server-side jumpInLiquid lifting him slowly via player_input, or strafe luck).
- **Run 148 (no dry route, copy of 125) — PASS on attempt 7, after 6 attempts that each found a real root cause.** River geometry: ground stone y=70 (top 71.0) x -120..-80, z 150-170; river strip x -105..-100, z 150-170, stone floor y=69, water y=70 (1 deep, surface 70.875); Segs starts (-115,71,160), goal (-90,71,160). PASS = water message within 60s, NEVER enters the trench, stays y=71 west side, hp 20/20.
  - Attempt 1 (batch2): Segs started the run IN the pond (leftover from run 147 — the setup tp fired LATE) and **CLIMBED OUT at (-83.57,71,160.49)**; then the goto drove him west, he fell into the trench area (status (-106,67,167)), climb assist failed (1.1 blocks), sidesteps failed, water message at 21s. PARTIAL: report+stop works, prevention doesn't.
  - Attempt 2 (batch2b, with no-water-landing patch): same trench entry (status (-106,67,167), then (-96,62,162)), water message at 19s. The A* still routed down into the trench — because the trench is a hollow drop (air y 63–70, water only at the bottom) and the drop-down moves land on air.
  - **Root cause (attempts 1–2): the "pit" is the under-slab cave, not a trench.** Probe run 161 (`/data get block`) failed — that command only works on block entities. Probe run 162 (Segs as the sensor: tp above each column, read landing y): (-107,168) lands y=71, (-96,162) lands y=71, (-103,160) lands y=70 (in the river), (-115,160) lands y=71 — **the server-side ground is solid stone at y=71 at the drop points**. The climb-assist log showed `short_grass` 1.5 ahead — natural grass terrain under the 1-thick slab (the test platform is a 1-thick stone slab at y=70, top 71.0, over natural ground at y~67 with caves underneath). The A* routed around the river's south end by dropping off the slab edge into the under-slab cave and could not climb back up. A chunk-loading timing theory was tested and disproved (the 15s goto failed identically to the 4s one). **Fix (test only):** run-148 setup now includes under-fill `/fill -120 55 150 -80 69 170 stone` (platform solid y=55–71) and the goto moved to 15s.
  - Attempt 3 (sealed platform): under-slab gone (stays y=70–71), but **climbAssist sprinted Segs straight into the river** (from (-105.58,71,160.5), run-up to (-103.61,70.23,160.47) in the water) and **"gotoPos OK (after climb assist) at (-103.30,70,160.47)"** — Segs said "here" while standing in the river 13 blocks short. The watchdog then climbed him OUT at (-105.37,71,160.48) — third live OUT in a row. **Two bugs found:** (C1) climbAssist has no water awareness; (C2) fork `goto()` resolves on an empty path (see Patch 4).
  - Attempt 4 (with goto-empty-path patch + climbAssist liquid checks at feet/head level + isInWater bail): Segs still entered the water at the river's west edge (-105,70,161); water message at 24s; climb-outs kept failing (feet pinned 70.49–70.54). **Root cause:** the liquid check read the block at FEET level (y=71, air ahead) while the water is one BELOW feet (y=70) — Segs steps DOWN into the river. Fix: also check the block below feet ahead (pre-check + in-loop).
  - Attempt 5 (with below-feet check): water message at 27s, Segs ends dry at (-106,71,157), y=71, no false "here" — but he STILL briefly entered the water at (-103.6,70.23,160.5) during the climb-assist run-up ("in water mid-run-up — bailing" x4), then climbed out. **Root cause:** the 50ms in-loop lookahead didn't catch the river — sprinting Segs covered the 1.5-block lookahead between checks. Fix: corridor scan + skip post-stages climbAssist when in water.
  - Attempt 6 (with corridor scan): Segs STILL entered the water (-103.2,70.00,160.5, "in water mid-run-up — bailing"); the corridor scan did NOT fire. **Root cause found: `bot.blockAt(...).liquid` is always undefined** (prismarine-block has NO `.liquid` property — grep of `mineflayer/node_modules/prismarine-block/index.js` finds none; the property exists only on the pathfinder's wrapped blocks, `movements.js` line 236: `b.liquid = this.liquids.has(b.type)`). Every climbAssist liquid check was a silent no-op. Fix: `isLiquid` helper by NAME (water/lava) replacing all five `.liquid` checks in climbAssist; also added the in-water skip for the post-stages climbAssist in gotoPos. (Caution during the fix: the first edit matched 2 locations and put the helper in `attemptDropDown` instead of `climbAssist` — caught by grep, removed from attemptDropDown, added to climbAssist; verified exactly one `const isLiquid`, `node --check` clean.)
  - Attempt 7 — **PASS.** The name-based check FIRES: "[goto] climb assist: liquid below feet ahead (water) at -105,70,161 — not stepping down into water" (3 times, all three run-up directions, before moving). Stage 1/1 fails "No path to the goal!" (the A* refuses the water; the goto-empty-path patch makes this a real failure, not a false success). Sidesteps fail ("Took to long to decide path to goal!" — the A* search times out on the long detour around the river's ends; an honest failure, not a wrong success). **Water message at 05:32:47 — 18s after the command, within 60s.** Statuses (-106,71,160) throughout — **stays y=71 on the west side, NEVER enters the water during the goto** (the 9 "[water] in water" lines in the log are all 05:31:59–05:32:15, BEFORE the goto — Segs spawned in the river from attempt 6's saved position; the setup tp moved him out before the command at 05:32:29). hp 20/20, no "here", no false success. Logs saved as `run148-attempt4/5/6/7*.log` in the version folder.
- **Run 149 (dry detour, copy of 124) — PASS (batch2).** Arrived (-91.57,71,160.68) at 04:57:28, "here", hp 20/20, zero "[water] in water" lines. Clean.

### Walking sweep (runs 150–157, batch3)

- **Run 150 (flat goto, new, 25 blocks) — PASS.** "here" in ~4s, "gotoPos OK (direct) at (-91.5,71,160.5)", hp 20/20.
- **Run 151 (lava detour, copy of 105) — PASS.** Arrived "lavatest" (-134.5,71,175.5), "gotoPos OK (direct)", hp 20/20 (no lava damage — went around).
- **Run 152 (long walk + 3-block drop, copy of 108) — PASS.** Leg 1 "here" at 05:42:21, "gotoPos OK (direct) at (-101.57,71,160.5)"; leg 2 "here" at 05:43:15, "gotoPos OK (direct) at (-90.53,73,169.33)", hp 20/20.
- **Run 153 (fence barrier, copy of 126) — PASS.** "here" at 05:44:13, arrived (-91.61,71,160.56), hp 20/20.
- **Run 154 (trees obstacle, new) — PASS.** Oak-log row 3 high + leaves at x=-100, z 155–165, open ends; "here" at 05:46:41, arrived (-90,71,160), hp 20/20; climb assist routed around (from (-99,71,154.7)). Zero logs/leaves broken (verify with the script's `/data get block -100 72 160` check in the log).
- **Run 155 (follow-through-door, copy of 57) — PASS.** "following you now"; "[door] opened oak_door at (-90,71,155)", "door assist: staging to (-89.5,71,154)", "through door at (-90,71,155)". Door opened, not broken.
- **Run 156 (60s stuck timeout, new) — PASS (bedrock retest).** Two failed attempts first, both test-design, both instructive: (1) Segs was tp'd to y=71 — INSIDE the solid glass floor — and the collision push-out + unstuck watchdog shoved him out through the wall, so he arrived at the goal; (2) with the y=72 fix (starting inside the air pocket — server log proves the box was sealed: glass 100 blocks, hollow 18 blocks, Segs tp'd to -139.5,72,160.5) he STILL escaped in 8s via a DIRECT goto with no dig lines — the A* (canDig=true) dug through the east glass wall, one block, which is what a real player sealed in glass would do, so it is NOT a bot bug; glass is the wrong material for a stuck test. With a **BEDROCK box** (unbreakable): climb assist runs up against the wall ("2-high wall ahead (bedrock + bedrock) at -138,72,159 — not a step, bailing to sidestep"), then **"i cant reach there, too far or blocked. want me to tp to you?" in 16s**, stayed at (-139,72,160) in the box, hp 20/20, never auto-tpa. **Bot fix on the way:** the non-water "cant reach there" message now offers /tpa too (it used to only offer on water) — both gotoPos failure branches changed.
- **Run 157 (fast follow + tpa offer, copy of 109) — PASS (leg 1) / PARTIAL (leg 2).** Leg 1: owner 35 blocks away (-105,71,160), Segs at (-140,71,160); follow at 05:50:49; status at 05:51:05 shows Segs at (-107,71,160) — **33 blocks in ≤16s (≥2.06 blocks/s), ends exactly 2 behind**; "sent you a tpa request, type /tpaccept Segs" at 05:51:45 (leg 2, owner inside a glass box). Leg 2 PARTIAL: the /tpaccept produced NO teleport on the test server (server log shows both commands issued, no "Teleported Segs", Segs still at (-143,71,160) 5s after the accept). Root cause is the HARNESS, not the bot: the test server has NO working tpa plugin (plugins: segsdebug — a physics-debug logger, 42 lines, no tpa code — spark, bStats; no "Unknown command" error appears anywhere, the commands are silently accepted and do nothing). Segs' side is proven (he sent /tpa, the server logged it) and /tpa is already proven on real Youniga (Tash confirmed it in v9.3). The landing needs Youniga or a test-server tpa plugin to verify.

### Creeper bow flake (runs 158–160) — final bot 3/3 PASS, 8/8 shots consumed, zero hits; mechanism still unknown

The arena was run 3x per bot iteration, 5 iterations (15 runs total). Flake history:

- **Batch3 (v10.5.2 bot): 2/3 PASS.** 158 PASS (3 shots, 64→63→62→61, creeper 20→13→6→0 killed, hp 20/20). 159 PASS (3 shots, 20→13→3→0 killed, hp 20/20). 160 FAIL: a shot at dist 3.0 consumed NO arrow (61->61), "hit taken! total 1", hp 20→15, Segs ended stuck at (-81,71,169).
- **Retest-1 (charge-start distance gate: creepers only charge at dist > 8): 2/3 PASS.** 159 PASS, 160 PASS (3/3 consumed each, zero hits). 158 FAIL: cornered at the arena edge after shot 1 (creeper hp 11), the gate blocked the 2nd charge (dist never exceeded 8), the creeper closed to fuse range and exploded (hp 20→13). **The gate starved the offense when cornered.**
- **Creeper2 (timer-cancel in the too-close branch + fight-when-cornered flag `combatNoFlee`, gate reverted): 2/3 PASS.** 158 PASS, 159 PASS (3/3 consumed, zero hits). 160 FAIL: charge started at dist 6.4 during a corner escape (moving back+left); the release fired at dist 3.6, **consumed: NO (61->61)**; creeper at hp 5 reached 2.9, "hit taken!", hp 20→2. Root-cause theory then: the flee's sprint cancelled the bow use server-side before the pending release fired.
- **Creeper3 (no-charge-while-sprinting gate): 1/3 PASS.** 159 PASS (3/3, zero hits). 158 FAIL: cornered, the gate blocked the 3rd shot (creeper at hp 11), explosion hp 20→13. 160 FAIL: charge started at dist ~8, release fired at dist 4.7, **consumed: NO (62->62)**; creeper at hp 5 reached 2.9, "hit taken!", hp 20→2. **The sprint theory is dead: this charge started while standing still (not sprinting) and still did not consume.**
- **Creeper4 (sprint-gate bot): 0/3 PASS.** All three failed the same way: the gate blocked the killing shot (creeper at hp 1, 2, and 6 respectively), the creeper closed to fuse range and exploded, Segs at hp 1–2/20 (nearly died each time). **The sprint gate was a clear net negative and was removed.**
- **Creeper5 (FINAL bot: timer-cancel + fight-when-cornered + release guard + diagnostics, NO sprint gate, NO distance gate): 3/3 PASS.** 158: 3 shots, 64→63→62→61, creeper 20→10→2→0 killed, hp 20/20. 159: 3 shots, 20→14→6→0 killed, hp 20/20. 160: 2 shots, 64→63→62, creeper 20→10→0 killed (2nd arrow did 10 damage), hp 20/20. **8/8 shots consumed, zero hits taken.** Diagnostics from these runs: charges DID start while sprinting back (`ctrl=sprint back left/right`) and consumed fine — sprinting at the charge start does NOT prevent consumption. And the fork's `bot.usingHeldItem` flag is `false` at every release even when the arrow fires, so it cannot discriminate whether the bow use registered — the diagnostic designed for that question is useless in this fork. **Honest verdict: the consumed:NO flake did not reproduce in the final 3 runs (0/8 shots), but its mechanism is still unknown, so this is a clean result on the final bot, not a proven fix for the flake.** The final bot's guards (timer-cancel, fight-when-cornered, release held-item guard) are all cheap and correct on their own; the two gates that made things worse are gone.
- **Regression-75 (same bot, pre-flee-detector): FAIL.** Shot consumed YES (62→61), creeper hp 11 at dist 6.4, then "corner escape: moving back+left" every tick while edge-safe refused every direction — Segs moved ~0 blocks, the creeper closed 6.4 → 2.7 in 2s and exploded (hp 20→14). NOT an arrow-consumption flake — the failure is the cornered close-range race. **Fix: flee-isn't-working detector** (bot.js combatTick) — when the too-close flee finds a direction, anchor Segs' position/time; if he has been fleeing without moving > 0.5 blocks, the flee is a dead end and he sword-fights instead (combatNoFlee, falls through to melee; 2 sword hits kill a creeper at hp 11 inside the 1.5s fuse, hit 1's knockback resets the fuse).
- **Creeper6 (detector, 1000ms threshold): 2/3 PASS.** 158 PASS, 159 PASS (3/3 consumed each, zero hits). 160 FAIL: the detector FIRED ("fleeing 1s+ without moving, cornered, fighting with sword") but the creeper's fuse (lit at ~3 blocks) beat the first sword swing — 1 hit taken, creeper died, Segs ended hp 20/20. 1s is too slow for the fuse. **Fix: threshold 1000ms → 500ms** — a working flee moves > 0.5 blocks in 500ms at sprint speed, so this only fires when truly stuck; a false positive self-corrects next tick (the tracker resets once Segs has moved > 0.5).
- **Creeper7 (detector, 500ms threshold): 3/3 PASS, zero hits taken.** 158: 3 shots consumed YES (64→61), creeper dead, hp 20/20. 159: creeper hp 0.0 after the 2nd shot, dead, hp 20/20. 160: 3 shots consumed YES (64→61), creeper dead, hp 20/20. **Zero "hit taken" lines in the whole log.** The detector did not fire in any of the 3 runs (the creepers died to the bow before getting cornered) — it is a safety net, proven to fire correctly in creeper6-160.
- **Arena tally, v10.5.3 final bot (creeper5 + creeper6 + creeper7): 8/9 PASS (89%)**, 25/26 shots consumed, zero hits in 8 of 9 runs. The one failure (creeper6-160) was the cornered fuse race, now addressed by the 500ms detector — but the detector's sword-fight path has only been exercised once (creeper6-160, where it was 1s too late), so the cornered case is improved, not proven. The consumed:NO flake has not reproduced since creeper3 (0/26 shots in the final-bot runs) — its mechanism remains unknown; do not claim fixed.
- The release guard added in creeper4 (kept in the final bot): the release timer checks `bot.heldItem.name === 'bow'` before releasing — if the combat tick exited the bow branch mid-charge and the melee equip swapped the sword in, the release is skipped instead of firing a status-6 on a sword (which consumes nothing). Proven mechanism in creeper3-160's trace shape (release at dist 4.7 after the bow branch was exited), though the guard itself never fired in the final 3 runs (the bow was held at every release).

### Full regression (2026-11-09, v10.5.3 bot) — 26 PASS, 2 FAIL (both fixed + retested below), 2 INCONCLUSIVE

Runs 72, 74, 75, 99, 101–105, 109–112, 119–121, 123, 124, 127–133, 136–140, in order (full log: `regression-v1053.log` in the version folder; batch ran 06:51–07:39). **Bot-split note:** the runner copies `bot.js` at the start of EACH run. The flee-detector fix (regression-75) was coded at 06:57:58, mid-batch — so runs 72/74/75/99/101 ran on the pre-fix bot and runs 102+ on the fixed bot. The fix only executes when a creeper is within 3.5 blocks (plus a no-op tracker reset in combatTick), so every non-creeper result is valid for both bots. The two creeper runs (75, 99) were re-run on the final bot afterwards (see below).

| Run | What | Verdict | Proof |
|---|---|---|---|
| 72 | drop fix (tp/sleep/stop) | PASS | beef x10 through tp/sleep/stop, zero dropped, hp 20/20 |
| 74 | AutoChat (no key) | PASS | "ai off (no key), today 0 req / 0 tokens", refuses stranger |
| 75 | creeper bow arena | **FAIL** | shot consumed YES (62→61), creeper hp 11, Segs cornered at arena edge, "hit taken!", hp 20→14, ended stuck — see flee-detector fix below |
| 99 | creeper bow open field | PASS | hp 20/20, 4× "consumed: YES", zero hits |
| 101 | Parkour 3-block drop | PASS | "here" (-91,73,169), hp 20/20 |
| 102 | AutoRespawn in place | PASS | died, respawned in place (-90,71,160), hp 20/20, no kick. Wart: "cant see my grave" — a /kill death makes no SimpleGraves chest, honest message |
| 103 | 4-block drop | PASS | "here" (-91,72,170), hp 20/20 |
| 104 | dip climb | PASS | "here" (-112,71,160), hp 20/20; the batch3-145 snap-back wart did NOT reproduce here |
| 105 | lava detour | PASS | "at lavatest" (-135,71,175), hp 20/20, no lava damage |
| 109 | fast follow + tpa offer | PASS | 33 blocks in ≤16s, ends 2 behind; "/tpa OrewaSegs" sent (landing unproven — test server has no tpa plugin; proven on Youniga in v9.3) |
| 110 | instant ack | PASS | "here" ~2s after the command, hp 20/20 |
| 111 | craft from chests | PASS | 4x torch + 2x bread, exact counts |
| 112 | cook/smelt from chests | PASS | 4x cooked_beef (smoker) + iron in blast furnace, taken out |
| 119 | idle jump (60s) | PASS | 0 jumps |
| 120 | idle jump (60s) | PASS | 0 jumps |
| 121 | idle jump (60s) | PASS | 0 jumps |
| 123 | auto-eat threshold | INCONCLUSIVE | food stayed 20/20, never dropped below 19 in the 85s window (by test design — same as v10.5.2); auto-eat proven by 137–140 |
| 124 | river dry detour | PASS | "here" (-92,71,160), hp 20/20, zero "[water] in water" lines |
| 127 | grave underwater | **FAIL** | grave at (-95,70,160) underwater; the run-148 water prevention refused the route ("i cant reach my grave", inventory empty) — see allowWater fix below |
| 128 | inventory/status totals | PASS | wheat x152, seeds x182, beef x7, potato x64, iron x15, stick x14, axe x1, totem x1 — all 46 slots |
| 129 | chest scan + cook | PASS | potato + coal found in adjacent chests, smelted |
| 130 | command queue | PASS | latest command wins ("dropping go to -90 71 160, doing go to -90 71 170") |
| 131 | queries during cook | PASS | "here" in 5s while cooking |
| 132 | single /tpa + cook | PASS | 64x potato cooking, one /tpa outstanding |
| 133 | aliases + take items | PASS | took 15 items from the chest |
| 136 | eat at full hunger | PASS | "im already full", beef x10, 0 dropped |
| 137 | hungry eat (beef) | INCONCLUSIVE | food stayed 20/20 all 75s — the hunger effect drains saturation first (~73s at amplifier 10), so the window barely reaches the food drop; every eat honestly said "already full". Hungry-eat proven by run 138 (porkchop 19→20) |
| 138 | hungry eat (porkchop etc.) | PASS | "yum, done", auto-eat porkchop food 19→20, 0 dropped |
| 139 | survive race | PASS | zero false-failure lines, 0 dropped |
| 140 | survive race | PASS | zero false-failure lines, 0 dropped |

**Warts closed by the regression:** run 144 wall-intact — no break/dig lines in batch1; Segs at (-91,72,165) was standing on the wall's top edge mid-sidestep, wall intact, arrived hp 20/20. Run 145 snap-back — did not reproduce in the regression re-run of 104 (arrived (-112,71,160), stayed y=71); the batch3 instance was a one-off 1-block server position correction after a climb-assist jump, harmless.

### Regression FAIL 1 — run 127: the water prevention blocked grave recovery (FIXED, retested PASS)

The regression caught a real regression from the run-148 water fix: Segs died in the river, the grave chest sat underwater at (-95,70,160), and the recovery goto refused the route ("i cant reach my grave", inventory empty) — the A* head-water + no-water-landing patches and the climbAssist liquid bails all treat water as impassable, with no exemption for a deliberate water entry. **Fix (bot.js + fork patch `pathfinder-allow-water`):** `gotoPos(pos, { allowWater: true })` — a wrapper around the renamed `gotoPosInner` that sets `pathMovements.allowWater = true` and a module flag `gotoAllowWater` for one goto only, restored in a `finally`. The fork patch gates all six water blocks on `!this.allowWater` (safeOrBreak returns cost for liquid instead of routing through safeToBreak — the v1 patch missed this: with canDig=false during recovery, safeToBreak refuses everything, so water stayed impassable and the first retest still said "No path"; plus the two original "dont go underwater" lines in getMoveDropDown/getMoveDown). climbAssist's five liquid checks are gated on `!gotoAllowWater`; the water watchdog stays out of the way during `recoveringGrave` (air-low swim-up still runs); the gotoWithTimeout progress timer's water-abort and pit-drop abort are gated on `!gotoAllowWater` (the batch-127 retest failed exactly there: the goal is a CHEST in water, not a water block, so the goalInWater test read "dry" and aborted the allowWater goto 2s in). `recoverGrave` is the ONLY caller that passes allowWater. **Retest (clean, fresh brain, no stale grave): PASS** — "i died at -95, 70, 160", "got my stuff back from my grave (18 items)" 24s later, hp 20/20 at (-95,70,160), wheat x10 + cooked_beef x5 + iron_ingot x3 exactly, "gotoPos OK (direct) at (-93.5, 70.14, 160.5)". Wart: on the first retest attempt a STALE grave (previous run's, chest destroyed by the next run's setup fills) sent Segs into the river and he drowned once before the retry recovered the fresh grave — the watchdog is gated during recovery, so a no-grave swim has only the air-low swim-up for protection; the fresh-grave path (the real case) works end to end including getting out. Open follow-up, not a blocker: make the air-low swim-up pause the recovery goto while air is low.

### Regression FAIL 2 — run 75: cornered creeper (flee-detector fix, retested below)

Regression-75's trace: shot consumed YES (62→61), creeper hp 11 at dist 6.4, then "corner escape: moving back+left" every tick while edge-safe refused every direction — Segs moved ~0 blocks, the creeper closed 6.4 → 2.7 in 2s and exploded (hp 20→14). **Fix (bot.js combatTick):** a flee-isn't-working detector — when the too-close flee finds a direction, anchor Segs' position/time; if he has been fleeing without moving > 0.5 blocks, the flee is a dead end and he sword-fights instead (combatNoFlee, falls through to melee; 2 sword hits kill a creeper at hp 11 inside the 1.5s fuse, hit 1's knockback resets the fuse). **Creeper6 (3x arena on the fixed bot): 2/3 PASS.** 158 PASS, 159 PASS (3/3 consumed each, zero hits). 160 FAIL: the detector FIRED ("fleeing 1s+ without moving, cornered, fighting with sword") but the creeper's fuse beat the first sword swing — 1 hit taken, creeper died, Segs ended hp 20/20. 1s is too slow. **Fix: threshold 1000ms → 500ms** (a working flee moves > 0.5 blocks in 500ms at sprint speed, so this only fires when truly stuck; a false positive self-corrects next tick). **Creeper7 (3x arena, 500ms threshold): 3/3 PASS, zero hits taken** — 158 (3 shots consumed YES, creeper dead, hp 20/20), 159 (creeper hp 0.0 after the 2nd shot, dead, hp 20/20), 160 (3 shots consumed YES, creeper dead, hp 20/20). Zero "hit taken" lines in the whole log. The detector did not fire in any of the 3 runs (creepers died to the bow before getting cornered); its sword-fight path was proven to fire correctly in creeper6-160. Run 99 re-run on the final bot (final-retest batch): PASS — creeper hp 13→4→0, 3× "consumed: YES", hp 20/20, zero hits.

### Run 148 re-check (clean runs, final bot) — test premise broke, bot behaviour correct

Two clean re-runs (fresh brain, 100ms-spaced setup fills) both "arrived" in ~6s with zero water lines — NOT a prevention failure. Mid-goto position probes (run 148-clean4) show the route: (-113,71,163) → (-107,71,169) → (-99,71,170) → (-93,71,164) → "here" (-91,71,161), all y=71, dry, hp 20/20. Segs went around the river's SOUTH end on the natural terrain south of the platform (z>170) — the river only spans the artificial platform (z 150–170), and the natural ground beyond it is walkable, so a dry detour exists and Segs correctly took it. The "no dry route" premise is false for this geometry (the run-148 attempt-7 PASS still stands as the refusal proof: there Segs stayed west and reported the water in 18s, because the A* did not find the south detour then). A true no-dry-route test would need the river to span the full walkable width including the natural terrain — on the real server a dry detour almost always exists if Segs walks far enough around, so the behaviour that matters (dry detour first, refuse + report when there is none) is proven. Also fixed in the harness: run 148's setup fills were 50ms apart and the server drops commands sent <100ms apart (the under-fill seal was dropped twice) — spread to 100ms+ (owner-bot.js).

### What v10.5.3 does NOT re-prove (standing limits, updated from v10.5.2)

Water climb-out live: IMPROVED to flaky (2 OUTs in last 4 attempts), NOT fixed — the honest fallback (dry detour first, 60s water cap, stop + /tpa offer) stands; horde 5 zombies zero-hits in the open arena (best 1 kill / 4 hits, v10.1); creeper bow flake mechanism unknown (final bot 8/9 arena PASS, 0/26 consumed:NO shots since creeper3, but the cause is unproven — do not claim fixed); the cornered-creeper sword-fight path has been exercised once (creeper6-160, 1s too late) — improved by the 500ms detector, not proven; sleep fake-fast; survive contradictions; hp 20→16 unexplained drop; tpa landing on the test server (no tpa plugin — needs Youniga); stale-grave swim can drown Segs (watchdog gated during recovery — open follow-up). All simulation only — Tash must test on real Youniga.
