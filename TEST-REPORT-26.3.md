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
