# Segs — Free Minecraft Bot (Mineflayer) — v3

100% free. No paid account, no AI chat. Runs on Node.js.
Talk to it like a person. No `!` needed.

**v3 change (2026-11-07): 26.3 kick fix + smarter chat.** The v2 bot would have been kicked ~1.5s after joining a 26.3 server with `multiplayer.disconnect.invalid_player_movement` — 26.3 requires a `client_tick_end` packet after move packets, and Mineflayer 4.39.0 never sends one (Mineflayer issue #4189, 2026-10-18). v3 wraps the client's write function so every `position` / `position_look` / `look` / `flying` packet is followed by `tick_end`. That workaround was verified by the issue reporter on Paper 26.3-205 via ViaBackwards, stable for long sessions. If you still have v2, use this v3 zip instead — same commands, same config.
**v3 chat is also smarter:** long messages are split into steps ("go to the farm and farm wheat and then come back to me"), it remembers home / farm / last task, and it can answer questions like "do you have iron", "how much wheat do you have", "what time is it", "what are you doing". Still fixed code, not AI — it just understands a lot more phrasing now.

## Talk to it — only OrewaSegs can give orders
In game chat, just type (as OrewaSegs):
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
It replies with varied fixed lines, like "on my way", "got it, coming", "ok, following you" — not the same robot line every time. It is NOT AI, it just matches what you said to a task.

Anyone can say "hi Segs" and it will say hi back. But if anyone else says "Segs follow me", it will say: "sorry, only OrewaSegs can tell me what to do" — and it will not follow them.

Old `!` commands still work as a backup, you just don't need them.

## What it does
- **tp to me** — it cannot do a real `/tp` unless it has op. It walks/runs to you with pathfinding. If you are too far / in another dimension, it will say it can't reach you.
- **Sleep** — finds a bed nearby, walks to it and sleeps. Only works at night. "Segs wake up" wakes it.
- **Follow** — sticks with you until you say "Segs stop"
- **Farm** — harvests only ripe crops and replants if it has seeds. Wheat / carrot / potato / beetroot.
- **AFK** — stands at your farm and moves/looks around every 25s so it doesn't get kicked idle.
- **Fight + protect** — auto-eats, equips best armor/sword, fights hostile mobs. "Segs guard me" also fights players who attack.
- **Survive** — auto-eat when food <= 14, backs off at low HP.
- **Craft** — "Segs craft iron pickaxe" — if it has the items, it crafts. If not, it says exactly what it needs, e.g. `i need 3x iron_ingot, 2x stick for 1x iron_pickaxe`. Needs a crafting table nearby for table recipes.
- **Pickup** — walk over dropped items and it picks them up. Or "Segs pickup" to go to the nearest dropped item.
- **Give me** — "Segs give me iron sword" drops it for you.

## IMPORTANT — Segs name + 26.3 version
**1. Same name, can't be online twice.**
You already registered `Segs` on your Mac and AFK'd with it. The bot uses that SAME name and SAME AuthMe password.
Put that same password in `config.json` — do NOT send it to me in chat.
When the bot is running as Segs, log out as Segs on your Mac first. Play as OrewaSegs instead. Same name online twice = one of them gets kicked.

**2. Minecraft 26.3 — honest warning, no absolute guarantee.**
Your server is 26.3, protocol 777. The official Mineflayer on npm (4.39.0) only supports up to 26.1. I tested this here: `minecraft-data('26.3')` fails, `26.1` works.
So this bot does this:
- `config.json` says `"version": "26.3"` as you asked.
- On start, the bot checks if Mineflayer knows that version. If not, it falls back to 26.1 and prints a clear warning in the terminal.
- 26.1 will only join a 26.3 server **if the server allows older clients** (ViaVersion / ViaBackwards plugin). ViaBackwards 5.12.0 added 26.3 server support.
- The v3 `tick_end` fix above is what makes the 26.1-via-ViaBackwards path actually stay connected — without it, even a ViaBackwards server kicks the bot in ~1.5s.
- **If your server really has no Via plugins and is vanilla 26.3, a 26.1 bot cannot join it natively.** The only native-26.3 path is a custom Mineflayer fork with 26.3 data (not on npm yet), or waiting for official Mineflayer 26.3 support. I cannot promise "absolute no failure" for that — nobody can yet, because the official library doesn't support 26.3. The fork is experimental, and I can't live-test it from here (my VM blocks direct TCP to game servers — I tested that, it returns a network-permissions message, not the real server).
- If the server kicks Segs for "outdated client", that is the 26.3 gap, not a bug in the bot. Then either:
  a) ask the server owner if ViaVersion + ViaBackwards can be added (free, 2 plugins, 5 min), or
  b) wait for Mineflayer to release 26.3 support, then just change `version` back to `26.3` and `npm update mineflayer`.

