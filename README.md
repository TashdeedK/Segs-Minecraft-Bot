# Segs — Free Minecraft Bot — v5 (NATIVE 26.3, no ViaVersion)

100% free. No paid account, no AI chat. Runs on Node.js 22+.
Talk to it like a person. No `!` needed.

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
