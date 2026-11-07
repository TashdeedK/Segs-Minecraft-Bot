# Segs — Free Minecraft Bot — v9.2 (NATIVE 26.3, no ViaVersion)

100% free. No paid account, no AI chat. Runs on Node.js 22+.
Talk to it like a person. No `!` needed.

**v9 is v8 + smart sorting into a 16-column storage unit, a base map it
remembers, paper auto-crafting, and sort jobs you can stop and resume.**
Same native 26.3 fork build (Misty4119 six-repo Mineflayer fork, protocol 777).

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