I did NOT pretend 26.3 works on plain npm — I tested it and it doesn't, yet.

**Server for this bot:** `youniga.deployd.sh:25565` (in config.json now). Is that your server, or a friend's? Who runs it — Paper, Purpur, or vanilla? If you can check the plugins list, tell me if ViaVersion is there.

## Cracked server + login plugin
- `auth: 'offline'` — no Microsoft/Mojang account needed.
- On join it auto-sends `/login <password>` from `config.json`.
- Auto-reconnects if kicked / disconnected (10s delay).

## Setup
1. Install Node.js 22 or newer from nodejs.org — check with `node --version`
2. Unzip this folder, open a terminal in the folder
3. `npm install`
4. Open `config.json` and fill it in:
```json
{
  "host": "youniga.deployd.sh",
  "port": 25565,
  "version": "26.3",
  "username": "Segs",
  "owner": "OrewaSegs",
  "authPassword": "PUT_SAME_PASSWORD_YOU_REGISTERED_SEGS_WITH",
  "farmCenter": null,
  "farmRadius": 16,
  "afkSpot": null
}
```
- `host` / `port` — `youniga.deployd.sh:25565` in the file now. If the port is different, change it.
- `version` — 26.3 in the file now. Bot will fall back to 26.1 automatically if needed, see above.
- `authPassword` — SAME password you used for Segs on your Mac. Do NOT share this file with anyone, and do NOT send the password in chat again — put it in `config.json` on your own PC only. `config.json` is in `.gitignore`, so it will never go to GitHub. Use `config.example.json` as the template in the repo.
- `farmCenter` — optional, e.g. `[100, 64, -200]`. If null, it farms around where it is when you say "Segs farm wheat".
- `afkSpot` — optional, e.g. `[100, 64, -200]` — your AFK farm spot. If null, it AFKs where it is.

5. Run it:
```
node bot.js
```
Leave that window open. If you close it / PC sleeps, the bot logs off.

## If it won't connect
- **Kicked ~1-2s after joining: "Invalid move player packet received" / `invalid_player_movement`** — that was the v2 bug, fixed in v3. Make sure you are running the v3 zip, not v2. On start the terminal should print `26.3 fix on: sending tick_end after every move packet`.
- **"Outdated client" / version error** — see 26.3 note above. Try 26.1 fallback first, check ViaVersion.
- **Wrong password** — `/login` fails. Use the exact Segs password from your Mac.
- **"Already logged in" / kicked when you join as Segs on Mac** — that's the same-name rule. Log out one of them.
- **Wrong host/port** — check your server panel.
- **Server offline / whitelist** — bot can't join if you can't join.

## Files
- `bot.js` — the whole bot
- `config.json` — your server + bot settings (keep private, never commit — see `.gitignore`)
- `config.example.json` — safe template to commit to GitHub, no real password
- `brain.json` — created when the bot runs, remembers home / farm / last task (local only, never commit)
- `package.json` — free dependencies: mineflayer, mineflayer-pathfinder, mineflayer-pvp, mineflayer-collectblock, mineflayer-tool, mineflayer-auto-eat, mineflayer-armor-manager

## GitHub — fun project repo
Mu tried to create `TashdeedK/Segs-Minecraft-Bot` on GitHub, but GitHub blocked it: `403 Resource not accessible by integration`. Mu can push to a repo, but cannot create one.
So you create it, then Mu pushes:
1. Go to github.com/new, name it `Segs-Minecraft-Bot`, public, do NOT add a README (Mu will push one).
2. Tell Mu "repo created", then Mu will push `bot.js`, `README.md`, `package.json`, `config.example.json`, `.gitignore` — no password, no `config.json`, no `brain.json`.
3. After that we can keep improving it together in GitHub, like a real project.

Built for Tash, 2026-11-07, v3. Bot name Segs, owner OrewaSegs, server 26.3, host youniga.deployd.sh.
