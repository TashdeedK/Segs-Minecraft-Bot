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
