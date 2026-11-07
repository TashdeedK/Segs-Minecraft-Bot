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
