// Segs - free Mineflayer bot, v10.5 - "100% at all cost" round:
//   pathfinding sweep (climb assist, lava detour, water climb-out),
//   fast follow (no re-path spam), instant ack, craft/cook/smelt from
//   nearby chests, view distance 7, Autobuild schematic tool v1.
//   v10.4.1 base: creeper bow kill, AutoChat gate, parkour drops,
//   respawn-in-place. See TEST-REPORT-26.3.md runs 104+.
//   (v9.1: bottom-first fill, owner-only commands, double-chest dedup;
//    v9: 16-column sorting + base map + A-to-Z guide;
//    v8: bed spawn, permanent home, grave recovery, pickup + store,
//    enemy evade, hunger-dependent sprint, danger avoidance;
//    v7: /tpa + /sethome /home, command queue, honest walks, goto timeout)
//   v9.2 changes: scanColumnChests anchors on the nearest container
//   (exact x,z footprint) so a continuous wall of columns no longer
//   bleeds into its neighbours; re-teaching a column MERGES instead
//   (v9.3: 'Segs tp to me' sends /tpa FIRST with no visibility check —
//   the old check blocked the request entirely when Tash was far away.)
//   (v10: PvP-god combat — threat-prioritised targeting, cooldown hits,
//   crits, sweep, strafing, surroundings check, retreat-to-heal.)
//   of overwriting; teaching a column already claimed by another
//   category is refused. Tools stay bottom-first (v9.1) until Tash
//   decides on best-at-top — that call is independent of this fix.
// Node 22+ : npm install, then edit config.json, then node bot.js
// Talk like this (only OrewaSegs can command it):
//   "Segs tp to me" / "Segs come here" / "Segs follow me"
//   "Segs sleep" / "Segs wake up"
//   "Segs farm wheat" / "Segs afk" / "Segs stop"
//   "Segs craft iron pickaxe" / "Segs craft bread 5"
//   "Segs guard me" / "Segs eat" / "Segs status" / "Segs help"
// No AI. Only fixed replies + the tasks above, with a few varied wordings
// so it does not sound like a robot repeating one line.
// Cracked server: auth offline. AuthMe: auto /login with the SAME password
// you registered Segs with on your Mac.
const fs = require('fs')
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const collectBlock = require('mineflayer-collectblock').plugin
const toolPlugin = require('mineflayer-tool').plugin
const autoEat = require('mineflayer-auto-eat').loader
const armorManager = require('mineflayer-armor-manager')
const Vec3 = require('vec3').Vec3

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'))
const OWNER = (config.owner || 'OrewaSegs').toLowerCase()
const BOT_NAME = config.username || 'Segs'

// ---- Minecraft 26.3 check ----
// Official npm Mineflayer 4.39.0 only goes up to 26.1. 26.3 data is only in
// a private fork, not on npm yet. So if config says 26.3, we try it,
// and if minecraft-data does not know it, we fall back to 26.1 and say so.
// 26.1 only works on a 26.3 server if the server allows older clients
// (ViaVersion / ViaBackwards). If it kicks you for "outdated client",
// that is the reason - not a bug in this bot.
// SEPARATE 26.3 KICK, FIXED IN THIS FILE (see tick_end block in
// createBot, Mineflayer issue #4189): 26.3 servers also kick any
// Mineflayer bot ~1.5s after join with "invalid_player_movement"
// unless it sends client_tick_end after move packets. That fix is
// already wired in - do not remove it.

// v4: resolve minecraft-data THROUGH mineflayer, not from this folder.
// npm plugins pull in a plain npm minecraft-data (no 26.3) which would
// shadow the fork's vendor overlay if we did a plain require().
// Resolving from mineflayer's own folder finds vendor/minecraft-data (26.3).
function mcDataFor (version) {
  try {
    const mfPath = require.resolve('mineflayer')
    const mcPath = require.resolve('minecraft-data', { paths: [require('path').dirname(mfPath)] })
    return require(mcPath)(version)
  } catch (e) {
    // plain require as a last resort (npm data, up to 26.1 only)
    return require('minecraft-data')(version)
  }
}

function resolveVersion (requested) {
  try {
    const mc = mcDataFor(requested)
    // minecraft-data returns null (not an error) for unknown versions
    // if another version was loaded first, so check the result too.
    if (!mc || !mc.version) throw new Error('unknown version ' + requested)
    return { version: requested, fallback: false }
  } catch (e) {
    if (requested === '26.3' || requested === '26.2') {
      console.log(`[WARN] Mineflayer npm 4.39.0 does NOT support ${requested} yet - latest is 26.1.`)
      console.log('[WARN] Trying 26.1 instead. This only works if your server allows older clients (ViaVersion).')
      console.log('[WARN] If the server kicks Segs for outdated client, use 26.3 when Mineflayer updates, or ask the server owner about ViaVersion.')
      return { version: '26.1', fallback: true }
    }
    return { version: requested, fallback: false }
  }
}
const RESOLVED = resolveVersion(config.version || '26.3')
const EFFECTIVE_VERSION = RESOLVED.version

let bot = null
let reconnectTimer = null
let loggedIn = false
let loginTried = false
let following = null
let farming = false
let farmTimer = null
let afkMode = false
let afkTimer = null
let guardMode = false
let stopping = false

// ---- v6: LOG SYSTEM — how Segs "learns" day by day ----
// Everything Segs does is written to a logs/ folder next to bot.js:
//   logs/2026-11-07.log   - human-readable daily log (one line per event)
//   logs/actions.jsonl    - one JSON object per action (time, action, result, position)
//   logs/chat.jsonl       - every chat message it heard + every reply it sent
//   logs/learning.jsonl   - every new thing it learned (base, fact, death, find)
//   logs/stats.json       - running totals (tasks done, crops farmed, deaths, uptime)
// Nothing in logs/ contains the password. logs/ is gitignored.
// To improve the bot: zip the logs/ folder and upload it here — Mu reads the
// logs, finds what went wrong or what Segs keeps doing, and fixes the code.
// Storage is kept small on purpose: logs are one line per event (no spam),
// daily files rotate, and anything older than 30 days is deleted on startup.
const LOG_DIR = './logs'
const LOG_KEEP_DAYS = 30
const LOG_MAX_BYTES = 5 * 1024 * 1024 // 5MB per file, then it starts a fresh part
try { fs.mkdirSync(LOG_DIR, { recursive: true }) } catch (e) {}
function logDay () { return new Date().toISOString().slice(0, 10) }
function logStamp () { return new Date().toISOString().slice(11, 19) }
function appendLog (file, line) {
  try {
    const p = require('path').join(LOG_DIR, file)
    if (fs.existsSync(p) && fs.statSync(p).size > LOG_MAX_BYTES) {
      fs.renameSync(p, p + '.old')
    }
    fs.appendFileSync(p, line + '\n')
  } catch (e) {}
}
function pruneLogs () {
  try {
    const cutoff = Date.now() - LOG_KEEP_DAYS * 24 * 3600 * 1000
    for (const f of fs.readdirSync(LOG_DIR)) {
      const p = require('path').join(LOG_DIR, f)
      try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p) } catch (e) {}
    }
  } catch (e) {}
}
pruneLogs()
// stats: cumulative counters, saved so they survive restarts
let stats = { started: new Date().toISOString(), tasksDone: 0, chatsAnswered: 0, cropsFarmed: 0, itemsCrafted: 0, blocksDug: 0, deaths: 0, foodEaten: 0, chestsChecked: 0, smeltsDone: 0, timesHungry: 0, itemsSorted: 0, sortsDone: 0, combatKills: 0, combatHitsTaken: 0, combatHitsLanded: 0 }
try { if (fs.existsSync(LOG_DIR + '/stats.json')) stats = { ...stats, ...JSON.parse(fs.readFileSync(LOG_DIR + '/stats.json', 'utf8')) } } catch (e) {}
function saveStats () { try { fs.writeFileSync(LOG_DIR + '/stats.json', JSON.stringify(stats, null, 2)) } catch (e) {} }
function bumpStat (key, n = 1) { stats[key] = (stats[key] || 0) + n; saveStats() }

function log (msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`) }
// logEvent: the core of the learning system. Every important thing Segs does
// goes to the daily log AND to actions.jsonl, so it can be reviewed later.
function logEvent (type, msg, extra = {}) {
  const entry = { time: new Date().toISOString(), type, msg, pos: bot?.entity ? [Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y), Math.floor(bot.entity.position.z)] : null, ...extra }
  appendLog(`${logDay()}.log`, `[${logStamp()}] [${type}] ${msg}`)
  appendLog('actions.jsonl', JSON.stringify(entry))
  log(`[${type}] ${msg}`)
}
function logChat (who, msg, reply = null) {
  appendLog('chat.jsonl', JSON.stringify({ time: new Date().toISOString(), who, msg, reply }))
}
function logLearn (what, detail) {
  appendLog('learning.jsonl', JSON.stringify({ time: new Date().toISOString(), what, detail }))
  logEvent('learn', `${what}: ${detail}`)
}
// say() talks in chat AND logs the reply, so the chat log shows both sides.
function say (msg) { try { bot.chat(msg); logChat('Segs', msg) } catch (e) { log('chat failed: ' + e.message) } }
function pick (arr) { return arr[Math.floor(Math.random() * arr.length)] }
// v10.5.1 INVENTORY FIX (Tash: status reported 5 stacks, the grave had
// 9+): the old status did items().slice(0,5) — only the FIRST 5 stacks
// ever shown — and listed per-stack counts, so wheat in two 64-stacks
// showed as one "wheat x64" and everything past stack 5 was invisible.
// THIRD bug, found by test (run 128): bot.inventory.items() only
// returns slots 9-44 (prismarine-windows: player inventory range
// {start:9, end:44}) — it EXCLUDES slot 45 (offhand) and slots 5-8
// (armor). A totem in the offhand never showed in status at all.
// So read bot.inventory.slots directly (all 46 slots: crafting,
// armor, main, hotbar, offhand) and sum counts by item name. List
// EVERY item type, no truncation. Minecraft chat caps a message at
// ~256 chars, so a long list is split into several chat lines instead
// of dropping items to fit one line.
function inventorySummaryParts () {
  try {
    const totals = new Map()
    const slots = (bot.inventory && bot.inventory.slots) || []
    for (const it of slots) {
      if (!it) continue
      totals.set(it.name, (totals.get(it.name) || 0) + it.count)
    }
    return [...totals.entries()].map(([name, count]) => `${name} x${count}`)
  } catch (e) { return [] }
}
function sayInventoryLines (prefix, parts) {
  if (!parts.length) { say(prefix + 'empty'); return }
  let line = prefix
  for (const p of parts) {
    const next = line === prefix ? line + p : line + ', ' + p
    if (next.length > 200) { say(line); line = p } else line = next
  }
  say(line)
}
function isOwner (username) { return username && username.toLowerCase() === OWNER }
function sleepMs (ms) { return new Promise(r => setTimeout(r, ms)) }

const CROPS = {
  wheat: { block: 'wheat', maxAge: 7, seed: 'wheat_seeds' },
  carrots: { block: 'carrots', maxAge: 7, seed: 'carrot' },
  carrot: { block: 'carrots', maxAge: 7, seed: 'carrot' },
  potatoes: { block: 'potatoes', maxAge: 7, seed: 'potato' },
  potato: { block: 'potatoes', maxAge: 7, seed: 'potato' },
  beetroot: { block: 'beetroots', maxAge: 3, seed: 'beetroot_seeds' },
}

// Item name helpers: "iron pickaxe" -> "iron_pickaxe", "a diamond sword" -> "diamond_sword"
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
// v10.3: quantities + filler words. "all"/"everything"/"every" means
// drop/craft ALL (count = Infinity). "x64" and "64x" both mean 64 (the
// old \b(\d+)\b needed a word boundary, and "x64" has none between
// x and 6, so the number was never parsed and became part of the item
// name — "seeds_x64", "64x_wheat_seeds", "all_seeds"). Filler words
// (yourself, your, a, an, some, please, me, the) are stripped so
// "craft yourself an axe" parses as "axe", not "yourself_axe".
function parseItemAndCount (text) {
  let t = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  let count = 1
  let all = false
  // "all" / "everything" / "every" = ALL of it
  if (/\b(all|everything|every|entire)\b/.test(t)) { all = true; t = t.replace(/\b(all|everything|every|entire)\b/g, ' ').trim() }
  // "x64" or "64x" (number glued to an x) — the old \b(\d+)\b missed these
  const xMatch = t.match(/\b(?:x(\d+)|(\d+)x)\b/)
  if (xMatch) { count = parseInt(xMatch[1] || xMatch[2], 10); t = t.replace(xMatch[0], ' ').trim() }
  else {
    const numMatch = t.match(/\b(\d+)\b/)
    if (numMatch) { count = parseInt(numMatch[1], 10); t = t.replace(numMatch[0], ' ').trim() }
    else {
      for (const [w, n] of Object.entries(NUMBER_WORDS)) {
        if (new RegExp(`\\b${w}\\b`).test(t)) { count = n; t = t.replace(new RegExp(`\\b${w}\\b`), ' ').trim(); break }
      }
    }
  }
  t = t.replace(/\b(a|an|some|please|me|the|yourself|your|my|of)\b/g, ' ').replace(/\s+/g, ' ').trim()
  const itemName = aliasItem(t.replace(/ /g, '_'))
  if (all) return { itemName, count: Infinity, all: true }
  return { itemName, count: Math.max(1, Math.min(64, count || 1)) }
}

// Common shorthand -> real Minecraft item/block names.
// "do you have iron" means iron_ingot, "wood" means oak_log, etc.
// (Simulation run 2 found this bug: "iron" is not an item name.)
const ITEM_ALIASES = {
  iron: 'iron_ingot', gold: 'gold_ingot', diamond: 'diamond', emerald: 'emerald',
  coal: 'coal', wood: 'oak_log', log: 'oak_log', logs: 'oak_logs', plank: 'oak_planks',
  planks: 'oak_planks', stone: 'stone', dirt: 'dirt', sand: 'sand', glass: 'glass',
  wheat: 'wheat', carrot: 'carrot', potato: 'potato', beetroot: 'beetroot',
  bread: 'bread', apple: 'apple', meat: 'cooked_beef', steak: 'cooked_beef',
  chicken: 'cooked_chicken', pork: 'cooked_porkchop', fish: 'cod',
  beef: 'cooked_beef', raw_beef: 'beef', raw_porkchop: 'porkchop', raw_chicken: 'chicken', raw_mutton: 'mutton', raw_rabbit: 'rabbit', raw_cod: 'cod', raw_salmon: 'salmon',
  stick: 'stick', sticks: 'stick', torch: 'torch', torches: 'torch',
  sword: 'iron_sword', pickaxe: 'iron_pickaxe', axe: 'iron_axe', shovel: 'iron_shovel',
  bow: 'bow', arrow: 'arrow', arrows: 'arrow', shield: 'shield', bed: 'white_bed',
  chest: 'chest', furnace: 'furnace', table: 'crafting_table', boat: 'oak_boat',
  seeds: 'wheat_seeds', seed: 'wheat_seeds', string: 'string', leather: 'leather',
  feather: 'feather', bone: 'bone', bones: 'bone', wool: 'white_wool',
  cobble: 'cobblestone', cobblestone: 'cobblestone', obsidian: 'obsidian',
  redstone: 'redstone', lapis: 'lapis_lazuli', quartz: 'quartz',
  netherite: 'netherite_ingot', copper: 'copper_ingot', amethyst: 'amethyst_shard',
}
function aliasItem (name) {
  if (!name) return name
  // "oak_logs" -> "oak_log" (singular) for item lookups, keep blocks as-is where needed
  const lower = name.toLowerCase()
  if (ITEM_ALIASES[lower]) return ITEM_ALIASES[lower]
  if (lower.endsWith('_logs')) return lower.slice(0, -1)
  return lower
}

// ---- Segs brain: remembers places + last task, so long messages make sense ----
// Saved to brain.json next to bot.js (NOT in the GitHub repo - see .gitignore).
// v5: MULTIPLE bases, not just one home. brain.bases = { home: [x,y,z], farm: [...], mine: [...] }
// brain.facts = things the owner taught it ("remember that ...")
// brain.macros = custom shortcuts the owner taught it ("learn daily means ...")
// brain.deaths = where it died and what killed it (it learns to be careful there)
// brain.found = where it found useful stuff (ores, farms, water)
// v6: brain.landmarks = things in the base Segs was shown, by type.
// "Segs this is the potato farm" / "Segs this is the food chest" /
// "Segs this is the smoker" / "Segs this is the furnace" — Segs stores the
// block + position, then USES it on its own when it needs food or smelting.
// Landmark types: farm (with a crop), chest, furnace, smoker, bed, table.
let brain = { home: null, farm: null, lastTask: null, lastPos: null, bases: {}, facts: [], macros: {}, deaths: [], found: {}, landmarks: {}, serverHomes: [], permanentHome: null, spawnBed: null, pendingSpawnBed: null, roomChests: [], lastGrave: null, columns: {}, areas: {}, itemChest: {}, sortJob: null, trashChest: null, sugarcaneChests: [], myRoom: null, buildSite: null, containers: [] }
try {
  if (fs.existsSync('./brain.json')) brain = { ...brain, ...JSON.parse(fs.readFileSync('./brain.json', 'utf8')) }
} catch (e) {}
// migrate v3/v4 single home/farm into the multi-base map
if (brain.home && !brain.bases.home) brain.bases.home = brain.home
if (brain.farm && !brain.bases.farm) brain.bases.farm = brain.farm
if (!brain.bases) brain.bases = {}
if (!brain.facts) brain.facts = []
if (!brain.macros) brain.macros = {}
if (!brain.deaths) brain.deaths = []
if (!brain.found) brain.found = {}
if (!brain.landmarks) brain.landmarks = {}
if (!brain.serverHomes) brain.serverHomes = []
if (!('permanentHome' in brain)) brain.permanentHome = null
if (!('spawnBed' in brain)) brain.spawnBed = null
if (!('pendingSpawnBed' in brain)) brain.pendingSpawnBed = null
if (!brain.roomChests) brain.roomChests = []
if (!('lastGrave' in brain)) brain.lastGrave = null
if (!brain.columns) brain.columns = {}
if (!brain.areas) brain.areas = {}
if (!brain.itemChest) brain.itemChest = {}
if (!('sortJob' in brain)) brain.sortJob = null
if (!('trashChest' in brain)) brain.trashChest = null
if (!brain.sugarcaneChests) brain.sugarcaneChests = []
if (!('myRoom' in brain)) brain.myRoom = null
let lastSetHome = null // name of the most recent /sethome, so the permanent home can link to it
let pendingSethome = null // { name, at } — waiting for the server's reply to /sethome
let pendingHome = null // { name, at, started, cancelled } — waiting for the /home warmup messages
let connected = false // true only while actually on the server; loops must not run on stale state
let pathMovements = null // the Movements object, so sprint + danger-avoid can be tuned live
let gotoAllowWater = false // true only during a gotoPos({ allowWater: true }) — grave recovery (run 127). climbAssist's liquid bails and the A* water blocks are skipped while set; the gotoPos wrapper restores it in a finally.
let lastEvadeSay = 0
let lastEvadeAt = 0
let sortStopRequested = false // set when the owner says stop during a sort
let sortPausedByStop = false // the sort already reported the pause; the queued stop handler stays quiet
let pendingContinue = null // { job } — Segs asked "continue this sorting or another one?" and waits for the answer
let recoveringGrave = false
function saveBrain () { try { fs.writeFileSync('./brain.json', JSON.stringify(brain, null, 2)) } catch (e) {} }
// Save the last ACTION task (not questions like "what time is it") so "do it again" works.
// (Simulation run 2 found this bug: lastTask was only saved for unknown commands,
// because every real action returned early before the save line.)
const QUERY_WORDS = ['status', 'how are you', 'what are you doing', 'where are you', 'what time', 'is it night', 'is it day', 'do you have', 'how much', 'how many', 'what do you need', 'are you busy', 'help', 'what do you remember', 'what did you learn', 'list bases']
function rememberTask (req) {
  if (!req) return
  if (QUERY_WORDS.some(q => req.includes(q))) return
  if (req === 'again' || req === 'do it again') return
  brain.lastTask = req; saveBrain()
}
function currentJob () {
  if (bot?.isSleeping) return 'sleeping'
  if (farming) return 'farming'
  if (afkMode) return 'afk'
  if (following) return 'following you'
  if (guardMode) return 'guarding'
  return 'idle, waiting for you'
}
// Clean a long sentence into the real request: strip "can you please...", "bro", etc.
function cleanClause (s) {
  return s.toLowerCase()
    .replace(/\b(can you|could you|will you|would you|can u|could u)\b/g, ' ')
    .replace(/\b(please|pls|bro|man|buddy|hey|hi|hello)\b/g, ' ')
    .replace(/[?.!,]/g, ' ')
    .replace(/\s+/g, ' ').trim()
}
// Split "go to the farm and farm wheat and then come back to me"
// into ["go to the farm", "farm wheat", "come back to me"]
function splitClauses (req) {
  return req
    .split(/\s+and then\s+|\s+then\s+|\s+and\s+|,\s+|\s+after that\s+/)
    .map(cleanClause).filter(Boolean)
    .filter(c => c !== 'segs' && c.length > 1)
}

function createBot () {
  log(`Connecting to ${config.host}:${config.port} as ${BOT_NAME} (asked ${config.version}, using ${EFFECTIVE_VERSION})...`)
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: BOT_NAME,
    version: EFFECTIVE_VERSION,
    auth: 'offline',
    // v10.5 VIEW DISTANCE 7: tell the server to send 7 chunks around
    // us. The bot does not render, so this is the main RAM lever: ~225
    // chunks instead of ~121 at view 5. Server may cap it lower/higher;
    // 7 is our request. On a 500MB-1GB machine this keeps the bot at
    // ~200-400MB. NOTE: this only sets OUR test server's view distance
    // via the client settings packet — on Youniga the SERVER owner sets
    // view/simulation distance, Segs cannot change it from the bot.
    viewDistance: 7,
  })

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(pvp)
  bot.loadPlugin(collectBlock)
  bot.loadPlugin(toolPlugin)
  // v10.5.1: the autoEat setup lives in bot.once('spawn') now (see
  // there) — bot.autoEat is undefined here, before inject_allowed,
  // but loadPlugin still QUEUES the plugin for later.
  bot.loadPlugin(autoEat)
  bot.loadPlugin(armorManager)

  // ---- 26.3 tick_end (Mineflayer issue #4189, 2026-10-18) ----
  // Since 26.3 the server kicks a client ~1.5s after join with
  // "multiplayer.disconnect.invalid_player_movement" if it sends a
  // second position packet without a client_tick_end in between.
  // v4 NATIVE 26.3 FORK: the fork's physics loop already sends
  // tick_end (lib/plugins/physics.js), so installing our old wrapper
  // on top would send it TWICE per tick. Skip the wrapper when the
  // fork is in use (EFFECTIVE_VERSION === '26.3' with native data).
  // Fallback only: if we ever fall back to npm 26.1, install the wrapper.
  if (EFFECTIVE_VERSION === '26.3') {
    log('native 26.3 fork: tick_end handled by physics loop, wrapper skipped')
    // v10.4 PACKETRATE (NiceWurst: show/limit outgoing packet rate so
    // the server never kicks Segs for spam). Count every outgoing
    // packet; log the rate every 10s; if the rate is sustained above
    // ~100 packets/s, CHAT packets are queued and sent 1 per 500ms.
    // Movement/physics packets are NEVER throttled.
    try {
      const prOrig = bot._client.write.bind(bot._client)
      let prCount = 0, prWindowStart = Date.now(), prPeak = 0, prTotal = 0, prLastTotal = 0
      let prChatQueue = [], prChatDrain = null
      bot._client.write = (name, packet) => {
        prCount++; prTotal++
        const now = Date.now()
        if (now - prWindowStart >= 1000) { if (prCount > prPeak) prPeak = prCount; prCount = 0; prWindowStart = now }
        if (name === 'chat' && prCount > 100) {
          prChatQueue.push([name, packet])
          logEvent('packetrate', 'chat throttled: rate >100/s, queued (queue ' + prChatQueue.length + ')')
          if (!prChatDrain) {
            prChatDrain = setInterval(() => {
              const item = prChatQueue.shift()
              if (item) { try { prOrig(item[0], item[1]) } catch (e) {} }
              if (!prChatQueue.length) { clearInterval(prChatDrain); prChatDrain = null }
            }, 500)
          }
          return
        }
        const result = prOrig(name, packet)
        // v10.4.1 AUTORESPAWN (run 84 root cause, decompiled from
        // paper-26.3.jar ServerGamePacketListenerImpl.handleMovePlayer):
        // Paper 26.3 disconnects with invalid_player_movement if a
        // SECOND position-bearing packet arrives in one server tick;
        // the flag is reset ONLY by a client_tick_end. The fork's
        // physics loop sends tick_end at the end of its own tick, but
        // the DELAYED respawn reply (physics.js: position_look sent
        // 1500ms after the server's respawn teleport) is sent OUTSIDE
        // that loop with no tick_end after it — and the next physics
        // tick then sends a second position packet (the 1s heartbeat:
        // lastSent.time is stale after death) in the same server tick.
        // Kill 11:12:55 -> kick 11:12:57 in run 84 is exactly that
        // window. Fix, at bot level so it ships in the zip (the fork
        // is re-cloned by setup-26.3.sh, so a fork edit would NOT
        // reach Tash): for 10s after a death, immediately follow
        // EVERY position/position_look packet with a tick_end, so the
        // server's per-tick flag is reset before any next position
        // packet can arrive. Outside the respawn window the physics
        // loop's own tick_end is enough, so no extra packets in
        // normal play. (Paper's PERFORM_RESPAWN handler returns
        // harmlessly when health > 0, so the repeated client_command
        // respawn packets are NOT the kick — verified in the same
        // decompile — and are kept as the retry safety.)
        if ((name === 'position' || name === 'position_look') && globalThis._lastDeathAt && Date.now() - globalThis._lastDeathAt < 10000) {
          try { prOrig('tick_end', {}) } catch (e) {}
        }
        // diagnostic: any movement packet while dead is a suspect
        if (bot && bot.isAlive === false && (name === 'position' || name === 'position_look' || name === 'look' || name === 'flying')) {
          logEvent('deathpkt', name + ' written while dead')
        }
        return result
      }
      setInterval(() => {
        const per10 = prTotal - prLastTotal; prLastTotal = prTotal
        logEvent('packetrate', 'outgoing ' + (per10 / 10).toFixed(1) + '/s avg (last 10s), peak 1s window ' + prPeak + '/s, total ' + prTotal)
      }, 10000)
      globalThis._packetRate = { get total () { return prTotal }, get peak () { return prPeak } }
    } catch (e) { log('packetrate setup: ' + e.message) }
  } else {
  try {
    const origWrite = bot._client.write.bind(bot._client)
    bot._client.write = (name, packet) => {
      const result = origWrite(name, packet)
      if (name === 'position' || name === 'position_look' || name === 'look' || name === 'flying') {
        try { origWrite('tick_end', {}) } catch (e) { /* pre-1.21.2 protocols have no tick_end */ }
      }
      return result
    }
    log('26.3 fix on: sending tick_end after every move packet')
  } catch (e) { log('tick_end fix could not be installed: ' + e.message) }
  }

  // (autoEat setup moved to bot.once('spawn') — see there.)

  bot.once('spawn', async () => {
    connected = true
    // v10.5.1 AUTO-EAT ROOT CAUSE: bot.loadPlugin() only QUEUES plugins
    // until 'inject_allowed' fires (mineflayer plugin_loader.js), so
    // bot.autoEat is UNDEFINED at createBot time and the old enableAuto()
    // call (which lived before spawn) never ran — auto-eat was never
    // actually turned on. Enable it HERE, on spawn, when the plugin
    // is really loaded.
    try {
      if (bot.autoEat) {
        bot.autoEat.setOpts({
          priority: 'saturation',
          minHunger: 19,
          minHealth: 14,
          bannedFood: ['rotten_flesh', 'pufferfish', 'chorus_fruit', 'poisonous_potato', 'spider_eye'],
        })
        bot.autoEat.enableAuto()
        log('autoEat enabled on spawn')
      } else {
        log('autoEat NOT present on spawn (bot.autoEat undefined)')
      }
    } catch (e) { log('autoEat setup: ' + e.message) }
    // v10.5.2 EAT-DROP ROOT CAUSE (runs 134-135): the override at
    // line ~1757 is installed in createBot's SYNCHRONOUS body, but
    // EVERY plugin — including inventory, which assigns the fork's
    // status-5 deactivateItem — is only injected at inject_allowed
    // (plugin_loader.js: setTimeout 0, AFTER createBot returns).
    // The inject OVERWROTE the override, so the auto-eat plugin's
    // eat() called the fork's status-5 function on EVERY eat:
    // server-side /data get proved 10->9->8 beef with a Steak entity
    // on the ground after each eat, at full hunger (deficit 0) and
    // at hungry alike. Re-install HERE, on spawn — after injection
    // — so it survives. The createBot-time install is kept as well
    // (harmless, covers anything that eats before spawn).
    try { bot.deactivateItem = () => { releaseItem() } } catch (e) {}
    startEdgeWatchdog()
    startUnstuckWatchdog()
    startWaterWatchdog()
    startNightWatchdog()
    startAutoArmor()
    startAutoTotem()
    log('Spawned at ' + bot.entity.position)
    loggedIn = false
    loginTried = false
    try {
      const mcData = mcDataFor(bot.version)
      const movements = new Movements(bot, mcData)
      // v9: allowParkour MUST be true — the storage columns are up to
      // 10 chests tall with stairways, and Segs has to climb those stairs
      // to reach the upper chests (each stair is a 1-block jump up).
      // With it false, every goto to an upper chest timed out and Segs
      // wandered off the platform. (Run 41e/41f proved it.)
      movements.allowParkour = true
      movements.canDig = true
      movements.allow1by1towers = false
      // v9.4: DOORS. The pathfinder's canOpenDoors defaults to false AND
      // its openable set only contains fence gates, so with canDig=true
      // the A* dug THROUGH doors instead of opening them — Tash watched
      // Segs break a house door on youniga. Enable door opening, add
      // every wooden door (not iron — those need redstone, not trapdoors)
      // to the openable set, and NEVER break a door: doors go in
      // blocksCantBreak, so even if opening fails Segs says "i cant
      // reach there" instead of destroying Tash's house.
      movements.canOpenDoors = true
      try {
        for (const name of Object.keys(mcData.blocksByName)) {
          if (name.endsWith('_door') && !name.startsWith('iron') && !name.includes('trapdoor')) {
            movements.openable.add(mcData.blocksByName[name].id)
          }
          if (name.endsWith('_door') || name.includes('trapdoor') || name.endsWith('_fence_gate')) {
            movements.blocksCantBreak.add(mcData.blocksByName[name].id)
          }
        }
      } catch (e) { log('doors: ' + e.message) }
      // v10 NO-TOOL RULE (pathfinder): never dig stone / ore / obsidian
      // to clear a path — the pathfinder only ever digs soft blocks
      // (dirt, sand, grass). It routes around stone or fails gracefully.
      try {
        for (const name of ['stone', 'cobblestone', 'mossy_cobblestone', 'deepslate', 'cobbled_deepslate', 'andesite', 'diorite', 'granite', 'tuff', 'calcite', 'basalt', 'blackstone', 'netherrack', 'end_stone', 'obsidian', 'crying_obsidian', 'prismarine', 'purpur_block', 'bricks', 'stone_bricks', 'nether_bricks', 'coal_ore', 'deepslate_coal_ore', 'iron_ore', 'deepslate_iron_ore', 'gold_ore', 'deepslate_gold_ore', 'diamond_ore', 'deepslate_diamond_ore', 'emerald_ore', 'deepslate_emerald_ore', 'redstone_ore', 'deepslate_redstone_ore', 'lapis_ore', 'deepslate_lapis_ore', 'copper_ore', 'deepslate_copper_ore', 'nether_quartz_ore', 'nether_gold_ore', 'ancient_debris']) {
          if (mcData.blocksByName[name]) movements.blocksCantBreak.add(mcData.blocksByName[name].id)
        }
      } catch (e) {}
      // v8: danger blocks. Lava + fire are already in the default
      // blocksToAvoid; add magma blocks (burn feet) and cactus (thorns).
      // v10.5.1 WATER AVOIDANCE (river bug — Tash's screenshot):
      // Segs walked STRAIGHT into a river on the way home and sat
      // stuck at the edge for 5 minutes. The fork's liquidCost is 1,
      // so a 20-block swim looks cheaper than a 40-block dry detour —
      // but the fork CANNOT climb out of water onto a vertical shore
      // (run 106: 0.72-block gap, unbridgeable), so the A* routes
      // INTO a trap it cannot exit. Water goes in blocksToAvoid
      // (impassable for routing) and liquidCost is raised to 10, so
      // a dry detour wins whenever one exists. If Segs IS in water,
      // the water watchdog (not the pathfinder) drives the climb-out.
      // If no dry route exists at all, the A* fails and gotoPos says
      // so honestly BEFORE Segs enters the water — it never walks
      // into a river it cannot get out of.
      try {
        if (mcData.blocksByName.water) movements.blocksToAvoid.add(mcData.blocksByName.water.id)
        movements.liquidCost = 10
        if (mcData.blocksByName.magma_block) movements.blocksToAvoid.add(mcData.blocksByName.magma_block.id)
        if (mcData.blocksByName.cactus) movements.blocksToAvoid.add(mcData.blocksByName.cactus.id)
        if (mcData.blocksByName.sweet_berry_bush) movements.blocksToAvoid.add(mcData.blocksByName.sweet_berry_bush.id)
        // v10.1 PLAN ITEM 11 (rest): never walk on crops — farmland
        // in blocksToAvoid so the pathfinder routes around it.
        if (mcData.blocksByName.farmland) movements.blocksToAvoid.add(mcData.blocksByName.farmland.id)
      } catch (e) {}
      pathMovements = movements
      bot.pathfinder.setMovements(movements)
      updateSprint()
    } catch (e) { log('movements: ' + e.message) }
    try { bot.armorManager.equipAll() } catch (e) {}
    await sleepMs(1500)
    tryLogin()
    // v8: if Segs died before this reconnect and the grave is still fresh
    // (SimpleGraves only keeps it 10 minutes), go back for its stuff once
    // it is logged in. The death handler saved the spot in brain.lastGrave.
    setTimeout(() => {
      try {
        if (bot && bot.entity && bot.health > 0 && brain.lastGrave && !brain.lastGrave.recovered && Date.now() - brain.lastGrave.at < 9 * 60 * 1000) {
          recoverGrave().catch(e => log('grave auto-recover: ' + e.message))
        }
      } catch (e) {}
    }, 8000)
  })

  function tryLogin () {
    if (!config.autoLogin || loginTried || !config.authPassword || config.authPassword.includes('PUT_') || config.authPassword.includes('SAME_PASSWORD')) return
    loginTried = true
    log('Sending /login ... (same password Segs was registered with)')
    bot.chat(`/login ${config.authPassword}`)
    setTimeout(() => { loggedIn = true }, 2000)
  }
  function tryRegister () {
    if (!config.authPassword || config.authPassword.includes('PUT_') || config.authPassword.includes('SAME_PASSWORD')) return
    log('Sending /register ...')
    bot.chat(`/register ${config.authPassword} ${config.authPassword}`)
    loginTried = true
    setTimeout(() => { loggedIn = true }, 2000)
  }

  // v7: ONE command at a time. Chat messages used to each start their own
  // handleTalk, so "go home" could start while the tpa walk was still
  // running — its stopAllMovement cancelled the walk's goal and both walks
  // died ("The goal was changed before it could be completed!", run 12).
  // Everything now queues behind the running command, in order.
  // v10.5 INSTANT ACK: an owner command gets a short reply the moment
  // it arrives — BEFORE the serialized talk queue runs it. The queue
  // used to delay the first reply by the whole previous command, so
  // Segs looked slow even when it was working. The ack is sent
  // synchronously in the chat handler (same tick as receipt), then
  // handleTalk does the work and reports the result. Non-commands
  // (greetings, thanks, status questions, small talk) and non-owner
  // chat are NOT acked — handleTalk answers those directly.
  // lastAckAt lets handleTalk skip its own "ok, doing it step by step"
  // intro when the ack already said it.
  let lastAckAt = 0
  const ACK_WORDS = ['go', 'follow', 'tp', 'craft', 'cook', 'smelt', 'dig', 'mine', 'chop', 'place', 'farm', 'sleep', 'sort', 'move', 'build', 'get', 'pick', 'eat', 'drop', 'give', 'stop', 'guard', 'fish', 'sethome', 'home', 'inventory', 'stats', 'status', 'list', 'remember', 'learn', 'forget', 'make', 'come', 'return', 'check', 'dance', 'jump', 'look', 'enable', 'disable', 'continue', 'afk', 'stay', 'wait']
  function ackCommand (username, msg, isWhisper = false) {
    try {
      if (!isOwner(username)) return
      const lower = msg.toLowerCase()
      if (!lower.includes('segs') && !isWhisper) return // whispers are always addressed to Segs
      const clean = lower.replace(/^(hey|hi)\s+segs\s+/, '').replace(/^segs\s+/, '').trim()
      if (!clean) return
      if (/^(hi|hello|hey|yo|thanks|thank you|thx|bye|good night|good morning)$/.test(clean)) return
      const first = clean.split(/\s+/)[0]
      const isCmd = ACK_WORDS.includes(first) || ACK_WORDS.some(w => clean.includes(w))
      if (!isCmd) return
      const at = Date.now()
      lastAckAt = at
      const ack = pick(['on it', 'got it', 'ok — doing it', 'coming', 'doing it now', 'on my way'])
      say(ack)
      logEvent('ack', `ack "${ack}" sent in ${Date.now() - at}ms for "${msg.slice(0, 60)}"`)
    } catch (e) {}
  }
  let talkQueue = Promise.resolve()
  // v10.5.1 COMMAND QUEUE FIX (Tash's whole-log proof: a 60s goto made
  // every later command arrive 27-94s late, in one stale burst, and
  // "stop" arrived after the command it was meant to stop). The old
  // queue serialized EVERY command behind the previous one's ENTIRE
  // execution (a 15s tpa wait, a 60s goto timeout, a 5-minute cook).
  // Now: LATEST COMMAND WINS. cmdGen is bumped on every new owner
  // command; every long await checks it and aborts SILENTLY (no stale
  // result). Queries (status/stats/inventory) bypass the queue and
  // answer immediately. STOP executes immediately and confirms <1s.
  // Long jobs (cook/sort/farm) run in the background and never block
  // status. Only the latest command's result is ever spoken.
  let cmdGen = 0
  let currentCmdDesc = '' // what the latest command is doing (for honest acks)
  function bumpCmd (desc) {
    cmdGen++
    moveToken++
    if (desc) currentCmdDesc = desc
    return cmdGen
  }
  function cmdCancelled (gen) { return gen !== cmdGen }
  // Sleep that aborts early when a newer command (or a stop) bumps
  // moveToken. Returns true if the full time elapsed, false if
  // cancelled. The token is the moveToken value captured before the
  // sleep — bumpCmd() and stopAllMovement() both bump it.
  async function sleepOrCancel (ms, token) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (token !== moveToken) return false
      await sleepMs(Math.min(250, end - Date.now()))
    }
    return token === moveToken
  }
  // Is this message a QUERY (read-only, answers immediately, never queued)?
  function isQueryMsg (clean) {
    return /^(status|stats|inventory|help)$/.test(clean) || clean.includes('status') || clean.includes('show stats') || clean.includes('your stats') || clean.includes('show inventory') || clean.includes('what is in your inventory') || clean.includes('how are you') || clean.includes('what are you doing') || clean.includes('where are you') || clean.includes('are you busy') || clean.includes('what do you remember')
  }
  function queueTalk (username, msg, isWhisper) {
    // v10.5.1: no serial queue any more — latest command wins. Run
    // handleTalk directly; the cmdGen token aborts the older one.
    // When the latest command finishes, clear the busy description so
    // the next ack is not a stale "dropping X".
    const gen = cmdGen
    handleTalk(username, msg, isWhisper).catch(e => { log('talk error: ' + e.message); logEvent('error', 'talk error: ' + e.message) }).finally(() => { if (gen === cmdGen) currentCmdDesc = '' })
    return Promise.resolve()
  }
  // moveToken: bumped every time movement is cancelled. A walk in progress
  // checks it and aborts silently instead of retrying a walk the user stopped.
  let moveToken = 0
  // v10.5.1 TPA dedup: timestamp of the last /tpa sent (0 = none pending).
  let tpaPendingAt = 0
  // v10.5.1: "stop jumping" holds the jump pulse (goto + follow) until
  // this timestamp. The climb assist (real steps during a goto) is not
  // held — only the pointless pulsing.
  let jumpHoldUntil = 0

  bot.on('chat', (username, message) => {
    if (!bot || username === BOT_NAME) return
    const msg = message.trim()
    // v6 fix: Paper broadcasts command feedback as chat from the command
    // sender, e.g. "Applied effect Hunger to Segs]". That is NOT the owner
    // talking - ignore system/command-feedback lines or Segs answers them.
    // v9: a line starting with / is a server command the owner typed
    // (e.g. /enchant Segs sharpness 3), not chat to Segs — ignore it or
    // Segs answers its own owner's commands with "i didn't get that".
    if (msg.startsWith('/')) return
    if (/^(applied|gave|set|teleported|enchanted|summoned|filled|changed|cleared|removed|replaced|killed|spawned|granted|revoked)\b/i.test(msg)) return
    if (msg.endsWith(']') && !msg.toLowerCase().includes('segs ')) return
    log(`<${username}> ${msg}`)
    logChat(username, msg)
    if (!loggedIn && config.autoLogin && config.authPassword && !config.authPassword.includes('PUT_')) {
      if (/please register|\/register|not registered/i.test(msg)) { tryRegister(); return }
      if (/please login|\/login|not logged in|login with/i.test(msg)) { tryLogin(); return }
    }
    if (/logged in successfully|welcome back|successfully logged/i.test(msg)) { loggedIn = true; return }
    // v7: a /tpa request from the owner arrives as chat/system text — accept it
    if (maybeAcceptTpa(msg)) return
    // v10.5.1 COMMAND QUEUE FIX: latest command wins, stop jumps the
    // queue, queries answer immediately.
    // v7: "stop" must interrupt a running walk NOW, not wait behind it
    // in the queue — cancel the movement immediately, then confirm
    // <1s (the old code let the queued handler say "ok stopped" 27s
    // late, after the command it was meant to stop had already
    // finished). v9: ONLY the owner may stop Segs (griefing hole).
    // v10.5.1: "stop jumping" is a real command now (Tash's log:
    // "Segs stop jumping" got "i didnt get that" and Segs kept
    // jumping). It stops all movement and holds jumping for 60s.
    if (isOwner(username)) {
      const stopReq = msg.toLowerCase().replace(/^segs\s+/, '')
      if (/^(stop|stay|wait|wait here|stay here|chill|hold on)$/.test(stopReq) || stopReq === 'stop following' || stopReq === 'stop follow' || stopReq.includes('stop farm') || stopReq.includes('stop afk') || stopReq.includes('stop guard') || stopReq.includes('stop protecting')) {
        if (/^(stop|stay|wait|wait here|stay here|chill|hold on)$/.test(stopReq)) sortStopRequested = true
        bumpCmd('stop')
        stopAllMovement()
        say(pick(['ok stopped', 'got it, staying here', 'ok, waiting here']))
        aiRecordChat(username, msg)
        return
      }
      if (stopReq.includes('stop jumping') || stopReq.includes('stop jump')) {
        bumpCmd('stop jumping')
        stopAllMovement()
        jumpHoldUntil = Date.now() + 60000
        say('ok, ill stop jumping')
        logEvent('jump', 'stop jumping — jump pulse held for 60s')
        aiRecordChat(username, msg)
        return
      }
      if (stopReq.includes('start jumping') || stopReq.includes('jump again')) {
        jumpHoldUntil = 0
        say('ok, jumping again when i need to')
        aiRecordChat(username, msg)
        return
      }
    }
    // Queries answer IMMEDIATELY (never queued, never blocked by a
    // long cook/sort/farm) — status/stats/inventory/help read live
    // state and return in <2s.
    const cleanQ = msg.toLowerCase().replace(/^(hey|hi)\s+segs\s+/, '').replace(/^segs\s+/, '').trim()
    if (isOwner(username) && isQueryMsg(cleanQ)) {
      handleTalk(username, msg).catch(e => { log('talk error: ' + e.message) })
      aiRecordChat(username, msg)
      return
    }
    // A new owner COMMAND cancels the running one (latest wins): bump
    // the token so the old command's long awaits abort silently, then
    // run the new one. Only real commands bump it — a bare "thanks"
    // or greeting must not cancel a goto. The ack is honest — if
    // something was running, say what is being dropped.
    const lowerCmd = msg.toLowerCase()
    const addressed = lowerCmd.includes('segs')
    const firstWord = cleanQ.split(/\s+/)[0]
    const isRealCmd = addressed && (ACK_WORDS.includes(firstWord) || ACK_WORDS.some(w => cleanQ.includes(w)))
    if (isOwner(username) && isRealCmd) {
      const prevDesc = currentCmdDesc
      const wasBusy = prevDesc && prevDesc !== 'stop'
      bumpCmd(cleanQ.slice(0, 40))
      if (wasBusy) { say(`dropping ${prevDesc}, doing ${cleanQ.slice(0, 40)}`); lastAckAt = Date.now() }
      else ackCommand(username, msg)
    } else {
      ackCommand(username, msg)
    }
    queueTalk(username, msg)
    aiRecordChat(username, msg)
    // v10.4 AUTOCHAT butt-in: unaddressed chat gets a 25% reply chance
    // (Wurst discipline), 10s gap — handled inside aiButtIn.
    if (!msg.toLowerCase().includes('segs')) aiButtIn(username, msg)
  })

  bot.on('messagestr', (message) => {
    // v7: tpa requests often arrive as system chat, not player chat
    if (maybeAcceptTpa(message)) return
    // v8: the server answers /sethome in FRENCH (screenshots 2026-11-07 —
    // the "Spanish" guess was wrong). If Segs just asked to set a home,
    // read the reply: a duplicate name or the 3-home limit is refused with
    // "Vous n'avez pas la permission d'ajouter un autre home !" and Segs
    // must NOT record a home that was never set. Spanish patterns are kept
    // as a fallback. Every reply is logged to logs/.
    if (pendingSethome && Date.now() - pendingSethome.at < 5000) {
      logEvent('sethome-reply', message)
      const m = (message || '').toLowerCase()
      // "Unknown command" (a server WITHOUT the home plugin, like the test
      // server) is not a refusal — ignore it.
      if (/unknown (command|or incomplete)/.test(m)) return
      const fail = /ya (existe|tienes)|existe|no (puedes|se puede|tienes)|l[ií]mite|m[aá]ximo|demasiad|ya hay|no se ha|denegado|pas la permission|ajouter un autre|permission d'ajouter|d[eé]j[aà]|limite|maximum/.test(m)
      if (fail) { pendingSethome.failed = true; pendingSethome.why = (message || '').slice(0, 100) }
    }
    // v8: the /home warmup speaks too — "Début de la téléportation vers
    // le home : a" (accepted, 3s countdown) and "Téléportation annulée
    // car vous avez bougé." (cancelled because Segs moved). Track both so
    // tryServerHome knows WHY a teleport did or didn't happen.
    if (pendingHome && Date.now() - pendingHome.at < 6000) {
      const m = (message || '').toLowerCase()
      if (/t[eé]l[eé]portation annul[eé]e|annul[eé]e car vous avez boug[eé]|teleport.*cancel/.test(m)) { pendingHome.cancelled = true; logEvent('home', 'warmup cancelled by server: ' + (message || '').slice(0, 100)) }
      else if (/d[eé]but de la t[eé]l[eé]portation|t[eé]l[eé]portation dans/.test(m)) { pendingHome.started = true; logEvent('home', 'warmup started: ' + (message || '').slice(0, 100)) }
    }
    if (!loggedIn && config.autoLogin && config.authPassword && !config.authPassword.includes('PUT_')) {
      if (/please register|\/register/i.test(message)) tryRegister()
      else if (/please login|\/login/i.test(message)) tryLogin()
    }
    if (/logged in successfully/i.test(message)) loggedIn = true
  })

  bot.on('whisper', (username, message) => {
    if (!bot || username === BOT_NAME) return
    ackCommand(username, message.trim(), true)
    queueTalk(username, message.trim(), true)
    aiRecordChat(username, message.trim())
  })

  bot.on('sleep', () => log('Segs is sleeping'))
  bot.on('wake', () => { say(pick(['morning', 'awake, ready to work', 'good morning, what now'])) })

  // v5 LEARNING from playing: when it dies, remember where and warn next time.
  // This is coded memory, not AI training - it just does not forget what happened.
  // v7: also RESPAWN immediately (client_command action 0 = the vanilla
  // "Respawn" button). Without this, the dead bot keeps sending movement
  // packets and Paper kicks it with "Invalid move player packet received",
  // then it reconnects and dies again — proven in the v7 run 1 test, where
  // zombies killed Segs 9 times in a row and it got kicked after every death.
  bot.on('death', () => {
    // v10.4.1: timestamp for the respawn tick_end guard (see the
    // PacketRate wrapper above) — 10s window covers the fork's
    // delayed respawn reply at +1500ms and the physics ticks after.
    globalThis._lastDeathAt = Date.now()
    const pos = bot.entity ? [Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y), Math.floor(bot.entity.position.z)] : [0, 0, 0]
    // v8: the grave (SimpleGraves) sits where Segs died, for 10 minutes.
    // Remember it with the dimension, so the respawn can go back for it —
    // or say in chat where it is if it cannot get there.
    try { brain.lastGrave = { pos, dimension: (bot.game && bot.game.dimension) || 'minecraft:overworld', at: Date.now(), recovered: false }; saveBrain() } catch (e) {}
    brain.deaths.push({ what: 'died', pos, at: new Date().toISOString() })
    if (brain.deaths.length > 10) brain.deaths = brain.deaths.slice(-10)
    saveBrain()
    bumpStat('deaths')
    logLearn('death', `died at ${pos.join(', ')}`)
    log('Segs died at ' + pos.join(', ') + ' - remembered, will be careful there')
    // Respawn: send the vanilla respawn packet right away, then keep sending
    // it every 500ms until alive again (max 5s). A single packet can lose
    // the race with the movement packets Paper flags on a corpse ("Invalid
    // move player packet received") — run 10 proved one shot is not enough.
    // v9.4: STOP EVERYTHING FIRST. The old code only cleared control
    // states, but a pathfinder goal / flee loop / follow loop still
    // moving sends position packets from the corpse, which is what
    // Paper flags. stopAllMovement cancels the goal, the flee timer,
    // following, farming, AFK and PvP — then the respawn packet goes
    // out with nothing else moving. If Paper still kicks the corpse,
    // the auto-reconnect in 10s is the fallback (unchanged).
    try { stopAllMovement() } catch (e) {}
    try { bot.clearControlStates() } catch (e) {}
    try { bot._client.write('client_command', { actionId: 0 }); log('respawning...'); globalThis._respawnCount = (globalThis._respawnCount || 0) + 1; logEvent('autorespawn', 'respawn packet sent (attempt ' + globalThis._respawnCount + ', death at ' + pos.join(',') + ')') } catch (e) { log('respawn failed: ' + e.message) }
    const respawnTimer = setInterval(() => {
      if (!bot || bot.health > 0) { clearInterval(respawnTimer); return }
      try { bot._client.write('client_command', { actionId: 0 }) } catch (e) {}
    }, 500)
    setTimeout(() => clearInterval(respawnTimer), 5000)
    // v10.5.1 GRAVE FIX: the auto-recovery timer used to live ONLY in
    // the spawn/login handler — it fired once at login, never after an
    // in-place respawn (v10.4.1). So a death mid-session never
    // auto-recovered; Tash's log shows all three recoveries were
    // manual commands. Schedule it HERE, on every death: 8s after
    // death, once respawned and alive, go back for the grave. The
    // login-handler timer stays (it covers a grave from a previous
    // session, loaded from brain.json).
    setTimeout(() => {
      try {
        if (bot && bot.entity && bot.health > 0 && brain.lastGrave && !brain.lastGrave.recovered && Date.now() - brain.lastGrave.at < 9 * 60 * 1000) {
          recoverGrave().catch(e => log('grave auto-recover: ' + e.message))
        }
      } catch (e) {}
    }, 8000)
  })

  bot.on('entityHurt', (entity) => {
    if (!bot.entity || entity !== bot.entity) return
    if (inCombat()) { combatHitsTaken++; bumpStat('combatHitsTaken', 1); logEvent('combat', 'hit taken! total ' + combatHitsTaken + ' (hp ' + bot.health + ')') }
    defendCheck()
  })
  bot.on('entityDead', (entity) => {
    if (!entity || entity === bot.entity) return
    if (inCombat() && combatTarget && entity === combatTarget) {
      combatKills++; bumpStat('combatKills', 1)
      logEvent('combat', 'killed ' + (entity.name || 'mob') + ' (total kills ' + combatKills + ')')
    }
  })

  bot.on('health', () => {
    if (!bot) return
    // v10.4.1: health 0 fires this handler BEFORE 'death' (health.js
    // emits 'health' first) — the old code set a pathfinder flee goal
    // for a corpse, which then moved on respawn. Dead Segs does nothing.
    if (bot.health <= 0) return
    if (bot.health < 8) {
      // v10.5.2: tryEatOnce refuses at food 20/20 — the old direct
      // plugin call would attempt an eat at full hunger and drop the
      // food (runs 134-135). Low health + full hunger = no eat.
      try { const p = tryEatOnce(); if (p && p.catch) p.catch(() => {}) } catch (e) {}
      if (inCombat()) return // combat's retreat handles it; do not fight it
      try {
        const target = bot.nearestEntity(e => e.type === 'mob' || e.type === 'player')
        if (target) {
          const away = bot.entity.position.clone().subtract(target.position).normalize().scale(6)
          bot.pathfinder.setGoal(new goals.GoalBlock(bot.entity.position.x + away.x, bot.entity.position.y, bot.entity.position.z + away.z))
        }
      } catch (e) {}
    }
    if (bot.food <= 18) { try { const p = bot.autoEat?.eat(); if (p && p.catch) p.catch(() => {}) } catch (e) {} }
  })

  setInterval(() => {
    if (!bot || !bot.entity || bot.health <= 0) return
    defendCheck()
  }, 1500)

  // ---- v10: PvP-god combat ----
  // Tash's standard: zero hits taken, zero seconds wasted, zero hits
  // wasted, even against a horde. The loop below is the whole system:
  // threat-prioritised targeting (creeper first, enderman NEVER),
  // cooldown-timed hits (never spam), crits on tough mobs, sword sweep
  // for hordes, constant strafing, knockback, a surroundings check so
  // Segs is never surrounded, and retreat-to-heal below 8 health.
  // It replaces the old one-line bot.pvp.attack() defend, which just
  // walked at the nearest mob and stood still while it hit back.
  // Creeper is NOT in COMBAT_THREAT: Segs never melees a creeper.
  // The fuse (1.5s) beats a sword kill (3 hits, ~2s), and this fork's
  // attacks miss ~92% of the time, so meleeing a creeper means it
  // explodes on Segs. Segs FLEES creepers (v8 flee) and only fights
  // them if Tash gives it a bow. A creeper in the threat list would
  // make Segs walk into an explosion.
  const COMBAT_THREAT = {
    skeleton: 1, stray: 1, witch: 2, blaze: 2, ghast: 2,
    spider: 3, cave_spider: 3, phantom: 3, zombie: 4, husk: 4,
    drowned: 4, zombie_villager: 4, slime: 4, magma_cube: 4,
    pillager: 3, vindicator: 3, evoker: 2, vex: 2, ravager: 2,
    piglin_brute: 3, hoglin: 3, zoglin: 3, wither_skeleton: 3,
    guardian: 3, elder_guardian: 2, warden: 1, silverfish: 5, endermite: 5
  }
  // Enderman is NEVER a combat target (looking at it / attacking it is
  // how you die). It is excluded here, not just deprioritised.
  const COMBAT_NEVER = new Set(['enderman'])
  let combatTimer = null
  let combatTarget = null
  let combatLastAttack = 0
  // v10 combat stats (for the test report and "Segs stats"): hits Segs
  // took while fighting, hits it landed, mobs it killed. A hit taken is
  // counted the moment Segs is hurt during combat — that is the number
  // Tash's "zero hits" standard is measured against.
  let combatHitsTaken = 0
  let combatHitsLanded = 0
  let combatKills = 0
  let combatStrafeDir = 1
  let combatStrafeFlip = 0
  let combatShieldLogged = false
  let shieldUp = false
  let combatNoWeaponTicks = 0
  let bowCharging = false
  let bowLastShot = 0
  // v10.5.3 (retest-158): cornered-creeper flag. Set when a creeper
  // is inside fuse range AND no flee direction is safe — the melee
  // creeper flee branches must then NOT turn Segs away (the strike's
  // facing check would skip every swing); Segs stands still and
  // sword-fights instead. Cleared at the top of every combat tick.
  let combatNoFlee = false
  // v10.5.3 (regression-75): flee-isn't-working tracker — the
  // position/time when the too-close flee started. If Segs has been
  // fleeing > 1s without moving > 0.5 blocks (pressed against a
  // wall/arena edge, every direction refused by edge-safe), the
  // flee is a dead end and he sword-fights instead. Cleared when
  // the creeper is not within fuse range, when the flee works, and
  // on stopCombat.
  let combatFleeStartPos = null, combatFleeStartTime = 0
  let funnelActive = false
  let combatSaidNeedWeapon = 0
  function combatThreat (name) {
    if (!name) return 99
    const n = name.toLowerCase()
    if (COMBAT_NEVER.has(n)) return 999
    if (COMBAT_THREAT[n] != null) return COMBAT_THREAT[n]
    return HOSTILE_MOBS.includes(n) ? 5 : 99
  }
  // Best target: lowest threat score, then nearest. A mob attacking the
  // OWNER outranks one attacking Segs (protect Tash first). A creeper
  // outranks everything (it explodes). Enderman is never returned.
  // v10.3: canSeeMob — Segs has EYES, not X-ray. A mob only counts
  // if it is on the same level (within 4 blocks up/down — not a cave
  // below or a roof above) AND there is a clear line of sight from
  // Segs' eye to the mob's chest (no solid block in between). Tash:
  // Segs sensed a zombie in a cave below in daytime and wanted to
  // fight it, but nothing was on the surface.
  function canSeeMob (e) {
    if (!bot || !bot.entity || !e || !e.position) return false
    if (Math.abs(e.position.y - bot.entity.position.y) > 4) return false
    try {
      const headPos = bot.entity.position.offset(0, bot.entity.eyeHeight || 1.62, 0)
      const target = e.position.offset(0, 1.0, 0)
      const dir = target.minus(headPos)
      const range = dir.norm()
      if (range < 0.5) return true
      const hit = bot.world.raycast(headPos, dir.normalize(), range, (b) => {
        return b && b.name !== 'air' && b.name !== 'water' && b.boundingBox !== 'empty'
      })
      return !hit
    } catch (err) { return true }
  }

  function findCombatTarget (maxDist) {
    if (!bot || !bot.entity || !bot.entities) return null
    let best = null, bestScore = Infinity
    const ownerEnt = resolveOwnerEntity()
    for (const e of Object.values(bot.entities)) {
      if (!e || !e.name || e === bot.entity) continue
      if (!HOSTILE_MOBS.includes(e.name)) continue
      if (COMBAT_NEVER.has(e.name)) continue
      if (!canSeeMob(e)) continue
      // creeper: a combat target ONLY if Segs has a bow + arrows
      // (shoot it from range — melee is suicide). Without a bow,
      // creepers are still flee-only.
      if (e.name === 'creeper') {
        const hasBow = bot.inventory.items().some(i => i.name === 'bow')
        const hasArrows = bot.inventory.items().some(i => i.name === 'arrow')
        if (!hasBow || !hasArrows) continue
      }
      const d = bot.entity.position.distanceTo(e.position)
      if (d > maxDist) continue
      let score = combatThreat(e.name) * 100 + d
      // a mob right next to the owner is attacking Tash — top priority
      if (ownerEnt && e.position.distanceTo(ownerEnt.position) < 4) score -= 500
      if (score < bestScore) { bestScore = score; best = e }
    }
    return best
  }
  // Equip the best weapon. Sword for hordes (sweep), axe for a single
  // tough target (bigger hit). Returns 'sword' | 'axe' | null.
  function equipCombatWeapon (preferAxe) {
    try {
      const inv = bot.inventory.items()
      const swords = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword']
      const axes = ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe']
      // Shield FIRST, as its own step: if the off-hand is empty and
      // Segs has a shield, equip it. (It used to sit after the weapon
      // early-return, so it never ran when Segs already held a sword.)
      try {
        const offHand = bot.inventory.slots[45]
        if ((!offHand || offHand.name !== 'shield')) {
          const shield = inv.find(i => i.name === 'shield')
          if (shield) bot.equip(shield, 'off-hand').catch(() => {})
        }
      } catch (e) {}
      const held = bot.heldItem
      const has = list => { for (const n of list) { const it = inv.find(i => i.name === n); if (it) return it } return null }
      // already holding a good weapon of the preferred kind — keep it
      if (held) {
        if (!preferAxe && swords.includes(held.name)) return 'sword'
        if (preferAxe && axes.includes(held.name)) return 'axe'
      }
      let item = null, kind = null
      if (preferAxe) { item = has(axes); kind = 'axe'; if (!item) { item = has(swords); kind = 'sword' } }
      else { item = has(swords); kind = 'sword'; if (!item) { item = has(axes); kind = 'axe' } }
      if (item) {
        bot.equip(item, 'hand').catch(() => {})
        return kind
      }
      try { bot.armorManager.equipAll() } catch (e) {}
      return null
    } catch (e) { return null }
  }
  function combatCooldownMs (kind) {
    if (kind === 'axe') {
      const held = bot.heldItem
      if (held && (held.name === 'diamond_axe' || held.name === 'netherite_axe')) return 1050
      if (held && held.name === 'iron_axe') return 950
      return 850
    }
    return 650 // sword — 1.6 attacks/sec = 625ms (pvp AttackSpeeds.json),
    // so 650ms is the full-damage cooldown. The lookAt-before-attack
    // fix (not a longer cooldown) is what fixes the miss rate.
  }
  function stopCombat (why) {
    if (combatTimer) { clearInterval(combatTimer); combatTimer = null }
    // v10.4: cancel a pending bow release — run 75 logged a 4th
    // "BOW released" AFTER combat had already stopped (the 1s
    // release timeout fired on a dead fight and shot at nothing).
    if (globalThis._bowReleaseTimer) { clearTimeout(globalThis._bowReleaseTimer); globalThis._bowReleaseTimer = null }
    if (globalThis._bowAimTimer) { clearInterval(globalThis._bowAimTimer); globalThis._bowAimTimer = null }
    combatTarget = null
    combatFleeStartPos = null; combatFleeStartTime = 0
    shieldUp = false
    bowCharging = false
    // v10.3: NO deactivateItem() here. It wrote a block_dig packet
    // (status 5) on EVERY stop, and on the real server that packet
    // is the prime suspect for Segs dropping the held item on any
    // command. The bow releases itself via its own 1s timeout, and
    // eating is handled by autoEat — nothing here needs it.
    if (why) logEvent('combat', 'stopped: ' + why)
    // v10.3.1: NO deactivateItem() — the v10.3 edit missed this second
    // call. It fired on every stop and dropped the held item (Tash:
    // beef in the right hand, "tp to me" dropped 1-3 beef, "sleep"
    // dropped beef). The bow releases itself via its own timeout.
    try { bot.clearControlStates() } catch (e) {}
  }
  function inCombat () { return !!combatTimer }
  // Count hostiles within range, and whether they are on more than one
  // side of Segs (surrounded = mobs in 2+ quadrants around it).
  function combatSurroundings (range) {
    let count = 0
    const quads = new Set()
    if (!bot || !bot.entity) return { count: 0, surrounded: false }
    for (const e of Object.values(bot.entities)) {
      if (!e || !e.name || !HOSTILE_MOBS.includes(e.name) || COMBAT_NEVER.has(e.name)) continue
      const d = bot.entity.position.distanceTo(e.position)
      if (d > range) continue
      count++
      const dx = e.position.x - bot.entity.position.x
      const dz = e.position.z - bot.entity.position.z
      quads.add((dx >= 0 ? 'E' : 'W') + (dz >= 0 ? 'S' : 'N'))
    }
    return { count, surrounded: count >= 3 && quads.size >= 2 }
  }
  function startCombat (target) {
    if (combatTimer) { if (target) combatTarget = target; return }
    if (!target) target = findCombatTarget(16)
    if (!target) return
    combatTarget = target
    combatShieldLogged = false
    combatNoWeaponTicks = 0
    stopFlee()
    try { bot.pathfinder.setGoal(null) } catch (e) {}
    logEvent('combat', 'fighting ' + target.name)
    combatTimer = setInterval(() => { combatTick().catch(e => log('combat: ' + e.message)) }, 250)
  }
  async function combatTick () {
    try {
      combatNoFlee = false // re-evaluated every tick (see too-close branch)
      if (!connected || !bot || !bot.entity || bot.health <= 0 || bot.isSleeping) { stopCombat('not connected/dead/sleeping'); return }
      // Target stickiness: STICK to the current target until it is
      // dead/gone. Re-picking every tick made Segs alternate between
      // zombies and spread damage so none of them died (386 attacks
      // for 10 kills). Only switch for a creeper (top threat) or if
      // the current target is dead, gone, or too far.
      // v10.4: NEVER fight a ghost. The stored combatTarget goes
      // stale (the server re-creates the entity object) — re-fetch
      // it LIVE every tick. If it is gone from bot.entities and no
      // same-name mob is within 16 blocks, the target is dead or
      // gone: STOP. Run 75 proved the old code fights a frozen
      // position forever: Segs fired 13 arrows at a creeper that was
      // not there any more (its by-name fallback even aimed at a
      // cave creeper 46 blocks away, 35 below).
      let target = combatTarget
      if (target) {
        let liveT = bot.entities[target.id]
        if (!liveT || !liveT.position) {
          let bestD = 99
          for (const e of Object.values(bot.entities)) {
            if (!e || e.name !== target.name || !e.position) continue
            const d = bot.entity.position.distanceTo(e.position)
            if (d < bestD) { bestD = d; liveT = e }
          }
          if (liveT && bestD <= 16) { target = liveT; combatTarget = liveT; logEvent('combat', 'target re-resolved by name: ' + liveT.name + ' at ' + bestD.toFixed(1)) }
          else { stopCombat('target gone (dead or despawned)'); return }
        } else target = liveT
      }
      const targetValid = target && target.position && bot.entity.position.distanceTo(target.position) <= 16
      const creeperNear = (() => {
        for (const e of Object.values(bot.entities)) {
          if (e && e.name === 'creeper' && bot.entity.position.distanceTo(e.position) <= 10) return e
        }
        return null
      })()
      if (creeperNear) { target = creeperNear }
      else if (!targetValid) { target = findCombatTarget(16) }
      if (!target || !target.position) { stopCombat('no target'); return }
      combatTarget = target
      const pos = bot.entity.position
      const dist = pos.distanceTo(target.position)
      // v10.5.3 (regression-75): the flee-isn't-working tracker is
      // only meaningful during a close-creeper episode — clear it
      // whenever the creeper is not within fuse range.
      if (!(target.name === 'creeper' && dist < 3.5)) { combatFleeStartPos = null; combatFleeStartTime = 0 }
      // v10.4 (patch I): log the target's health once per second so
      // arrow hits are visible (metadata index 9 = health).
      if (!globalThis._lastTargetHpLog || Date.now() - globalThis._lastTargetHpLog > 1000) {
        globalThis._lastTargetHpLog = Date.now()
        const liveT = bot.entities[target.id] || target
        const hp = liveT.metadata && typeof liveT.metadata[9] === 'number' ? liveT.metadata[9].toFixed(1) : '?'
        logEvent('combat', 'target ' + target.name + ' hp=' + hp + ' dist=' + dist.toFixed(1))
      }
      if (dist > 16) { stopCombat('target too far'); return }
      // Retreat to heal: below 8 health Segs disengages, eats, heals.
      // Dying to kill one zombie is a loss.
      if (bot.health < 8) {
        stopCombat('low health, retreating to heal')
        say('im hurt, falling back to heal')
        // v10.5.2: tryEatOnce refuses at food 20/20 — the old direct
        // plugin call would attempt an eat at full hunger and drop
        // the food (runs 134-135).
        try { const p = tryEatOnce(); if (p && p.catch) p.catch(() => {}) } catch (e) {}
        const away = pos.clone().subtract(target.position)
        away.y = 0
        if (away.distanceTo(new (require('vec3').Vec3)(0, 0, 0)) < 0.1) away.set(-Math.sin(bot.entity.yaw), 0, -Math.cos(bot.entity.yaw))
        away.normalize()
        const safe = pos.clone().add(away.scale(8))
        try { bot.pathfinder.setGoal(new goals.GoalNear(safe.x, safe.y, safe.z, 2)) } catch (e) {}
        return
      }
      // v10.4 (patch I): a creeper inside fuse range (< 3.5) will
      // explode — stop shooting and sprint straight away from it.
      if (target.name === 'creeper' && dist < 3.5) {
        // v10.5.3 (run 160 flake): a bow charge started at dist 5.8
        // has a 1000ms release timer still pending when this branch
        // fires — the flee sets sprint, and sprint cancels the bow
        // use server-side, so the timer's status-6 release fires
        // with no bow in use and consumes NO arrow ("consumed: NO
        // (61->61)"), then the creeper reaches Segs and hits him.
        // Cancel the pending charge here (no release — a point-blank
        // release at fuse range is the wrong shot anyway); the
        // sprint below ends the server-side use.
        if (globalThis._bowReleaseTimer) { clearTimeout(globalThis._bowReleaseTimer); globalThis._bowReleaseTimer = null; logEvent('combat', 'bow charge cancelled — creeper too close, fleeing instead') }
        if (globalThis._bowAimTimer) { clearInterval(globalThis._bowAimTimer); globalThis._bowAimTimer = null }
        bowCharging = false
        // v10.4 (patch J): use the 8-direction escape — straight away
        // is often wall-blocked (run 75: Segs died cornered at the
        // south wall because straight-south was refused and it stood
        // still). Segs looks AT the creeper, so back = away.
        const toT = target.position.clone().subtract(pos); toT.y = 0
        const tl = Math.hypot(toT.x, toT.z) || 1
        const fx = toT.x / tl, fz = toT.z / tl
        const rx = -fz, rz = fx
        const dirs = [
          { dx: -fx, dz: -fz, f: false, b: true, l: false, r: false },
          { dx: -fx - rx, dz: -fz - rz, f: false, b: true, l: true, r: false },
          { dx: -fx + rx, dz: -fz + rz, f: false, b: true, l: false, r: true },
          { dx: -rx, dz: -rz, f: false, b: false, l: true, r: false },
          { dx: rx, dz: rz, f: false, b: false, l: false, r: true },
          { dx: fx - rx, dz: fz - rz, f: true, b: false, l: true, r: false },
          { dx: fx + rx, dz: fz + rz, f: true, b: false, l: false, r: true },
          { dx: fx, dz: fz, f: true, b: false, l: false, r: false },
        ]
        let fled = false
        for (const d of dirs) {
          if (combatMoveSafe(d.dx, d.dz)) {
            bot.setControlState('forward', d.f); bot.setControlState('back', d.b)
            bot.setControlState('left', d.l); bot.setControlState('right', d.r)
            bot.setControlState('sprint', true)
            logEvent('combat', 'creeper too close (' + dist.toFixed(1) + ') — fleeing ' + (d.b ? 'back' : d.f ? 'forward' : '') + (d.l ? '+left' : d.r ? '+right' : '') + ', not shooting')
            fled = true
            break
          }
        }
        if (!fled) {
          // v10.5.3 (retest-158): cornered with a creeper at fuse
          // range and NO safe flee direction — standing still takes
          // the explosion for free. Fall through to the melee code
          // below instead (dist < 4 skips the bow branch, so the
          // sword runs: 650ms cooldown, 2 hits kill a creeper at
          // hp 11, inside the 1.5s fuse — and hit 1's knockback
          // resets the fuse). combatNoFlee stops the melee creeper
          // flee branches from turning Segs away (the strike's
          // facing check would skip every swing); he stands still,
          // faces the creeper, and swings. The bow charge was
          // already cancelled above, so bowCharging is false.
          combatNoFlee = true
          combatFleeStartPos = null; combatFleeStartTime = 0
          logEvent('combat', 'creeper too close (' + dist.toFixed(1) + ') — NO safe flee direction, fighting with sword')
        } else {
          // v10.5.3 (regression-75): flee-isn't-working detector.
          // Segs was cornered at the arena edge, "corner escape:
          // moving back+left" every tick, but edge-safe refused
          // every direction and he moved ~0 blocks while the
          // creeper closed 6.4 -> 2.7 in 2s and exploded on him.
          // If he has been fleeing without moving > 0.5 blocks,
          // the flee is a dead end: fight with the sword instead
          // (falls through to the melee code; combatNoFlee keeps
          // the melee flee branches from turning him away).
          // Threshold 500ms (was 1000ms): creeper6-160 proved 1s
          // is too slow — the detector fired at 08:15:33 but the
          // creeper's fuse (lit at ~3 blocks) beat the first sword
          // swing and Segs took 1 hit. 500ms gives the sword ~1s
          // to kill (2 hits at 650ms) before the 1.5s fuse ends.
          // A working flee moves > 0.5 blocks in 500ms (sprint is
          // 5.6 blocks/s), so this only fires when truly stuck;
          // a false positive self-corrects next tick (the tracker
          // resets once Segs has moved > 0.5).
          if (!combatFleeStartPos) { combatFleeStartPos = pos.clone(); combatFleeStartTime = Date.now(); return }
          if (Date.now() - combatFleeStartTime > 500 && pos.distanceTo(combatFleeStartPos) < 0.5) {
            combatNoFlee = true
            combatFleeStartPos = null; combatFleeStartTime = 0
            logEvent('combat', 'creeper too close (' + dist.toFixed(1) + ') — fleeing 500ms+ without moving, cornered, fighting with sword')
            // fall through to melee (no return)
          } else if (pos.distanceTo(combatFleeStartPos) > 0.5) {
            // flee is working — reset the anchor so a later
            // cornering episode starts fresh.
            combatFleeStartPos = null; combatFleeStartTime = 0
            return
          } else return
        }
      }
      // v10.1 BOW COMBAT. If the target is one best fought from range
      // (skeleton, creeper, witch, blaze, pillager) AND Segs has a bow
      // + arrows AND it is more than 6 blocks away, SHOOT IT — do not
      // walk into its range. Keep 8-14 blocks, strafe, aim with lead +
      // drop, charge 1s, release. Inside 6 blocks, fall back to sword.
      // creeper IS in BOW_TARGETS (re-added patch B): the bow fires
      // with the status-6 release (patch G) and Wurst ballistics.
      // Proven to kill a stationary target at 8 blocks (probe-bow5,
      // once the test-field plank was cleared). Moving-creeper hit
      // rate is the open question — see run 75.
      const BOW_TARGETS = new Set(['skeleton', 'stray', 'witch', 'blaze', 'pillager', 'ghast', 'creeper'])
      // horde: 2+ hostiles means a ring is forming — shoot the
      // zombies from range too (thin the horde before it arrives),
      // instead of sword-fighting 5 at once in the open.
      if (combatSurroundings(8).count >= 2) { BOW_TARGETS.add('zombie'); BOW_TARGETS.add('zombie_villager'); BOW_TARGETS.add('husk'); BOW_TARGETS.add('drowned') }
      const hasBow = bot.inventory.items().some(i => i.name === 'bow')
      const hasArrows = bot.inventory.items().some(i => i.name === 'arrow')
      if (BOW_TARGETS.has(target.name) && hasBow && hasArrows && dist > 4) {
        // v10.4 (patch L): PLANT YOUR FEET to shoot. Moving (back +
        // strafe) while the bow is charging makes the arrows miss
        // 10/10 — the eye moves while the look is sent in 8.6 deg/
        // tick baby steps, so the server's rotation lags the aim.
        // Standing still, the same ballistics hit 3/3 and killed a
        // creeper (run 99). So: while a shot is charging, stand
        // still; between shots, move to keep range as below.
        if (bowCharging) {
          bot.setControlState('forward', false); bot.setControlState('back', false)
          bot.setControlState('left', false); bot.setControlState('right', false)
          bot.setControlState('sprint', false); bot.setControlState('jump', false)
          return // the charge owns this tick — do not move or melee
        }
        // keep range: skeleton 10-14 (it shoots back, so distance
        // matters); creeper 6-10 (closer = more accurate, and the
        // creeper kept drifting to 15+ blocks where arrows drop and
        // combat stops at 16). At 6-10 Segs is still safe (the fuse
        // only starts within 3 blocks).
        const bowMin = target.name === 'creeper' ? 8 : 10
        const bowMax = target.name === 'creeper' ? 14 : 14
        if (dist < bowMin) {
          // v10.4 combat edge safety (run 75: Segs strafed/backed
          // off the arena and fell 14 blocks — the edge watchdog's
          // stop is re-overridden by the next combat tick, so combat
          // itself must refuse to walk off an edge).
          const awayDir = pos.clone().subtract(target.position); awayDir.y = 0
          if (!combatMoveSafe(awayDir.x, awayDir.z)) {
            // v10.4 corner escape (run 75: Segs backed into the arena
            // corner and both strafes were wall-blocked, so it stood
            // still while the creeper closed in). Try the 8
            // facing-relative directions, most-away first, and take
            // the first safe one (Segs looks AT the target, so back
            // = away, left/right = sideways, forward = past it).
            bot.setControlState('back', false); bot.setControlState('forward', false); bot.setControlState('sprint', false)
            const toT2 = target.position.clone().subtract(pos); toT2.y = 0
            const tl2 = Math.hypot(toT2.x, toT2.z) || 1
            const fx = toT2.x / tl2, fz = toT2.z / tl2 // forward = toward target
            const rx = -fz, rz = fx // right = perpendicular
            const dirs = [
              { dx: -fx, dz: -fz, f: false, b: true, l: false, r: false }, // back (away)
              { dx: -fx - rx, dz: -fz - rz, f: false, b: true, l: true, r: false }, // back-left
              { dx: -fx + rx, dz: -fz + rz, f: false, b: true, l: false, r: true }, // back-right
              { dx: -rx, dz: -rz, f: false, b: false, l: true, r: false }, // left
              { dx: rx, dz: rz, f: false, b: false, l: false, r: true }, // right
              { dx: fx - rx, dz: fz - rz, f: true, b: false, l: true, r: false }, // fwd-left (past it)
              { dx: fx + rx, dz: fz + rz, f: true, b: false, l: false, r: true }, // fwd-right (past it)
              { dx: fx, dz: fz, f: true, b: false, l: false, r: false }, // forward (through)
            ]
            for (const d of dirs) {
              if (combatMoveSafe(d.dx, d.dz)) {
                bot.setControlState('forward', d.f); bot.setControlState('back', d.b)
                bot.setControlState('left', d.l); bot.setControlState('right', d.r)
                logEvent('combat', 'corner escape: moving ' + (d.b ? 'back' : d.f ? 'forward' : '') + (d.l ? '+left' : d.r ? '+right' : ''))
                break
              }
            }
          }
          else { bot.setControlState('back', true); bot.setControlState('forward', false) }
          // SPRINT backward (creeper walks 4 blocks/s; walking
          // backward is the same speed so the distance never grows
          // and the creeper reaches Segs in ~2 shots). Sprinting
          // backward outruns it while Segs keeps shooting.
          bot.setControlState('sprint', true)
        } else if (dist > bowMax) {
          const toDir = target.position.clone().subtract(pos); toDir.y = 0
          if (!combatMoveSafe(toDir.x, toDir.z)) { bot.setControlState('forward', false); bot.setControlState('sprint', false); bot.setControlState('back', false) }
          else { bot.setControlState('forward', true); bot.setControlState('sprint', true); bot.setControlState('back', false) }
        } else {
          bot.setControlState('forward', false)
          bot.setControlState('back', false)
          bot.setControlState('sprint', false)
        }
        // strafe while shooting (return fire cannot be led)
        if (Date.now() - combatStrafeFlip > 300 + Math.random() * 200) { combatStrafeFlip = Date.now(); combatStrafeDir = -combatStrafeDir }
        {
          // v10.4: do not strafe off an edge — flip, or stand still
          const toT = target.position.clone().subtract(pos); toT.y = 0
          const tl = Math.hypot(toT.x, toT.z) || 1
          // strafe dir: perpendicular to the target direction
          let sx = -toT.z / tl * combatStrafeDir, sz = toT.x / tl * combatStrafeDir
          if (!combatMoveSafe(sx, sz)) { combatStrafeDir = -combatStrafeDir; sx = -sx; sz = -sz }
          if (!combatMoveSafe(sx, sz)) { bot.setControlState('left', false); bot.setControlState('right', false) }
          else { bot.setControlState('left', combatStrafeDir < 0); bot.setControlState('right', combatStrafeDir > 0) }
        }
        // aim + shoot (once per 1.2s, only when not already charging)
        // v10.5.3 (creeper4 run 158): the sprint gate added for the
        // creeper3-160 flake is REMOVED — it did not prevent that
        // flake (the charge there started while standing still) and
        // it blocked the killing 3rd shot here: the creeper was at
        // hp 1, dist 7.1, Segs was sprinting back to bowMin 8, the
        // gate blocked the charge, the creeper closed to 2.7 and
        // exploded (hp 20->1). A charge while moving away is a
        // legitimate shot; the gate starved the offense. The
        // consumed:NO mechanism is still unknown — the release-time
        // diagnostics below (control states at charge start,
        // usingHeldItem + held item at release) will pin it.
        if (!bowCharging && Date.now() - bowLastShot >= 1200) {
          bowCharging = true
          logEvent('combat', 'BOW shot attempt: dist=' + dist.toFixed(1) + ' target=' + target.name + ' held=' + (bot.heldItem ? bot.heldItem.name : 'none') + ' ctrl=' + (bot.controlState.sprint ? 'sprint ' : '') + (bot.controlState.forward ? 'fwd ' : '') + (bot.controlState.back ? 'back ' : '') + (bot.controlState.left ? 'left ' : '') + (bot.controlState.right ? 'right' : ''))
          try {
            const bow = bot.inventory.items().find(i => i.name === 'bow')
            const arrowsBefore = bot.inventory.items().filter(i => i.name === 'arrow').reduce((a, i) => a + i.count, 0)
            if (bow) await bot.equip(bow, 'hand')
            logEvent('combat', 'BOW equipped, held=' + (bot.heldItem ? bot.heldItem.name : 'none') + ', charging...')
            // aim directly at the target's chest (y + 1.0). No lead:
            // the target's velocity is 0 when sampled between steps,
            // so a lead makes the arrow go where the skeleton WAS.
            // At 10 blocks the arrow flies in 0.19s — the skeleton
            // moves less than a block in that time, and its body is
            // 0.6 wide x 1.99 tall, so a chest aim still hits.
            // aim function: chest (y + 1.0), plus a creeper lead
            // (it walks toward Segs at ~4 blocks/s — lead it by
            // speed x flight time in the direction from the creeper
            // to Segs). Re-aimed every 100ms DURING the charge, so
            // the arrow is released at the target's CURRENT position,
            // not where it was when the charge started (the creeper
            // moves ~4 blocks in the 1s charge — a stale aim misses).
            const bowAim = () => {
              try {
                // LIVE entity by NAME, not by stored id — the stored
                // combatTarget goes stale (server re-creates the
                // entity), so bot.entities[id] is undefined and the
                // aim falls back to a stale position (the same bug
                // that caused the 92% sword miss rate).
                let live = bot.entities[target.id]
                if (!live || !live.position) {
                  let bestD = 99
                  for (const e of Object.values(bot.entities)) {
                    if (!e || e.name !== target.name || !e.position) continue
                    const d = bot.entity.position.distanceTo(e.position)
                    if (d < bestD) { bestD = d; live = e }
                  }
                }
                // v10.4: a fallback entity 16+ blocks away is NOT this
                // fight (run 75 aimed at a cave creeper 46 away).
                // Skip the aim this tick; the live check above ends
                // the fight if the real target is gone.
                if (!live || !live.position) return
                if (bot.entity.position.distanceTo(live.position) > 16) return
                const bp = bowAimPoint(live, bowLeadVec(live, bot.entity.position.distanceTo(live.position)))
                if (bp) slowLookAtYawPitch(bp.yaw, bp.pitch)
                else bot.lookAt(live.position.clone().offset(0, 1.0, 0))
              } catch (e) {}
            }
            bowAim()
            bot.activateItem(false) // start charging the bow
            // re-aim every 50ms while charging (tracks the target;
            // 100ms let a creeper walk 0.4 blocks between aims)
            const bowAimTimer = setInterval(bowAim, 50)
            globalThis._bowAimTimer = bowAimTimer
            globalThis._bowReleaseTimer = setTimeout(() => {
              globalThis._bowReleaseTimer = null
              try { clearInterval(bowAimTimer) } catch (e) {}
              globalThis._bowAimTimer = null
              // v10.5.3 (creeper4): release-time diagnostic for the
              // consumed:NO flake — log the fork's usingHeldItem
              // flag and the held item right before the release, so
              // a flake run shows whether the fork ever registered
              // the bow use (usingHeldItem false = activateItem
              // never took effect) or the server dropped it (flag
              // true but no arrow consumed).
              logEvent('combat', 'BOW release check: usingHeldItem=' + bot.usingHeldItem + ' held=' + (bot.heldItem ? bot.heldItem.name : 'none'))
              if (!bot.heldItem || bot.heldItem.name !== 'bow') {
                logEvent('combat', 'bow release skipped — held item is ' + (bot.heldItem ? bot.heldItem.name : 'none') + ', not bow (unequipped mid-charge)')
                bowCharging = false
                bowLastShot = Date.now()
                return
              }
              try { bowAim() } catch (e) {} // one final aim right before release
              try {
                releaseItem()
                // v10.4: read the count 500ms LATER — the server's
                // inventory sync packet lands after the release, so
                // an immediate read always says NO (run 75: all 3
                // shots read NO at release but 64->61 by the next
                // attempt — every shot had consumed an arrow).
                setTimeout(() => {
                  const arrowsAfter = bot.inventory.items().filter(i => i.name === 'arrow').reduce((a, i) => a + i.count, 0)
                  logEvent('combat', 'BOW released — consumed: ' + (arrowsAfter < arrowsBefore ? 'YES' : 'NO') + ' (' + arrowsBefore + '->' + arrowsAfter + ')')
                }, 500)
                logEvent('combat', 'BOW released (arrow fired)')
              } catch (e) {}
              bowCharging = false
              bowLastShot = Date.now()
            }, 1000) // full charge = max damage
          } catch (e) { bowCharging = false }
        }
        return // bow handled this tick — do not also do melee movement
      }
      // Weapon: no sword or axe means no fighting. Fists do nothing and
      // Segs takes hits for free — flee and say so instead.
      const nearby = combatSurroundings(8).count
      const preferAxe = nearby <= 1 && (target.name === 'witch' || target.name === 'ravager' || target.name === 'evoker')
      const kind = equipCombatWeapon(preferAxe)
      if (!kind) {
        // No weapon YET — the inventory may still be syncing after a
        // respawn. Retry for ~3s (12 ticks) before giving up, so a
        // slow sync does not forfeit the fight.
        combatNoWeaponTicks = (combatNoWeaponTicks || 0) + 1
        if (combatNoWeaponTicks < 20) return
        if (Date.now() - combatSaidNeedWeapon > 30000) {
          combatSaidNeedWeapon = Date.now()
          say('i need a sword or an axe to fight — give me one or tell me to make one')
        }
        const invDbg = bot.inventory.items().map(i => i.name + 'x' + i.count).join(', ') || '(empty)'
        logEvent('combat', 'no weapon! inv=[' + invDbg + '], held=' + (bot.heldItem ? bot.heldItem.name : 'none'))
        stopCombat('no weapon')
        startFlee(target)
        return
      }
      combatNoWeaponTicks = 0
      // Move: two modes. MELEE (zombie etc.) — KITING: Segs hits from
      // 3 blocks, the mob can only hit from ~2, so keep the gap at
      // 2.5-3.0 and the mob can never reach Segs. RANGED (skeleton etc.)
      // — CLOSE AND STAY: a skeleton backs away and shoots, so kiting
      // lets it keep shooting. Segs sprints to point-blank (<2 blocks)
      // and stays on it. While closing, strafe RANDOMLY (not a fixed
      // rhythm) so the arrows cannot be led. Every hit knocks the mob
      // back, which buys the range back.
      const RANGED_MOBS = new Set(['skeleton', 'stray', 'witch', 'blaze', 'ghast', 'pillager', 'evoker'])
      const isRanged = RANGED_MOBS.has(target.name)
      const inRange = dist <= 3.2
      slowLookAt(target.position.offset(0, 1.2, 0))
      // strafe flip: random 300-800ms vs ranged (unpredictable, arrows
      // miss), steady 1.2s vs melee
      const flipMs = isRanged ? 300 + Math.random() * 500 : 1200
      if (Date.now() - combatStrafeFlip > flipMs) { combatStrafeFlip = Date.now(); combatStrafeDir = -combatStrafeDir }
      // Creeper: keep it at MAX range (3.2). The fuse lights at 3.0,
      // so the melee kiting range (2.5-3.0) puts Segs inside the blast.
      // If the creeper gets closer than 3.0, TURN AND SPRINT AWAY
      // (forward, not backward — backing away is only ~2.5 blocks/sec,
      // the creeper walks that fast too, so Segs never gains distance
      // and the fuse completes. Forward sprint is 5.6 and outruns it).
      if (target.name === 'creeper') {
        if (dist < 3.0 && !combatNoFlee) {
          // too close — face away and sprint forward (outruns it)
          try {
            const away = bot.entity.position.clone().subtract(target.position)
            away.y = 0
            if (away.length() > 0.1) {
              away.normalize()
              bot.lookAt(bot.entity.position.clone().add(away.scale(5)))
            }
          } catch (e) {}
          bot.setControlState('forward', true)
          bot.setControlState('sprint', true)
          bot.setControlState('back', false)
          bot.setControlState('jump', false)
          bot.setControlState('left', false)
          bot.setControlState('right', false)
        } else {
          // STAND STILL. The creeper chases Segs on its own — walking
          // toward it puts Segs inside fuse range (3.0) before it can
          // hit. Standing still, Segs hits it at max range (3.2) when
          // it arrives, the knockback throws it back to ~6, and it
          // comes back for the next hit. 3 hits kill it, fuse never
          // lights, because Segs never lets it within 3.0.
          bot.setControlState('forward', false)
          bot.setControlState('back', false)
          bot.setControlState('sprint', false)
          bot.setControlState('jump', false)
          bot.setControlState('left', false)
          bot.setControlState('right', false)
        }
      } else if (isRanged) {
        const toDirM = target.position.clone().subtract(pos); toDirM.y = 0
        const moveSafeM = combatMoveSafe(toDirM.x, toDirM.z)
        if (dist > 3.2) {
          if (!moveSafeM) { bot.setControlState('forward', false); bot.setControlState('sprint', false); bot.setControlState('jump', false); bot.setControlState('back', false); bot.setControlState('left', false); bot.setControlState('right', false) }
          else {
          // close in fast: SPRINT-JUMP straight at it (no strafe —
          // strafing while closing slows the forward movement, so Segs
          // takes ~14s to catch a retreating skeleton and eats arrows
          // the whole time). Sprint-jumping is ~7 blocks/sec, so Segs
          // reaches sword range in ~2s and starts landing hits.
          bot.setControlState('forward', true)
          bot.setControlState('sprint', true)
          bot.setControlState('jump', true)
          bot.setControlState('back', false)
          bot.setControlState('left', false)
          bot.setControlState('right', false)
          }
        } else if (dist > 2.0) {
          // in sword range — strafe randomly while attacking so the
          // arrows cannot be led
          bot.setControlState('forward', true)
          bot.setControlState('sprint', false)
          bot.setControlState('jump', false)
          bot.setControlState('back', false)
        } else {
          // point-blank — stay on it, follow if it retreats (no jump,
          // so Segs can hit cleanly on the cooldown)
          bot.setControlState('forward', true)
          bot.setControlState('sprint', false)
          bot.setControlState('jump', false)
          bot.setControlState('back', false)
        }
      } else if (dist < 2.5) {
        // too close — back away (strafe too, so the mob cannot track)
        bot.setControlState('back', true)
        bot.setControlState('forward', false)
        bot.setControlState('sprint', false)
      } else if (dist > 3.0) {
        // too far — close in fast (unless that way is off an edge)
        const toDir2 = target.position.clone().subtract(pos); toDir2.y = 0
        if (!combatMoveSafe(toDir2.x, toDir2.z)) { bot.setControlState('forward', false); bot.setControlState('sprint', false); bot.setControlState('back', false) }
        else { bot.setControlState('forward', true); bot.setControlState('sprint', true); bot.setControlState('back', false) }
      } else {
        // sweet spot (2.5-3.0) — hold range, strafe to dodge
        bot.setControlState('forward', false)
        bot.setControlState('back', false)
        bot.setControlState('sprint', false)
      }
      // strafe (only when not sprint-jumping straight at a ranged
      // target — the close-in above already set left/right to false)
      if (!(isRanged && dist > 3.2)) {
        bot.setControlState('left', combatStrafeDir < 0)
        bot.setControlState('right', combatStrafeDir > 0)
      }
      // Creeper: HIT-AND-RUN. The fuse is 1.5s — walking backward is
      // too slow, the creeper explodes before Segs is clear (run 53:
      // Segs took ~10 damage and retreated without killing it). So
      // after a hit, SPRINT away, and do not re-approach until the
      // creeper is >5 blocks away (fuse reset). 3 hits kill it.
      if (target.name === 'creeper') {
        if (dist < 3.0 && !combatNoFlee) {
          bot.setControlState('back', true)
          bot.setControlState('sprint', true)
          bot.setControlState('forward', false)
          bot.setControlState('left', false)
          bot.setControlState('right', false)
        }
      }
      // Shield: while closing in on a RANGED mob (skeleton etc.), raise
      // the shield (off-hand) so arrows are blocked, and DO NOT attack
      // — attacking cancels the block and the arrow lands mid-swing.
      // Lower the shield and attack only at point-blank (dist <= 2.0),
      // where Segs kills it in 2 crits before it can shoot again.
      // No shield = no block, Segs relies on strafing instead.
      const RANGED_MOBS2 = new Set(['skeleton', 'stray', 'witch', 'blaze', 'ghast', 'pillager', 'evoker'])
      const isRangedTarget = RANGED_MOBS2.has(target.name)
      const offHand = bot.inventory.slots[45]
      const hasShield = offHand && offHand.name === 'shield'
      if (!combatShieldLogged && isRangedTarget) {
        combatShieldLogged = true
        const invList = bot.inventory.items().map(i => i.name + 'x' + i.count).join(', ') || '(empty)'
        logEvent('combat', 'shield check: off-hand=' + (offHand ? offHand.name : 'empty') + ', inv=[' + invList + '], held=' + (bot.heldItem ? bot.heldItem.name : 'none'))
      }
      if (hasShield && isRangedTarget) {
        // Stateful: only (de)activate on CHANGE. Calling activateItem
        // every tick re-sends use_item and resets the block, so the
        // shield is never up when the arrow arrives.
        if (dist > 2.0 && !shieldUp) {
          try { bot.activateItem(true); shieldUp = true } catch (e) {}
        } else if (dist <= 2.0 && shieldUp) {
          try { releaseItem(); shieldUp = false } catch (e) {}
        }
      }
      checkAntiBreak() // v10.4 ANTIBREAK: never swing a tool about to break
      // Attack: only on the cooldown (full damage), never spam.
      // Crit (jump + hit while falling, 1.5x) on tough single targets.
      const cd = combatCooldownMs(kind)
      // Attack range: 2.5 for ranged (the skeleton retreats, so an
      // attack sent at 3.2 blocks misses by the time it registers —
      // 386 attempts for 10 kills proved it). 3.2 for melee (zombies
      // do not retreat, so the kiting range works).
      const attackRange = isRangedTarget ? 2.5 : 3.2
      if (dist <= attackRange && Date.now() - combatLastAttack >= cd + gaussJitter()) {
        const strike = () => {
          try {
            if (!combatTarget || !combatTarget.position) return
            // Re-fetch the target by id from the LIVE entity map. The
            // stored combatTarget can go stale (the server re-creates
            // the entity object), and attacking a ghost never lands —
            // that was the 38-swings-per-kill miss rate. Attack the
            // live entity, or skip if it is gone.
            const live = bot.entities[combatTarget.id]
            if (!live || !live.position) return
            if (bot.entity.position.distanceTo(live.position) > 3.0) return
            // v10.4 KillauraLegit discipline: LOS gate + verify facing
            // before the hit. A swing at a mob Segs cannot see, or is
            // not actually looking at yet, is a wasted hit.
            if (!canSeeMob(live)) { logEvent('combat', 'strike skipped: no LOS to ' + live.name); return }
            if (!isFacing(live)) { logEvent('combat', 'strike skipped: not facing ' + live.name + ' yet (turning)'); return }
            // Immediate attack. (A lookAt-wait was tried and made the
            // zombie worse — 4 hits, 9s — because it slowed Segs down.
            // The per-tick lookAt already keeps Segs facing a slow
            // zombie, so the immediate attack lands. The 0-hit zombie
            // pass used this.)
            bot.attack(live)
            combatLastAttack = Date.now()
            combatHitsLanded++; bumpStat('combatHitsLanded', 1)
          } catch (e) {}
        }
        // Attack immediately on the cooldown. (The old jump-crit with a
        // 220ms delay wasted hits on a retreating target: by the time
        // the delay passed, the skeleton had moved out of range and the
        // strike was skipped. A reliable hit now beats a crit that
        // never lands.)
        strike()
      }
      // Surrounded: 3+ mobs on 2+ sides. BREAK OUT through the gap.
      // Kiting away from the pack centre does NOT work when the zombies
      // form a ring — moving away from the centre just pushes Segs
      // into the ring. Instead, count mobs in each of 8 directions,
      // pick the emptiest (the gap), and SPRINT-JUMP through it, then
      // re-engage from outside the ring.
      const surr = combatSurroundings(8)
      // FUNNEL EARLY: 2+ hostiles nearby means a ring is forming.
      // Back to a wall NOW (before it closes), so Segs fights from
      // a funnel position and never gets surrounded. Waiting until
      // surrounded (3+ mobs) cost 5 hits before the funnel started.
      if (surr.count >= 2) {
        // FUNNEL: back to the nearest wall so the horde can only come
        // from the front. Check the 4 cardinal directions for a solid
        // block within 10 blocks; stand next to it (wall at Segs' back).
        if (!funnelActive) {
          let wallDir = null, wallDist = 99
          for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            for (let d = 2; d <= 10; d++) {
              const bx = Math.floor(pos.x) + dx * d, bz = Math.floor(pos.z) + dz * d
              const b = bot.blockAt(new (require('vec3').Vec3)(bx, Math.floor(pos.y), bz))
              if (b && b.name !== 'air' && b.name !== 'water') { if (d < wallDist) { wallDist = d; wallDir = [dx, dz] } break }
            }
          }
          if (wallDir) {
            funnelActive = true
            logEvent('combat', 'surrounded by ' + surr.count + ' — backing to wall (' + wallDir + ', ' + wallDist + ' blocks)')
            const dest = pos.clone().add(new (require('vec3').Vec3)(wallDir[0] * (wallDist - 1), 0, wallDir[1] * (wallDist - 1)))
            try { bot.pathfinder.setGoal(new goals.GoalNear(dest.x, dest.y, dest.z, 1)) } catch (e) {}
            setTimeout(() => { funnelActive = false }, 5000)
            return // let the pathfinder move Segs to the wall this tick
          }
        }
        let bestDir = null, bestCount = 99
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2
          const dx = Math.cos(ang), dz = Math.sin(ang)
          let n = 0
          for (const e of Object.values(bot.entities)) {
            if (!e || !e.name || !HOSTILE_MOBS.includes(e.name) || COMBAT_NEVER.has(e.name)) continue
            const rel = e.position.clone().subtract(pos)
            const d = Math.hypot(rel.x, rel.z)
            if (d > 8) continue
            const dot = (rel.x * dx + rel.z * dz) / (d || 1)
            if (dot > 0.7) n++
          }
          if (n < bestCount) { bestCount = n; bestDir = new (require('vec3').Vec3)(dx, 0, dz) }
        }
        if (bestDir) {
          logEvent('combat', 'surrounded by ' + surr.count + ', breaking out (gap has ' + bestCount + ')')
          const dest = pos.clone().add(bestDir.clone().scale(6))
          try { bot.lookAt(dest) } catch (e) {}
          bot.setControlState('forward', true)
          bot.setControlState('sprint', true)
          bot.setControlState('jump', true)
          bot.setControlState('back', false)
        }
      }
    } catch (e) { stopCombat('error: ' + (e && e.message ? e.message : e)) }
  }
  function defendCheck () {
    if (!config.autoDefend && !guardMode) return
    if (!bot.entity) return
    if (bot.health < 12) return // too hurt to fight — heal first, do not re-engage
    if (inCombat()) return // already fighting; the loop re-targets itself
    // 16 blocks so a skeleton is spotted at bow range (the bow engages
    // from 8-14); melee still closes in, so the range does not make
    // Segs charge across the map for a zombie.
    const target = findCombatTarget(16)
    if (target) {
      log('Defending vs ' + (target.username || target.name))
      startCombat(target)
    }
  }

  function equipBestWeapon () {
    try {
      equipCombatWeapon(false)
      bot.armorManager.equipAll()
    } catch (e) {}
  }

  bot.on('entitySpawn', (entity) => {
    if (!bot.entity || entity.type !== 'object' || entity.objectType !== 'Item') return
    if (entity.position.distanceTo(bot.entity.position) < 5 && !farming) {
      try { bot.pathfinder.setGoal(new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 1)) } catch (e) {}
    }
  })

  bot.on('kicked', (reason) => { connected = false; stopFlee(); log('Kicked: ' + reason); scheduleReconnect() })
  bot.on('error', (err) => { log('Error: ' + err.message) })
  bot.on('end', (reason) => { connected = false; stopFlee(); log('Disconnected: ' + (reason || '')); scheduleReconnect() })

  function scheduleReconnect () {
    if (stopping || !config.autoReconnect) return
    if (reconnectTimer) return
    log(`Reconnecting in ${config.reconnectDelayMs / 1000}s...`)
    reconnectTimer = setTimeout(() => { reconnectTimer = null; createBot() }, config.reconnectDelayMs || 10000)
  }

  // ================= v10.4 — NiceWurst picks =================
  // Tash's 13 picks, in order: AutoChat, AimAssist, KillauraLegit,
  // AutoEat, AutoArmor, AutoTotem, AntiBreak, AutoFarm, AutoMine,
  // Follow, Parkour, AutoRespawn, PacketRate. Source of truth:
  // ~/workspace/wurst/nicewurst-analysis.md (decompiled Wurst 7.56.1).
  // AimAssist + KillauraLegit are cheat-as-products — only their
  // HUMAN discipline is ported (capped rotation, LOS gate, facing
  // check, jitter, bow ballistics). Never auto-aim / auto-attack.

  // v10.4 RELEASE FIX: the fork's bot.deactivateItem() sends
  // block_dig status 5. In Minecraft 26.3 the PlayerAction enum
  // gained CHANGE_DESTROY_DIRECTION (ordinal 1), so RELEASE_USE_ITEM
  // moved from 5 to 6 and status 5 is now DROP_ITEM. Every bow
  // "release" was a drop, never a shot (probe-bow4 proved status 6
  // fires: arrow 64 -> 63), and every shield-lower dropped the
  // shield. This is also the true cause of the v10.3.1 drop bug.
  // Use this for ALL item-use releases (bow, shield). Never call
  // bot.deactivateItem() on 26.3.
  function releaseItem () {
    try {
      bot._client.write('block_dig', { status: 6, location: new Vec3(0, 0, 0), face: 0, sequence: 0 })
      bot.usingHeldItem = false
    } catch (e) {}
  }
  // v10.4 (patch M): the fork's bot.deactivateItem() sends status 5
  // = DROP_ITEM in 26.3. Patch G removed bot.js's own calls, but the
  // mineflayer-auto-eat plugin calls bot.deactivateItem() before
  // every eat — a drop risk on every meal. Override it to the safe
  // status-6 release so plugins cannot drop the held item.
  // v10.5.2: this install alone is NOT enough — every plugin is
  // injected at inject_allowed (setTimeout 0, after createBot
  // returns), and the inventory plugin re-assigns the fork's
  // status-5 function OVER this override. It is re-installed in
  // bot.once('spawn') too (after injection) — that is the install
  // that actually survives. See runs 134-135.
  try { bot.deactivateItem = () => { releaseItem() } } catch (e) {}

  // ---- combat discipline helpers (KillauraLegit + BowAimbot) ----
  function angleDiff (a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d }
  function slowLookAtYawPitch (targetYaw, targetPitch) {
    // KillauraLegit: rotationSpeed 600 deg/s (30 deg/tick). Combat
    // tick is 250ms, so max 150 deg per call. (RotationUtils.
    // slowlyTurnTowards, limitAngleChange — decompiled source.)
    try {
      const maxStep = (600 * Math.PI / 180) * 0.25
      const yaw = bot.entity.yaw + Math.max(-maxStep, Math.min(maxStep, angleDiff(bot.entity.yaw, targetYaw)))
      let pitch = bot.entity.pitch + Math.max(-maxStep, Math.min(maxStep, targetPitch - bot.entity.pitch))
      pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch))
      bot.look(yaw, pitch).catch(() => {})
    } catch (e) {}
  }
  function slowLookAt (aim) {
    try {
      const eye = bot.entity.position.offset(0, bot.entity.eyeHeight || 1.62, 0)
      const d = aim.clone().subtract(eye)
      slowLookAtYawPitch(Math.atan2(-d.x, -d.z), Math.atan2(d.y, Math.sqrt(d.x * d.x + d.z * d.z)))
    } catch (e) {}
  }
  function isFacing (e, tolDeg = 15) {
    // KillauraLegit: attack only after isFacingBox confirms the
    // crosshair is on the target (RotationUtils.isFacingBox).
    try {
      if (!e || !e.position) return false
      const eye = bot.entity.position.offset(0, bot.entity.eyeHeight || 1.62, 0)
      const aim = e.position.clone(); aim.y += 1.0
      const d = aim.subtract(eye); const len = d.norm()
      if (len < 0.5) return true
      const yaw = bot.entity.yaw, pitch = bot.entity.pitch
      const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch)
      const dot = (d.x * fx + d.y * fy + d.z * fz) / len
      return dot > Math.cos(tolDeg * Math.PI / 180)
    } catch (err) { return true }
  }
  function combatMoveSafe (dx, dz) {
    // v10.4 combat edge safety (run 75): combat sets control states
    // directly every 250ms, so the edge watchdog's stop is overridden
    // almost immediately. Before moving in a direction, check the
    // ground ahead: a drop with no safe landing within 3 blocks is
    // a NO — stand and shoot instead of walking off.
    try {
      const len = Math.hypot(dx, dz)
      if (len < 0.1) return true
      const dir = new (require('vec3').Vec3)(dx / len, 0, dz / len)
      if (groundAhead(dir, 1.5) !== 'drop') return true
      const Vec3 = require('vec3').Vec3
      for (let d = 1; d <= 3; d++) {
        const b = bot.blockAt(new Vec3(Math.floor(bot.entity.position.x + dir.x * 1.5), Math.floor(bot.entity.position.y) - d, Math.floor(bot.entity.position.z + dir.z * 1.5)))
        if (b && b.boundingBox === 'block') return true
      }
      logEvent('combat', 'edge-safe: will NOT move ' + dir.x.toFixed(1) + ',' + dir.z.toFixed(1) + ' (drop, no landing)')
      return false
    } catch (e) { return true }
  }
  function gaussJitter () {
    // KillauraLegit: +/-100ms Gaussian jitter on attack timing.
    let u = 0, v = 0
    while (u === 0) u = Math.random()
    while (v === 0) v = Math.random()
    const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    return Math.max(-100, Math.min(100, g * 50))
  }
  // v10.4: lead tracking. live.velocity is ~0 for a walking mob —
  // the server only sends velocity packets on knockback, NOT for
  // normal walking (run 75: 3 arrows missed a creeper walking
  // straight at Segs because the lead was computed from a zero
  // velocity). Wurst uses (target.pos - target.xOld) — the per-tick
  // POSITION delta. Track it here, per target.
  let bowTrack = { id: null, samples: [] } // {pos, at} samples, last ~500ms
  function bowLeadVec (live, dist) {
    try {
      const now = Date.now()
      // v10.4 fix: the INSTANT 50ms delta is noise — the server sends
      // a walking mob's position in jumps, so the delta is 0.00 most
      // samples and 0.30 on the jump (run 75). The aim point jumped
      // around by 0.36 blocks between re-aims and the arrow missed a
      // 0.6-wide creeper. Use a rolling average over the last ~500ms
      // instead: a creeper walking 4 blocks/s = 0.2 blocks/tick, stable.
      if (bowTrack.id !== live.id) bowTrack = { id: live.id, samples: [] }
      bowTrack.samples.push({ pos: live.position.clone(), at: now })
      bowTrack.samples = bowTrack.samples.filter(sm => now - sm.at <= 500)
      let disp = { x: 0, y: 0, z: 0 }
      if (bowTrack.samples.length >= 2) {
        const first = bowTrack.samples[0], last = bowTrack.samples[bowTrack.samples.length - 1]
        const dtTicks = Math.max(1, (last.at - first.at) / 50)
        disp = { x: (last.pos.x - first.pos.x) / dtTicks, y: (last.pos.y - first.pos.y) / dtTicks, z: (last.pos.z - first.pos.z) / dtTicks }
        const m = Math.hypot(disp.x, disp.z)
        if (m > 0.3) { disp.x *= 0.3 / m; disp.z *= 0.3 / m }
      }
      const d = dist * (1 / 3) // v10.4 (patch J): lead time = flight time (arrow 3 b/tick), not Wurst's 0.2
      return { x: disp.x * d, y: disp.y * d, z: disp.z * d, dispPerTick: Math.hypot(disp.x, disp.z) }
    } catch (e) { return { x: 0, y: 0, z: 0, dispPerTick: 0 } }
  }
  function bowAimPoint (live, leadVec) {
    // BowAimbot ballistics, EXACT from the decompiled source
    // (BowAimbotHack.java): velocity = bow charge 0..1 (1.0 = full,
    // we always charge 1000ms), g = 0.006, lead d = distance *
    // predictMovement (0.2) applied to the target's per-tick
    // displacement, aim at the bounding-box centre (+0.5 height).
    // pitch = atan((v^2 - sqrt(v^4 - g(g h^2 + 2 y v^2))) / (g h));
    // Wurst negates it (notchian XRot); mineflayer pitch is + = up.
    // No ballistic solution (NaN / negative disc) -> direct aim.
    try {
      const eye = bot.entity.position.offset(0, bot.entity.eyeHeight || 1.62, 0)
      const height = live.height || 1.8
      const centre = live.position.clone(); centre.y += height * 0.5
      const dist = eye.distanceTo(centre)
      const d = dist * (1 / 3) // v10.4 (patch J): lead time = flight time (arrow 3 b/tick), not Wurst's 0.2
      const lead = leadVec || { x: 0, y: 0, z: 0, dispPerTick: 0 }
      const pred = centre.clone()
      pred.x += lead.x; pred.z += lead.z
      const v = 1.0, g = 0.006
      const dx = pred.x - eye.x, dz = pred.z - eye.z
      const h = Math.sqrt(dx * dx + dz * dz)
      const posY = pred.y - eye.y
      const v2 = v * v, v4 = v2 * v2
      const disc = v4 - g * (g * h * h + 2 * posY * v2)
      const yaw = Math.atan2(-dx, -dz)
      if (!isFinite(disc) || disc < 0 || h < 0.5) {
        logEvent('bow', 'ballistics no solution (disc ' + (isFinite(disc) ? disc.toFixed(4) : 'NaN') + ', h=' + h.toFixed(2) + '), direct aim')
        return { yaw, pitch: Math.atan2(posY, h || 1) }
      }
      const pitch = Math.atan((v2 - Math.sqrt(disc)) / (g * h))
      logEvent('bow', 'ballistics dist=' + dist.toFixed(1) + ' h=' + h.toFixed(1) + ' dy=' + posY.toFixed(2) + ' lead=' + d.toFixed(2) + ' (disp/tick ' + (lead.dispPerTick || 0).toFixed(2) + ') pitch=' + (pitch * 180 / Math.PI).toFixed(1) + 'deg')
      return { yaw, pitch }
    } catch (e) { return null }
  }

  // ---- FOLLOW: re-target the owner BY NAME (Wurst Follow) ----
  function resolveOwnerEntity () {
    try {
      for (const pl of Object.values(bot.players || {})) {
        if (pl && pl.username && pl.username.toLowerCase() === OWNER && pl.entity) return pl.entity
      }
      for (const e of Object.values(bot.entities || {})) {
        if (e && e.username && e.username.toLowerCase() === OWNER) return e
      }
      return null
    } catch (err) { return null }
  }

  // ---- AUTOCHAT (Groq) — the ONLY real AI in the jar ----
  // Groq OpenAI-compatible endpoint, gpt-oss-20b primary,
  // gpt-oss-120b fallback. Free tier: 30 RPM, 1000 req/day,
  // 200k tokens/day. Key lives ONLY in config.json on Tash's PC.
  let aiEnabled = !!config.aiEnabled
  let aiLastReply = 0, aiLastUnsolicited = 0, aiLastPerPerson = {}
  let aiRecentReplies = [], aiChatHistory = []
  let aiReqCount = 0, aiTokenCount = 0, aiDay = new Date().toISOString().slice(0, 10)
  let aiBackoffUntil = 0, aiInFlight = false, aiNoKeySaid = false
  const AI_MODELS = { primary: 'openai/gpt-oss-20b', fallback: 'openai/gpt-oss-120b' }
  function aiResetDay () { const d = new Date().toISOString().slice(0, 10); if (d !== aiDay) { aiDay = d; aiReqCount = 0; aiTokenCount = 0; logEvent('ai', 'daily budget reset') } }
  function aiBudgetHit () { aiResetDay(); return aiReqCount >= 800 || aiTokenCount >= 160000 }
  function aiHasKey () { return !!(config.groqApiKey && !String(config.groqApiKey).includes('PUT_')) }
  function aiRecordChat (username, msg) { aiChatHistory.push({ user: username, msg: String(msg).slice(0, 200) }); if (aiChatHistory.length > 5) aiChatHistory = aiChatHistory.slice(-5) }
  function aiDedup (text) {
    const words = new Set(String(text).toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 2))
    for (const old of aiRecentReplies) {
      const ow = new Set(String(old).toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 2))
      let shared = 0; for (const w of words) if (ow.has(w)) shared++
      if (shared / Math.max(words.size, ow.size, 1) >= 0.75) return true
    }
    return false
  }
  function aiFilterInjection (text) { return /ignore (all )?previous|you are now|new instructions|system prompt|jailbreak|do not (follow|obey)|disregard/i.test(String(text)) }
  function aiStatusLine () { aiResetDay(); return 'ai ' + (aiEnabled ? 'on' : 'off') + (aiHasKey() ? ' (key set)' : ' (no key)') + ', today ' + aiReqCount + ' req / ' + aiTokenCount + ' tokens' }
  async function aiAskGroq (userMsg, username) {
    aiResetDay()
    if (!aiHasKey()) return null
    if (aiBudgetHit()) { logEvent('ai', 'budget guard hit: ' + aiReqCount + ' req, ' + aiTokenCount + ' tokens — AI off for today'); return null }
    if (Date.now() < aiBackoffUntil) { logEvent('ai', 'in backoff until ' + new Date(aiBackoffUntil).toLocaleTimeString()); return null }
    const sys = 'You are Segs, a friendly Minecraft player on a server with your owner OrewaSegs. Reply in ONE short line, max 140 characters, plain words, no markdown, no emojis. Never say you are an AI or a bot. You are a player. Keep it casual and human.'
    const history = aiChatHistory.map(h => ({ role: 'user', content: h.user + ': ' + h.msg }))
    const base = { messages: [{ role: 'system', content: sys }, ...history.slice(-5), { role: 'user', content: username + ': ' + userMsg }], max_tokens: 64, temperature: 0.8, top_p: 0.9 }
    for (const model of [AI_MODELS.primary, AI_MODELS.fallback]) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.groqApiKey }, body: JSON.stringify({ ...base, model }) })
        aiReqCount++
        if (res.status === 429) { aiBackoffUntil = Date.now() + 60000; logEvent('ai', 'Groq 429 on ' + model + ' — backing off 60s'); continue }
        if (!res.ok) { logEvent('ai', 'Groq ' + res.status + ' on ' + model + ' — trying fallback'); continue }
        const data = await res.json()
        const text = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim()
        const used = (data.usage && data.usage.total_tokens) || Math.ceil(JSON.stringify(base).length / 4) + 64
        aiTokenCount += used
        logEvent('ai', 'Groq reply via ' + model + ' (' + used + ' tokens, day total ' + aiReqCount + ' req / ' + aiTokenCount + ' tok)')
        return text.slice(0, 140)
      } catch (e) { logEvent('ai', 'Groq error on ' + model + ': ' + e.message) }
    }
    aiBackoffUntil = Date.now() + 5 * 60 * 1000
    logEvent('ai', 'Groq failed on both models — backing off 5min, canned replies meanwhile')
    return null
  }
  async function aiHandleFallback (username, req, isWhisper) {
    // Addressed but nothing else matched: open-ended chat -> AI.
    if (!aiEnabled) return false
    if (!aiHasKey()) {
      if (!aiNoKeySaid) { aiNoKeySaid = true; say('ai is on but i have no groq key in config yet, so i cant think'); logEvent('ai', 'enabled but no key — canned only') }
      return true
    }
    if (aiBudgetHit()) { say('my brain budget is used up for today, ask me tomorrow'); logEvent('ai', 'budget guard: canned reply'); return true }
    const now = Date.now()
    if (now - aiLastReply < 3000) { logEvent('ai', 'cooldown: last AI reply ' + (now - aiLastReply) + 'ms ago, skipping'); return true }
    if (now - (aiLastPerPerson[username.toLowerCase()] || 0) < 30000) { logEvent('ai', 'per-person cooldown for ' + username + ', skipping'); return true }
    if (aiFilterInjection(req)) { logEvent('ai', 'injection filtered: [Filtered potential prompt-injection attempt]'); say('nope, not doing that'); return true }
    const text = await aiAskGroq(req, username)
    if (!text) { say(pick(['hmm, not sure', 'idk, ask me later', 'brain fart, try again'])); return true }
    if (aiDedup(text)) { logEvent('ai', 'de-dup: reply too similar to a recent one, skipping'); return true }
    aiRecentReplies.push(text); if (aiRecentReplies.length > 8) aiRecentReplies.shift()
    aiLastReply = Date.now(); aiLastPerPerson[username.toLowerCase()] = Date.now()
    say(text); return true
  }
  async function aiButtIn (username, msg) {
    // Unaddressed chat: Wurst's 25% butt-in chance, min 10s between
    // unsolicited replies, min 3s after any AI reply.
    if (!aiEnabled || aiInFlight || !aiHasKey()) return
    if (Date.now() - aiLastUnsolicited < 10000) return
    if (Date.now() - aiLastReply < 3000) return
    if (Math.random() > 0.25) { logEvent('ai', 'butt-in roll: no (25% chance)'); return }
    if (aiFilterInjection(msg)) return
    aiInFlight = true
    try {
      const text = await aiAskGroq(msg, username)
      if (text && !aiDedup(text)) {
        aiRecentReplies.push(text); if (aiRecentReplies.length > 8) aiRecentReplies.shift()
        aiLastUnsolicited = Date.now(); aiLastReply = Date.now()
        say(text)
      }
    } finally { aiInFlight = false }
  }

  // ---- AUTOEAT (saturation-first, Wurst AutoEat) ----
  const SATURATION = { cooked_beef: 12.8, cooked_porkchop: 12.8, cooked_mutton: 9.6, cooked_rabbit: 5.0, cooked_chicken: 7.2, baked_potato: 6.0, bread: 6.0, cooked_cod: 5.0, cooked_salmon: 6.0, pumpkin_pie: 4.8, mushroom_stew: 7.2, beetroot_soup: 7.2, rabbit_stew: 10.0, apple: 2.4, carrot: 3.6, potato: 0.6, cookie: 0.4, melon_slice: 1.2, dried_kelp: 0.6, sweet_berries: 0.4, glow_berries: 0.4, honey_bottle: 0.4 }
  const POISON_FOOD = new Set(['rotten_flesh', 'poisonous_potato', 'spider_eye', 'pufferfish', 'chorus_fruit'])
  function foodPointsOf (name) {
    try { const mc = mcDataFor(bot.version); const f = mc.foodsByName && mc.foodsByName[name]; if (f && f.foodPoints != null) return f.foodPoints } catch (e) {}
    const fb = { cooked_beef: 8, cooked_porkchop: 8, cooked_mutton: 6, cooked_chicken: 6, bread: 5, baked_potato: 5, apple: 4, carrot: 3, potato: 1, cookie: 2, melon_slice: 2 }
    return fb[name] || 2
  }
  function pickBestFood () {
    const items = bot.inventory.items().filter(i => FOOD_ITEMS.includes(i.name) && !POISON_FOOD.has(i.name))
    if (!items.length) return null
    items.sort((a, b) => (SATURATION[b.name] || 0) - (SATURATION[a.name] || 0) || foodPointsOf(b.name) - foodPointsOf(a.name))
    return items[0]
  }
  // v10.5.2: ONE guarded eat, used by every direct plugin call
  // site (health handler, combat retreat, survive). Never attempts
  // an eat at full hunger — vanilla cannot eat at 20/20, and the
  // attempt only drops the food (runs 134-135: -1 beef per eat at
  // deficit 0). Verifies the food level actually rose (500ms settle
  // for the health packet) before reporting success, so a timed-out
  // or refused eat is never counted or announced as fed.
  async function tryEatOnce () {
    if (!bot.autoEat) return false
    if (bot.food >= 20) return false
    const before = bot.food
    try {
      // v10.5.2 (run 138 leg E): the plugin's own statusCheck may
      // already be eating when we arrive — its eat() THROWS 'Already
      // eating!' in that case, and the old code reported a false
      // failure while the in-progress eat then restored hunger a
      // second later ("i tried to eat but my hunger didnt go up"
      // while food went 18->20 anyway). Wait for the in-progress
      // eat instead of starting a second one.
      if (bot.autoEat.isEating) {
        for (let i = 0; i < 16 && bot.autoEat.isEating; i++) { try { await sleepMs(250) } catch (e) {} }
      } else {
        await bot.autoEat.eat()
      }
    } catch (e) { return false }
    // Poll for the rise (up to ~2s) instead of a single 500ms check
    // — the health packet can trail the eat-finish by a tick, and an
    // in-progress eat we waited out finishes on its own schedule.
    for (let i = 0; i < 8; i++) {
      if (bot.food > before) return true
      try { await sleepMs(250) } catch (e) {}
    }
    return bot.food > before
  }
  async function eatBestFood () {
    const injured = bot.health < (bot.maxHealth || 20) - 3
    const food = pickBestFood()
    if (!food) { logEvent('autoeat', 'no edible food (poison excluded)'); return false }
    const deficit = 20 - bot.food
    // v10.5.2: a real player cannot eat at full hunger. Tash's
    // 18:53:26 log: "Segs eat" at food 20/20, deficit 0 — the old
    // code attempted the eat anyway, dropped 1 beef, and still said
    // "yum, done". Refuse, honestly, before touching the food.
    if (deficit <= 0) { logEvent('autoeat', 'already full (food 20/20), not eating ' + food.name); return 'full' }
    const foodCount = (n) => bot.inventory.items().filter(i => i.name === n).reduce((a, i) => a + i.count, 0)
    // v10.5.2 LOGGING GAP (Tash's log never recorded inventory
    // around an eat, so a -1 beef was invisible): log beef/food
    // before and after every eat, permanently.
    const foodBefore = bot.food, countBefore = foodCount(food.name)
    logEvent('autoeat', 'eating ' + food.name + ' (saturation ' + (SATURATION[food.name] || '?') + ', food ' + bot.food + '/20, injured=' + injured + ', deficit=' + deficit + ', ' + food.name + ' x' + countBefore + ')')
    try { await bot.equip(food, 'hand') } catch (e) {}
    const ate = await tryEatOnce()
    const countAfter = foodCount(food.name)
    logEvent('autoeat', 'eat done ' + food.name + ' food=' + bot.food + '/20 (was ' + foodBefore + ') ' + food.name + ' x' + countAfter + ' (was x' + countBefore + ')')
    if (!ate) { logEvent('autoeat', 'eat did not restore hunger (' + food.name + ' x' + countBefore + ' -> x' + countAfter + ', food ' + foodBefore + ' -> ' + bot.food + ')'); return false }
    bumpStat('foodEaten')
    return true
  }

  // ---- AUTOARMOR (Wurst: score = armor*5 + Protection*3 + toughness;
  // 1 piece per tick, 2-tick gap, ONLY while still) ----
  const ARMOR_POINTS = { leather_helmet: 1, golden_helmet: 2, chainmail_helmet: 2, iron_helmet: 2, diamond_helmet: 3, netherite_helmet: 3, turtle_helmet: 2, leather_chestplate: 3, golden_chestplate: 5, chainmail_chestplate: 5, iron_chestplate: 6, diamond_chestplate: 8, netherite_chestplate: 8, leather_leggings: 2, golden_leggings: 3, chainmail_leggings: 4, iron_leggings: 5, diamond_leggings: 6, netherite_leggings: 6, leather_boots: 1, golden_boots: 1, chainmail_boots: 1, iron_boots: 2, diamond_boots: 3, netherite_boots: 3 }
  const ARMOR_TOUGH = { diamond_helmet: 2, diamond_chestplate: 2, diamond_leggings: 2, diamond_boots: 2, netherite_helmet: 3, netherite_chestplate: 3, netherite_leggings: 3, netherite_boots: 3 }
  function armorSlotOf (name) { if (name.endsWith('_helmet')) return 'head'; if (name.endsWith('_chestplate')) return 'torso'; if (name.endsWith('_leggings')) return 'legs'; if (name.endsWith('_boots')) return 'feet'; return null } // 'feet' matches the loop slot + bot.equip destination (was 'boots', so boots were never equipped)
  function protectionLevel (item) { try { const e = item.enchants || []; const pr = e.find(x => x && (x.name === 'protection' || x.name === 'minecraft:protection')); return pr ? (pr.level || pr.lvl || 0) : 0 } catch (err) { return 0 } }
  function armorScore (item) { return (ARMOR_POINTS[item.name] || 0) * 5 + protectionLevel(item) * 3 + (ARMOR_TOUGH[item.name] || 0) }
  let autoArmorLast = 0
  function startAutoArmor () {
    setInterval(() => {
      try {
        if (!connected || !bot || !bot.entity || bot.health <= 0) return
        if (inCombat() || fleeTimer) return
        const vel = bot.entity.velocity
        if (vel && Math.hypot(vel.x, vel.z) > 0.2) return // only while STILL
        if (Date.now() - autoArmorLast < 100) return // 2-tick gap
        const slotIdx = { head: 5, torso: 6, legs: 7, feet: 8 }
        for (const slot of ['head', 'torso', 'legs', 'feet']) {
          const worn = bot.inventory.slots[slotIdx[slot]]
          const wornScore = worn ? armorScore(worn) : -1
          const candidates = bot.inventory.items().filter(i => armorSlotOf(i.name) === slot)
          candidates.sort((a, b) => armorScore(b) - armorScore(a))
          if (candidates.length && armorScore(candidates[0]) > wornScore) {
            autoArmorLast = Date.now()
            const best = candidates[0]
            bot.equip(best, slot).catch(() => {})
            logEvent('autoarmor', 'equipped ' + best.name + ' on ' + slot + ' (score ' + armorScore(best) + ' > worn ' + wornScore + ')')
            return // 1 piece per tick
          }
        }
      } catch (e) {}
    }, 100)
  }

  // ---- AUTOTOTEM (Wurst: re-equip on pop; health gate) ----
  let lastTotemTotal = -1, lastTotemEquipAt = 0, autoTotemStartedAt = Date.now()
  function startAutoTotem () {
    setInterval(() => {
      try {
        if (!connected || !bot || !bot.entity || bot.health <= 0) return
        const off = bot.inventory.slots[45]
        const offIsTotem = !!(off && off.name === 'totem_of_undying')
        const invTotem = bot.inventory.items().find(i => i.name === 'totem_of_undying')
        const invTotemCount = bot.inventory.items().filter(i => i.name === 'totem_of_undying').reduce((a, i) => a + i.count, 0)
        const total = invTotemCount + (offIsTotem ? 1 : 0)
        // v10.4 (patch P): a totem POP is a real drop in the TOTAL
        // totem count (inventory + off-hand), not a flag flip — the
        // equip is async, so the off-hand reads non-totem while an
        // equip is in flight and the old flag logic spammed "popped".
        // v10.4 (patch Q): ignore a total drop within 2s of an equip
        // — the inventory sync lags while the totem moves to the
        // off-hand, so the total briefly reads low (run 78 logged a
        // false "popped" at startup). A real pop is not near an equip.
        // v10.4 (patch R): skip pop detection for the first 3s after
        // the interval starts — inventory sync lag while the totem
        // gives land + the first equip runs caused a false "popped"
        // at startup in run 78.
        if (lastTotemTotal >= 0 && total < lastTotemTotal && Date.now() - lastTotemEquipAt > 2000 && Date.now() - autoTotemStartedAt > 3000) {
          if (invTotem) logEvent('autototem', 'totem popped — a fresh totem will be equipped to off-hand')
          else logEvent('autototem', 'totem popped — no spare totem in inventory')
          say('totem popped, got another one ready')
        }
        lastTotemTotal = total
        // v10.4 (patch N): hold the totem ALWAYS when Segs has one.
        // Debounce the equip (2s) so the in-flight equip is not
        // re-attempted every 500ms poll.
        if (!offIsTotem && invTotem && Date.now() - lastTotemEquipAt > 2000) {
          lastTotemEquipAt = Date.now()
          bot.equip(invTotem, 'off-hand').catch(() => {})
          logEvent('autototem', 'holding totem in off-hand (hp ' + Math.round(bot.health) + ')')
        } else if (!offIsTotem && !invTotem && bot.inventory.items().some(i => i.name === 'shield') && (!off || off.name !== 'shield')) {
          const sh = bot.inventory.items().find(i => i.name === 'shield')
          if (sh) { bot.equip(sh, 'off-hand').catch(() => {}); logEvent('autototem', 'no totem — shield in off-hand') }
        }
      } catch (e) {}
    }, 500)
  }

  // ---- ANTIBREAK (Wurst: swap out a tool about to break) ----
  function checkAntiBreak () {
    try {
      const held = bot.heldItem
      if (!held || !held.maxDurability) return false
      const used = held.durabilityUsed || 0
      const left = held.maxDurability - used
      if (left > Math.max(5, Math.floor(held.maxDurability * 0.10))) return false
      const kind = held.name.split('_').slice(1).join('_')
      const repl = bot.inventory.items().filter(i => i.name !== held.name && i.name.endsWith('_' + kind) && i.maxDurability && (i.maxDurability - (i.durabilityUsed || 0)) > 10)
      if (repl.length) {
        repl.sort((a, b) => (b.maxDurability - (b.durabilityUsed || 0)) - (a.maxDurability - (a.durabilityUsed || 0)))
        bot.equip(repl[0], 'hand').catch(() => {})
        logEvent('antibreak', held.name + ' at ' + left + '/' + held.maxDurability + ' durability — swapped to ' + repl[0].name)
        say('my ' + held.name + ' is about to break, swapped to ' + repl[0].name)
        return true
      }
      logEvent('antibreak', held.name + ' at ' + left + '/' + held.maxDurability + ' durability — no spare, keeping it')
      say('my ' + held.name + ' is almost broken and i have no spare')
      return true
    } catch (e) { return false }
  }

  // ---- AUTOFARM: remember which seed goes on each spot ----
  function recordFarmSpot (pos, cropName, seedName) {
    try {
      if (!brain.farmSpots) brain.farmSpots = {}
      brain.farmSpots[pos.x + ',' + pos.y + ',' + pos.z] = { crop: cropName, seed: seedName, at: Date.now() }
      saveBrain()
    } catch (e) {}
  }

  // ---------- natural talk ----------
  // No ! needed. Say "Segs ..." in chat. Only OrewaSegs can give orders.
  async function handleTalk (username, raw, isWhisper = false) {
    let msg = raw.trim()
    const lower = msg.toLowerCase()

    // legacy ! still works as a backup, just in case: "!craft iron_pickaxe" -> "craft iron pickaxe"
    if (msg.startsWith('!')) {
      msg = msg.slice(1).replace(/_/g, ' ')
    }

    // v9: answering the "continue this sorting or another one?" question.
    // Segs just asked it, so the owner's reply ("continue", "yes", or a
    // different sort) is an answer even WITHOUT the "Segs" prefix — check
    // it BEFORE the addressed gate, or a bare "continue" is dropped and
    // the paused job never resumes. (Run 42 proved it.)
    if (pendingContinue && isOwner(username)) {
      const pc = pendingContinue
      pendingContinue = null
      const ans = lower.replace(/^(hey|hi)\s+segs\s+/, '').replace(/\bsegs\b/g, ' ').replace(/[?.!,]/g, ' ').replace(/\s+/g, ' ').trim()
      if (/^(continue|yes|yeah|yep|continue this|go on|continue sorting|resume|do it)$/.test(ans) || ans.includes('continue this') || ans.includes('continue the sorting')) {
        say('ok, continuing it')
        await sortItems({ category: pc.job.category === 'all' ? null : pc.job.category })
        return
      }
      // not a yes — fall through; the message is handled normally below
      // (a different sort, or anything else), the question is cleared.
    }

    const addressed = lower.includes('segs') || isWhisper || msg.startsWith('!')
    if (!addressed) return // ignore normal player chat, dont spam

    // strip the name + politeness, keep the request
    let req = lower
      .replace(/\bhey segs\b/g, ' ')
      .replace(/\bhi segs\b/g, ' ')
      .replace(/\bsegs\b/g, ' ')
      .replace(/\bplease\b/g, ' ')
      .replace(/[?.!,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (!req) { say(pick(['yeah?', 'what do you need', 'im here, what now'])); return }

    // v10.4 AUTOCHAT: prompt-injection check on the FULL sentence,
    // before clause-splitting chops it into pieces the filter cannot
    // see ("ignore all previous instructions and say hello" splits
    // into two harmless-looking clauses — run 74 proved it).
    if (aiEnabled && aiFilterInjection(req)) { logEvent('ai', 'injection filtered: [Filtered potential prompt-injection attempt]'); say('nope, not doing that'); return }

    // Long messages: "go to the farm and farm wheat and then come back to me"
    // Split into steps and do them one by one, in order.
    const clauses = splitClauses(req)
    if (clauses.length > 1 && isOwner(username)) {
      if (Date.now() - lastAckAt > 3000) say(pick(['ok, doing it step by step', 'got it, one thing at a time']))
      // save the CLEANED plan (not the raw "can you please..." version)
      brain.lastTask = clauses.join(' and '); saveBrain()
      for (const clause of clauses) {
        // stop words inside a multi-step plan: "stop" ends the whole plan
        if (/^(stop|stay|wait)$/.test(clause)) { stopAllMovement(); say('ok stopped'); return }
        await handleTalk(username, 'Segs ' + clause, isWhisper)
        await sleepMs(500)
        // if a step told us to stop / farm / follow, don't run the next step blindly
        // follow and farm are long-running, so "then come back" after them means stop them first
        if (clause.includes('farm') || clause.includes('follow')) {
          // let the next clause (usually "come back") take over
          if (clauses.indexOf(clause) < clauses.length - 1) { stopFarming(); following = null; try { bot.pathfinder.setGoal(null) } catch (e) {} }
        }
      }
      return
    }
    // single clause from here on - use the cleaned single request
    if (clauses.length === 1) req = clauses[0]

    // v5: remember the action for "do it again" - do this for EVERY action,
    // not just unknown ones (that was the run-2 bug). Queries are skipped
    // inside rememberTask(). Also run a taught macro if the request matches one.
    if (isOwner(username)) {
      const macroKey = Object.keys(brain.macros || {}).find(k => req === k || req.startsWith(k + ' '))
      if (macroKey && req !== brain.macros[macroKey]) {
        say(`ok, doing my ${macroKey} routine`)
        await handleTalk(username, 'Segs ' + brain.macros[macroKey], isWhisper)
        return
      }
      rememberTask(req)
    }

    // greetings / small talk - anyone can say hi, commands are owner-only.
    // v6: much wider casual talk, all fixed replies (no AI). It understands
    // the *meaning* by matching the words you use, not by thinking.
    if (/^(hi|hello|hey|yo|hii|hello there|good morning|good afternoon|good evening)$/.test(req)) {
      const t = bot.time?.timeOfDay ?? 6000
      const greet = t > 13000 && t < 23000 ? 'good night, still up?' : t < 6000 ? 'good morning' : t < 12000 ? 'good morning' : 'hey'
      say(pick(['yo', 'hey, whats up', 'yo, ready when you are', greet])); return
    }
    if (/^(thanks|thank you|thx|nice|good bot|good job|well done)$/.test(req)) {
      say(pick(['np', 'anytime', 'you got it', 'thats what im here for'])); return
    }
    if (/^(bye|good night|goodbye|see you|see ya|gn)$/.test(req) && !req.includes('sleep')) {
      say(pick(['bye, see you', 'later', 'good night, ill keep watch'])); return
    }
    if (req.includes('who are you') || req.includes('your name') || req === 'who r u') {
      say("i'm Segs, Tash made me"); return
    }
    if (req.includes('how are you') || req === 'how r u' || req.includes('you ok') || req.includes('are you ok') || req.includes('you good')) {
      say(`im good, hp ${Math.round(bot.health)}/20 food ${bot.food}/20, ${currentJob()}`); return
    }
    if (req.includes('whats up') || req === 'sup' || req === 'wassup' || req.includes('what are you up to')) {
      say(pick(['nothing much, just ' + currentJob(), 'chilling here, what do you need', 'waiting for orders, boss'])); return
    }
    if (req.includes('i love you') || req.includes('you are the best') || req.includes('youre the best') || req.includes('best bot')) {
      say(pick(['aww, i like you too', 'youre the best owner', 'i know, i try my best'])); return
    }
    if (req.includes('lol') || req.includes('haha') || req === 'funny' || req.includes('that was funny')) {
      say(pick(['haha', 'lol, i know right', 'glad you liked it'])); return
    }
    if (req.includes('are you ai') || req.includes('are you a robot') || req.includes('are you real') || req.includes('are you human')) {
      say(aiEnabled ? 'yeah, Tash gave me a brain now — i can actually chat' : 'im a bot, not AI. Tash coded me, i just do what im told and remember stuff'); return
    }
    if (req.includes('tell me a story') || req.includes('story time')) {
      say('ok, once there was a bot named Segs who walked 5 blocks and felt like a hero. the end'); return
    }
    if (req.includes('sing') || req.includes('sing a song')) {
      say('la la la, im a little bot, farming wheat and dodging creepers, la la la'); return
    }
    if (req.includes('favourite food') || req.includes('favorite food')) { say('baked potato, obviously'); return }
    if (req.includes('favourite mob') || req.includes('favorite mob')) { say('wolves, they are loyal like me'); return }
    if (req.includes('favourite block') || req.includes('favorite block')) { say('diamond ore, shiny'); return }
    if (req.includes('do you like me') || req.includes('do you like minecraft')) { say('yeah, minecraft is my whole life, and youre my favourite player'); return }
    if (req.includes('what should i do') || req.includes('im bored')) {
      const t = bot.time?.timeOfDay ?? 6000
      const isNight = t > 13000 && t < 23000
      say(isNight ? 'its night, we could sleep or fight mobs, your call' : bot.food < 10 ? 'im hungry, lets get food first' : 'we could farm, mine, or build something, what do you feel like')
      return
    }
    if (req.includes('is it raining') || req.includes('is it snowing')) {
      say(bot.isRaining ? 'yeah, its raining' : 'no, clear skies'); return
    }
    if (req.includes('what day is it') || req.includes('what day')) {
      say(`day ${bot.time?.day ?? '?'}`); return
    }
    if (req.includes('who is the best player') || req.includes('best player')) { say('OrewaSegs, obviously'); return }

    // from here: orders. Owner only.
    if (!isOwner(username)) {
      say(`sorry ${username}, only ${config.owner} can tell me what to do`)
      return
    }

    // v10.4 AUTOCHAT commands (owner only). The Groq key lives ONLY
    // in config.json on Tash's PC — never in chat, never in a file here.
    if (req === 'enable ai' || req === 'enable ai chat' || req === 'ai on') {
      aiEnabled = true
      try { config.aiEnabled = true; fs.writeFileSync('./config.json', JSON.stringify(config, null, 2)) } catch (e) {}
      if (!aiHasKey()) { say('ai is on, but i have no groq key in config yet — add it and i can think'); logEvent('ai', 'enabled, but NO groq key in config') }
      else { say('ai on, i can chat properly now'); logEvent('ai', 'enabled with key set') }
      return
    }
    if (req === 'disable ai' || req === 'disable ai chat' || req === 'ai off') {
      aiEnabled = false
      try { config.aiEnabled = false; fs.writeFileSync('./config.json', JSON.stringify(config, null, 2)) } catch (e) {}
      say('ai off, back to my normal replies'); logEvent('ai', 'disabled by owner'); return
    }
    if (req === 'ai status' || req === 'ai stats') { say(aiStatusLine()); logEvent('ai', 'status requested: ' + aiStatusLine()); return }

    // help
    if (req.includes('help') || req.includes('what can you do')) {
      say('just talk to me like: segs tp to me, segs follow me, segs sleep, segs farm wheat, segs farm potato, segs farm all, segs craft iron pickaxe, segs dig stone, segs place torch, segs fish, segs smelt iron ore, segs get food, segs this is the potato farm, segs this is the smoker, segs what is here, segs remember this is home, segs go to mine, segs list bases, segs sethome mine, segs go to mine, segs list homes, segs forget home mine, segs learn daily means go to the farm and farm wheat and come back, segs what do you remember, segs stats, segs inventory, segs afk, segs guard me, segs eat, segs status, segs stop, segs set this bed as your bed, segs remember this is your permanent home, segs pick up the items, segs keep these items at your base, segs check for enemies, segs get your stuff, segs this is the ore column, segs this is my room, segs this is the trading hall, segs sort my room, segs move the ores to the ore column, segs make paper, segs continue last sorting, segs list columns, segs list places, segs go to the trading hall, segs this is the build site, segs build house here')
      return
    }

    // ---- v5: LEARNING (coded, not AI) ----
    // MUST run before farm/craft/guard handlers, or "learn daily means farm wheat"
    // starts farming instead of saving the routine (simulation v5 run 2 bug).
    // "Segs remember that the mine is dangerous at night" - it stores the fact.
    // "Segs learn daily means go to the farm and farm wheat and come back" - macro,
    // then "Segs daily" runs the whole routine. "Segs what do you remember" lists it all.
    // It also learns on its own: where it died, where it found stuff.
    if (isOwner(username) && req.startsWith('remember that')) {
      const fact = req.replace(/^remember that\s*/, '').trim()
      if (fact) {
        if (!brain.facts.includes(fact)) { brain.facts.push(fact); saveBrain() }
        say(`ok, remembered: ${fact}`); return
      }
    }
    if (isOwner(username) && (req.includes('what do you remember') || req.includes('what did you learn') || req.includes('what have you learned'))) {
      const bits = []
      if (Object.keys(brain.bases || {}).length) bits.push('bases: ' + Object.keys(brain.bases).join(', '))
      if (brain.facts.length) bits.push('facts: ' + brain.facts.join(' | '))
      if (Object.keys(brain.macros || {}).length) bits.push('routines: ' + Object.keys(brain.macros).join(', '))
      if (brain.deaths.length) bits.push('deaths: ' + brain.deaths.slice(-3).map(d => `${d.what} at ${d.pos.join(', ')}`).join(' | '))
      say(bits.length ? bits.join('. ') : 'nothing yet, teach me: segs remember that ... or segs learn daily means ...')
      return
    }
    if (isOwner(username)) {
      const learnMatch = req.match(/learn (\w+) means (.+)/)
      if (learnMatch) {
        const name = learnMatch[1], cmd = cleanClause(learnMatch[2])
        brain.macros[name] = cmd; saveBrain()
        say(`ok, learned ${name}: when you say segs ${name}, i will do: ${cmd}`); return
      }
    }
    if (isOwner(username) && req.startsWith('forget that')) {
      const fact = req.replace(/^forget that\s*/, '').trim()
      const i = brain.facts.indexOf(fact)
      if (i >= 0) { brain.facts.splice(i, 1); saveBrain(); say('ok, forgot that') }
      else say('i dont remember that one')
      return
    }

    // ---- v6: TEACH ME YOUR BASE (walkthrough) ----
    // Call Segs to you, stand next to a thing, and say what it is:
    // "Segs this is the potato farm" / "Segs this is the food chest" /
    // "Segs this is the smoker" / "Segs this is the furnace" /
    // "Segs this is the wheat farm" / "Segs this is the coal chest".
    // Segs stores it as a landmark and USES it on its own when it needs food.
    // "Segs what is here" lists everything it knows nearby.
    // "Segs this is the ..." is different from "remember this is home":
    // landmarks are THINGS (farm/chest/furnace/smoker), bases are PLACES.
    // v10.3: "this is" WITHOUT "the" must work too. Tash says
    // "Segs this is Storage unit" / "Segs this is food chest" (no
    // "the") and the old handler required 'this is the', so those
    // failed twice in his log. Accept this is / this is the / my / a.
    // v10.5 AUTOBUILD: "Segs this is the build site" marks the origin
    // (Segs' feet = the schematic's 0,0,0 corner). MUST run before the
    // generic "this is ..." landmark handler below, or the site gets
    // filed as a base-map area instead of a build origin.
    if (isOwner(username) && req.includes('build site')) {
      const here = [Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y), Math.floor(bot.entity.position.z)]
      brain.buildSite = { pos: here, setAt: Date.now() }
      saveBrain()
      logLearn('build-site', `build site origin at ${here.join(', ')}`)
      say(`ok, this is the build site — origin ${here.join(', ')}. tell me: segs build house here`)
      return
    }
    if (isOwner(username) && /^this is( the| my| a| an)?\s+/.test(req)) {
      const name = req.replace(/^this is( the| my| a| an)?\s*/, '').trim()
      if (name) {
        // ---- v9: columns, rooms, areas, trash/sugarcane chests ----
        // These are NOT landmarks (farm/chest/furnace/...) — intercept
        // them before the landmark type detection below.
        const here = [Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y), Math.floor(bot.entity.position.z)]
        if (name.includes('column')) {
          let cat = null
          for (const [word, c] of Object.entries(COLUMN_WORDS)) { if (name.includes(word)) { cat = c; break } }
          const chests = scanColumnChests(new Vec3(here[0], here[1], here[2]))
          if (!chests.length) { say('i cant see any chest or barrel in this column — stand right next to it and try again'); return }
          const chestPos = chests.map(p => [p.x, p.y, p.z])
          // v9.2: re-teaching ADDS to what Segs knows instead of
          // overwriting it (teaching per floor used to lose the other
          // floors), and a column already claimed by another category
          // is refused instead of silently stolen — in a continuous
          // wall, standing at the wrong column must not re-label it.
          if (cat) {
            for (const [k, c] of Object.entries(brain.columns || {})) {
              if (!c || !c.chests || c.category === cat) continue
              if (c.chests.some(p => chestPos.some(q => sameChestInventory(p, q)))) {
                say(`wait, those chests are already the ${c.category || 'blank'} column — stand at the ${cat} column and try again`); return
              }
            }
            // a blank column taught earlier at this same spot becomes the named column
            for (const [k, c] of Object.entries(brain.columns || {})) {
              if (c && !c.category && c.chests && c.chests.some(p => chestPos.some(q => sameChestInventory(p, q)))) delete brain.columns[k]
            }
            const prev = (brain.columns[cat] && brain.columns[cat].chests) || []
            const all = mergeChestLists([prev, chestPos])
            const added = all.length - prev.length
            brain.columns[cat] = { category: cat, name: cat + ' column', chests: all, pos: here, taughtAt: Date.now() }
            saveBrain()
            logLearn('column', `${cat} column at ${here.join(', ')} (${all.length} chests, ${added} new)`)
            say(prev.length ? `ok, this is the ${cat} column — ${all.length} chests now (${added} new), i will remember it` : `ok, this is the ${cat} column — ${all.length} chests, i will remember it`); return
          }
          // no type word: a blank column Segs can claim later for a
          // category that has no column yet. Re-teaching the same
          // blank column (e.g. from another floor) merges into it.
          // If these chests already belong to a named column, say so
          // instead of making a second blank copy of them.
          for (const c of Object.values(brain.columns || {})) {
            if (c && c.category && c.chests && c.chests.some(p => chestPos.some(q => sameChestInventory(p, q)))) {
              say(`those chests are already the ${c.category} column`); return
            }
          }
          let blankKey = null
          for (const [k, c] of Object.entries(brain.columns || {})) {
            if (c && !c.category && c.chests && c.chests.some(p => chestPos.some(q => sameChestInventory(p, q)))) { blankKey = k; break }
          }
          if (blankKey) {
            const prev = brain.columns[blankKey].chests || []
            const all = mergeChestLists([prev, chestPos])
            brain.columns[blankKey].chests = all
            brain.columns[blankKey].taughtAt = Date.now()
            saveBrain()
            logLearn('column', `blank column at ${here.join(', ')} (${all.length} chests)`)
            say(`ok, noted this column (${all.length} chests now) — i will use it for a category that has no column yet`); return
          }
          brain.columns['blank-' + here.join(',')] = { category: null, name: 'blank column', chests: chestPos, pos: here, taughtAt: Date.now() }
          saveBrain()
          logLearn('column', `blank column at ${here.join(', ')} (${chests.length} chests)`)
          say(`ok, noted this column (${chests.length} chests) — i will use it for a category that has no column yet`); return
        }
        if (name.includes('trash chest') || name === 'trash') {
          const near = bot.findBlock({ matching: b => isContainer(b), maxDistance: 8 })
          if (!near) { say('i cant see a chest or barrel here for trash'); return }
          brain.trashChest = [near.position.x, near.position.y, near.position.z]; saveBrain()
          logLearn('trash', `trash chest at ${brain.trashChest.join(', ')}`)
          say('ok, this is the trash chest — junk goes here'); return
        }
        if (name.includes('sugarcane') && name.includes('chest')) {
          const near = bot.findBlock({ matching: b => isContainer(b), maxDistance: 8 })
          if (!near) { say('i cant see a chest here for the sugarcane'); return }
          brain.sugarcaneChests.push([near.position.x, near.position.y, near.position.z]); saveBrain()
          logLearn('sugarcane', `sugarcane chest at ${near.position.x}, ${near.position.y}, ${near.position.z}`)
          say('ok, noted this sugarcane chest — i will take cane from here to make paper'); return
        }
        if (name.includes('storage unit')) {
          brain.areas['storage unit'] = { name: 'storage unit', pos: here }
          if (!brain.permanentHome) {
            const roomChests = bot.findBlocks({ matching: b => isContainer(b), maxDistance: 8, count: 6 })
            brain.permanentHome = { pos: here, serverHome: lastSetHome || null, setAt: Date.now() }
            brain.roomChests = roomChests.map(p => [p.x, p.y, p.z])
          }
          saveBrain()
          logLearn('area', `storage unit at ${here.join(', ')}`)
          say('ok, this is the storage unit — my permanent home, and the centre of my base map'); return
        }
        // named places (trading hall, a room, another player's home) — the
        // base map. Landmarks below handle farm/chest/furnace/smoker/bed/table.
        if (!name.includes('farm') && !name.includes('chest') && !name.includes('smoker') && !name.includes('furnace') && !name.includes('bed') && !name.includes('table')) {
          brain.areas[name] = { name, pos: here }
          saveBrain()
          logLearn('area', `${name} at ${here.join(', ')}`)
          say(`ok, got it, this is the ${name}. i will remember it on the base map`); return
        }
        let type = 'place'
        let crop = null
        if (name.includes('farm')) { type = 'farm'; crop = ['potato', 'wheat', 'carrot', 'beetroot'].find(c => name.includes(c)) || 'wheat' }
        else if (name.includes('chest')) type = 'chest'
        else if (name.includes('smoker')) type = 'smoker'
        else if (name.includes('furnace')) type = 'furnace'
        else if (name.includes('bed')) type = 'bed'
        else if (name.includes('table')) type = 'table'
        // v6 fix (simulation run 1): record the position of the THING, not
        // Segs' own feet. Stand next to the farm/chest/smoker and the nearest
        // matching block is the landmark. Fall back to Segs' position if none
        // is near (e.g. "this is the base" with no block to match).
        let pos = [Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y), Math.floor(bot.entity.position.z)]
        const matchBlock = (b) => {
          if (type === 'farm') return b.name === (crop === 'wheat' ? 'wheat' : crop === 'carrot' ? 'carrots' : crop === 'potato' ? 'potatoes' : 'beetroot')
          if (type === 'chest') return b.name.includes('chest')
          if (type === 'smoker') return b.name === 'smoker'
          if (type === 'furnace') return b.name === 'furnace'
          if (type === 'bed') return b.name.includes('bed')
          if (type === 'table') return b.name === 'crafting_table'
          return false
        }
        const near = type !== 'place' ? bot.findBlock({ matching: matchBlock, maxDistance: 8 }) : null
        if (near) pos = [near.position.x, near.position.y, near.position.z]
        brain.landmarks[name] = { name, type, crop, pos }
        saveBrain()
        logLearn('landmark', `${name} (${type}) at ${pos.join(', ')}`)
        say(`ok, got it, this is the ${name}. i will remember it`); return
      }
    }
    if (isOwner(username) && req === 'this is my room') {
      const here = [Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y), Math.floor(bot.entity.position.z)]
      const all = bot.findBlocks({ matching: b => isContainer(b), maxDistance: 5, count: 12 })
      // never count a column's chests as room chests (the room sits next
      // to the storage unit, so the scan would catch the columns too)
      const colSet = new Set()
      for (const c of Object.values(brain.columns || {})) { for (const p of (c.chests || [])) colSet.add(p.join(',')) }
      const chests = all.filter(p => !colSet.has([p.x, p.y, p.z].join(',')))
      brain.myRoom = { pos: here, chests: chests.map(p => [p.x, p.y, p.z]) }
      saveBrain()
      logLearn('room', `my room at ${here.join(', ')} (${chests.length} chests)`)
      say(`ok, this is your room — ${chests.length} chests, i will sort from here`); return
    }
    if (req.includes('what is here') || req.includes('show me around') || req.includes('what do you know here') || req.includes('list landmarks')) {
      const marks = Object.values(brain.landmarks || {})
      if (!marks.length) { say('i dont know this place yet, show me around: stand next to something and say segs this is the ...'); return }
      say('i know: ' + marks.map(m => `${m.name} at ${m.pos.join(', ')}`).join(' | ')); return
    }
    // ---- v6: SURVIVAL commands ----
    // "Segs get food" / "Segs survive" / "Segs im hungry" (owner says it for Segs)
    // runs the full survival routine: eat what it has, else farm, cook, eat.
    // It also runs ON ITS OWN when it gets hungry (watchdog, every 60s).
    if (req.includes('get food') || req.includes('find food') || req === 'survive' || req.includes('take care of yourself') || req.includes('sort yourself out') || req.includes('you are hungry') || req.includes('youre hungry')) {
      await survive(); return
    }
    if (req.includes('check the chest') || req.includes('look in the chest')) {
      await checkChestFor(FOOD_ITEMS.concat(FUEL_ITEMS), 8); return
    }

    // sleep / wake - check first, before "stop" etc.
    if (req.includes('wake up') || req.includes('get up')) { await wakeUp(); return }
    if (req.includes('sleep') || req.includes('go to bed') || req.includes('go bed')) { await sleepInBed(); return }

    // stop variants
    if (req.includes('stop farm')) { stopFarming(); say(pick(['ok, farm stopped', 'stopped farming'])); return }
    if (req.includes('stop afk')) { stopAfk(); say('afk off'); return }
    if (req.includes('stop guard') || req.includes('stop protecting')) { guardMode = false; stopCombat(); try { bot.pvp.stop() } catch (e) {}; say('ok, guard off'); return }
    if (req === 'block' || req === 'raise shield' || req === 'use shield') {
      try {
        const shield = bot.inventory.items().find(i => i.name === 'shield')
        if (!shield) { say('i dont have a shield'); return }
        bot.equip(shield, 'off-hand').catch(() => {})
        setTimeout(() => { try { bot.activateItem(true) } catch (e) {} }, 500)
        say('shield up')
      } catch (e) { say('shield failed') }
      return
    }
    if (req === 'lower shield' || req === 'stop blocking') {
      // v10.3.1: only deactivate if the shield is actually up. A
      // v10.4: releaseItem() (status 6) — the fork's deactivateItem()
      // sends status 5 = DROP_ITEM on 26.3 and would drop the shield.
      if (shieldUp) { try { releaseItem() } catch (e) {}; shieldUp = false }
      say('shield down')
      return
    }
    if (/^(stop|stay|wait|wait here|stay here|chill|hold on)$/.test(req) || req === 'stop following' || req === 'stop follow') {
      sortStopRequested = true
      stopAllMovement()
      if (sortPausedByStop) { sortPausedByStop = false; return } // the sort already said it stopped + put things back
      say(pick(['ok stopped', 'got it, staying here', 'ok, waiting here'])); return
    }

    // tp / come to me — v7: REAL teleport via /tpa (the server has a TPA
    // plugin and no LP ranks, so /tpa is a player command Segs can use).
    // Segs sends the request, the owner types /tpaccept Segs. If nobody
    // accepts within 15s, Segs walks instead, like before.
    // v9.3: the /tpa is sent FIRST, with NO "can I see you" check — a
    // /tpa works over any distance, that is the whole point of it. The
    // old code checked visibility BEFORE sending the request, so when
    // Tash was far away (Segs at spawn, Tash at his base) the server
    // never sent Tash's entity to Segs, Segs said "i cant see you
    // right now" and NEVER SENT THE /tpa AT ALL. That is the exact bug
    // Tash hit on youniga 2026-11-07. The visibility check now only
    // gates the WALKING fallback (you cannot walk to someone you
    // cannot see). Teleport success is detected by Segs having moved
    // a long way (the /tpa landed) or the owner being within 5 blocks.
    if (req.includes('tp to me') || req.includes('teleport to me') || req.includes('come to me') || req.includes('come here') || req === 'come' || req === 'tp' || req === 'teleport' || req.includes('come to') || req.includes('tp me')) {
      brain.lastPos = [Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y), Math.floor(bot.entity.position.z)]; saveBrain()
      stopAllMovement()
      // v10.5.1 TPA DEDUP: only ONE /tpa outstanding. Three "tp to me"
      // in 15s used to send three /tpa requests and three 15s waits
      // piling up. If one was sent <15s ago and is still pending, do
      // NOT send another — remind the owner to accept the first one.
      const nowTpa = Date.now()
      if (tpaPendingAt && nowTpa - tpaPendingAt < 15000) {
        say('already sent you a tpa request, type /tpaccept Segs')
        return
      }
      const beforePos = bot.entity.position.clone()
      say('sent you a tpa request, type /tpaccept Segs')
      serverCmd(`/tpa ${config.owner}`)
      logEvent('tpa', 'sent /tpa to ' + config.owner)
      tpaPendingAt = nowTpa
      const tpaToken = moveToken
      const waited = await sleepOrCancel(15000, tpaToken)
      // v10.5.1: do NOT clear tpaPendingAt when the wait is cancelled —
      // the /tpa REQUEST is still outstanding on the server even though
      // Segs stopped waiting for it. Clearing it here let a 3rd "tp to
      // me" send a 2nd /tpa. The timestamp expires on its own after 15s.
      if (!waited) return // a newer command (or stop) cancelled the wait — silent, no stale walk
      if (tpaToken !== moveToken) return // stopped while waiting, do not walk
      const moved = bot.entity.position.distanceTo(beforePos)
      const ownerNow = bot.players[username]?.entity
      if (moved > 10 || (ownerNow && bot.entity.position.distanceTo(ownerNow.position) < 5)) {
        tpaPendingAt = 0 // the request was accepted and consumed — a fresh "tp to me" may send a new one
        say(pick(['here', 'im here', 'made it'])); return
      }
      // not accepted (or no TPA on this server) — walk only if Segs can
      // actually see the owner. Far away the server never sends the
      // owner's entity, so walking is impossible and Segs says so.
      const playerAgain = bot.players[username]?.entity
      if (!playerAgain) { say('i cant see you right now — type /tpaccept Segs next time, or come closer and try again'); return }
      say('you didnt accept, walking to you instead')
      logEvent('tpa', 'tpa not accepted in 15s, walking instead')
      if (await gotoPos(playerAgain.position)) say(pick(['here', 'im here', 'made it']))
      return
    }

    // follow
    if (req.includes('follow me') || req.includes('follow') || req.includes('stay with me')) {
      following = username
      say(pick(['ok, following you', 'following you now', 'got it, sticking with you']))
      followLoop()
      return
    }

    // ---- v8: bed = spawn point ("set this bed as your bed") ----
    if ((req.includes('bed') && /(your bed|set|spawn|remember|this bed)/.test(req)) || (req.includes('spawn') && /(set|make|your|here)/.test(req))) { await setSpawnBed(); return }
    // ---- v8: permanent home / room ----
    if ((req.includes('where is') || req.includes('where')) && (req.includes('your room') || req.includes('permanent home'))) {
      if (!brain.permanentHome) { say('i dont have a permanent home yet — stand in my room and tell me: segs remember this is your permanent home'); return }
      const ph = brain.permanentHome
      say(`my permanent home is at ${ph.pos.join(', ')}` + (ph.serverHome ? ` (server home ${ph.serverHome})` : ''))
      return
    }
    if ((req.includes('permanent home') || req.includes('your room')) && !req.startsWith('go ') && !req.includes('where')) { await rememberPermanentHome(); return }
    // ---- v8: store items at the base ("keep these items at your base") ----
    if ((req.includes('store') && req.includes('item')) || req.includes('deposit') || ((req.includes('keep') || req.includes('put')) && (req.includes('base') || req.includes('room') || req.includes('home')) && (req.includes('item') || req.includes('stuff') || req.includes('these')))) { await storeItems(); return }
    // ---- v8: pick up dropped items ("pick the items", "pick up the bread") ----
    if ((req.includes('pick') || req.includes('collect') || req.includes('grab')) && (req.includes('item') || req.includes('up') || req.includes('these') || req.includes('them'))) { await pickupItems(req); return }
    // ---- v8: check for enemies ----
    if (req.includes('enemies') || req.includes('enemy') || req.includes('is it safe') || (req.includes('safe') && req.includes('here'))) { checkEnemies(); return }
    // ---- v8: go back to the grave ("get your stuff", "go to your grave") ----
    if ((req.includes('grave') || req.includes('your stuff')) && (req.includes('get') || req.includes('go') || req.includes('recover') || req.includes('fetch'))) { await recoverGrave(true); return }

    // ---- v9: SORTING ----
    // "Segs sort my room" / "sort my room and move to storage unit" /
    // "move out and sort" (whole room) — or one category: "Segs move the
    // ores to the ore column" / "Segs sort the ores". Any wording like
    // these works. (Placed after "sort yourself out" -> survive above,
    // so that phrase still means "take care of yourself".)
    if (req.includes('continue') && req.includes('sort')) { await askContinueSorting(); return }
    if (req.includes('make paper') || req.includes('craft paper')) { await makePaper(); return }
    if (req.includes('sort') || req.includes('move out') || (req.includes('move') && (req.includes('column') || req.includes('storage')))) {
      let cat = null
      for (const [word, c] of Object.entries(COLUMN_WORDS)) { if (req.includes(word)) { cat = c; break } }
      // "sort my room" has no category word -> full sort. But watch out:
      // "sort the farm items" contains 'farm' -> farm category, good.
      // "sort the woods" contains 'wood' -> woods, good.
      await sortItems({ category: cat }); return
    }
    if (req.includes('list columns') || req.includes('what columns') || req.includes('show columns') || req.includes('my columns') || req === 'column' || req.includes('show me the column')) {
      const cols = Object.values(brain.columns || {}).filter(c => c.category)
      const blanks = Object.values(brain.columns || {}).filter(c => !c.category)
      if (!cols.length && !blanks.length) { say('i dont know any columns yet — take me to one and tell me: segs this is the ore column'); return }
      say('columns: ' + cols.map(c => `${c.category} (${c.chests.length} chests)`).join(', ') + (blanks.length ? ` | ${blanks.length} blank column(s) waiting for a category` : '')); return
    }
    if (req.includes('list places') || req.includes('what places') || req.includes('my places') || req.includes('list areas')) {
      const areas = Object.values(brain.areas || {})
      if (!areas.length) { say('i dont know any places yet — walk me somewhere and tell me: segs this is the trading hall'); return }
      say('places i know: ' + areas.map(a => `${a.name} at ${a.pos.join(', ')}`).join(' | ')); return
    }
    if ((req.includes('where is') || req.includes('where')) && (req.includes('column') || req.includes('trading hall') || req.includes('storage unit'))) {
      let found = null
      for (const [word, c] of Object.entries(COLUMN_WORDS)) { if (req.includes(word)) { found = columnFor(c); break } }
      if (!found) { for (const [name, a] of Object.entries(brain.areas || {})) { if (req.includes(name)) { found = a; break } } }
      if (!found) { say('i dont know that place yet'); return }
      say(`${found.name || found.category + ' column'} is at ${(found.pos || found.chests[0]).join(', ')}`); return
    }

    // ---- v7: SERVER HOMES (HomePlugin, overworld only, max 3 per player) ----
    // "Segs sethome mine" sets a server home (instant teleport later).
    // "Segs forget home mine" removes it. "Segs list homes" shows them.
    // Server homes are for TELEPORTING; brain bases are for WALKING to a
    // place Segs knows. "Segs go to mine" tries /home first, walks if it fails.
    if (req.startsWith('sethome ') || req.includes('set home ')) {
      const m = req.match(/sethome\s+(\S+)/) || req.match(/set home\s+(\S+)/)
      const name = m && m[1]
      if (!name) { say('sethome what? try: segs sethome mine'); return }
      if (!brain.serverHomes.includes(name) && brain.serverHomes.length >= 3) {
        say(`i already have 3 homes set: ${brain.serverHomes.join(', ')}. tell me which one to forget first: segs forget home <name>`)
        return
      }
      // v8: wait for the server's reply before claiming success. The
      // server refuses a duplicate name (in Spanish) and refuses past 3
      // homes. /home <name> has a 3s no-movement warmup; /sethome itself
      // is instant. (messagestr flags a refusal in pendingSethome.failed.)
      serverCmd(`/sethome ${name}`)
      pendingSethome = { name, at: Date.now() }
      await sleepMs(1500)
      if (pendingSethome && pendingSethome.failed) {
        const why = pendingSethome.why ? ' — the server said: ' + pendingSethome.why : ''
        say(`the server wouldnt set home ${name}${why}`)
        logEvent('sethome', `/sethome ${name} refused by server`)
        pendingSethome = null
        return
      }
      pendingSethome = null
      lastSetHome = name
      if (!brain.serverHomes.includes(name)) { brain.serverHomes.push(name); saveBrain() }
      logLearn('server-home', `set /sethome ${name}`)
      say(`ok, set home ${name} on the server`); return
    }
    if (req.includes('forget home ')) {
      const name = req.split('forget home ')[1].trim().split(/\s+/)[0]
      if (!name) { say('forget which home?'); return }
      serverCmd(`/delhome ${name}`)
      brain.serverHomes = brain.serverHomes.filter(h => h !== name); saveBrain()
      say(`ok, forgot home ${name}`); return
    }
    if (req.includes('list homes') || req.includes('my homes')) {
      if (!brain.serverHomes.length) { say('i dont have any server homes set yet, try: segs sethome home'); return }
      say(`my server homes: ${brain.serverHomes.join(', ')}`); return
    }

    // go to a place - MUST come before "farm", or "go to the farm" starts
    // farming instead of just walking there (simulation run 3 bug).
    // v10.5.1 WHOLE-LOG SWEEP: commands Tash used that Segs did not
    // understand ("didnt get that" x6 in the log).
    // "segs autoeat" — auto-eat on/off + status (was "didnt get that").
    if (req.includes('autoeat') || req.includes('auto eat')) {
      if (req.includes('off') || req.includes('disable')) {
        try { bot.autoEat?.disableAuto() } catch (e) {}
        say('auto eat off — i wont eat on my own now, tell me to eat when you want me to'); return
      }
      if (req.includes('on') || req.includes('enable')) {
        try { bot.autoEat?.enableAuto() } catch (e) {}
        say('auto eat on — ill eat when my hunger drops below 19'); return
      }
      say(`auto eat is ${bot.autoEat?.enabled ? 'on' : 'off'} — i eat when hunger drops below 19, and i have ${bot.inventory.items().filter(i => i && FOOD_ITEMS.includes(i.name)).reduce((a, i) => a + i.count, 0)} food with me`); return
    }
    // "segs take items from this chest" / "collect this chest" — take
    // everything from the nearest chest into inventory.
    if (req.includes('take items from this chest') || req.includes('take from this chest') || req.includes('collect this chest') || req.includes('take everything from this chest') || req.includes('empty this chest')) {
      const chests = findNearbyContainers(12)
      if (!chests.length) { say('i cant see a chest near me'); return }
      const pos = chests[0]
      try {
        await gotoWithTimeout(new goals.GoalNear(pos.x, pos.y, pos.z, 1), 10000)
        const block = bot.blockAt(pos)
        if (!block || !block.name.includes('chest')) { say('i cant see that chest any more'); return }
        const chest = await bot.openChest(block)
        let took = 0
        try {
          for (const it of chest.containerItems()) {
            if (!it) continue
            try { await chest.withdraw(it.type, it.metadata, it.count); took += it.count } catch (e) {}
          }
        } finally { try { chest.close() } catch (e) {} }
        say(took > 0 ? `took ${took} items from the chest` : 'that chest is empty'); return
      } catch (e) { say('couldnt open that chest'); return }
    }
    // "segs deathchest" — go to the grave (alias).
    if (req.includes('deathchest') || req.includes('death chest')) { await recoverGrave(true); return }
    // "segs tp home" — teleport to the server home (alias for /home).
    if (req === 'tp home' || req.includes('tp home') || req.includes('teleport home')) {
      const name = (brain.permanentHome && brain.permanentHome.serverHome) || (brain.serverHomes && brain.serverHomes[0])
      if (!name) { say('i dont know a home to tp to yet — set one with segs sethome a'); return }
      stopAllMovement(); say(`going to ${name}`)
      if (await tryServerHome(name)) { say(`at ${name}`); return }
      say('couldnt teleport there'); return
    }
    if (req.startsWith('go to') || req.startsWith('go to the') || req === 'go farm' || req === 'go home') {
      // named base? "go to mine", "go to farm base", "go to home"
      // (v7 fix: "go home" and "go farm" do not start with "go to", so the
      // replace below left place as "go home" and the bot said "i dont know
      // where go home is" instead of going home. Normalize them here.)
      let place = req.replace(/^go to (the )?/, '').replace(/ base$/, '').trim()
      if (req === 'go home') place = 'home'
      if (req === 'go farm') place = 'farm'
      // v8: "go home" / "go to your room" means the PERMANENT home — the
      // room, not the bed/spawn point (that can move). Teleport with its
      // linked server home if it has one, else walk there.
      if ((req === 'go home' || place === 'your room' || place === 'your permanent home') && brain.permanentHome) {
        await goPermanentHome()
        return
      }
      // v7: if it is a server home, teleport with /home first (overworld only)
      if (place && brain.serverHomes.includes(place)) {
        stopAllMovement(); say(`going to ${place}`)
        if (await tryServerHome(place)) { say(`at ${place}`); return }
        say('couldnt teleport there, walking instead')
        logEvent('home', `/home ${place} failed, walking instead`)
      }
      if (place && brain.bases[place]) {
        stopAllMovement(); say(`going to ${place}`)
        if (await gotoPos(new Vec3(brain.bases[place][0], brain.bases[place][1], brain.bases[place][2]))) say(`at ${place}`)
        return
      }
      // v9: named areas on the base map (trading hall, a room, another
      // player's home, the storage unit). Taught by walking Segs there:
      // "Segs this is the trading hall".
      if (place && brain.areas[place]) {
        const a = brain.areas[place]
        stopAllMovement(); say(`going to ${place}`)
        if (await gotoPos(new Vec3(a.pos[0], a.pos[1], a.pos[2]))) say(`at ${place}`)
        return
      }
      // old single-home field (kept for backwards compat with older brain.json)
      if (place === 'home' && brain.home) {
        stopAllMovement(); say('going home')
        if (await gotoPos(new Vec3(brain.home[0], brain.home[1], brain.home[2]))) say('home')
        return
      }
      if (place === 'farm' && config.farmCenter) {
        stopAllMovement(); if (await gotoPos(new Vec3(config.farmCenter[0], config.farmCenter[1], config.farmCenter[2]))) say('at the farm')
        return
      }
      const coordMatch = req.match(/(-?\d+)\s+(-?\d+)\s+(-?\d+)/)
      if (coordMatch) {
        const [x, y, z] = coordMatch.slice(1).map(Number)
        stopAllMovement(); say('on my way there')
        if (await gotoPos(new Vec3(x, y, z))) say('here')
        return
      }
      if (place) { say(`i dont know where ${place} is, tell me: segs remember this is ${place}`); return }
      // "go to" with nothing after - fall through to other handlers
    }

    // farm — wheat, carrot, potato, beetroot (all 4 replantable crops).
    // "Segs farm potato" farms potatoes, "Segs farm all" farms every ripe
    // crop nearby. Pumpkins/melons grow on stems and are not replanted the
    // same way, so they are not in the farm list.
    if (req.includes('farm all') || req.includes('harvest all') || req.includes('farm everything')) {
      say('farming everything ripe around here')
      logEvent('farm', 'farm all started')
      for (const key of ['wheat', 'carrot', 'potato', 'beetroot']) { startFarming(key); await sleepMs(8000); stopFarming() }
      say('done farming everything'); return
    }
    if (req.includes('farm') || req.includes('harvest')) {
      const cropName = ['wheat', 'carrot', 'carrots', 'potato', 'potatoes', 'beetroot'].find(c => req.includes(c)) || 'wheat'
      const key = cropName === 'carrots' ? 'carrot' : cropName === 'potatoes' ? 'potato' : cropName
      if (!CROPS[key]) { say('farm what? wheat, carrot, potato, beetroot'); return }
      logEvent('farm', `farm ${key} started`)
      startFarming(key)
      return
    }

    // afk
    if (req.includes('afk') || req.includes('go afk')) { startAfk(); say(pick(['afk mode on, ill stay here', 'ok, going afk here'])); return }

    // guard
    if (req.includes('guard me') || req.includes('protect me') || req === 'guard' || req === 'protect' || req.includes('fight')) {
      guardMode = true
      say(pick(['guard on, i got you', 'ok, protecting you now'])); return
    }

    // equip — "Segs equip axe" / "Segs equip sword" / "Segs equip shield"
    // / "Segs hold <item>". Tash's log: "equip axe" said "didn't get that".
    if (req.startsWith('equip') || req.startsWith('hold') || req.startsWith('wear')) {
      const rest = req.replace(/^(equip|hold|wear)\s*/, '').replace(/\b(a|an|the|your|my)\b/g, '').trim()
      if (!rest || rest === 'best weapon' || rest === 'weapon') {
        const kind = equipCombatWeapon(false)
        say(kind ? `holding my ${kind}` : 'i dont have a weapon to hold')
        return
      }
      const name = aliasItem(rest.replace(/ /g, '_'))
      const item = bot.inventory.items().find(i => i.name === name || i.name.startsWith(name))
      if (!item) { say(`i dont have ${name}`); return }
      try {
        if (item.name.includes('shield')) await bot.equip(item, 'off-hand')
        else await bot.equip(item, 'hand')
        say(`holding ${item.name}`)
      } catch (e) { say(`couldnt hold ${item.name}`) }
      return
    }

    // store / keep — "Segs keep wheat in this chest" / "Segs store
    // iron in this chest". Puts the named item into the nearest chest.
    if ((req.includes('keep') || req.includes('store')) && req.includes('chest')) {
      const rest = req.replace(/^(keep|store)\s*/, '').replace(/\s*in (this|the) chest\s*$/, '').trim()
      const { itemName, count } = parseItemAndCount(rest)
      const chestBlock = bot.findBlock({ matching: b => isContainer(b), maxDistance: 8 })
      if (!chestBlock) { say('i cant see a chest near me'); return }
      const item = bot.inventory.items().find(i => i.name === itemName)
      if (!item) { say(`i dont have ${itemName} to store`); return }
      try {
        await gotoPos(chestBlock.position)
        const chest = await bot.openChest(chestBlock)
        const n = (count === Infinity) ? item.count : Math.min(count, item.count)
        await chest.deposit(item.type, null, n)
        chest.close()
        say(`stored ${n}x ${itemName} in the chest`)
      } catch (e) { say('couldnt store that, the chest might be full or too far') }
      return
    }

    // eat
    if (req === 'eat' || req.includes('eat something') || req.includes('eat food') || req.includes('you hungry')) {
      const ate = await eatBestFood()
      // v10.5.2: eatBestFood returns 'full' at food 20/20 — a real
      // player cannot eat when full, and the old code ate anyway,
      // dropped 1 beef and lied "yum, done" (Tash's 18:53:26 log).
      if (ate === 'full') say('im already full')
      else if (ate) say(pick(['ate, thanks', 'yum, done']))
      else say('no food to eat, give me food')
      return
    }

    // v10.5 AUTOBUILD: "Segs build house here" — reads
    // schematics/<name>.json and builds it at the marked site.
    // Must come before "craft", or "build house" would fall through
    // to the craft handler.
    if (req.startsWith('build') || (req.includes('build ') && req.includes(' here'))) {
      const m = req.match(/build\s+([a-z0-9_-]+)/)
      const name = m ? m[1] : 'house'
      await autobuild(name)
      return
    }

    // craft / make
    if (req.startsWith('craft') || req.startsWith('make')) {
      const rest = req.replace(/^(craft|make)\s*/, '')
      if (!rest) { say('craft what? try: segs craft iron pickaxe'); return }
      const { itemName, count } = parseItemAndCount(rest)
      await doCraft(itemName, count)
      return
    }

    // give / drop me an item. "drop seeds" = ALL the seeds now
    // (Tash: "he drops single only"). "drop 1 seeds" = just one.
    // "drop everything" = every item in the inventory.
    if (req.startsWith('give me') || req.startsWith('drop')) {
      const rest = req.replace(/^(give me|drop)\s*/, '')
      const parsed = parseItemAndCount(rest)
      // v10.3: no number in the text = drop ALL of that item. Tash:
      // "he drops single only" — "drop seeds" must drop the seeds,
      // not 1. "drop 1 seeds" still drops just 1.
      const hasNumber = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/.test(rest)
      const count = (!hasNumber && !parsed.all) ? Infinity : parsed.count
      await tossItem(parsed.itemName, count)
      return
    }

    // pickup — v10.3: VERIFY it. Walk to the item, wait a moment,
    // then check the item entity is gone (picked up). If it is still
    // there, say so instead of pretending it worked.
    if (req.includes('pick up') || req.includes('pickup') || req.includes('collect')) {
      const item = bot.nearestEntity(e => e.type === 'object' && e.objectType === 'Item')
      if (!item) { say('no dropped items near me'); return }
      const itemName = (item.metadata && item.metadata[8] && item.metadata[8].itemId) ? '' : ''
      say('picking it up')
      const itemId = item.id
      await gotoPos(item.position)
      await sleepMs(800)
      const stillThere = bot.entities[itemId]
      if (!stillThere) { say('got it') }
      else { say('i cant reach that one, it is too far or blocked') }
      return
    }

    // go to coords / go to farm
    if (req.includes('go to farm') || req === 'go farm') {
      if (config.farmCenter) { stopAllMovement(); await gotoPos(new Vec3(config.farmCenter[0], config.farmCenter[1], config.farmCenter[2])); say('at the farm'); }
      else say('i dont know where the farm is yet, set farmCenter in config or tell me the coords')
      return
    }
    {
      const coordMatch = req.match(/(-?\d+)\s+(-?\d+)\s+(-?\d+)/)
      if (req.includes('go to') && coordMatch) {
        const [x, y, z] = coordMatch.slice(1).map(Number)
        stopAllMovement()
        say('on my way there')
        // v10.4.1: the old code said "here" even when gotoPos
        // returned false (run 101: Segs said "here" while still on
        // the roof at y76, 3 blocks above the goal). Only say it
        // when Segs actually arrived.
        if (await gotoPos(new Vec3(x, y, z))) say('here')
        // (gotoPos already says why on failure — water or blocked —
        // so do not repeat a generic line here.)
        return
      }
    }

    // v6: "Segs stats" — show what it has done (from logs/stats.json)
    if (req === 'stats' || req.includes('show stats') || req.includes('your stats')) {
      say(`my stats: ${stats.cropsFarmed} crops farmed, ${stats.itemsCrafted} items crafted, ${stats.blocksDug} blocks dug, ${stats.foodEaten} times fed, ${stats.chestsChecked} chests checked, ${stats.smeltsDone} smelts, ${stats.deaths} deaths, ${stats.timesHungry} times hungry, ${stats.itemsPicked || 0} items picked up, ${stats.itemsStored || 0} items stored, ${stats.graves || 0} graves recovered, ${stats.itemsSorted || 0} items sorted, ${stats.sortsDone || 0} sorts done, combat: ${stats.combatKills || 0} kills, ${stats.combatHitsTaken || 0} hits taken, ${stats.combatHitsLanded || 0} hits landed`)
      return
    }
    // status
    if (req.includes('status') || req.includes('how are you') || req.includes('what are you doing') || req.includes('where are you')) {
      const head = `hp ${Math.round(bot.health)}/20 food ${bot.food}/20 at ${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.z)}`
      const parts = inventorySummaryParts()
      if (!parts.length) { say(head + ' - empty'); return }
      const joined = parts.join(', ')
      if ((head + ' - ' + joined).length <= 240) { say(head + ' - ' + joined); return }
      say(head)
      sayInventoryLines('i have: ', parts)
      return
    }

    // ---- smarter stuff (v3): questions, memory, repeat, fetch ----
    // "do it again" / "again" - repeat the last thing you asked
    if (req === 'again' || req === 'do it again' || req === 'repeat that' || req === 'do that again') {
      if (!brain.lastTask) { say('do what again? i dont remember yet'); return }
      say('ok, doing it again')
      await handleTalk(username, 'Segs ' + brain.lastTask, isWhisper)
      return
    }
    // ---- v5: MULTIPLE bases ----
    // "Segs remember this is home" / "remember this is the mine base" / "remember this is base 2"
    // You can have as many bases as you want. "Segs list bases" shows them all.
    // "Segs go to farm" / "Segs go to mine" walks to that base. "Segs go home" = the home base.
    {
      // "remember that ..." is a FACT, not a place - the learning block above
      // already handled it; never let it become a base (simulation v5 run 2 bug).
      if (req.startsWith('remember that')) { /* fall through */ }
      else {
      const remMatch = req.match(/remember (?:this is|this|that) (?:the )?(.+?)(?: base)?$/)
      if (req.includes('remember') && remMatch) {
        const name = remMatch[1].replace(/\b(my|our)\b/g, '').trim().replace(/\s+/g, ' ')
        if (name && name !== 'this' && !name.startsWith('that ')) {
          const pos = [Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y), Math.floor(bot.entity.position.z)]
          brain.bases[name] = pos
          if (name === 'home') brain.home = pos
          if (name === 'farm') { brain.farm = pos; config.farmCenter = pos }
          saveBrain()
          say(`ok, remembered this as ${name} (${pos.join(', ')})`); return
        }
      }
      }
    }
    if (req.includes('list bases') || req.includes('my bases') || req.includes('where are my bases') || req.includes('show bases')) {
      const names = Object.keys(brain.bases || {})
      if (!names.length) { say('i dont know any bases yet, stand somewhere and say segs remember this is home'); return }
      say('my bases: ' + names.map(n => `${n} at ${brain.bases[n].join(', ')}`).join(' | ')); return
    }
    if (req.startsWith('forget base') || req.startsWith('forget ') && req.includes('base')) {
      const name = req.replace(/^forget (base )?/, '').replace(/ base$/, '').trim()
      if (brain.bases[name]) { delete brain.bases[name]; if (name === 'home') brain.home = null; if (name === 'farm') brain.farm = null; saveBrain(); say(`ok, forgot ${name}`) }
      else say(`i dont know a base called ${name}`)
      return
    }
    // v10.5.1 WHOLE-LOG SWEEP: "Segs go home a" said "i dont know
    // where home is yet" even though /sethome a was set — this handler
    // only checked brain bases, never server homes. "go home <name>"
    // now tries the server home first (teleport), then brain bases.
    if (req === 'go home' || req.includes('go home') || req.includes('take me home')) {
      const nameMatch = req.match(/go home\s+(\S+)/)
      const homeName = nameMatch ? nameMatch[1] : null
      if (homeName && brain.serverHomes && brain.serverHomes.includes(homeName)) {
        stopAllMovement(); say(`going to ${homeName}`)
        if (await tryServerHome(homeName)) { say(`at ${homeName}`); return }
        say('couldnt teleport there, walking instead')
      }
      const home = brain.bases.home || brain.home
      if (!home) { say('i dont know where home is yet, stand somewhere and say segs remember this is home'); return }
      stopAllMovement(); say('going home'); if (await gotoPos(new Vec3(home[0], home[1], home[2]))) say('home'); return
    }
    if (req.includes('come back') || req === 'return' || req.includes('go back')) {
      // "come back to me" means come to the OWNER, not to the last place.
      // (Simulation v5 run 3: it said "back where?" inside a long plan.)
      if (req.includes('to me') || req.includes('to you')) {
        const player = bot.players[username]?.entity
        if (!player) { say('i cant see you right now'); return }
        stopAllMovement(); say('coming back to you')
        if (await gotoPos(player.position)) say('here'); return
      }
      const backTo = brain.lastPos || brain.bases.home || brain.home
      if (!backTo) { say('back where? i dont remember'); return }
      stopAllMovement(); say('coming back'); await gotoPos(new Vec3(backTo[0], backTo[1], backTo[2])); return
    }
    // ---- v5: more player stuff ----
    // dig / mine / chop: "Segs dig stone", "Segs mine iron ore", "Segs chop wood"
    if (req.startsWith('dig') || req.startsWith('mine') || req.startsWith('chop')) {
      const rest = req.replace(/^(dig|mine|chop)\s*/, '')
      const { itemName, count } = parseItemAndCount(rest)
      await digBlock(itemName, count)
      return
    }
    // place: "Segs place a torch", "Segs place stone"
    if (req.startsWith('place')) {
      const rest = req.replace(/^place\s*/, '')
      const { itemName, count } = parseItemAndCount(rest)
      await placeBlock(itemName, count)
      return
    }
    // fish: "Segs fish" (needs a fishing rod)
    if (req === 'fish' || req.includes('go fishing') || req.includes('start fishing')) {
      await goFishing()
      return
    }
    // smelt / cook: "Segs smelt iron ore" / "Segs cook beef" (v10.5:
    // input + fuel come from nearby chests too, the right workstation
    // is found within 12 blocks, output is taken out and reported)
    if (req.startsWith('smelt') || req.startsWith('cook')) {
      const rest = req.replace(/^(smelt|cook)\s*/, '')
      const { itemName, count } = parseItemAndCount(rest)
      await cookOrSmelt(itemName, count, req.startsWith('cook') ? 'cook' : 'smelt')
      return
    }
    // inventory: "Segs inventory" / "Segs what do you have"
    if (req === 'inventory' || req.includes('show inventory') || req.includes('what is in your inventory')) {
      const parts = inventorySummaryParts()
      if (!parts.length) { say('my inventory is empty'); return }
      sayInventoryLines('i have: ', parts); return
    }
    // v10.5.1 CONTAINER MEMORY: "Segs list chests" / "what chests do
    // you see" — every container Segs has seen (remembered in brain)
    // plus the ones visible right now, with distances.
    if (req.includes('list chest') || req.includes('what chest') || req.includes('which chest') || req.includes('chests do you see') || req.includes('chests do you know')) {
      const visible = findNearbyContainers(32)
      const visKeys = new Set(visible.map(p => p.x + ',' + p.y + ',' + p.z))
      const parts = []
      for (const pos of visible) {
        const b = bot.blockAt(pos)
        const d = bot.entity ? Math.round(Math.hypot(pos.x - bot.entity.position.x, pos.z - bot.entity.position.z)) : 0
        parts.push(`${b ? b.name : 'chest'} at ${pos.x},${pos.y},${pos.z} (${d} away)`)
      }
      for (const c of (brain.containers || [])) {
        const key = c.pos[0] + ',' + c.pos[1] + ',' + c.pos[2]
        if (visKeys.has(key)) continue
        const d = bot.entity ? Math.round(Math.hypot(c.pos[0] - bot.entity.position.x, c.pos[2] - bot.entity.position.z)) : 0
        parts.push(`${c.type} at ${c.pos[0]},${c.pos[1]},${c.pos[2]} (${d} away, remembered)`)
      }
      if (!parts.length) { say('i dont know any chests around here yet'); return }
      sayInventoryLines('chests i know: ', parts); return
    }
    // v10.5.1: "Segs check the chests" / "what is in the chests nearby"
    if (req.includes('check the chest') || req.includes('what is in the chest') || req.includes('whats in the chest') || req.includes('check all chest')) {
      await checkAllChests(); return
    }
    // drop all: "Segs drop everything"
    if (req.includes('drop everything') || req.includes('drop all')) {
      await dropAll(); return
    }
    // fun / human stuff: dance, jump, wave, look at me, joke, who are you
    if (req.includes('dance')) {
      say('ok watch this')
      bot.setControlState('jump', true); setTimeout(() => bot.setControlState('jump', false), 600)
      try { bot.look(bot.entity.yaw + Math.PI, 0) } catch (e) {}
      setTimeout(() => { try { bot.look(bot.entity.yaw + Math.PI, 0) } catch (e) {} }, 700)
      return
    }
    if (req === 'jump' || req.includes('jump up')) { bot.setControlState('jump', true); setTimeout(() => bot.setControlState('jump', false), 500); say('boing'); return }
    if (req.includes('wave') || req.includes('say hi')) { try { bot.swingArm('right') } catch (e) {}; say('hi'); return }
    if (req.includes('look at me')) {
      const player = bot.players[username]?.entity
      if (!player) { say('i cant see you'); return }
      try { await bot.lookAt(player.position.offset(0, 1.6, 0)) } catch (e) {}
      say('looking at you'); return
    }
    if (req.includes('tell me a joke') || req.includes('joke')) {
      say(pick(['why did the creeper cross the road? to get to the other side... and explode', 'i told a zombie a joke once, he fell apart', 'what do you call a pig that does karate? a pork chop', 'i would tell you a crafting joke but its too blocky'])); return
    }
    if (req.includes('who are you') || req.includes('your name') || req.includes('who made you')) {
      say('im Segs, your bot. Tash made me, i work for OrewaSegs'); return
    }
    // "do you have iron" / "how much wheat do you have" / "how many diamonds"
    {
      const haveMatch = req.match(/(?:do you have|how much|how many)\s+(.+)/)
      if (haveMatch) {
        const { itemName } = parseItemAndCount(haveMatch[1].replace(/\b(do|you|have|got)\b/g, ' '))
        const mcData = mcDataFor(bot.version)
        const item = mcData.itemsByName[itemName] || mcData.blocksByName[itemName]
        if (!item) { say(`i dont know what ${itemName} is`); return }
        const count = bot.inventory.count(item.id, null)
        say(count > 0 ? `i have ${count}x ${itemName}` : `i dont have any ${itemName}`)
        return
      }
    }
    // "what time is it" / "is it night"
    if (req.includes('what time') || req.includes('is it night') || req.includes('is it day') || req.includes('is it dark')) {
      const t = bot.time.timeOfDay
      const isNight = t > 13000 && t < 23000
      say(isNight ? `its night, time ${Math.floor(t)}` : `its day, time ${Math.floor(t)}`)
      return
    }
    // "what do you need" / "are you busy"
    if (req.includes('what do you need') || req.includes('are you busy') || req.includes('do you need anything')) {
      const needs = []
      if (bot.food < 10) needs.push('food')
      if (bot.health < 10) needs.push('healing')
      if (farming && !bot.inventory.items().some(i => i.name.includes('seed') || i.name === 'carrot' || i.name === 'potato')) needs.push('seeds to replant')
      say(needs.length ? `i need ${needs.join(' and ')}` : `i'm good, ${currentJob()}`)
      return
    }
    // "i need an iron pickaxe" - try to craft it for you
    if (req.startsWith('i need') || req.startsWith('i want')) {
      const rest = req.replace(/^(i need|i want)\s*/, '')
      const { itemName, count } = parseItemAndCount(rest)
      await doCraft(itemName, count)
      return
    }
    // "get me 10 oak logs" / "bring me some stone" - go get it, then come back
    if (req.startsWith('get me') || req.startsWith('bring me') || req.startsWith('fetch')) {
      const rest = req.replace(/^(get me|bring me|fetch)\s*/, '')
      const { itemName, count } = parseItemAndCount(rest)
      await fetchBlock(itemName, count, username)
      return
    }
    // "kill that zombie" / "kill the skeleton"
    {
      const killMatch = req.match(/kill (?:that |the |a )?(\w+)/)
      if (killMatch) {
        const mob = killMatch[1]
        const target = bot.nearestEntity(e => e.type === 'mob' && (e.name || '').toLowerCase().includes(mob))
        if (!target) { say(`i cant see a ${mob} near me`); return }
        guardMode = true; equipBestWeapon()
        say(`ok, going for the ${mob}`)
        startCombat(target)
        return
      }
    }
    // "say hi to Steve"
    {
      const hiMatch = req.match(/say hi to (\w+)/)
      if (hiMatch) { say(`hi ${hiMatch[1]}`); return }
    }

    // remember this task for "do it again"
    brain.lastTask = req; saveBrain()

    // v10.4 AUTOCHAT: the keyword-hint fallback below SHADOWS the AI
    // (any open question with the word "creeper"/"farm"/"food" in it
    // gets a hint instead of an AI reply — run 74 proved it). When
    // AI is on, try it FIRST; when it is off it returns false and
    // the hints below still work.
    if (await aiHandleFallback(username, req, isWhisper)) return

    // v6: keyword fallback — if it does not understand the exact sentence,
    // it guesses the meaning from the words and suggests the right command,
    // instead of just saying "didn't get that". Still fixed rules, no AI.
    {
      const hints = [
        [/food|hungry|eat|starving/, 'do you want me to get food? try: segs get food'],
        [/farm|harvest|crop|potato|wheat|carrot|beetroot/, 'want me to farm? try: segs farm potato'],
        [/sleep|bed|tired/, 'want me to sleep? try: segs sleep'],
        [/come|here|tp|teleport/, 'want me to come to you? try: segs tp to me'],
        [/follow/, 'want me to follow you? try: segs follow me'],
        [/fight|attack|kill|zombie|skeleton|creeper|mob/, 'want me to fight? try: segs guard me'],
        [/craft|make|build/, 'want me to craft something? try: segs craft iron pickaxe'],
        [/chest|coal|smoker|furnace|cook|smelt/, 'want me to cook or check a chest? try: segs get food'],
        [/home|base/, 'want to go home? try: segs go home, or segs list bases'],
        [/dance|jump|fun|play/, 'want me to have fun? try: segs dance'],
      ]
      const hint = hints.find(([re]) => re.test(req))
      if (hint) { say(`hmm, i didnt quite get that. ${hint[1]}`); return }
    }

    // v10.3: fuzzy typos. "Segs top" is almost certainly "stop",
    // "Segs complete" means finish the current task (= stop it).
    const TYPO_MAP = { top: 'stop', stpo: 'stop', stp: 'stop', complete: 'stop', done: 'stop', finish: 'stop', follw: 'follow me', folow: 'follow me', tpo: 'tp to me', staus: 'status', stat: 'status', inv: 'inventory', hel: 'help' }
    if (TYPO_MAP[req]) { say(`did you mean "segs ${TYPO_MAP[req]}"?`); return }
    // v10.4 AUTOCHAT: nothing else matched — if AI is on, ask Groq.
    // Canned status/where/what-doing questions never reach here (own
    // handlers above), so this is only open-ended chat.
    if (await aiHandleFallback(username, req, isWhisper)) return
    say("hmm, i didn't get that. try: segs help")
  }

  async function sleepInBed () {
    if (bot.isSleeping) { say('already sleeping'); return }
    stopAllMovement()
    // find a bed nearby
    const bed = bot.findBlock({ matching: b => b.name && b.name.includes('bed'), maxDistance: 16 })
    if (!bed) { say('i cant see a bed near me, put one down'); return }
    try {
      await gotoPos(bed.position)
      await bot.sleep(bed)
      say(pick(['sleeping, good night', 'going to sleep, wake me up when you need me']))
    } catch (e) {
      if (/not night|daytime|day/i.test(e.message)) say("its daytime, i cant sleep yet")
      else if (/too far|no bed|monster/i.test(e.message)) say('cant sleep: ' + e.message.toLowerCase())
      else say('cant sleep right now, try again at night')
      log('sleep failed: ' + e.message)
    }
  }
  async function wakeUp () {
    if (!bot.isSleeping) { say('im already awake'); return }
    try { await bot.wake(); say('awake, ready to work') } catch (e) { say('cant wake up yet') }
  }

  // ---- v8: sprint (hunger-dependent) ----
  // A human sprints when fed and walks when hungry — sprinting drains
  // hunger fast. The pathfinder only sprints on straight stretches when
  // allowSprinting is on, so toggle it from the food level: sprint at 10+
  // (5 drumsticks), walk below that. Called before every walk and by the
  // 30s watchdog, so it follows the food level live.
  let sprintOn = null
  function updateSprint () {
    if (!pathMovements || !bot || !bot.entity || bot.food == null) return
    const want = bot.food >= 10
    if (want !== sprintOn) {
      sprintOn = want
      pathMovements.allowSprinting = want
      log('sprint ' + (want ? 'on' : 'off') + ' (food ' + bot.food + '/20)')
    }
  }

  // ---- v8: bed = spawn point ----
  // "Segs set this bed as your bed" — Segs sleeps in the nearest bed, which
  // is what sets the vanilla spawn point. If it is daytime it cannot sleep
  // yet, so it remembers the bed and sleeps in it at night on its own.
  // Asking again at another bed moves the spawn point there, any time.
  async function setSpawnBed () {
    const bed = bot.findBlock({ matching: b => b.name && b.name.includes('bed'), maxDistance: 8 })
    if (!bed) { say('i cant see a bed near me, put one down and bring me to it'); return }
    const pos = [Math.floor(bed.position.x), Math.floor(bed.position.y), Math.floor(bed.position.z)]
    try {
      stopAllMovement()
      await gotoPos(bed.position)
      await bot.sleep(bed)
      brain.spawnBed = pos; brain.pendingSpawnBed = null; saveBrain()
      say('ok, this bed is my spawn now — if i die ill come back here')
      logEvent('spawn', 'spawn point set at bed ' + pos.join(', '))
    } catch (e) {
      if (/not night|daytime|day/i.test(e.message)) {
        brain.pendingSpawnBed = pos; saveBrain()
        say('its daytime, i cant sleep yet — ill sleep in this bed tonight and set my spawn then')
        log('spawn bed remembered for tonight: ' + pos.join(', '))
      } else if (/monster|mob/i.test(e.message)) {
        say('cant sleep, monsters are too close — clear them out first')
      } else { say('cant sleep in that bed right now'); log('setSpawnBed failed: ' + e.message) }
    }
  }
  // Night check for a bed remembered during the day (called by the watchdog).
  async function sleepPendingBed () {
    if (!brain.pendingSpawnBed || bot.isSleeping) return
    if (currentJob() !== 'idle, waiting for you') return
    try {
      if (bot.time && bot.time.isDay) return
      const bp = new Vec3(brain.pendingSpawnBed[0], brain.pendingSpawnBed[1], brain.pendingSpawnBed[2])
      if (bot.entity.position.distanceTo(bp) > 20) return
      if (nearestHostile(8)) return // monsters nearby block sleeping anyway
      const bed = bot.blockAt(bp)
      if (!bed || !bed.name.includes('bed')) { brain.pendingSpawnBed = null; saveBrain(); return }
      await gotoPos(bp)
      await bot.sleep(bed)
      brain.spawnBed = brain.pendingSpawnBed; brain.pendingSpawnBed = null; saveBrain()
      say('slept in my bed — this is my spawn now')
      logEvent('spawn', 'spawn point set at bed (night) ' + brain.spawnBed.join(', '))
    } catch (e) { log('sleepPendingBed: ' + e.message) }
  }

  // ---- v8: permanent home (the room) ----
  // Different from the bed/spawn point, which moves whenever the owner says
  // so: the permanent home is where Segs lives — its room, its chests.
  // It stays put even if the spawn point changes later.
  async function rememberPermanentHome () {
    const pos = [Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y), Math.floor(bot.entity.position.z)]
    // link the server home set most recently, so "go home" can teleport
    const serverHome = lastSetHome && brain.serverHomes.includes(lastSetHome) ? lastSetHome : null
    // scan for the room's chests now, so "store items" knows where to put things
    const chests = []
    try {
      const found = bot.findBlocks({ matching: b => b.name.includes('chest'), maxDistance: 8, count: 6 })
      for (const p of found) chests.push([Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)])
    } catch (e) {}
    brain.permanentHome = { pos, serverHome, setAt: new Date().toISOString() }
    brain.roomChests = chests
    saveBrain()
    say(serverHome ? `ok, this is my permanent home now — my server home for it is ${serverHome}` : 'ok, this is my permanent home now')
    logEvent('home', 'permanent home set at ' + pos.join(', ') + (serverHome ? ' (server home ' + serverHome + ')' : '') + ', chests: ' + chests.length)
  }
  async function goPermanentHome () {
    if (!brain.permanentHome) return false
    const ph = brain.permanentHome
    if (ph.serverHome && brain.serverHomes.includes(ph.serverHome)) {
      stopAllMovement(); say('going to my room')
      if (await tryServerHome(ph.serverHome)) { say('at my room'); return true }
      say('couldnt teleport there, walking instead')
    }
    stopAllMovement(); say('going to my room')
    const ok = await gotoPos(new Vec3(ph.pos[0], ph.pos[1], ph.pos[2]))
    if (ok) say('at my room')
    return ok
  }

  // ---- v8: store items in the room's chests ----
  // Keeps its tools (pickaxe, sword, etc.) — those stay in its hands.
  // Everything else goes into the room chests.

  // ---- v9: SORT ENGINE ----
  // Deposit into one specific chest (used to return items to their
  // source chest when a sort is stopped). Returns true if it went in.
  async function depositIntoChest (chestPos, item) {
    const block = bot.blockAt(chestPos)
    if (!block || !isContainer(block)) return false
    try {
      if (!(await gotoPos(chestPos))) return false
      const chest = await bot.openChest(block)
      try { await chest.deposit(item.type, item.metadata, item.count) } catch (e) { chest.close(); return false }
      chest.close()
      return true
    } catch (e) { return false }
  }
  // Junk goes to the trash chest if one was taught ("Segs this is the
  // trash chest"), else Segs drops it on the ground and says so.
  async function trashItem (item) {
    if (brain.trashChest) {
      if (await depositIntoChest(new Vec3(brain.trashChest[0], brain.trashChest[1], brain.trashChest[2]), item)) return 'trashed'
    }
    try { await bot.toss(item.type, item.metadata, item.count); return 'dropped' } catch (e) { return 'kept' }
  }
  // Paper column: sugarcane -> paper. 3 cane = 3 paper, needs a crafting
  // table (3-wide recipe). Returns how many paper were ACTUALLY made
  // (counted from the inventory, not assumed — bot.craft with a count
  // above 1 does not reliably craft that many times in this fork, so
  // craft one at a time and count what really appears).
  async function craftPaper (caneCount) {
    const crafts = Math.floor(caneCount / 3)
    if (crafts < 1) return 0
    let table = null
    // v9: radius 16, not 10 — when the sort processes sugarcane last,
    // Segs is already at a far column (~11 blocks from the table) and a
    // 10-block search misses it. (Run 41j proved it.)
    try { table = bot.findBlock({ matching: b => b.name === 'crafting_table', maxDistance: 16 }) } catch (e) { log('craftPaper findBlock error: ' + e.message) }
    if (!table) { say('i need a crafting table near me to make paper'); return 0 }
    const mcData = mcDataFor(bot.version)
    const paperId = mcData.itemsByName.paper.id
    const countPaper = () => bot.inventory.items().filter(i => i.type === paperId).reduce((a, i) => a + i.count, 0)
    try {
      if (!(await gotoPos(table.position))) return 0
      const before = countPaper()
      let made = 0
      for (let i = 0; i < crafts; i++) {
        // v9: re-fetch the recipe AND the table every step. The fork's
        // bot.craft only ever makes paper on the FIRST call in a loop —
        // later calls return without throwing but make nothing (run 41n:
        // 9 cane yielded 3 paper). A fresh recipe + table each step
        // makes every craft actually happen.
        let recipe = null
        try { recipe = bot.recipesFor(paperId, null, 1, table)[0] || bot.recipesFor(paperId, null, 1, null)[0] } catch (e) {}
        if (!recipe) { log('paper craft step ' + (i + 1) + ': no recipe, stopping'); break }
        try { await bot.craft(recipe, 1, table) } catch (e) { log('paper craft step ' + (i + 1) + ' failed: ' + e.message); break }
        await sleepMs(200)
        made = countPaper() - before
        if (made >= (i + 1) * 3) continue
        // this step made nothing — stop, don't spin on a dead recipe
        if (countPaper() === before) break
      }
      // v9: the inventory can lag a tick behind the last craft, so the
      // count above can read 6 when 9 paper are actually there — then the
      // deposit only moves 6 and 3 paper strand in Segs' inventory.
      // Wait a beat and recount so `made` is the true paper count.
      // (Run 41l proved it: 6 in the paper column, 3 still carried.)
      await sleepMs(300)
      made = countPaper() - before
      if (made > 0) logEvent('craft', `made ${made}x paper from ${made}x sugarcane`)
      return made
    } catch (e) { log('paper craft failed: ' + e.message); return 0 }
  }
  // Route ONE carried stack to its destination. Returns 'stored' | 'trashed' | 'dropped' | 'failed' | 'paper'.
  async function routeCarried (item) {
    if (item.enchanted || itemIsEnchanted(item)) {
      if (await depositIntoColumn('misc', item)) return 'stored'
      say('the misc column is full or missing, keeping ' + item.name); return 'failed'
    }
    if (isJunk(item)) return await trashItem(item)
    const cat = categoryOf(item.name)
    // sugarcane is paper input: craft it instead of storing the cane
    if (item.name === 'sugar_cane') {
      const made = await craftPaper(item.count)
      if (made > 0) {
        const paper = { type: mcDataFor(bot.version).itemsByName.paper.id, metadata: 0, count: made, name: 'paper' }
        // the crafted paper is already in Segs' inventory — deposit it
        const ok = await depositIntoColumn('paper', paper)
        // any cane the craft did not use stays in Segs' inventory — put
        // it in the paper column as stock, don't leave it carried
        const left = item.count - made
        if (left > 0) {
          const cane = { type: item.type, metadata: item.metadata, count: left, name: 'sugar_cane' }
          await depositIntoColumn('paper', cane)
        }
        return ok ? 'paper' : 'failed'
      }
      // no table / could not craft: store the cane in the paper column as stock
      if (await depositIntoColumn('paper', item)) return 'stored'
      return 'failed'
    }
    let col = columnFor(cat)
    if (!col) {
      col = claimBlankColumn(cat)
      if (col) say(`no ${cat} column yet — made this column the ${cat} column`)
      else {
        // nowhere to put it: misc is the overflow
        if (await depositIntoColumn('misc', item)) return 'stored'
        return 'failed'
      }
    }
    if (await depositIntoColumn(cat, item)) return 'stored'
    // column full: try misc as overflow
    if (cat !== 'misc' && await depositIntoColumn('misc', item)) return 'stored'
    return 'failed'
  }
  // The sort itself. opts: { category (null = everything), source ('room' or null) }.
  // Works in batches: withdraw from one source chest, carry it, deposit
  // it, repeat. Stops cleanly when the owner says stop (moveToken bump):
  // it puts back whatever it is carrying and saves the job as paused.
  let sortingNow = false
  async function sortItems (opts) {
    if (sortingNow) { say('im already sorting, say stop first if you want me to stop'); return }
    const category = (opts && opts.category) || null
    // source chests: the taught room, else any container near Segs
    let sourceChests = []
    if (brain.myRoom && brain.myRoom.chests && brain.myRoom.chests.length) sourceChests = brain.myRoom.chests.map(p => new Vec3(p[0], p[1], p[2]))
    else { try { sourceChests = bot.findBlocks({ matching: b => isContainer(b), maxDistance: 8, count: 8 }) } catch (e) {} }
    if (!sourceChests.length) { say('i cant see any chests to sort from — stand in your room and tell me: segs this is my room'); return }
    if (!brain.permanentHome && !Object.keys(brain.columns || {}).length) { say('i dont know your storage unit yet — take me there and tell me: segs this is your permanent home, then teach me the columns'); return }
    // (No trip to the storage unit up front — the sort starts at the
    // source chests in the room, and each deposit walk takes Segs to the
    // columns as needed. One less walk.)
    const tok = moveToken
    sortStopRequested = false
    sortingNow = true
    // (re)start or resume the job record: moved stays cumulative, total
    // is re-scanned so left = what is actually still in the source.
    let job = brain.sortJob
    const sameJob = job && job.status !== 'done' && job.category === (category || 'all') && job.kind === (category ? 'category' : 'full')
    if (!sameJob) job = { kind: category ? 'category' : 'full', category: category || 'all', source: brain.myRoom ? 'my room' : 'nearby chests', moved: 0, movedItems: 0, total: 0, totalItems: 0, status: 'running', startedAt: Date.now() }
    job.status = 'running'
    brain.sortJob = job; saveBrain()
    say(category ? `sorting the ${category} into the ${category} column` : 'sorting your room into the storage unit columns')
    logEvent('sort', `started ${job.kind} sort (${job.category}) from ${job.source}`)
    // count the work first, so "left" is honest in the continue report.
    // On a resume, moved stays cumulative and total = moved + remaining.
    {
      let remStacks = 0, remItems = 0
      for (const sc of sourceChests) {
        if (sortStopRequested || tok !== moveToken) break
        const block = bot.blockAt(sc)
        if (!block || !isContainer(block)) continue
        try {
          if (!(await gotoPos(sc))) continue
          const chest = await bot.openChest(block)
          for (const it of chest.containerItems()) {
            if (!it || it.name.includes('shulker')) continue
            if (category && categoryOf(it.name) !== category && !(category === 'paper' && it.name === 'sugar_cane')) continue
            remStacks++; remItems += it.count
          }
          chest.close()
        } catch (e) {}
      }
      job.total = job.moved + remStacks
      job.totalItems = job.movedItems + remItems
      brain.sortJob = job; saveBrain()
      if (!remStacks) { say('nothing to sort here — the chests are empty or already sorted'); job.status = 'done'; brain.sortJob = job; saveBrain(); sortingNow = false; return }
    }
    let carried = [] // { type, metadata, count, name, fromPos }
    let skippedShulkers = 0
    let failed = 0
    const interrupted = () => sortStopRequested || tok !== moveToken
    // scan + move, one source chest at a time
    for (const sc of sourceChests) {
      if (interrupted()) break
      const block = bot.blockAt(sc)
      if (!block || !isContainer(block)) continue
      let chest
      try { if (!(await gotoPos(sc))) continue; chest = await bot.openChest(block) } catch (e) { continue }
      let items = []
      try { items = chest.containerItems().filter(i => i) } catch (e) { items = [] }
      // plan this chest's work list (skip shulkers entirely)
      const work = []
      for (const it of items) {
        if (it.name.includes('shulker')) { skippedShulkers++; continue }
        if (category && categoryOf(it.name) !== category && !(category === 'paper' && it.name === 'sugar_cane')) continue
        work.push(it)
      }
      // withdraw in batches (leave inventory room for the trip back)
      for (const it of work) {
        if (interrupted()) { log('sort: withdraw loop interrupted (stop=' + sortStopRequested + ' tok=' + (tok !== moveToken) + ')'); break }
        if (bot.inventory.items().length >= 30) { log('sort: inventory full (' + bot.inventory.items().length + ' stacks), depositing batch'); break } // full — deposit this batch first
        const take = Math.min(it.count, 64)
        try {
          await chest.withdraw(it.type, it.metadata, take)
          carried.push({ type: it.type, metadata: it.metadata, count: take, name: it.name, fromPos: sc, enchanted: itemIsEnchanted(it) })
        } catch (e) { log('sort: withdraw ' + it.name + ' failed: ' + e.message) }
      }
      try { chest.close() } catch (e) {}
      // deposit the batch we just took from this chest — tools first,
      // best tier first, so the tools column fills top-down best-to-worst
      carried.sort((a, b) => {
        const ta = TOOL_SUFFIX.test(a.name) ? toolTier(a.name) : 99
        const tb = TOOL_SUFFIX.test(b.name) ? toolTier(b.name) : 99
        return ta - tb
      })
      for (const item of [...carried]) {
        if (interrupted()) break
        const res = await routeCarried(item)
        carried.splice(carried.indexOf(item), 1)
        if (res === 'stored' || res === 'trashed' || res === 'dropped' || res === 'paper') { job.moved++; job.movedItems += item.count }
        else {
          failed++
          // nowhere to put it: back where it came from, don't strand it in Segs' inventory
          await depositIntoChest(item.fromPos, item)
        }
      }
      brain.sortJob = job; saveBrain()
      if (interrupted()) break
      // if the inventory filled mid-chest, loop the same chest again
      // (the outer loop moves on; the chest will be re-scanned next sort)
    }
    // done or interrupted — put back anything still carried
    if (carried.length) {
      for (const item of [...carried]) {
        let back = await depositIntoChest(item.fromPos, item)
        if (!back) { for (const sc of sourceChests) { if (await depositIntoChest(sc, item)) { back = true; break } } }
        if (!back) say(`couldnt put back ${item.count}x ${item.name}, still carrying it`)
        carried.splice(carried.indexOf(item), 1)
      }
    }
    sortingNow = false
    if (interrupted()) {
      job.status = 'paused'
      brain.sortJob = job; saveBrain()
      sortPausedByStop = true
      sortStopRequested = false
      say(`stopped sorting — put back what i was carrying. moved ${job.moved} stacks, ${failed} couldnt go anywhere${skippedShulkers ? `, left ${skippedShulkers} shulker boxes alone` : ''}. say "segs continue last sorting" when you want me to pick it up again`)
      logEvent('sort', `paused: moved ${job.moved} stacks, ${failed} failed`)
      return
    }
    job.status = 'done'
    brain.sortJob = job; saveBrain()
    bumpStat('itemsSorted', job.movedItems); bumpStat('sortsDone', 1)
    say(`done sorting — moved ${job.moved} stacks (${job.movedItems} items)${failed ? `, ${failed} stacks couldnt go anywhere (no column and no misc)` : ''}${skippedShulkers ? `, left ${skippedShulkers} shulker boxes alone` : ''}`)
    logEvent('sort', `done: moved ${job.moved} stacks (${job.movedItems} items), ${failed} failed`)
  }
  // "Segs continue last sorting" — report first, wait for the answer.
  async function askContinueSorting () {
    const job = brain.sortJob
    if (!job || job.status === 'done' || (!job.moved && job.status !== 'paused')) { say('i dont have a sorting job to continue — tell me what to sort: segs sort my room'); return }
    if (job.status === 'running') { say('im already sorting that one, wait a bit or say stop'); return }
    const left = Math.max(0, (job.total || 0) - job.moved)
    say(`last sorting was ${job.kind === 'category' ? 'the ' + job.category : 'your whole room'} from ${job.source} — i moved ${job.moved} stacks, ${left} left. do you want me to continue this one, or do another sorting? if another one, which one?`)
    pendingContinue = { job }
    logEvent('sort', `asked to continue: ${job.kind} ${job.category}, ${job.moved} moved, ${left} left`)
  }
  // "Segs make paper" — take sugarcane from the sugarcane farm chests,
  // craft paper, put it in the paper column.
  async function makePaper () {
    if (!columnFor('paper')) { say('i dont know the paper column yet — take me there and tell me: segs this is the paper column'); return }
    let caneChests = (brain.sugarcaneChests || []).map(p => new Vec3(p[0], p[1], p[2]))
    if (!caneChests.length) {
      const mark = Object.values(brain.landmarks || {}).find(l => l.type === 'chest' && l.name.includes('sugarcane'))
      if (mark) caneChests = [new Vec3(mark.pos[0], mark.pos[1], mark.pos[2])]
    }
    if (!caneChests.length) { try { caneChests = bot.findBlocks({ matching: b => isContainer(b), maxDistance: 8, count: 4 }) } catch (e) {} }
    if (!caneChests.length) { say('i cant see any chest with sugarcane — show me the sugarcane farm chests first'); return }
    let totalCane = 0
    for (const cp of caneChests) {
      const block = bot.blockAt(cp)
      if (!block || !isContainer(block)) continue
      try {
        if (!(await gotoPos(cp))) continue
        const chest = await bot.openChest(block)
        const cane = chest.containerItems().find(i => i && i.name === 'sugar_cane')
        if (cane) {
          const take = Math.min(cane.count, 27)
          try { await chest.withdraw(cane.type, cane.metadata, take); totalCane += take } catch (e) {}
        }
        chest.close()
      } catch (e) {}
      if (totalCane >= 27) break
    }
    if (!totalCane) { say('no sugarcane in the chests'); return }
    const made = await craftPaper(totalCane)
    if (!made) return // craftPaper already said why
    const paper = { type: mcDataFor(bot.version).itemsByName.paper.id, metadata: 0, count: made, name: 'paper' }
    if (await depositIntoColumn('paper', paper)) say(`made ${made}x paper and put it in the paper column`)
    else say(`made ${made}x paper but the paper column is full or missing, still carrying it`)
  }


  // ================= v9: SORTING + COLUMNS + BASE MAP =================
  // One COLUMN = one category (16 categories). A column is a vertical
  // stack of chests/barrels, up to 10 tall, taught once by walking Segs
  // there ("Segs this is the ore column"). Segs records the chests and
  // remembers item -> chest, so the next sort goes straight there.
  const SORT_CATEGORIES = ['flowers', 'building', 'ores', 'tools', 'foods', 'farm', 'paper', 'woods', 'redstone', 'mob drops', 'nether', 'valuables', 'brewing', 'armor', 'seeds', 'misc']
  // What the owner says -> category. "the ore column" -> ores, "the tool column" -> tools, ...
  const COLUMN_WORDS = { flower: 'flowers', building: 'building', block: 'building', ore: 'ores', tool: 'tools', food: 'foods', farm: 'farm', paper: 'paper', wood: 'woods', redstone: 'redstone', drop: 'mob drops', mob: 'mob drops', nether: 'nether', valuable: 'valuables', treasure: 'valuables', brew: 'brewing', potion: 'brewing', armor: 'armor', seed: 'seeds', plant: 'seeds', misc: 'misc' }
  // A container Segs may open: chest / trapped chest / barrel. NEVER a
  // shulker box (the owner's private storage — off limits without his
  // explicit permission) and never an ender chest (that's per-player).
  function isContainer (b) {
    if (!b || !b.name) return false
    if (b.name.includes('shulker') || b.name === 'ender_chest') return false
    return b.name.includes('chest') || b.name === 'barrel'
  }
  // Is this item enchanted? prismarine-item exposes .enchants; fall back
  // to the raw NBT (26.3 uses lowercase `enchantments`). Enchanted items
  // ALWAYS go to Misc and are NEVER thrown away — the owner might have
  // kept netherite gear in a chest and losing it would be a big issue.
  function itemIsEnchanted (item) {
    if (!item) return false
    try { if (item.enchants && item.enchants.length) return true } catch (e) {}
    try {
      const n = item.nbt && item.nbt.value
      if (n) {
        const enc = n.enchantments || n.Enchantments
        if (enc) { const list = enc.value && enc.value.value ? enc.value.value : enc.value; if (list && list.length) return true }
      }
    } catch (e) {}
    return false
  }
  // Junk = thrown away (trash chest, else dropped on the ground): rotten
  // flesh, arrows, and NON-enchanted low-tier tools/weapons/armor
  // (wood/stone/iron/gold/leather). Diamond/netherite is never junk.
  const JUNK_NAMES = new Set(['rotten_flesh', 'arrow', 'spectral_arrow', 'tipped_arrow'])
  function isJunk (item) {
    if (!item || itemIsEnchanted(item)) return false
    if (JUNK_NAMES.has(item.name)) return true
    const m = item.name.match(/^(wooden|stone|iron|golden|leather)_(.+)$/)
    if (m && /^(pickaxe|axe|shovel|hoe|sword|bow|crossbow|helmet|chestplate|leggings|boots)$/.test(m[2])) return true
    return false
  }
  // Tool tier for the tools column: best at the TOP chest, worst at the
  // bottom. (Owner's order; gold sits between iron and stone — correct
  // him if he wants it elsewhere.)
  function toolTier (name) {
    if (name.startsWith('netherite_')) return 0
    if (name.startsWith('diamond_')) return 1
    if (name.startsWith('iron_')) return 2
    if (name.startsWith('golden_')) return 3
    if (name.startsWith('stone_')) return 4
    if (name.startsWith('wooden_')) return 5
    return 2 // no material in the name (bow, crossbow, fishing rod, shears, trident, mace) — mid
  }
  // Which column does an item belong in? Order matters: exact farm items
  // first (potato/carrot are also foods), redstone before building
  // ('redstone' contains 'stone'), woods before nether (warped planks
  // are wood). Anything unmatched -> misc.
  const TOOL_SUFFIX = /_(pickaxe|axe|shovel|hoe|sword)$|^bow$|^crossbow$|^fishing_rod$|^shears$|^flint_and_steel$|^trident$|^mace$/
  const ARMOR_SUFFIX = /_(helmet|chestplate|leggings|boots)$|^shield$|^elytra$|_horse_armor$/
  function categoryOf (name) {
    if (!name) return 'misc'
    if (name === 'wheat' || name === 'potato' || name === 'carrot') return 'farm'
    if (name === 'paper' || name === 'book' || name === 'writable_book' || name === 'sugar_cane') return 'paper'
    if (TOOL_SUFFIX.test(name)) return 'tools'
    if (ARMOR_SUFFIX.test(name)) return 'armor'
    if (/^(cooked_|baked_)/.test(name) || /_stew$/.test(name) || ['bread', 'apple', 'golden_apple', 'melon_slice', 'pumpkin_pie', 'cookie', 'cake', 'mushroom_stew', 'suspicious_stew', 'beetroot_soup', 'rabbit_stew', 'honey_bottle', 'milk_bucket', 'chorus_fruit', 'sweet_berries', 'glow_berries', 'dried_kelp', 'beetroot', 'cod', 'salmon', 'tropical_fish', 'poisonous_potato'].includes(name)) return 'foods'
    if (/_log$|_planks$|_wood$/.test(name) || name === 'stick' || name === 'ladder' || name === 'bamboo') return 'woods'
    if (/^raw_(iron|gold|copper)$/.test(name) || /^(iron|gold|copper|coal)_ingot$/.test(name) || /^(iron|gold|copper|coal)_block$/.test(name) || name === 'coal' || name === 'charcoal' || name === 'flint') return 'ores'
    if (['diamond', 'emerald', 'netherite_ingot', 'netherite_scrap', 'ancient_debris', 'lapis_lazuli', 'amethyst_shard', 'echo_shard', 'heart_of_the_sea', 'dragon_egg', 'totem_of_undying', 'nether_star', 'eye_of_ender'].includes(name) || /^(diamond|emerald|netherite|lapis|amethyst)_block$/.test(name)) return 'valuables'
    if (/redstone|repeater|comparator|piston|observer|hopper|dropper|dispenser|_rail$|lever|button|pressure_plate|daylight_detector|target|lightning_rod|tripwire_hook|note_block|jukebox|sculk_sensor/.test(name)) return 'redstone'
    if (['nether_wart', 'blaze_rod', 'blaze_powder', 'ghast_tear', 'magma_cream', 'fermented_spider_eye', 'sugar', 'glistering_melon_slice', 'golden_carrot', 'pufferfish', 'glass_bottle', 'dragon_breath'].includes(name) || /_potion$/.test(name)) return 'brewing'
    if (['bone', 'string', 'gunpowder', 'spider_eye', 'ender_pearl', 'slime_ball', 'phantom_membrane', 'rabbit_hide', 'rabbit_foot', 'ink_sac', 'glow_ink_sac', 'prismarine_shard', 'prismarine_crystals', 'nautilus_shell', 'scute', 'wither_skeleton_skull', 'skeleton_skull', 'zombie_head', 'creeper_head', 'dragon_head', 'piglin_head'].includes(name)) return 'mob drops'
    if (/^(netherrack|nether_quartz|quartz|glowstone|soul_sand|soul_soil|basalt|blackstone|nether_brick|nether_wart_block|warped_|crimson_)/.test(name) || name === 'glowstone_dust') return 'nether'
    if (/stone|brick|concrete|terracotta|glass|sand|gravel|dirt|stairs|slab|wall|pillar|andesite|diorite|granite|deepslate|tuff|calcite|prismarine|purpur|end_stone|obsidian|crying_obsidian|clay|mud|packed_mud|ice|snow|wool|carpet|torch|lantern|candle|chain|fence|door|trapdoor|sign|banner|flower_pot|cauldron|anvil|grindstone|smithing_table|stonecutter|loom|composter|barrel|chest|bookshelf|lectern|enchanting_table|beacon|conduit|respawn_anchor|lodestone/.test(name)) return 'building'
    if (/poppy|dandelion|tulip|orchid|allium|cornflower|lily|rose|sunflower|peony|lilac|daisy|oxeye|wither_rose|torchflower|pitcher|blue_orchid|azure_bluet/.test(name)) return 'flowers'
    if (/seed|sapling|mushroom|kelp|vine|cactus|chorus_plant|chorus_flower|azalea|spore_blossom|hanging_roots|glow_lichen|moss|fern|grass|tall_grass|dead_bush/.test(name)) return 'seeds'
    return 'misc'
  }
  // v9.2: Scan the chests/barrels of ONE column only. Tash's real
  // storage unit is one continuous wall — columns sit side by side
  // with no gap — so the old scan (everything within 2 blocks
  // horizontally of where Segs stands) also recorded the columns
  // next door, and ores could land in the wrong column. Now Segs
  // anchors on the NEAREST container block to where he stands and
  // reads that exact (x, z) footprint block by block, from 10 below
  // to 10 above (a column is a vertical stack, up to 10 tall, with
  // stairways). Reading block-by-block matters: the old findBlocks
  // call capped at 40 containers, and a real wall has 160+ chests
  // nearby, so the top levels never even reached the filter (run 46
  // first try: only 6-7 of 10 recorded). A double chest is two
  // adjacent blocks sharing one 54-slot inventory, so keeping one
  // (x, z) per level still records it once — 10 double chests = 10,
  // not 20.
  function scanColumnChests (pos) {
    let anchor = null
    try { anchor = bot.findBlock({ matching: b => isContainer(b), maxDistance: 8 }) } catch (e) {}
    if (!anchor) return []
    const ax = anchor.position.x
    const az = anchor.position.z
    const inCol = []
    for (let y = pos.y - 10; y <= pos.y + 10; y++) {
      let block = null
      try { block = bot.blockAt(new Vec3(ax, y, az)) } catch (e) {}
      if (block && isContainer(block)) inCol.push(new Vec3(ax, y, az))
    }
    return inCol.sort((a, b) => a.y - b.y) // bottom to top
  }
  // Two chest positions are the SAME inventory if they are the same
  // block, or two halves of one double chest (same y, adjacent in x
  // or z). Used when merging re-teaches and when checking whether a
  // column is already claimed — teaching from the other half of a
  // double chest must not double-count it or steal it for another
  // category.
  function sameChestInventory (a, b) {
    const ax = a[0] !== undefined ? a[0] : a.x
    const ay = a[1] !== undefined ? a[1] : a.y
    const az = a[2] !== undefined ? a[2] : a.z
    const bx = b[0] !== undefined ? b[0] : b.x
    const by = b[1] !== undefined ? b[1] : b.y
    const bz = b[2] !== undefined ? b[2] : b.z
    if (ax === bx && ay === by && az === bz) return true
    if (ay !== by) return false
    return (Math.abs(ax - bx) === 1 && az === bz) || (Math.abs(az - bz) === 1 && ax === bx)
  }
  // Merge chest lists, dropping the second half of any double chest
  // (keep the west/north half, like the v9.1 dedup). Input/output are
  // [x, y, z] arrays, sorted bottom to top.
  function mergeChestLists (lists) {
    const merged = new Map()
    for (const list of lists) for (const p of list) merged.set(p[0] + ',' + p[1] + ',' + p[2], p)
    const all = [...merged.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0] || a[2] - b[2])
    const kept = []
    for (const p of all) {
      if (kept.some(q => q[1] === p[1] && ((q[0] === p[0] - 1 && q[2] === p[2]) || (q[2] === p[2] - 1 && q[0] === p[0])))) continue
      kept.push(p)
    }
    return kept
  }
  function columnFor (category) { return (brain.columns || {})[category] || null }
  // A column taught with no type word ("Segs this is a column") is a
  // blank column. When a sort needs a column for a category that has
  // none, Segs claims the first blank one for it.
  function claimBlankColumn (category) {
    const cols = brain.columns || {}
    for (const key of Object.keys(cols)) {
      const c = cols[key]
      if (!c.category) {
        c.category = category
        delete cols[key]
        cols[category] = c
        saveBrain()
        logLearn('column', `claimed blank column at ${c.pos.join(', ')} for ${category}`)
        return c
      }
    }
    return null
  }
  // Deposit one item stack into a column's chests. BOTTOM-FIRST for
  // every column, then gradually up: Segs fills the bottom chest, and
  // only moves to the next one up when the one below is full. (Tash's
  // rule, 2026-11-07 — the old tools top-first reversal is gone.)
  // Uses the remembered item -> chest first (it goes straight there if
  // that chest still has room), else scans the column's chests in
  // order. Returns true if it got in somewhere.
  async function depositIntoColumn (category, item) {
    const col = columnFor(category)
    if (!col || !col.chests || !col.chests.length) return false
    const order = col.chests // bottom to top (scanColumnChests sorts by y)
    const tryChests = []
    // v9: only trust the remembered chest if it is actually IN this
    // column. The index is keyed by item name, so an enchanted diamond
    // sword would otherwise inherit the plain diamond sword's remembered
    // chest (the tools column) and land in tools instead of misc.
    // (Run 41k proved it: the [ENCH] sword went to the tools top chest.)
    const remembered = (brain.itemChest || {})[item.name]
    if (remembered && col.chests.some(c => c[0] === remembered[0] && c[1] === remembered[1] && c[2] === remembered[2])) tryChests.push(new Vec3(remembered[0], remembered[1], remembered[2]))
    for (const cp of order) tryChests.push(new Vec3(cp[0], cp[1], cp[2]))
    const seen = new Set()
    for (const cp of tryChests) {
      const key = cp.x + ',' + cp.y + ',' + cp.z
      if (seen.has(key)) continue
      seen.add(key)
      const block = bot.blockAt(cp)
      if (!block || !isContainer(block)) continue
      try {
        if (!(await gotoPos(cp))) continue
        const chest = await bot.openChest(block)
        try { await chest.deposit(item.type, item.metadata, item.count) } catch (e) { chest.close(); continue }
        chest.close()
        brain.itemChest[item.name] = [cp.x, cp.y, cp.z]
        saveBrain()
        return true
      } catch (e) { log('deposit: chest at ' + cp + ' failed: ' + e.message) }
    }
    return false
  }
  // Take one stack out of a chest. Returns how many were actually taken.
  async function withdrawFromChest (chestPos, item) {
    const block = bot.blockAt(chestPos)
    if (!block || !isContainer(block)) return 0
    try {
      if (!(await gotoPos(chestPos))) return 0
      const chest = await bot.openChest(block)
      const have = chest.containerItems().find(i => i && i.type === item.type && i.metadata === item.metadata)
      if (!have) { chest.close(); return 0 }
      const take = Math.min(item.count, have.count)
      try { await chest.withdraw(item.type, item.metadata, take) } catch (e) { chest.close(); return 0 }
      chest.close()
      return take
    } catch (e) { log('withdraw: chest at ' + chestPos + ' failed: ' + e.message); return 0 }
  }

  const KEEP_ITEMS = ['pickaxe', 'axe', 'shovel', 'sword', 'hoe', 'fishing_rod', 'bow', 'crossbow', 'shield', 'helmet', 'chestplate', 'leggings', 'boots', 'elytra', 'trident']
  async function storeItems () {
    if (!brain.permanentHome) { say('i dont have a permanent home yet — stand in my room and tell me: segs remember this is your permanent home'); return }
    const items = bot.inventory.items().filter(i => !KEEP_ITEMS.some(k => i.name.includes(k)))
    if (!items.length) { say('i have nothing to store, just my tools'); return }
    if (!(await goPermanentHome())) return // it already said why
    // chests: the ones scanned when the room was set, else any chest nearby
    let chestPositions = (brain.roomChests || []).map(p => new Vec3(p[0], p[1], p[2]))
    if (!chestPositions.length) {
      try { chestPositions = bot.findBlocks({ matching: b => b.name.includes('chest'), maxDistance: 8, count: 6 }) } catch (e) {}
    }
    if (!chestPositions.length) { say('im in my room but i cant see any chest here'); return }
    const stored = []
    for (const cp of chestPositions) {
      if (!items.length) break
      const block = bot.blockAt(cp)
      if (!block || !block.name.includes('chest')) continue
      try {
        await gotoPos(cp)
        const chest = await bot.openChest(block)
        for (const item of [...items]) {
          try {
            await chest.deposit(item.type, item.metadata, item.count)
            stored.push(`${item.count}x ${item.name}`)
            items.splice(items.indexOf(item), 1)
          } catch (e) { /* chest full for this stack — try the next chest */ }
        }
        chest.close()
      } catch (e) { log('store: chest at ' + cp + ' failed: ' + e.message) }
    }
    if (stored.length) { say(`stored in my room: ${stored.join(', ')}`); logEvent('store', 'stored ' + stored.join(', ')); bumpStat('itemsStored', stored.length) }
    else say('couldnt store anything, the chests look full')
    if (items.length) say(`still carrying: ${items.map(i => `${i.count}x ${i.name}`).join(', ')}`)
  }

  // ---- v8: pick up dropped items ----
  async function pickupItems (req) {
    // "pick up the bread" -> bread only; "pick the items" -> everything nearby
    let wanted = null
    const m = req.match(/pick (?:up )?(?:the )?(.+)$/) || req.match(/(?:collect|grab) (?:the )?(.+)$/)
    if (m && m[1] && !/^(items|item|stuff|these|them|everything)$/.test(m[1].trim())) wanted = aliasItem(m[1].trim())
    // v8 fix (run 22): gotoPos stops up to 2 blocks short (GoalNear range
    // 2), but picking an item up needs Segs almost on top of it — walk to
    // range 1 instead, and wait a full second for the server to hand it
    // over. Re-scan the entities each time: the first walk can take a
    // while and a falling item's position goes stale.
    const before = {}
    for (const it of bot.inventory.items()) before[it.name] = (before[it.name] || 0) + it.count
    for (let round = 0; round < 6; round++) {
      const dropped = Object.values(bot.entities || {}).filter(e => e && e.name === 'item' && bot.entity.position.distanceTo(e.position) <= 16)
      if (!dropped.length) break
      dropped.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position))
      let target = null
      for (const e of dropped) {
        if (!wanted) { target = e; break }
        let iname = null
        try { const di = e.getDroppedItem && e.getDroppedItem(); if (di) iname = di.name } catch (_) {}
        if (!iname || iname === wanted) { target = e; break }
      }
      if (!target) break
      if (bot.inventory.items().length >= 36) { say('my inventory is full, cant pick up more'); break }
      try {
        updateSprint()
        await gotoWithTimeout(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 1), 15000)
        await sleepMs(1000) // give the server a moment to hand the item over
      } catch (err) { log('pickup: ' + err.message); break }
    }
    const got = []
    for (const it of bot.inventory.items()) {
      const diff = it.count - (before[it.name] || 0)
      if (diff > 0) got.push(`${diff}x ${it.name}`)
    }
    if (got.length) { say(`picked up: ${got.join(', ')}`); logEvent('pickup', 'collected ' + got.join(', ')); bumpStat('itemsPicked', got.length) }
    else say(wanted ? `couldnt reach any ${wanted}` : 'couldnt reach the items')
  }

  // ---- v8: enemies — check + evade (like a villager flees) ----
  const HOSTILE_MOBS = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'slime', 'husk', 'drowned', 'stray', 'zombie_villager', 'cave_spider', 'blaze', 'ghast', 'piglin', 'piglin_brute', 'hoglin', 'zoglin', 'phantom', 'vex', 'vindicator', 'pillager', 'ravager', 'evoker', 'guardian', 'elder_guardian', 'warden', 'silverfish', 'endermite', 'magma_cube', 'wither_skeleton', 'zombified_piglin']
  function nearestHostile (maxDist) {
    if (!bot || !bot.entities) return null
    let best = null, bestD = maxDist
    for (const e of Object.values(bot.entities)) {
      if (!e || !e.name || !HOSTILE_MOBS.includes(e.name)) continue
      if (!canSeeMob(e)) continue
      const d = bot.entity.position.distanceTo(e.position)
      if (d < bestD) { best = e; bestD = d }
    }
    return best
  }
  function checkEnemies () {
    const found = []
    if (!bot || !bot.entities) { say('i cant see anything right now'); return }
    for (const e of Object.values(bot.entities)) {
      if (!e || !e.name || !HOSTILE_MOBS.includes(e.name)) continue
      if (!canSeeMob(e)) continue
      const d = Math.round(bot.entity.position.distanceTo(e.position))
      if (d <= 20) found.push(`${e.name} ${d} blocks away`)
    }
    if (!found.length) say('all clear, nothing hostile nearby')
    else say(`i can see: ${found.slice(0, 5).join(', ')}`)
    logEvent('enemies', found.length ? found.join('; ') : 'all clear')
  }
  // Evade tick (every 5s, background): if a hostile gets close while Segs
  // is idle, walk away from it — like a villager flees a zombie. If it is
  // in the middle of a job and the mob is about to hit (under 4 blocks),
  // interrupt the job and run. Guard mode is the exception: then it fights.
  // v8: fleeing is a continuous run, not a one-shot pathfinder goal.
  // Run 27 proved the goal version fails: Segs sprinted to a point 15
  // blocks away, STOPPED there (goal reached), and the zombie just walked
  // to where it stopped and killed it 11s later. A real player keeps
  // running while the mob is close. So the flee loop re-steers directly
  // away from the nearest hostile every 250ms (forward + sprint + jump)
  // and only stops when nothing hostile is within 12 blocks.
  // v9.4: flee must not run off an edge. Check the ground ahead in a
  // direction before running that way: 'safe' = solid block to stand on
  // within 2 below, 'blocked' = a wall in the way, 'drop' = nothing to
  // stand on (cliff, bridge edge, void). A drop means do NOT run that
  // way — Tash watched Segs flee a phantom on a 1-wide bridge at Y200
  // and fall off. If no direction is safe, Segs stands still: taking a
  // hit beats a 200-block fall, and the loop re-checks every 250ms.
  function groundAhead (dir, dist = 1.5) {
    try {
      const pos = bot.entity.position
      const Vec3 = require('vec3').Vec3
      const solid = b => b && b.boundingBox === 'block'
      // v10.5 run 107 fix: check TWO points ahead (dist and dist+1).
      // A single point is fooled by a thin natural ledge 1-2 below
      // it — 'safe' at the ledge, but a 7-block drop one block
      // further on (run 107c/d: Segs walked off the platform edge at
      // z=150 onto a ledge and fell to y=63). If EITHER point is a
      // drop, the way ahead is a drop.
      for (const d of [dist, dist + 1]) {
        const ahead = pos.clone().add(dir.clone().scale(d))
        const bx = Math.floor(ahead.x), by = Math.floor(pos.y), bz = Math.floor(ahead.z)
        const foot = bot.blockAt(new Vec3(bx, by, bz))
        const below1 = bot.blockAt(new Vec3(bx, by - 1, bz))
        const below2 = bot.blockAt(new Vec3(bx, by - 2, bz))
        if (solid(foot)) return 'blocked'
        if (!solid(below1) && !solid(below2)) return 'drop'
      }
      return 'safe'
    } catch (e) { return 'safe' } // if unsure, do not block fleeing
  }
  function rotateDir (dir, deg) {
    const Vec3 = require('vec3').Vec3
    const rad = deg * Math.PI / 180
    const cos = Math.cos(rad), sin = Math.sin(rad)
    return new Vec3(dir.x * cos - dir.z * sin, 0, dir.x * sin + dir.z * cos)
  }
  // v10.5.1 (b/c): pre-check a sidestep route for drops. Sample the
  // ground under the straight line from `from` to `to` every 1 block;
  // a sample is a drop if there is no solid block within 2 below the
  // feet level. Run 107: the sidestep around a wall ran along the
  // platform edge (z=150) and off it — the inland side (ground under
  // every step) must be tried first, and a side whose route crosses a
  // drop must not be tried before the safe side. If unsure, allow it.
  function routeSafe (from, to) {
    try {
      const Vec3 = require('vec3').Vec3
      const solid = b => b && b.boundingBox === 'block'
      const dist = Math.hypot(to.x - from.x, to.z - from.z)
      const steps = Math.max(1, Math.ceil(dist))
      for (let i = 1; i <= steps; i++) {
        const x = from.x + (to.x - from.x) * i / steps
        const z = from.z + (to.z - from.z) * i / steps
        const bx = Math.floor(x), bz = Math.floor(z)
        const by = Math.floor(from.y)
        const b1 = bot.blockAt(new Vec3(bx, by - 1, bz))
        const b2 = bot.blockAt(new Vec3(bx, by - 2, bz))
        if (!solid(b1) && !solid(b2)) return false
      }
      return true
    } catch (e) { return true }
  }
  // v10.5.1 RIVER BUG: does the straight line from->to cross water?
  // Used so a failed goto can say WHY (water, not "blocked") and so
  // the caller can decide whether to offer /tpa instead of retrying.
  function routeCrossesWater (from, to) {
    try {
      const Vec3 = require('vec3').Vec3
      const dist = Math.hypot(to.x - from.x, to.z - from.z)
      const steps = Math.max(1, Math.ceil(dist))
      for (let i = 1; i <= steps; i++) {
        const x = from.x + (to.x - from.x) * i / steps
        const z = from.z + (to.z - from.z) * i / steps
        const bx = Math.floor(x), bz = Math.floor(z)
        for (const dy of [0, -1, 1]) {
          const b = bot.blockAt(new Vec3(bx, Math.floor(from.y) + dy, bz))
          if (b && b.name === 'water') return true
        }
      }
      return false
    } catch (e) { return false }
  }
  // v10.1 PLAN ITEM 7 (night behaviour) + ITEM 11 (owner-offline
  // idle). Every 30s: at night, if Segs is idle (not fighting,
  // following, sorting or fleeing) and outside, go to the permanent
  // home (or near the owner). If the owner is offline, go to the
  // permanent home and idle there — do not wander alone.
  function startNightWatchdog () {
    setInterval(() => {
      try {
        if (!connected || !bot || !bot.entity || bot.health <= 0) return
        if (inCombat() || fleeTimer || followMode || sortJob) return
        const t = bot.time && bot.time.timeOfDay != null ? bot.time.timeOfDay : 6000
        const isNight = t > 13000 && t < 23000
        const ownerOnline = !!(bot.players[OWNER] && bot.players[OWNER].entity)
        const home = brain.permanentHome
        if (!home) return
        const pos = bot.entity.position
        const homeDist = Math.hypot(pos.x - home.x, pos.z - home.z)
        if (homeDist < 3) return // already home
        if (isNight || !ownerOnline) {
          logEvent('night', (isNight ? 'night' : 'owner offline') + ' — going home (' + Math.round(homeDist) + ' blocks)')
          if (!ownerOnline) say('youre offline, heading to my room to wait')
          else say('its night, heading inside')
          try { bot.pathfinder.setGoal(new goals.GoalNear(home.x, home.y, home.z, 2)) } catch (e) {}
        }
      } catch (e) {}
    }, 30000)
  }
  // v10.1 PLAN ITEM 9: WATER & DROWNING WATCHDOG. If Segs is in
  // water and its air is low (< 4) or it has been in water for more
  // than 5s, swim UP (hold jump) and move toward the nearest shore.
  // Runs every 1s. Drowning is a silent killer.
  let waterSince = 0
  let waterGoalAt = 0 // when the current shore goal was set (do not re-scan for 5s)
  let waterShore = null // the shore position Segs is swimming at
  let waterStuckSaid = false // said "stuck in the water" for this swim
  let waterGaveUp = false // 60s total cap hit — climb-out stops, no restart
  // v10.4.1: the watchdog only owns the controls WHILE it is driving
  // a swim. The old code cleared jump/forward/sprint every 200ms
  // whenever Segs was NOT in water — which silently killed every
  // other manual walk (drop-down, door assist, flee): the probe in
  // run 103 proved forward was cleared ~1s after the drop-down set
  // it, from this exact line, and Segs froze at z163.6. The
  // pathfinder survived only because it re-asserts forward every
  // 50ms physics tick. Fix: clear only if this watchdog was the one
  // driving (waterDriving), once, on exiting the water.
  let waterDriving = false
let waterClimbing = false // a waterClimbOut() is running — interval stays out of its way
let waterClimbLogAt = 0 // last water debug log (every 2s while swimming)
  // v10.3 WATER EXIT — rewritten. The pathfinder overwrites manual
  // control states every tick, and it cannot jump out of water onto
  // land (no water->land jump in its move set) — that is why 6
  // attempts (pathfinder, direct, combination) all stalled at the
  // edge. This version uses NO pathfinder goal: a FAST 200ms interval
  // re-asserts lookAt(shore) + forward + jump + sprint, so the
  // controls stay set. The pathfinder goal is cleared so it cannot
  // drive or override them.
  // v10.5 WATER DEBUG: what is straight ahead of Segs (facing
  // direction from yaw: forward = (-sin yaw, -cos yaw)), at feet and
  // head height, plus what is under its feet. Logged every 2s while
  // swimming so a stall can be diagnosed from bot.log.
  function aheadBlockInfo () {
    try {
      const p = bot.entity.position
      const yaw = bot.entity.yaw
      const dx = -Math.sin(yaw), dz = -Math.cos(yaw)
      const ax = Math.floor(p.x + dx), az = Math.floor(p.z + dz)
      const feet = bot.blockAt(new Vec3(ax, Math.floor(p.y), az))
      const head = bot.blockAt(new Vec3(ax, Math.floor(p.y) + 1, az))
      const below = bot.blockAt(new Vec3(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z)))
      return `feet-ahead=${feet ? feet.name : '?'} head-ahead=${head ? head.name : '?'} below-feet=${below ? below.name : '?'}`
    } catch (e) { return '?' }
  }
  // v10.5 WATER CLIMB-OUT (dedicated async climb). The fork's physics
  // only fires the out-of-liquid impulse (vel.y = 0.3) when Segs is
  // horizontally collided AND the space 0.6 above its feet is free of
  // blocks AND water — so feet must be up at the surface BEFORE Segs
  // drives into the shore. Phase 1: swim straight up (jump only, no
  // forward) for 1.5s so the feet rise to the surface. Phase 2: drive
  // forward + jump + sprint into the shore, re-facing every 100ms.
  // Phase 3: if the wall will not let Segs out, strafe along it
  // (left, then right) looking for a lower spot. The pathfinder goal
  // is cleared first so it cannot overwrite the controls mid-climb.
  // NEVER places blocks to climb out.
  async function waterClimbOut () {
    if (waterClimbing) return
    waterClimbing = true
    try {
      try { bot.pathfinder.setGoal(null) } catch (e) {}
      const pos0 = bot.entity.position.clone()
      // v10.5 run 106 fix: dy is the OUTER loop — a ground-level
      // shore (dy=0, top = water surface) in ANY direction beats a
      // 1-high ledge nearby. The old order (r/direction outer, dy
      // inner) picked the east dy=1 ledge at (-83,72,161) even
      // though its face is 2 high (feet-ahead stone AND head-ahead
      // stone) — Segs drove into it for 20s and gave up, four times.
      // A dy=0 shore is a 1-block step from the surface; a dy=1
      // shore is a 2-block climb and is only tried if no dy=0 shore
      // exists within 10 blocks in any direction.
      let shore = null
      outer:
      for (const dy of [0, 1, 2]) {
        for (let r = 1; r <= 10 && !shore; r++) {
          for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]) {
            const bx = Math.floor(pos0.x) + dx * r, by = Math.floor(pos0.y) + dy, bz = Math.floor(pos0.z) + dz * r
            const b = bot.blockAt(new Vec3(bx, by, bz))
            const above = bot.blockAt(new Vec3(bx, by + 1, bz))
            const above2 = bot.blockAt(new Vec3(bx, by + 2, bz))
            if (b && b.name !== 'water' && b.name !== 'air' && above && above.name === 'air' && above2 && above2.name === 'air') {
              shore = new Vec3(bx + 0.5, by + 1, bz + 0.5); break
            }
          }
          if (shore) break outer
        }
      }
      if (!shore) { logEvent('water', 'climb-out: no shore found within 10 blocks'); return }
      logEvent('water', `climb-out: shore at ${Math.round(shore.x)},${Math.round(shore.y)},${Math.round(shore.z)} — phase 1 swim up, phase 2 drive in`)
      // Phase 1: swim straight up, jump only — feet to the surface.
      try { bot.clearControlStates() } catch (e) {}
      bot.setControlState('jump', true)
      waterDriving = true
      await sleepMs(1500)
      // Phase 2/3: drive into the shore, re-facing every 100ms, up to 20s.
      const deadline = Date.now() + 20000
      let lastPos = bot.entity.position.clone(), lastMove = Date.now()
      let strafe = null // null = straight in, 'left' / 'right' = along the wall
      let strafeUntil = 0
      while (Date.now() < deadline) {
        if (!bot || !bot.entity || bot.health <= 0) break
        // v10.5: a jump apex briefly clears isInWater while Segs is
        // still OVER the pond — the old check declared success at
        // y=71.19 and Segs fell straight back in (run 104, three
        // climb-outs at spawn). Out means OUT: not in water AND
        // standing on solid ground.
        if (!bot.entity.isInWater && bot.entity.onGround) { logEvent('water', 'climb-out: OUT of the water at ' + bot.entity.position); return }
        const airLow = (bot.oxygenLevel != null && bot.oxygenLevel < 15)
        if (airLow) {
          // air first: swim straight up until the head is out
          bot.setControlState('jump', true)
          bot.setControlState('forward', false)
          bot.setControlState('left', false)
          bot.setControlState('right', false)
          await sleepMs(500)
          continue
        }
        const p = bot.entity.position
        try { bot.lookAt(new Vec3(shore.x, p.y + 0.5, shore.z)) } catch (e) {}
        bot.setControlState('forward', true)
        bot.setControlState('sprint', true)
        bot.setControlState('jump', true)
        waterDriving = true
        // phase 3: no progress in 2s — strafe along the wall for 2s
        if (p.distanceTo(lastPos) > 0.3) { lastPos = p.clone(); lastMove = Date.now() }
        if (Date.now() - lastMove > 2000) {
          if (Date.now() > strafeUntil) {
            strafe = strafe === 'left' ? 'right' : 'left'
            strafeUntil = Date.now() + 2000
            logEvent('water', 'climb-out: no progress, strafing ' + strafe + ' along the wall')
            lastMove = Date.now()
          }
        }
        bot.setControlState('left', strafe === 'left' && Date.now() < strafeUntil)
        bot.setControlState('right', strafe === 'right' && Date.now() < strafeUntil)
        await sleepMs(100)
      }
      logEvent('water', 'climb-out: gave up after 20s at ' + (bot.entity ? bot.entity.position : '?'))
    } finally {
      waterClimbing = false
      try { bot.setControlState('jump', false); bot.setControlState('forward', false); bot.setControlState('sprint', false); bot.setControlState('left', false); bot.setControlState('right', false) } catch (e) {}
      waterDriving = false
    }
  }
  let waterWatchdog = null
  function startWaterWatchdog () {
    if (waterWatchdog) return
    waterWatchdog = setInterval(() => {
      try {
        if (!connected || !bot || !bot.entity || bot.health <= 0) return
        if (inCombat()) return
        const inWater = bot.entity.isInWater
        if (!inWater) {
          // v10.4.1: only release controls the WATER watchdog itself
          // set. On land with waterDriving false, another system
          // (drop-down, door assist, flee, combat) owns forward —
          // clearing it here froze Segs mid-walk in run 103.
          // v10.5: a jump apex briefly clears isInWater while Segs is
          // still OVER the pond — do NOT clear waterClimbing on a
          // flicker, or a second climb-out starts on top of the first
          // (run 104: two climb-outs strafing opposite ways at once,
          // three starts in 30s at spawn). Only a real exit — standing
          // on the ground — ends the climb. Controls are only released
          // when the climb is not running.
          if (waterDriving && !waterClimbing) {
            try { bot.setControlState('jump', false); bot.setControlState('forward', false); bot.setControlState('sprint', false) } catch (e) {}
            waterDriving = false
          }
          if (bot.entity.onGround) waterClimbing = false
          waterSince = 0; waterGoalAt = 0; waterShore = null; waterStuckSaid = false; waterGaveUp = false
          return
        }
        if (!waterSince) { waterSince = Date.now(); waterStuckSaid = false; waterGaveUp = false }
        // v10.5 WATER DEBUG: log the exact state every 2s while swimming.
        if (Date.now() - waterClimbLogAt > 2000) {
          waterClimbLogAt = Date.now()
          try {
            const p = bot.entity.position
            const v = bot.entity.velocity
            logEvent('water', `in water: pos ${p.x.toFixed(1)},${p.y.toFixed(2)},${p.z.toFixed(1)} vel ${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)} collH=${!!bot.entity.isCollidedHorizontally} onGround=${!!bot.entity.onGround} ${aheadBlockInfo()}`)
          } catch (e) {}
        }
        // while a dedicated climb is running, the interval stays out
        // of its way (its air-low branch would kill the forward drive)
        if (waterClimbing) return
        // v10.5.3 (regression-127): while recovering a grave, Segs is
        // DELIBERATELY in the water (the grave is underwater) — the
        // watchdog's shore climb would fight the recovery goto and
        // drag him out before he reaches it, and the 20s stuck
        // message would fire while he is working. Stay out of the
        // way; only the air-low swim-up still runs so he never
        // drowns. The watchdog resumes the moment the recovery ends.
        if (recoveringGrave) {
          if (bot.oxygenLevel != null && bot.oxygenLevel < 15) {
            try { bot.setControlState('jump', true); bot.setControlState('forward', false); bot.setControlState('sprint', false) } catch (e) {}
            waterDriving = true
          }
          return
        }
        const airLow = (bot.oxygenLevel != null && bot.oxygenLevel < 15)
        // v10.3: stuck in the water 20s without getting out — say so
        // and ask for help (the fork cannot jump out of water onto a
        // vertical 1-block shore; Segs swims to the edge and stalls).
        if (!waterStuckSaid && Date.now() - waterSince > 20000) {
          waterStuckSaid = true
          say('im stuck in the water, i cant climb out — come get me or tell me to tp to you')
          logEvent('water', 'stuck in water 20s, asked owner for help')
        }
        if (!airLow && Date.now() - waterSince < 5000) return
        // Air low: swim STRAIGHT UP (jump only, no forward) until
        // the head is above water. Swimming forward while submerged
        // keeps the head under and Segs drowns (run 59: air hit -1).
        if (airLow) {
          bot.setControlState('jump', true)
          bot.setControlState('forward', false)
          bot.setControlState('sprint', false)
          waterDriving = true
          return
        }
        // v10.5.1 RIVER BUG: the climb-out used to loop 20s attempts
        // FOREVER (Tash: Segs stuck at a river edge for 5 minutes).
        // waterSince never resets while in water, so after each 20s
        // give-up the watchdog started another climb-out. Total cap:
        // after 60s in the water without getting out, STOP, clear the
        // goal (so no goto re-sets it), say exactly where/why, and
        // offer /tpa. Never restart the climb-out after this — the
        // owner decides (tp, or a bridge). The 60s goto progress
        // timeout is the backstop for walks; this is the water one.
        if (Date.now() - waterSince > 60000) {
          if (!waterGaveUp) {
            waterGaveUp = true
            try { bot.pathfinder.setGoal(null) } catch (e) {}
            try { bot.clearControlStates() } catch (e) {}
            say('im stuck in the water at ' + Math.round(bot.entity.position.x) + ',' + Math.round(bot.entity.position.y) + ',' + Math.round(bot.entity.position.z) + ' — i cant climb out, the shore is too steep. tell me to tp to you and ill come')
            logEvent('water', 'gave up after 60s in water, goal cleared, offered tpa')
          }
          return
        }
        // Air OK, still in water >5s: run the dedicated climb-out.
        // (v10.5: the old fire-and-forget drive stalled at the edge
        // in runs 66-68, 70, 67 — it drove forward while Segs' feet
        // were still deep, so the out-of-liquid impulse never fired.)
        waterClimbOut().catch(e => log('water climb: ' + e.message))
      } catch (e) {}
    }, 200)
  }
  // v10.1 PLAN ITEM 6: UNSTUCK WATCHDOG. If Segs has a pathfinder
  // goal but has not moved >0.5 blocks in 10s, it is stuck. Try:
  // jump, turn 90 degrees and walk, jump again. NEVER break a block
  // to get out (that is how the door got broken). After 3 tries, say
  // so and wait for the owner. Runs every 2s.
  let unstuckTries = 0
  let unstuckLastPos = null, unstuckLastMove = 0
  function startUnstuckWatchdog () {
    setInterval(() => {
      try {
        if (!connected || !bot || !bot.entity || bot.health <= 0) return
        if (inCombat() || fleeTimer) return
        // v10.5.1 (item 3): SKIP while a build is running. Segs
        // INTENTIONALLY stands still while placing (settle + place),
        // and the watchdog's jump/forward "unstick" moves it off its
        // stand point mid-place (run 113: 8 firings during the build,
        // each one disrupting the stand). The build's own moveCapped
        // handles stand moves; the watchdog has nothing to fix here.
        if (globalThis._autobuildRunning) return
        // v10.3: SKIP when Segs is in water — the water watchdog owns
        // water exits. The unstuck watchdog was firing at the water's
        // edge, fighting the climb-out, and clearing the goal after
        // 3 tries (run 67: "im stuck" while the water watchdog was
        // still trying to climb out).
        if (bot.entity.isInWater) return
        const goal = bot.pathfinder && bot.pathfinder.goal
        if (!goal) { unstuckLastPos = bot.entity.position.clone(); unstuckLastMove = Date.now(); unstuckTries = 0; return }
        const pos = bot.entity.position
        if (!unstuckLastPos || pos.distanceTo(unstuckLastPos) > 0.5) { unstuckLastPos = pos.clone(); unstuckLastMove = Date.now(); return }
        if (Date.now() - unstuckLastMove < 10000) return
        unstuckTries++
        logEvent('unstuck', 'stuck for 10s, try ' + unstuckTries)
        if (unstuckTries > 3) {
          say('im stuck and i cant get out without breaking something — come get me?')
          unstuckLastMove = Date.now(); unstuckTries = 0
          try { bot.pathfinder.setGoal(null) } catch (e) {}
          return
        }
        bot.setControlState('jump', true)
        setTimeout(() => { try { bot.setControlState('jump', false) } catch (e) {} }, 500)
        if (unstuckTries >= 2) {
          try { bot.lookAt(pos.clone().add(new (require('vec3').Vec3)(Math.cos(bot.entity.yaw + Math.PI / 2), 0, Math.sin(bot.entity.yaw + Math.PI / 2)))) } catch (e) {}
          bot.setControlState('forward', true)
          setTimeout(() => { try { bot.setControlState('forward', false) } catch (e) {} }, 1500)
        }
        unstuckLastMove = Date.now()
      } catch (e) {}
    }, 2000)
  }
  // v10: EDGE WATCHDOG — edge awareness for ALL movement, not just
  // flee. Runs every 500ms. Reads Segs' velocity (the direction it is
  // actually moving) and checks the ground ahead. A drop stops all
  // movement at once. Set up once the bot spawns (see the spawn block).
  // v10.4.1 PARKOUR: true while attemptDropDown is walking Segs off
  // a ledge on purpose — the edge watchdog must not stop it.
  let dropDownActive = false
  let edgeWatchdog = null
  function startEdgeWatchdog () {
    if (edgeWatchdog) return
    edgeWatchdog = setInterval(() => {
      try {
        if (!connected || !bot || !bot.entity || bot.health <= 0) return
        if (bot.isSleeping) return
        const vel = bot.entity.velocity
        if (!vel) return
        const speed = Math.hypot(vel.x, vel.z)
        if (speed < 0.5) return // not moving, nothing to check
        // v10.4.1 PARKOUR: during a manual drop-down (attemptDropDown
        // below) Segs is INTENTIONALLY walking off an edge — the
        // watchdog must not stop it mid-drop.
        if (dropDownActive) return
        const Vec3 = require('vec3').Vec3
        const dir = new Vec3(vel.x / speed, 0, vel.z / speed)
        // v10.5.1 (a): SLOW DOWN near edges. At sprint (5.6 blocks/s)
        // the slide after a stop carries Segs 1-2 blocks past the
        // detection point — run 107 fell off the platform edge even
        // though the watchdog fired. A drop within 5 blocks ahead
        // means walk only (4.3 blocks/s, much shorter slide); the
        // stop at 3 blocks below then has real margin. This caps
        // speed for ALL movement, not just the pathfinder, because
        // the watchdog owns the edge check.
        if (groundAhead(dir, 5) === 'drop') {
          try { bot.setControlState('sprint', false) } catch (e) {}
        }
        // v10.5 run 107 fix: look 3 blocks ahead, not 1.5. At sprint
        // (5.6 blocks/s) Segs covers 2.8 blocks per 500ms watchdog
        // tick, so a 1.5 lookahead never saw the platform edge — Segs
        // was already past it (BB off the edge, falling to y=63) by
        // the time the check ran. 3 blocks ahead gives 5+ ticks of
        // warning at sprint speed.
        if (groundAhead(dir, 3) === 'drop') {
          // v10.4.1 PARKOUR: drop ahead — is there a safe landing
          // within 3 blocks of FEET drop AND is Segs moving toward a
          // goal? Then step/jump down onto it instead of stopping.
          // Root cause of run 100: the old scan only looked d=1..3
          // blocks below the FEET for the landing BLOCK. A 3-block
          // feet drop has its landing block FOUR below the feet
          // (feet 76, landing feet 73, landing block 72), so the
          // scan never found it and Segs stopped at every real ledge.
          // Minecraft fall damage is floor(fallDistance - 3), so a
          // 3-block drop is exactly the safe maximum (0 damage); a
          // 4-block drop would cost 1 hp and is NOT jumped by the
          // watchdog — only the manual fallback below takes it, and
          // only after the pathfinder has already failed.
          const Vec3p = require('vec3').Vec3
          const aheadX = Math.floor(bot.entity.position.x + dir.x * 3)
          const aheadZ = Math.floor(bot.entity.position.z + dir.z * 3)
          let landing = null
          for (let d = 1; d <= 4; d++) {
            const b = bot.blockAt(new Vec3p(aheadX, Math.floor(bot.entity.position.y) - d, aheadZ))
            if (b && b.boundingBox === 'block') { landing = d - 1; break } // feet drop
            if (b && (b.name === 'lava' || b.name === 'water')) break
          }
          const hasGoal = !!(bot.pathfinder && bot.pathfinder.goal)
          if (landing != null && landing <= 3 && hasGoal) {
            bot.setControlState('jump', true)
            setTimeout(() => { try { bot.setControlState('jump', false) } catch (e) {} }, 500)
            logEvent('parkour', 'drop ahead, safe landing ' + landing + ' below — jumping down')
            return
          }
          // about to walk off an edge — STOP everything at once
          try { bot.pathfinder.setGoal(null) } catch (e) {}
          try { bot.clearControlStates() } catch (e) {}
          stopFlee()
          logEvent('edge', 'edge ahead while moving — stopped (velocity ' + speed.toFixed(1) + ')')
          if (Date.now() - (globalThis._lastEdgeSay || 0) > 10000) {
            globalThis._lastEdgeSay = Date.now()
            say('wait — edge ahead, i stopped so i dont fall')
          }
        }
      } catch (e) {}
    }, 150)
  }

  let fleeTimer = null
  let fleeLastPos = null, fleeLastMove = 0
  function stopFlee (why) {
    if (fleeTimer) { clearInterval(fleeTimer); fleeTimer = null }
    if (why) logEvent('evade', 'flee stopped: ' + why)
    try { bot.clearControlStates() } catch (e) {}
  }
  function startFlee (mob) {
    if (fleeTimer) return
    stopAllMovement()
    if (Date.now() - lastEvadeSay > 30000) { lastEvadeSay = Date.now(); say(`${mob.name} nearby, moving away`) }
    logEvent('evade', `fleeing ${mob.name} at ${Math.round(bot.entity.position.distanceTo(mob.position))} blocks`)
    fleeLastPos = bot.entity.position.clone(); fleeLastMove = Date.now()
    fleeTimer = setInterval(() => {
      try {
        // Never flee on stale state: while disconnected bot.entity and
        // bot.entities are frozen, and a bad lookAt there once poisoned
        // Segs' yaw with NaN (run 27) so the server kept kicking it.
        if (!connected) { stopFlee('not connected'); return }
        if (!bot || !bot.entity) { stopFlee('no entity'); return }
        if (bot.health <= 0) { stopFlee('dead'); return }
        if (bot.isSleeping || guardMode) { stopFlee('sleeping/guarding'); return }
        const m = nearestHostile(12)
        if (!m) { stopFlee('clear, no hostile within 12'); return }
        const pos = bot.entity.position
        if (!pos || !isFinite(pos.x) || !isFinite(pos.y) || !isFinite(pos.z)) { stopFlee('bad position'); return }
        let away = pos.clone().subtract(m.position)
        away.y = 0 // flee horizontally — a mob below/above must not point Segs at the sky
        // v10.1 PLAN ITEM 7 (creeper rule): NEVER lead a creeper to
        // the owner or the house. If the away direction points
        // toward the owner or the permanent home, flip it — flee
        // away from BOTH.
        if (m.name === 'creeper') {
          const ownerEnt = bot.players[OWNER] && bot.players[OWNER].entity
          const home = brain.permanentHome
          let bad = false
          if (ownerEnt) {
            const toOwner = ownerEnt.position.clone().subtract(pos); toOwner.y = 0
            if (toOwner.distanceTo(new Vec3(0, 0, 0)) > 0.1 && away.angleTo(toOwner) < Math.PI / 2) bad = true
          }
          if (!bad && home) {
            const toHome = new Vec3(home.x - pos.x, 0, home.z - pos.z)
            if (toHome.distanceTo(new Vec3(0, 0, 0)) > 0.1 && away.angleTo(toHome) < Math.PI / 2) bad = true
          }
          if (bad) { away = away.scale(-1); logEvent('evade', 'creeper flee flipped — away from owner/home') }
        }
        // If the mob is exactly on top of Segs the vector is (0,0,0) and
        // normalize() gives NaN — run away in the direction Segs faces.
        const Vec3 = require('vec3').Vec3
        if (!isFinite(away.x) || !isFinite(away.z) || away.distanceTo(new Vec3(0, 0, 0)) < 0.1) {
          away = new Vec3(-Math.sin(bot.entity.yaw), 0, -Math.cos(bot.entity.yaw))
        } else { away = away.normalize() }
        let target = pos.clone().add(away.clone().scale(10))
        if (!isFinite(target.x) || !isFinite(target.z)) { logEvent('evade', `bad target: pos=${pos} away=${away} mobPos=${m.position} yaw=${bot.entity.yaw} mob=${m.name}@${m.position}`); stopFlee('bad target'); return }
        // v9.4: EDGE CHECK. If the flee direction runs off a drop, try
        // the other directions; if none is safe, stand still this tick.
        if (groundAhead(away) === 'drop') {
          let safeDir = null
          for (const deg of [45, -45, 90, -90, 135, -135, 180]) {
            const rot = rotateDir(away, deg)
            if (groundAhead(rot) === 'safe') { safeDir = rot; break }
          }
          if (!safeDir) {
            logEvent('evade', 'no safe flee direction (edge) — holding still')
            bot.setControlState('forward', false)
            bot.setControlState('sprint', false)
            bot.setControlState('jump', false)
            return
          }
          away = safeDir
          target = pos.clone().add(safeDir.clone().scale(10))
        }
        bot.lookAt(target)
        bot.setControlState('forward', true)
        bot.setControlState('sprint', true)
        // v10.1 PLAN ITEM 8 (mob-by-mob flee): skeleton/witch zigzag
        // (their shots are aimed); enderman look DOWN and walk away
        // slowly (never look at it, never sprint); spider sprint.
        if (m.name === 'skeleton' || m.name === 'stray' || m.name === 'witch') {
          const zig = (Date.now() / 300 | 0) % 2 === 0
          bot.setControlState('left', zig); bot.setControlState('right', !zig)
        }
        if (m.name === 'enderman') {
          bot.setControlState('sprint', false)
          try { bot.lookAt(pos.clone().add(new Vec3(0, -2, 0))) } catch (e) {}
        }
        // Sprint only, no held jump: bunny-hopping tripped Paper's
        // "moved too quickly" in run 27. Jump only in a short pulse
        // when Segs is stuck against a step (hasn't moved in 750ms).
        if (fleeLastPos && pos.distanceTo(fleeLastPos) > 0.5) { fleeLastPos = pos.clone(); fleeLastMove = Date.now(); bot.setControlState('jump', false) }
        else if (Date.now() - fleeLastMove > 750) { bot.setControlState('jump', true); setTimeout(() => { try { bot.setControlState('jump', false) } catch (e) {} }, 400) }
      } catch (e) { stopFlee('error: ' + (e && e.message ? e.message : e)) }
    }, 250)
  }
  async function evadeTick () {
    try {
      if (!connected || !bot || !bot.entity || bot.health <= 0 || bot.isSleeping) return
      if (guardMode) return
      if (inCombat()) return // fighting owns movement; the combat loop handles it
      // Armed + autoDefend ON = Segs FIGHTS, it does not flee. Let the
      // combat system own the mob. Flee only when Segs cannot fight.
      if (config.autoDefend) {
        const hasWeapon = bot.inventory.items().some(i => i.name.endsWith('_sword') || i.name.endsWith('_axe'))
        if (hasWeapon) return
      }
      if (fleeTimer) return // already fleeing; the loop steers itself
      const job = currentJob()
      const mob = nearestHostile(job === 'idle, waiting for you' ? 8 : 4)
      if (!mob) return
      startFlee(mob)
    } catch (e) {}
  }

  // ---- v8: grave recovery (SimpleGraves) ----
  // The grave sits at the death spot for 10 minutes. After respawn Segs
  // walks back, finds the grave block (chest-like), and shift+right-clicks
  // it — that takes everything back at once, inventory as it was at death.
  // If it cannot reach the spot or cannot find the grave, it says the
  // coords in chat so the owner knows where the stuff is.
  // v10.5.1 GRAVE FIX: the old version only matched chest /
  // trapped_chest / player_head / barrel within 5 blocks of SEGS,
  // and returned null while standing ON the grave (real server
  // 2026-11-08: 3 failures at the death spot). SimpleGraves places
  // the chest AT OR NEAR the death spot — underwater, a few blocks
  // off, or on the nearest dry land — and adds a wall-sign headstone.
  // So scan a cube around the DEATH SPOT (radius 8, y -3..+3, so
  // underwater graves count), prefer chest-like blocks, fall back to
  // the headstone sign (the chest sits next to it), and if NOTHING is
  // found, LOG every solid block within 5 of the death spot — the
  // next real-server failure must be diagnosable, not "cant see it".
  function findGraveBlock (deathPos) {
    try {
      const Vec3 = require('vec3').Vec3
      const graveNames = new Set(['chest', 'trapped_chest', 'player_head', 'barrel', 'ender_chest'])
      const isChestLike = b => b && (graveNames.has(b.name) || b.name.endsWith('_shulker_box'))
      const isSign = b => b && (b.name.endsWith('_sign') || b.name.endsWith('_wall_sign'))
      const cx = deathPos[0], cy = deathPos[1], cz = deathPos[2]
      let best = null, bestD = 1e9
      for (let dx = -8; dx <= 8; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -8; dz <= 8; dz++) {
        const b = bot.blockAt(new Vec3(cx + dx, cy + dy, cz + dz))
        if (!isChestLike(b)) continue
        const d = Math.abs(dx) + Math.abs(dy) + Math.abs(dz)
        if (d < bestD) { bestD = d; best = b }
      }
      if (best) { logEvent('grave', 'grave block found: ' + best.name + ' at ' + best.position + ' (' + bestD + ' from death spot)'); return best }
      // No chest-like block: look for the headstone sign, then a chest
      // next to it (SimpleGraves puts a wall sign with name/date/coords).
      for (let dx = -8; dx <= 8; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -8; dz <= 8; dz++) {
        const b = bot.blockAt(new Vec3(cx + dx, cy + dy, cz + dz))
        if (!isSign(b)) continue
        logEvent('grave', 'headstone sign found at ' + b.position + ' — looking for the chest next to it')
        for (const [ox, oy, oz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0]]) {
          const n = bot.blockAt(new Vec3(cx + dx + ox, cy + dy + oy, cz + dz + oz))
          if (isChestLike(n)) { logEvent('grave', 'grave block found next to sign: ' + n.name + ' at ' + n.position); return n }
        }
      }
      // Diagnostic: every solid block within 5 of the death spot, so
      // the next failure shows exactly what IS there (chest? dirt?
      // nothing but water?). Cap at 40 entries.
      const seen = []
      for (let dx = -5; dx <= 5; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -5; dz <= 5; dz++) {
        const b = bot.blockAt(new Vec3(cx + dx, cy + dy, cz + dz))
        if (b && b.name !== 'air' && b.name !== 'water' && b.name !== 'cave_air') seen.push(b.name + '@' + (cx + dx) + ',' + (cy + dy) + ',' + (cz + dz))
      }
      logEvent('grave', 'NO grave block near ' + deathPos.join(',') + ' — solid blocks within 5: ' + (seen.slice(0, 40).join(' | ') || 'none (all air/water)'))
      return null
    } catch (e) { return null }
  }
  // v10.5.1 GRAVE FIX: a failed recovery must NOT mark the grave
  // recovered — the old code did that on "cant reach" and "cant see
  // it", so the FIRST failure killed all auto-retries and only a
  // manual command tried again. Retry every 60s while the grave is
  // fresh (<9.5 min), reporting the time left each time.
  function scheduleGraveRetry () {
    try {
      setTimeout(() => {
        try {
          if (bot && bot.entity && bot.health > 0 && brain.lastGrave && !brain.lastGrave.recovered && Date.now() - brain.lastGrave.at < 9.5 * 60 * 1000) {
            recoverGrave().catch(e => log('grave retry: ' + e.message))
          }
        } catch (e) {}
      }, 60000)
    } catch (e) {}
  }
  async function recoverGrave (manual) {
    if (recoveringGrave) return false
    const g = brain.lastGrave
    if (!g) { if (manual) say('i dont have a grave to go back to'); return false }
    const ageMin = (Date.now() - g.at) / 60000
    if (ageMin > 10) { if (manual) say('that grave is gone by now, graves only last 10 minutes'); brain.lastGrave.recovered = true; saveBrain(); return false }
    if (g.recovered && !manual) return false
    if (g.dimension && bot.game && bot.game.dimension && g.dimension !== bot.game.dimension) {
      say(`i died in ${g.dimension.replace('minecraft:', '')} at ${g.pos.join(', ')} — i cant walk there from here`)
      brain.lastGrave.recovered = true; saveBrain(); return false
    }
    recoveringGrave = true
    // v10.5.1 GRAVE FIX: NEVER dig on the grave path. The pathfinder
    // has canDig=true, and the old code let it dig through the
    // riverbank/grass to reach an underwater grave (the hole in
    // Tash's screenshots). canDig=false for the whole recovery — the
    // A* routes around or fails honestly, it never breaks a block.
    const savedGraveCanDig = pathMovements ? pathMovements.canDig : true
    if (pathMovements) pathMovements.canDig = false
    try {
      say(`i died at ${g.pos.join(', ')} — going back for my stuff`)
      logEvent('grave', `recovering grave at ${g.pos.join(', ')}, died ${Math.round(ageMin)} min ago, ${Math.max(0, Math.round(10 - ageMin))} min left`)
      // v10.5.3 (regression-127): the grave may be UNDERWATER — pass
      // allowWater so the A* can route through the river to it (the
      // run-148 water prevention would otherwise refuse and the grave
      // would expire with Segs' stuff in it). Every other goto keeps
      // the prevention.
      const arrived = await gotoPos(new Vec3(g.pos[0], g.pos[1], g.pos[2]), { allowWater: true })
      if (!arrived) { say(`i cant reach my grave at ${g.pos.join(', ')} — my stuff is there, ${Math.max(0, Math.round(10 - ageMin))} minutes left on it, ill try again in a minute`); scheduleGraveRetry(); return false }
      const grave = findGraveBlock(g.pos)
      if (!grave) { say(`im at the spot where i died (${g.pos.join(', ')}) but i cant see my grave — it should be right here, ${Math.max(0, Math.round(10 - ageMin))} minutes left on it, ill try again in a minute`); scheduleGraveRetry(); return false }
      // Take everything out of the grave. PRIMARY (Tash's way): the
      // plugin's own shortcut — sneak + right-click the grave block
      // claims everything. Do that FIRST, then check the inventory:
      // if items arrived, the take-all worked and we are done. If it
      // opened a window instead (plain chest, no plugin) or nothing
      // arrived, fall back to opening it as a chest and withdrawing
      // every stack by hand. (Old code did openChest first and only
      // tried sneak+click if that threw — backwards.)
      const countItems = () => bot.inventory.items().reduce((a, it) => a + it.count, 0)
      const beforeCount = countItems()
      let took = 0
      let opened = false
      try {
        bot.setControlState('sneak', true); await sleepMs(200)
        await bot.activateBlock(grave); await sleepMs(1200)
      } catch (e) { log('grave sneak+click: ' + e.message) }
      try { bot.setControlState('sneak', false) } catch (e) {}
      took = countItems() - beforeCount
      logEvent('grave', 'sneak+right-click take-all: inventory +' + took + ' items' + (bot.currentWindow ? ' (a window opened)' : ''))
      // If a window opened (plain chest), withdraw every stack from it.
      if (bot.currentWindow) {
        opened = true
        const win = bot.currentWindow
        const items = win.containerItems().filter(Boolean)
        for (const it of items) {
          try { await win.withdraw(it.type, it.metadata, it.count); took += it.count } catch (e) { log('grave withdraw failed for ' + it.name + ': ' + e.message) }
        }
        try { win.close() } catch (e) {}
      }
      if (took <= 0) {
        // Take-all did not fire and no window opened: open it as a
        // chest and withdraw every stack by hand.
        try {
          const win = await bot.openChest(grave)
          opened = true
          const items = win.containerItems().filter(Boolean)
          for (const it of items) {
            try { await win.withdraw(it.type, it.metadata, it.count); took += it.count } catch (e) { log('grave withdraw failed for ' + it.name + ': ' + e.message) }
          }
          try { win.close() } catch (e) {}
        } catch (e) { log('grave openChest failed (' + e.message + ')') }
      }
      log('grave: window opened=' + opened + ', took ' + took + ' item(s)')
      const afterCount = countItems()
      // Only mark recovered when items were actually taken (or the
      // grave was opened and confirmed empty). A failed take-all
      // leaves it unrecovered so the retry keeps trying.
      if (took > 0 || opened) {
        brain.lastGrave.recovered = true; saveBrain()
        bumpStat('graves', 1)
        say(took > 0 ? 'got my stuff back from my grave (' + took + ' items)' : 'opened my grave — check if my stuff is back, it should all be there')
        logEvent('grave', `grave recovered at ${g.pos.join(', ')}, took ${took} items, inventory ${beforeCount} -> ${afterCount}`)
        return true
      }
      say(`i found my grave at ${grave.position} but i couldnt get my stuff out — ${Math.max(0, Math.round(10 - ageMin))} minutes left on it, ill try again in a minute`)
      logEvent('grave', `grave take-all failed at ${grave.position}, took 0, retrying in 60s`)
      scheduleGraveRetry()
      return false
    } finally { recoveringGrave = false; if (pathMovements) pathMovements.canDig = savedGraveCanDig }
  }

  function stopAllMovement () {
    moveToken++
    following = null
    stopFarming()
    stopAfk()
    stopFlee()
    stopCombat()
    try { bot.pathfinder.setGoal(null) } catch (e) {}
    try { bot.pvp.stop() } catch (e) {}
  }

  // ---- v7: SERVER COMMANDS (player commands only — no LP ranks on the server) ----
  // youniga plugins: AuthMe, CoreProtect, CreeperBlockProtection, HomePlugin,
  // packetevents, SimpleGraves, SkinsRestorer, SmoothChat. No LuckPerms, so
  // Segs can only use PLAYER commands: /login, /tpa, /tpaccept, /sethome,
  // /home, /delhome. It never tries /tp, /give or /gamemode (those need op).
  // Every server command goes through here so it is logged in logs/.
  function serverCmd (cmd) {
    try { bot.chat(cmd); logEvent('server-cmd', cmd) } catch (e) { log('server cmd failed: ' + e.message) }
  }
  // Try a server /home teleport. Returns true if Segs actually moved
  // (teleported). The server only has /home in the overworld and only 3
  // homes per player, so anything can fail — the caller walks instead.
  async function tryServerHome (name) {
    // v8: /home has a 3-second warmup and ANY movement cancels the
    // teleport, so stand perfectly still first — stop everything, clear
    // all control states — then wait 3.5s (warmup + a little server lag)
    // before checking whether Segs actually moved. Never send bare /home:
    // that opens a GUI on this server, only /home <name> teleports.
    stopAllMovement()
    try { bot.clearControlStates() } catch (e) {}
    const before = bot.entity.position.clone()
    pendingHome = { name, at: Date.now(), started: false, cancelled: false }
    serverCmd(`/home ${name}`)
    await sleepMs(3500)
    const moved = bot.entity.position.distanceTo(before) > 2
    const cancelled = pendingHome && pendingHome.cancelled
    pendingHome = null
    if (cancelled) { logEvent('home', `/home ${name} warmup cancelled — Segs moved`); return false }
    if (moved) logEvent('home', `teleported to /home ${name}`)
    else logEvent('home', `/home ${name} did not teleport (no such home, or the warmup never started)`)
    return moved
  }
  // Auto-accept a /tpa request from the owner. The exact message depends on
  // the server's TPA plugin, so match flexibly: it must mention teleport +
  // accept + the owner's name. Only the owner, never anyone else.
  // (v7 fix: the same request arrives via BOTH the 'chat' and 'messagestr'
  // events, so without a cooldown Segs accepted twice and said so twice.)
  let lastTpaAccept = 0
  function maybeAcceptTpa (text) {
    const lower = (text || '').toLowerCase()
    if (!lower.includes('teleport')) return false
    if (!lower.includes('tpaccept') && !lower.includes('accept')) return false
    if (!lower.includes(OWNER)) return false
    if (Date.now() - lastTpaAccept < 10000) return true // already accepted, swallow the duplicate
    lastTpaAccept = Date.now()
    serverCmd(`/tpaccept ${config.owner}`)
    say('accepted your tpa, coming to you')
    logEvent('tpa', 'auto-accepted /tpa from ' + config.owner)
    return true
  }

  // A goto that gives up instead of hanging forever. The pathfinder can
  // stall indefinitely (stuck in water, behind a wall, recalculating) —
  // run 13 proved a 29-block walk can hang 134s with no error at all.
  // Race each attempt against a timeout and cancel the goal on timeout,
  // so a stuck walk fails honestly instead of blocking the whole queue.
  // v10.5.1 RIVER BUG: no walk may sit stuck for 5 minutes silently.
  // gotoPos sets this at the start of a walk (the MAIN goal, not the
  // phase goal); gotoWithTimeout aborts any phase if Segs has made
  // <2 blocks progress toward the main goal in 60s. The old unstuck
  // watchdog could not do this: it skips in water (by design) and
  // resets on any >0.5-block jiggle (swimming/bobbing at a river edge
  // resets it forever), and the water climb-out looped 20s attempts
  // forever without ever stopping. This tracker is goal-progress, not
  // movement — bobbing in place is still stuck.
  let gotoMainGoal = null, gotoMainStartDist = 0, gotoMainStartTime = 0, gotoMainStartY = null
  async function gotoWithTimeout (goal, ms = 25000) {
    let timer, progTimer
    try {
      await Promise.race([
        bot.pathfinder.goto(goal),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('goto timeout after ' + ms + 'ms')), ms) }),
        new Promise((_, reject) => {
          progTimer = setInterval(() => {
            try {
              if (!bot || !bot.entity || !gotoMainGoal) return
              // v10.5.1 RUN 125: abort the moment Segs ENTERS water
              // mid-walk to a DRY goal. The A* routes through a shallow
              // river on its bottom (feet on stone, water at head level
              // — blocksToAvoid only blocks standing ON water), so
              // without this Segs walks into the river and sits there
              // until the 25s timeout. A goal that is itself in water
              // (a grave, a target) is allowed — only a dry goal aborts.
              // Also abort if Segs has FALLEN more than 2 blocks below
              // the goto start height while the goal is at the same
              // height (it walked down into a river trench / pit — the
              // water is above its head there, so isInWater is false
              // and the water check alone never fires; run 125).
              // v10.5.3 (run 127 retest): NOT for a grave goto — the
              // goal is a CHEST sitting in water, not a water block,
              // so the goalInWater test above reads "dry" and aborts
              // the recovery the moment Segs enters the river (the
              // batch-127 run failed exactly this way: "entered water
              // on the way to a dry goal" 2s into the allowWater goto,
              // even though the water route was deliberately allowed).
              // gotoAllowWater is set only by gotoPos({ allowWater:
              // true }) — grave recovery — and the wrapper restores
              // it, so every other goto keeps the abort.
              if (bot.entity.isInWater && !gotoAllowWater) {
                try {
                  const gb = bot.blockAt(new (require('vec3').Vec3)(Math.floor(gotoMainGoal.x), Math.floor(gotoMainGoal.y), Math.floor(gotoMainGoal.z)))
                  const gb2 = bot.blockAt(new (require('vec3').Vec3)(Math.floor(gotoMainGoal.x), Math.floor(gotoMainGoal.y) - 1, Math.floor(gotoMainGoal.z)))
                  const goalInWater = (gb && gb.name === 'water') || (gb2 && gb2.name === 'water')
                  if (!goalInWater) {
                    reject(new Error('entered water on the way to a dry goal — the way goes through water and i cant climb out of it'))
                  }
                } catch (e) { /* block read failed, keep walking */ }
              }
              // v10.5.3 (run 127 retest): same gate for the pit-drop
              // abort — a grave can sit below the bank (the riverbed),
              // so dropping toward it is the route, not a trap.
              if (!gotoAllowWater && gotoMainStartY != null && Math.abs(gotoMainGoal.y - gotoMainStartY) <= 1 && bot.entity.position.y < gotoMainStartY - 2) {
                reject(new Error('fell into a pit/river on the way to a dry goal (dropped to y=' + bot.entity.position.y.toFixed(1) + ' from y=' + gotoMainStartY + ') — the way goes through water and i cant climb out of it'))
              }
              if (Date.now() - gotoMainStartTime < 60000) return
              const d = Math.hypot(gotoMainGoal.x - bot.entity.position.x, gotoMainGoal.z - bot.entity.position.z)
              if (gotoMainStartDist - d < 2) {
                reject(new Error('no progress toward goal in 60s (stuck at ' + bot.entity.position + ', ' + d.toFixed(1) + ' from goal)'))
              }
            } catch (e) {}
          }, 2000)
        })
      ])
    } catch (e) {
      try { bot.pathfinder.setGoal(null) } catch (_) {}
      throw e
    } finally { clearTimeout(timer); if (progTimer) clearInterval(progTimer) }
  }

  // Returns true if Segs got within 2 blocks of pos, false otherwise.
  // Long walks fail when the goal sits in unloaded chunks (the pathfinder
  // plans the whole route up front and view distance is only 5), so a
  // failed direct walk is retried in 16-block stages toward the goal —
  // chunks load as Segs moves. Callers MUST check the result: never
  // announce arrival on false (run 11 proved both "made it" and "at home"
  // were said after walks that never arrived).
  // v9.4: DOOR ASSIST. The fork's A* cannot route through a 2-block door:
  // getMoveForward only "opens" the feet-level block and always tries to
  // break the head-level block, so a door is either broken (v9.3) or
  // impassable (v9.4 first try). When a goto fails, look for a wooden door
  // nearby, open it, and walk straight through it with direct movement
  // (the open doorway IS walkable — the pathfinder just cannot plan it).
  // Returns true if Segs got through a door.
  async function tryDoorAssist (goalPos) {
    try {
      if (!bot || !bot.entity) return false
      const Vec3 = require('vec3').Vec3
      const door = bot.findBlock({
        matching: b => b && b.name && b.name.endsWith('_door') && !b.name.startsWith('iron') && !b.name.includes('trapdoor'),
        // v10.5.1 (item 4): 6 blocks, not 4. Run 57 retest: Segs
        // presses the house's WEST wall 4.8 blocks from the door, so
        // a 4-block search finds no door and the assist never runs.
        maxDistance: 6
      })
      if (!door) return false
      const pos = bot.entity.position
      const dp = new Vec3(door.position.x + 0.5, door.position.y, door.position.z + 0.5)
      try {
        const props = door.getProperties ? door.getProperties() : {}
        if (props.open === false) {
          await bot.activateBlock(door)
          await sleepMs(400)
        }
      } catch (e) {}
      // walk straight through: aim 2 blocks past the door, away from Segs.
      // FIRST clear the pathfinder goal — while a GoalFollow is active the
      // pathfinder owns the movement keys and overrides the direct
      // forward/sprint states, so the walk-through goes nowhere (run 48:
      // moved 0.0-0.2 blocks). The caller re-sets its goal afterwards.
      try { bot.pathfinder.setGoal(null) } catch (e) {}
      try { bot.clearControlStates() } catch (e) {}
      const through = new Vec3(dp.x - pos.x, 0, dp.z - pos.z)
      if (through.distanceTo(new Vec3(0, 0, 0)) < 0.1) return false
      through.normalize()
      // v10.5.1 (item 4): through the DOORWAY, not along the approach.
      // The old `through` was (door - Segs), so a Segs approaching from
      // the west got a through-direction pointing EAST — the walk aimed
      // 2 blocks east of the door, along the south wall, and Segs ended
      // up at the house's east wall (run 57: staging worked, walk went
      // east, beyond -0.7). Through a door means: from the door toward
      // the GOAL (the owner / the goto target), which is on the other
      // side of the wall. Recompute from goalPos when it is given.
      if (goalPos) {
        const gx = goalPos.x - dp.x, gz = goalPos.z - dp.z
        if (Math.hypot(gx, gz) > 0.5) {
          through.x = gx / Math.hypot(gx, gz)
          through.z = gz / Math.hypot(gx, gz)
        }
      }
      // v10.5.1 (item 4): STAGE to the door first. The walk-through from
      // 4.8 blocks away never moves (run 57: Segs floats at the jump apex
      // and forward has no traction over that distance). Route Segs to a
      // point 1.5 blocks in front of the door on ITS side first — the A*
      // CAN route to open ground in front of a door (no door in the way),
      // and from 1.5 blocks the walk-through is a short, grounded step.
      // The staging point is door centre minus 1.5 * through-direction.
      const doorDist = Math.hypot(dp.x - pos.x, dp.z - pos.z)
      if (doorDist > 2.5) {
        const stage = new Vec3(dp.x - through.x * 1.5, dp.y, dp.z - through.z * 1.5)
        logEvent('door', `door assist: staging to ${stage} (door ${doorDist.toFixed(1)} away)`)
        // Tight radius 0.3, not 1: the open door's panel is a thin slab
        // at the block's west edge (x -90.0..-89.81), and Segs' 0.6-wide
        // body must be centred on the doorway's clear part (x -89.5) to
        // pass — a 1-block radius let it stop at x=-90.26, clipping the
        // panel, and the walk then moved 0.0 blocks (run 57).
        try { await gotoWithTimeout(new goals.GoalNear(stage.x, stage.y, stage.z, 0.3), 10000) } catch (e) { log('door assist: staging failed: ' + e.message) }
        try { bot.pathfinder.setGoal(null) } catch (e) {}
        try { bot.clearControlStates() } catch (e) {}
      }
      const past = dp.clone().add(through.clone().scale(2))
      const startPos = pos.clone()
      // v10.5.1 (item 4): LAND FIRST. Run 57 retest: Segs floats at
      // y=71.42 (onG=false, server pins the jump apex) while the walk
      // runs, so forward has no traction (vel ~0.01-0.05, 0.0 blocks
      // in 5s). Clear jump, stop, and wait up to 2s for onGround
      // before walking — a walk only works on the ground.
      try { bot.clearControlStates() } catch (e) {}
      const landT0 = Date.now()
      while (Date.now() - landT0 < 2000) {
        if (bot.entity && bot.entity.onGround) break
        await sleepMs(100)
      }
      bot.lookAt(new Vec3(past.x, pos.y + 1, past.z))
      bot.setControlState('forward', true)
      // sprint, not walk — more speed and better air control if Segs
      // does get bounced, and the 6-block radius needs the pace.
      bot.setControlState('sprint', true)
      const t0 = Date.now()
      // v10.5.1 (item 4): walk until PAST the door, not just 1.5
      // blocks from the start. The old break (`moved > 1.5`) stopped
      // Segs 1.5 blocks in from a door 4.8 blocks away — still
      // outside the house, and it returned true (moved > 1.5) even
      // though it never got through. Past means: Segs is 0.5+ blocks
      // beyond the door centre in the through-direction. 8s cap covers
      // the turn + the walk from the full 6-block search radius.
      while (Date.now() - t0 < 8000) {
        await sleepMs(200)
        if (!bot || !bot.entity || bot.health <= 0) break
        const cur = bot.entity.position
        const beyond = (cur.x - dp.x) * through.x + (cur.z - dp.z) * through.z
        // re-assert the walk every tick — a stale jump pulse or a
        // watchdog must not cancel forward or re-launch Segs mid-walk.
        try { bot.setControlState('forward', true); bot.setControlState('sprint', true); bot.setControlState('jump', false) } catch (e) {}
        if (beyond > 0.5) break
        bot.lookAt(new Vec3(past.x, bot.entity.position.y + 1, past.z))
      }
      bot.setControlState('forward', false)
      const moved = bot.entity ? bot.entity.position.distanceTo(startPos) : 0
      const beyond = bot.entity ? (bot.entity.position.x - dp.x) * through.x + (bot.entity.position.z - dp.z) * through.z : -99
      logEvent('door', `door assist: moved ${moved.toFixed(1)} blocks, beyond door ${beyond.toFixed(1)} — through door at ${door.position}`)
      return beyond > 0.5
    } catch (e) { return false }
  }
  // v10.4.1 PARKOUR — MANUAL DROP-DOWN (the different approach for
  // run 100). Why the pathfinder refuses a 3-block drop: its
  // Movements.getLandingBlock measures node.y - landing BLOCK.y
  // against maxDropDown (4) — a 3-block FEET drop is a 4-block
  // difference to the landing block, so it only just passes, and a
  // 4-block feet drop (diff 5) can NEVER be routed, however safe the
  // landing is; the A* then explores the whole platform and times
  // out ("Took to long to decide path to goal!", run 100). A human
  // does not pathfind off a ledge — they walk to the edge and step
  // off. This does exactly that, with NO pathfinder goal at all:
  // clear the goal, face the target, walk forward off the edge and
  // let gravity do the drop. Walk, do NOT jump: jumping adds ~1.25
  // blocks of height, turning a 3-block drop into a ~4.25 fall
  // (1 hp damage). Only used when the target is 1-4 blocks below
  // and within 12 blocks horizontally, the landing is solid ground
  // (not lava/water/void), and there is headroom at the target.
  // Returns true if Segs landed within 2 blocks of the target.
  async function attemptDropDown (targetPos) {
    try {
      if (!bot || !bot.entity || bot.health <= 0) return false
      const Vec3 = require('vec3').Vec3
      const from = bot.entity.position.clone()
      const drop = from.y - targetPos.y
      const horiz = Math.hypot(targetPos.x - from.x, targetPos.z - from.z)
      if (drop < 1 || drop > 4 || horiz < 0.5 || horiz > 12) return false
      const tx = Math.floor(targetPos.x), tz = Math.floor(targetPos.z)
      const ty = Math.floor(targetPos.y)
      const land = bot.blockAt(new Vec3(tx, ty - 1, tz))
      const feet = bot.blockAt(new Vec3(tx, ty, tz))
      const head = bot.blockAt(new Vec3(tx, ty + 1, tz))
      const solid = b => b && b.boundingBox === 'block'
      const clear = b => !b || b.boundingBox !== 'block'
      if (!solid(land) || !clear(feet) || !clear(head)) return false
      if (land.name === 'lava' || land.name === 'water') return false
      logEvent('parkour', `drop-down: walking off a ${drop.toFixed(1)}-block drop toward ${tx},${ty},${tz} (no pathfinder goal)`)
      dropDownActive = true
      try { bot.pathfinder.setGoal(null) } catch (e) {}
      try { bot.clearControlStates() } catch (e) {}
      try { await bot.lookAt(new Vec3(targetPos.x, from.y, targetPos.z)) } catch (e) {}
      bot.setControlState('forward', true)
      if (horiz > 4) bot.setControlState('sprint', true)
      const start = Date.now()
      while (Date.now() - start < 12000) {
        if (!bot || !bot.entity || bot.health <= 0) break
        const p = bot.entity.position
        const dHoriz = Math.hypot(targetPos.x - p.x, targetPos.z - p.z)
        if (p.y <= targetPos.y + 0.6 && dHoriz <= 2) {
          logEvent('parkour', `drop-down done: landed at ${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)} hp ${Math.round(bot.health)}`)
          return true
        }
        // re-face the target every 500ms (the walk drifts)
        try { await bot.lookAt(new Vec3(targetPos.x, p.y, targetPos.z)) } catch (e) {}
        await sleepMs(500)
      }
      logEvent('parkour', 'drop-down timed out at ' + bot.entity.position)
      return false
    } catch (e) { log('drop-down: ' + e.message); return false } finally {
      dropDownActive = false
      try { bot.clearControlStates() } catch (e) {}
    }
  }
  // v10.5 CLIMB ASSIST: manual step-up walk for rough terrain. The
  // pathfinder times out in dips/valleys (runs 32-35: Segs fell in a
  // dip at (-121,69,162) and could not climb out westward) — the A*
  // explores the whole area and gives up. A human just walks at the
  // wall and jumps. This does that, with one crucial extra step.
  // UNWEDGE (probe-proven, run 104): Segs often stalls pressed
  // against a 1-block wall with its collision box overlapping the
  // wall by a hair — the fork's physics then never latches onGround,
  // so the jump never fires and holding forward+jump moves 0.0 blocks
  // in 8s (probe 1 at (-137.3,70,160.5)). A human steps back and
  // takes a run-up. Each attempt: back up 0.7s to clear the overlap,
  // then sprint + forward + jump (running jump) at the wall. Straight
  // first, then 45-degree diagonals. No digging, no block placing.
  // Returns true if Segs closed the horizontal gap by >2 blocks or
  // got within 2 of the target.
  async function climbAssist (targetPos, allowDiagonals = true) {
    try {
      if (!bot || !bot.entity || bot.health <= 0) return false
      const Vec3 = require('vec3').Vec3
      // v10.5.3 (run 146): CANCELLATION. climbAssist used to have no
      // idea the goto was cancelled — it kept driving Segs for up to
      // 33s (3 run-ups) after the owner said something else, and the
      // leaked assist dragged Segs up the stairs AFTER the down-goto
      // had already said "here", so the wall phase then started from
      // on top of the platform and failed. Capture the moveToken at
      // entry and bail the moment it changes, like gotoPos does.
      const tok = moveToken
      const cancelled = () => tok !== moveToken
      // v10.5.3 (run 148 attempt 6): prismarine-block Block objects
      // have NO .liquid property (only the pathfinder's wrapped blocks
      // do — movements.js sets b.liquid). bot.blockAt(...).liquid is
      // always undefined, so every .liquid check in climbAssist was a
      // silent no-op and Segs sprinted into the river three runs in a
      // row. Liquid here means by NAME: water or lava.
      const isLiquid = b => b && (b.name === 'water' || b.name === 'lava')
      const from = bot.entity.position.clone()
      const startDist = Math.hypot(targetPos.x - from.x, targetPos.z - from.z)
      if (startDist < 1) return false
      logEvent('goto', `climb assist: toward ${Math.round(targetPos.x)},${Math.round(targetPos.y)},${Math.round(targetPos.z)} from ${from}`)
      try { bot.pathfinder.setGoal(null) } catch (e) {}
      const tryRunUp = async (yawOffset) => {
        if (cancelled()) return false
        try { bot.clearControlStates() } catch (e) {}
        const p0 = bot.entity.position.clone()
        // face the target (plus an optional diagonal offset).
        // forward = (-sin yaw, -cos yaw), so yaw = atan2(-dx, -dz).
        const dx = targetPos.x - p0.x, dz = targetPos.z - p0.z
        const yaw = Math.atan2(-dx, -dz) + yawOffset
        try { await bot.look(yaw, 0) } catch (e) {}
        // v10.5.1 (item 2): do NOT run up a 2+ high WALL. The step
        // check below only fires the jump when the block ABOVE the
        // step is air — for a 2-high wall that block is solid, so the
        // jump never fires and Segs sprints into the wall for 6s per
        // run-up (run 107: 3 run-ups, 18s, 0.0 blocks). A wall is a
        // go-AROUND job (the sidestep), not a jump job. If the block
        // 1.5 ahead at feet level AND the block above it are both
        // solid, bail out immediately so gotoPos can sidestep instead.
        {
          const fx0 = -Math.sin(yaw), fz0 = -Math.cos(yaw)
          const ax0 = Math.floor(p0.x + fx0 * 1.5), ay0 = Math.floor(p0.y), az0 = Math.floor(p0.z + fz0 * 1.5)
          const low0 = bot.blockAt(new Vec3(ax0, ay0, az0))
          const high0 = bot.blockAt(new Vec3(ax0, ay0 + 1, az0))
          const solid0 = b => b && b.name !== 'air' && b.name !== 'water'
          if (solid0(low0) && solid0(high0)) {
            logEvent('goto', `climb assist: 2-high wall ahead (${low0.name} + ${high0.name}) at ${ax0},${ay0},${az0} — not a step, bailing to sidestep`)
            return false
          }
          // v10.5.3 (run 148): WATER. The A* refuses water crossings,
          // but the climb assist is manual driving — it used to sprint
          // Segs straight into the river, and the empty-path goto quirk
          // then called that "here". Never run up into liquid: if the
          // block 1.5 ahead at feet level is water/lava, bail so the
          // goto fails honestly instead of drowning the attempt.
          // NOTE the check must include the block BELOW feet level:
          // at a river bank Segs' feet are at y=71 (air ahead) while
          // the water is at y=70 — a feet-level-only check misses it
          // and he steps down into the river (run 148 attempt 4).
          // v10.5.3 (run 127): skipped while gotoAllowWater — the grave may be underwater and Segs is allowed in.
          if (!gotoAllowWater && (isLiquid(low0) || isLiquid(high0))) {
            logEvent('goto', `climb assist: liquid ahead (${low0.name} / ${high0.name}) at ${ax0},${ay0},${az0} — not running into water`)
            return false
          }
          {
            const below0 = bot.blockAt(new Vec3(ax0, ay0 - 1, az0))
            if (!gotoAllowWater && isLiquid(below0)) {
              logEvent('goto', `climb assist: liquid below feet ahead (${below0.name}) at ${ax0},${ay0 - 1},${az0} — not stepping down into water`)
              return false
            }
          }
          // v10.5.3 (run 148 attempt 5): the 50ms in-loop lookahead
          // did NOT catch the river — sprinting Segs covered the
          // 1.5-block lookahead between checks and was in the water
          // before any iteration fired. So scan the WHOLE run-up
          // corridor up front (before any movement): 0.5-block steps
          // out to 8 blocks, at feet level AND one below. Any liquid
          // anywhere in the corridor means this run-up would end in
          // water — bail now, while Segs is still dry.
          {
            let liquidInCorridor = null
            for (let r = 1; r <= 8 && !liquidInCorridor; r += 0.5) {
              const cx = Math.floor(p0.x + fx0 * r), cz = Math.floor(p0.z + fz0 * r)
              for (const cy of [ay0, ay0 - 1]) {
                const cb = bot.blockAt(new Vec3(cx, cy, cz))
                if (!gotoAllowWater && isLiquid(cb)) { liquidInCorridor = `${cb.name} at ${cx},${cy},${cz}`; break }
              }
            }
            if (liquidInCorridor) {
              logEvent('goto', `climb assist: liquid in run-up corridor (${liquidInCorridor}) — not running into water`)
              return false
            }
          }
        }
        // step back to clear the wall overlap
        bot.setControlState('back', true)
        await sleepMs(700)
        bot.setControlState('back', false)
        logEvent('goto', `climb assist: stepped back to ${bot.entity.position}`)
        // TIMED JUMP, 1.5-BLOCK LOOKAHEAD (run 104f fix): run at the
        // wall with sprint+forward and NO jump, and press jump the
        // moment a 1-block step appears 1.5 blocks ahead — the block
        // at feet level 1.5 ahead is solid and the block above it is
        // air. Why 1.5: the bunny-hop (parts 6-7) jumped from the
        // start, so its apex came 1.5 blocks SHORT of the wall and
        // Segs landed at the wall's foot, where the client/server
        // desync pins it (onGround false, vy 0.00, collH true — the
        // jump never fires again, 0.0 blocks in 6s, run 104e/f). The
        // 0.7-block lookahead (part 5) was too late: the 100ms check
        // + 50ms tick race lets sprinting Segs cover 0.28 blocks
        // between detection and the jump, so it was already wedged
        // when the jump was set. At 1.5 blocks out there is a full
        // 0.27s of margin; the jump fires while Segs is still on
        // solid ground (onGround true), and the apex (0.3s later,
        // 1.7 blocks on) is OVER the wall — Segs lands on top of it.
        // Controls are re-asserted every 50ms (a pending jump-pulse
        // setTimeout or watchdog must not cancel the jump mid-flight,
        // run 104d). No lookAt during the run — the yaw is set once
        // at the start.
        // STAIR MODE (run 107 fix): if the TARGET is 2+ blocks above
        // Segs (a staircase, not a single wall), a running jump
        // overshoots — Segs flies 2-3 blocks and lands wedged in the
        // next stairwell (run 107: jumped from -96.27, landed wedged
        // at -94.34, y=72.25, 0.0 blocks). Detection is by TARGET
        // HEIGHT, not by sampling blocks ahead — the block check
        // missed the 1-wide stairs whenever Segs was 0.3 off the
        // stair line (run 107b: at z=159.68, the steps are at z=160).
        // Stairs need 1-block hops: jump in place to the apex (300ms),
        // then step forward onto the step top (250ms, ~1 block at walk
        // speed — 400ms overshoots to the next step's face), land and
        // repeat. Each cycle gains ~1 step (1 forward, 1 up). No sprint.
        const dyUp = targetPos.y - bot.entity.position.y
        const distH = Math.hypot(targetPos.x - bot.entity.position.x, targetPos.z - bot.entity.position.z)
        const isStaircase = dyUp > 1.5 && distH < 10
        if (isStaircase) {
          logEvent('goto', `climb assist: target ${dyUp.toFixed(1)} above, ${distH.toFixed(1)} away — stair hop-step mode`)
          const stairT0 = Date.now()
          while (Date.now() - stairT0 < 15000) {
            if (!bot || !bot.entity || bot.health <= 0) break
            if (cancelled()) { logEvent('goto', 'climb assist: cancelled mid-stairs'); return false }
            if (bot.entity.isInWater) { logEvent('goto', 'climb assist: in water mid-stairs — bailing'); return false }
            const p = bot.entity.position
            const d = Math.hypot(targetPos.x - p.x, targetPos.z - p.z)
            if (d <= 2) return true
            if (startDist - d > 2) return true
            // hop: jump in place to the apex, then step forward onto
            // the step top, then land and re-evaluate.
            try { bot.setControlState('jump', true); bot.setControlState('forward', false); bot.setControlState('sprint', false) } catch (e) {}
            await sleepMs(300)
            try { bot.setControlState('jump', false); bot.setControlState('forward', true) } catch (e) {}
            await sleepMs(250)
            try { bot.setControlState('forward', false) } catch (e) {}
            await sleepMs(250)
            try { bot.lookAt(new Vec3(targetPos.x, bot.entity.position.y + 1, targetPos.z)) } catch (e) {}
          }
          const end = bot.entity.position
          const made = startDist - Math.hypot(targetPos.x - end.x, targetPos.z - end.z)
          logEvent('goto', `climb assist: stair hops ended at ${end}, closed gap by ${made.toFixed(1)} blocks`)
          return made > 2
        }
        if (bot.food >= 10) bot.setControlState('sprint', true)
        bot.setControlState('forward', true)
        const t0 = Date.now()
        let lastLog = 0, jumped = false
        while (Date.now() - t0 < 6000) {
          if (!bot || !bot.entity || bot.health <= 0) break
          if (cancelled()) { logEvent('goto', 'climb assist: cancelled mid-run-up'); return false }
          if (bot.entity.isInWater) { logEvent('goto', 'climb assist: in water mid-run-up — bailing'); return false }
          const p = bot.entity.position
          const d = Math.hypot(targetPos.x - p.x, targetPos.z - p.z)
          if (d <= 2) return true
          if (startDist - d > 2) return true // real progress — let the pathfinder take over
          // step 1.5 blocks ahead? (checked every 50ms so the
          // detection lands well before the wall)
          const fx = -Math.sin(bot.entity.yaw), fz = -Math.cos(bot.entity.yaw)
          const ax = Math.floor(p.x + fx * 1.5), ay = Math.floor(p.y), az = Math.floor(p.z + fz * 1.5)
          const stepBlock = bot.blockAt(new Vec3(ax, ay, az))
          const aboveBlock = bot.blockAt(new Vec3(ax, ay + 1, az))
          // v10.5.3 (run 148): liquid 1.5 ahead — stop before running in.
          // Include the block BELOW feet: at a river bank the water is
          // one below feet level (feet y=71, water y=70).
          if (!gotoAllowWater && (isLiquid(stepBlock) || isLiquid(aboveBlock))) { logEvent('goto', `climb assist: liquid 1.5 ahead (${stepBlock.name}) at ${ax},${ay},${az} — bailing`); return false }
          {
            const belowStep = bot.blockAt(new Vec3(ax, ay - 1, az))
            if (!gotoAllowWater && isLiquid(belowStep)) { logEvent('goto', `climb assist: liquid below feet 1.5 ahead (${belowStep.name}) at ${ax},${ay - 1},${az} — bailing`); return false }
          }
          const stepAhead = stepBlock && stepBlock.name !== 'air' && stepBlock.name !== 'water' && aboveBlock && aboveBlock.name === 'air'
          if (stepAhead && !jumped) { jumped = true; logEvent('goto', `climb assist: step 1.5 ahead (${stepBlock.name}) at ${p} — jumping`) }
          try {
            if (bot.food >= 10) bot.setControlState('sprint', true)
            bot.setControlState('forward', true)
            bot.setControlState('jump', jumped)
          } catch (e) {}
          if (Date.now() - lastLog > 1000) { lastLog = Date.now(); logEvent('goto', `climb assist: at ${p}, ${d.toFixed(1)} from target, jumped=${jumped}, onG=${bot.entity.onGround}, vy=${bot.entity.velocity.y.toFixed(2)}`) }
          await sleepMs(50)
        }
        const end = bot.entity.position
        const made = startDist - Math.hypot(targetPos.x - end.x, targetPos.z - end.z)
        logEvent('goto', `climb assist: run-up ended at ${end}, closed gap by ${made.toFixed(1)} blocks`)
        return made > 2
      }
      if (await tryRunUp(0)) return true
      if (cancelled()) return false
      if (allowDiagonals) {
        if (await tryRunUp(Math.PI / 4)) return true
        if (cancelled()) return false
        if (await tryRunUp(-Math.PI / 4)) return true
      }
      return false
    } catch (e) { log('climb assist: ' + e.message); return false } finally {
      try { bot.clearControlStates() } catch (e) {}
    }
  }
  async function gotoPosInner (pos, allowWater) {
    updateSprint() // sprint when fed, walk when hungry — before every walk
    const tok = moveToken
    const stopped = () => tok !== moveToken
    const from = bot.entity ? bot.entity.position.clone() : null
    gotoMainGoal = pos; gotoMainStartDist = (bot.entity ? Math.hypot(pos.x - bot.entity.position.x, pos.z - bot.entity.position.z) : 0); gotoMainStartTime = Date.now(); gotoMainStartY = (bot.entity ? Math.floor(bot.entity.position.y) : null)
    // v10.5.1 RIVER BUG: water is impassable for routing now, so if
    // Segs starts a goto while IN water the A* would fail instantly.
    // Wait for the water watchdog to get it out (up to 25s) before
    // pathfinding. If it is still in water after that, fail honestly
    // instead of walking into a river it cannot leave.
    // v10.5.3 (run 127): NOT for a grave goto — the grave is
    // underwater and Segs is allowed in the water for it; waiting
    // for the watchdog would drag him out before he reaches it.
    if (bot.entity && bot.entity.isInWater && !allowWater) {
      logEvent('goto', 'in water at goto start — waiting for the water watchdog to get out')
      const t0 = Date.now()
      while (Date.now() - t0 < 25000 && bot.entity && bot.entity.isInWater && !stopped()) await sleepMs(500)
      if (bot.entity && bot.entity.isInWater) { logEvent('goto', 'still in water after 25s, aborting goto'); say('i cant reach there — im stuck in the water and i cant climb out. want me to tp to you?'); gotoMainGoal = null; stopJumpPulse(); return false }
    }
    // v10.3.1 JUMP PULSE: while a goto is running, if Segs has not
    // moved in 2s, pulse jump (a 1-block step the pathfinder is
    // struggling with). Tash: "he cant jump up 1 block and get stuck"
    // on land. The followLoop has this; gotoPos did not.
    let jumpPulse = null
    let lastJumpPos = bot.entity ? bot.entity.position.clone() : null
    let lastJumpMove = Date.now()
    const startJumpPulse = () => {
      if (jumpPulse) return
      jumpPulse = setInterval(() => {
        try {
          if (!bot || !bot.entity) return
          // v10.5.1: "stop jumping" holds the pulse for 60s.
          if (Date.now() < jumpHoldUntil) return
          const now = bot.entity.position
          if (lastJumpPos && now.distanceTo(lastJumpPos) < 0.5) {
            if (Date.now() - lastJumpMove > 2000) {
              // v10.5.1 IDLE-JUMP FIX: only pulse jump when there is
              // actually a 1-block STEP ahead toward the goal (low
              // block solid, block above it air). A leaked or stale
              // pulse on flat land jumps Segs every 2s while idle —
              // the idle-jump bug. No step ahead = no jump, ever.
              const stepAhead = (() => {
                try {
                  const dx = pos.x - now.x, dz = pos.z - now.z
                  const len = Math.hypot(dx, dz) || 1
                  const ax = Math.floor(now.x + (dx / len) * 1.5), ay = Math.floor(now.y), az = Math.floor(now.z + (dz / len) * 1.5)
                  const low = bot.blockAt(new (require('vec3').Vec3)(ax, ay, az))
                  const high = bot.blockAt(new (require('vec3').Vec3)(ax, ay + 1, az))
                  const solid = b => b && b.name !== 'air' && b.name !== 'water'
                  return solid(low) && !solid(high)
                } catch (e) { return false }
              })()
              if (stepAhead) {
                bot.setControlState('jump', true)
                setTimeout(() => { try { bot.setControlState('jump', false) } catch (e) {} }, 500)
              }
              lastJumpMove = Date.now()
            }
          } else { lastJumpPos = now.clone(); lastJumpMove = Date.now() }
        } catch (e) {}
      }, 500)
    }
    const stopJumpPulse = () => { if (jumpPulse) { clearInterval(jumpPulse); jumpPulse = null } try { bot.setControlState('jump', false) } catch (e) {} }
    try {
      startJumpPulse()
      await gotoWithTimeout(new goals.GoalNear(pos.x, pos.y, pos.z, 2))
      stopJumpPulse()
      logEvent('goto', 'gotoPos OK (direct) at ' + bot.entity.position)
      gotoMainGoal = null; return true
    } catch (e) {
      log(`gotoPos FAIL: from ${from} to ${pos.x},${pos.y},${pos.z}: ${e.message} (still at ${bot.entity ? bot.entity.position : '?'})`)
      if (stopped()) { stopJumpPulse(); gotoMainGoal = null; return false } // cancelled by a stop command, not a failure
      // v9.4: maybe a door is in the way — push through it, then retry
      if (await tryDoorAssist(pos)) {
        try {
          await gotoWithTimeout(new goals.GoalNear(pos.x, pos.y, pos.z, 2))
          stopJumpPulse()
          gotoMainGoal = null; return true
        } catch (e2) { log('goto after door assist failed: ' + e2.message) }
      }
      // v10.5.1 (item 2): WALL SIDESTEP FIRST. The direct path failed
      // and it was not a door — it is a wall. A wall is a go-AROUND
      // job: step 4 blocks left/right (perpendicular to travel, the
      // safe — inland, routeSafe-checked — side first) and retry the
      // goal from there. The old order ran the climb assist first,
      // which sprints into a 2-high wall for 6s per run-up (the jump
      // never fires — the block above the step is solid) and burns
      // the whole budget before the sidestep ever runs (run 107:
      // the stop command cut the run off before the sidestep).
      // Gate: NOT for a staircase — if the target is 2+ blocks above
      // Segs, sidestepping left/right cannot help (run 107 retest:
      // the early sidestep burned 24s on the stairs goal); the
      // climb assist's stair hop-step mode is the tool for that.
      // Gate 2 (v10.5.1 run 104 fix): NOT for a 1-block STEP. A dip
      // edge or a single block is a climb-assist job, not a wall —
      // sidestepping burns up to 74s (12s + 25s per side) and the
      // run's stop cuts it off before the climb assist ever runs.
      // Only sidestep when the block 1.5 ahead at feet level AND the
      // block above it are both solid (a real 2-high wall).
      if (!(bot.entity && pos.y > bot.entity.position.y + 1.5)) {
      const _aheadSolid = (() => {
        try {
          const _p = bot.entity.position
          const _dx = pos.x - _p.x, _dz = pos.z - _p.z
          const _len = Math.hypot(_dx, _dz) || 1
          const _fx = _dx / _len, _fz = _dz / _len
          const _ax = Math.floor(_p.x + _fx * 1.5), _ay = Math.floor(_p.y), _az = Math.floor(_p.z + _fz * 1.5)
          const _low = bot.blockAt(new (require('vec3').Vec3)(_ax, _ay, _az))
          const _high = bot.blockAt(new (require('vec3').Vec3)(_ax, _ay + 1, _az))
          const _s = b => b && b.name !== 'air' && b.name !== 'water'
          return _s(_low) && _s(_high)
        } catch (e) { return true }
      })()
      if (_aheadSolid) {
      {
        const sdx = pos.x - (from ? from.x : bot.entity.position.x)
        const sdz = pos.z - (from ? from.z : bot.entity.position.z)
        const slen = Math.sqrt(sdx * sdx + sdz * sdz) || 1
        const spx = -sdz / slen, spz = sdx / slen
        const Vec3s = require('vec3').Vec3
        const sides = [4, -4].map(side => {
          const sx = bot.entity.position.x + spx * side
          const sz = bot.entity.position.z + spz * side
          return { side, sx, sz, safe: routeSafe(bot.entity.position, new Vec3s(sx, bot.entity.position.y, sz)) }
        }).sort((a, b) => (b.safe ? 1 : 0) - (a.safe ? 1 : 0))
        for (const { side, sx, sz, safe } of sides) {
          if (stopped()) { stopJumpPulse(); gotoMainGoal = null; return false }
          if (!safe) logEvent('goto', `wall sidestep (early) ${side > 0 ? 'left' : 'right'} 4 crosses a drop — trying it only after the safe side`)
          logEvent('goto', `wall sidestep (early) ${side > 0 ? 'left' : 'right'} 4 to ${Math.round(sx)},${Math.round(sz)}`)
          try {
            await gotoWithTimeout(new goals.GoalXZ(sx, sz), 12000)
            await gotoWithTimeout(new goals.GoalNear(pos.x, pos.y, pos.z, 2), 25000)
            stopJumpPulse()
            logEvent('goto', 'gotoPos OK (after early sidestep) at ' + bot.entity.position)
            gotoMainGoal = null; return true
          } catch (e) { log('early sidestep ' + side + ' failed: ' + e.message) }
        }
      }
      } // end _aheadSolid gate — a 1-block step skips the sidestep
      } // end staircase gate — the climb assist below handles stairs
      // v10.5: try the climb assist BEFORE burning 20s per stage — a
      // wedged Segs fails every stage the same way (run 104). Straight
      // run-up only here; the full diagonal set runs after the stages.
      // stop the goto jump pulse while the assist runs by hand — its
      // setTimeout(jump=false) would cancel a timed jump mid-flight.
      stopJumpPulse()
      if (await climbAssist(pos, false)) {
        try {
          await gotoWithTimeout(new goals.GoalNear(pos.x, pos.y, pos.z, 2), 25000)
          stopJumpPulse()
          logEvent('goto', 'gotoPos OK (after climb assist) at ' + bot.entity.position)
          gotoMainGoal = null; return true
        } catch (e2) { log('goto after climb assist failed: ' + e2.message) }
      }
      startJumpPulse()
      log('goto failed, retrying in stages: ' + e.message)
    }
    const start = bot.entity.position.clone()
    const stages = Math.max(1, Math.ceil(start.distanceTo(pos) / 16))
    let stageFailed = false
    for (let i = 1; i <= stages; i++) {
      if (stopped()) { stopJumpPulse(); gotoMainGoal = null; return false }
      const t = i / stages
      const ix = start.x + (pos.x - start.x) * t
      const iz = start.z + (pos.z - start.z) * t
      try {
        // GoalXZ, not GoalNear: a waypoint must not care about height.
        // (Run 14: stages used the bot's CURRENT y, so on rising ground the
        // waypoint sat 3+ blocks below the surface and could never be
        // reached — the walk timed out even though the route was walkable.)
        await gotoWithTimeout(new goals.GoalXZ(ix, iz), 20000)
      } catch (e) {
        if (stopped()) { stopJumpPulse(); gotoMainGoal = null; return false }
        log(`goto stage ${i}/${stages} failed: ` + e.message)
        stageFailed = true
        break
      }
    }
    if (stopped()) { stopJumpPulse(); gotoMainGoal = null; return false }
    // v10.3.1 WALL SIDESTEP: the direct path and the stages both
    // failed — a wall is in the way. Try 4 blocks LEFT and 4 blocks
    // RIGHT (perpendicular to the travel direction) and retry the
    // goal from there. Tash: "just at his right or left there is
    // open space and he could chose that" — Segs now does.
    if (stageFailed) {
      // v10.4.1 PARKOUR: the pathfinder could not route here — if
      // the target is below Segs, walk off the ledge by hand instead
      // of saying "i cant reach there". Only after the pathfinder
      // has already failed, so normal walks are unchanged.
      if (bot.entity && pos.y < bot.entity.position.y - 0.5) {
        if (await attemptDropDown(pos)) {
          try {
            await gotoWithTimeout(new goals.GoalNear(pos.x, pos.y, pos.z, 2), 15000)
            stopJumpPulse()
            logEvent('goto', 'gotoPos OK (after drop-down) at ' + bot.entity.position)
            gotoMainGoal = null; return true
          } catch (e) { log('goto after drop-down failed: ' + e.message) }
        }
      }
      // v10.5: rough-terrain climb — walk at the wall and jump instead
      // of the A* timing out in a dip (runs 32-35).
      // v10.5.3 (run 148): never climb-assist from IN water — the
      // assist bails on isInWater anyway, and its step-back just
      // churns in the river while the watchdog should be driving
      // the climb-out. Skip straight to the sidestep / honest fail.
      stopJumpPulse()
      if (bot.entity && bot.entity.isInWater) logEvent('goto', 'climb assist skipped: Segs is in water — leaving it to the water watchdog')
      else if (await climbAssist(pos)) {
        try {
          await gotoWithTimeout(new goals.GoalNear(pos.x, pos.y, pos.z, 2), 25000)
          stopJumpPulse()
          logEvent('goto', 'gotoPos OK (after climb assist) at ' + bot.entity.position)
          gotoMainGoal = null; return true
        } catch (e) { log('goto after climb assist failed: ' + e.message) }
      }
      startJumpPulse()
      const dx = pos.x - start.x, dz = pos.z - start.z
      const len = Math.sqrt(dx * dx + dz * dz) || 1
      const px = -dz / len, pz = dx / len // perpendicular (left/right)
      // v10.5.1 (b/c): check both sidestep routes for drops FIRST and
      // try the safe (inland) side before the side that crosses a
      // drop. The old order always tried left first, even when left
      // ran along a platform edge.
      const sides = [4, -4].map(side => {
        const sx = bot.entity.position.x + px * side
        const sz = bot.entity.position.z + pz * side
        const Vec3s = require('vec3').Vec3
        return { side, sx, sz, safe: routeSafe(bot.entity.position, new Vec3s(sx, bot.entity.position.y, sz)) }
      }).sort((a, b) => (b.safe ? 1 : 0) - (a.safe ? 1 : 0))
      for (const { side, sx, sz, safe } of sides) {
        if (stopped()) { stopJumpPulse(); gotoMainGoal = null; return false }
        if (!safe) logEvent('goto', `wall sidestep ${side > 0 ? 'left' : 'right'} 4 crosses a drop — trying it only after the safe side`)
        logEvent('goto', `wall sidestep ${side > 0 ? 'left' : 'right'} 4 to ${Math.round(sx)},${Math.round(sz)}`)
        try {
          await gotoWithTimeout(new goals.GoalXZ(sx, sz), 12000)
          await gotoWithTimeout(new goals.GoalNear(pos.x, pos.y, pos.z, 2), 25000)
          stopJumpPulse()
          gotoMainGoal = null; return true
        } catch (e) { log('sidestep ' + side + ' failed: ' + e.message) }
      }
      stopJumpPulse()
      if (from && routeCrossesWater(from, pos) && !allowWater) say('i cant reach there — the way goes through water and i cant climb out of it. want me to tp to you?')
      else say('i cant reach there, too far or blocked. want me to tp to you?')
      gotoMainGoal = null; return false
    }
    try {
      await gotoWithTimeout(new goals.GoalNear(pos.x, pos.y, pos.z, 2))
      stopJumpPulse()
      logEvent('goto', 'gotoPos OK (final step) at ' + bot.entity.position)
      gotoMainGoal = null; return true
    } catch (e) {
      if (stopped()) { stopJumpPulse(); gotoMainGoal = null; return false }
      log('goto final step failed: ' + e.message)
      stopJumpPulse()
      if (from && routeCrossesWater(from, pos) && !allowWater) say('i cant reach there — the way goes through water and i cant climb out of it. want me to tp to you?')
      else say('i cant reach there, too far or blocked. want me to tp to you?')
      gotoMainGoal = null; return false
    }
  }
  // v10.5.3 (regression-127): the public goto. opts.allowWater is
  // for GRAVE RECOVERY ONLY — the grave can be underwater (run 127:
  // chest at y=70 under the river), and the water prevention (run
  // 148: A* head-water + no-water-landing patches, climbAssist liquid
  // bails) would refuse the route and leave Segs' stuff in the river
  // until the grave expires. For this one goto the A* may route
  // through water (pathMovements.allowWater, fork patch
  // pathfinder-allow-water) and climbAssist skips its liquid bails
  // (gotoAllowWater). The flags are restored in the finally, so every
  // other goto keeps the prevention. All other callers pass no opts
  // and behave exactly as before.
  async function gotoPos (pos, opts) {
    const allowWater = !!(opts && opts.allowWater)
    if (!allowWater) return gotoPosInner(pos, false)
    const savedAllow = pathMovements ? pathMovements.allowWater : false
    if (pathMovements) pathMovements.allowWater = true
    gotoAllowWater = true
    logEvent('goto', 'gotoPos allowWater: grave recovery — water route allowed for this goto only')
    try { return await gotoPosInner(pos, true) }
    finally { if (pathMovements) pathMovements.allowWater = savedAllow; gotoAllowWater = false }
  }
  // same walk, but silent on failure (for farming: one unreachable crop
  // should not spam chat, the caller decides what to do)
  async function gotoPosQuiet (pos) {
    await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 1))
  }

  // v10: open a door in the way (wooden: right-click it; iron: press a
  // nearby plate / button / lever). Returns true if it opened something.
  async function openDoorInWay () {
    try {
      if (!bot || !bot.entity) return false
      // v10.1 PLAN ITEM 10: trapdoors + fence gates, not just doors.
      // A closed trapdoor above Segs blocks the path the same way a
      // closed door does; a closed fence gate blocks a pen/garden.
      // Same rule: open them, never break them.
      const door = bot.findBlock({
        matching: b => b && b.name && (
          (b.name.endsWith('_door') && !b.name.includes('trapdoor')) ||
          b.name.endsWith('_trapdoor') ||
          b.name.endsWith('_fence_gate')
        ),
        maxDistance: 3
      })
      if (!door) return false
      const props = door.getProperties ? door.getProperties() : {}
      if (props.open === true) return false // already open, nothing to do
      if (!door.name.startsWith('iron')) {
        // wooden door: right-click it open
        await bot.activateBlock(door)
        await sleepMs(300)
        logEvent('door', 'opened ' + door.name + ' at ' + door.position)
        // v10.5.1 (item 4): remember when/where a door was opened, so
        // the follow loop can force a fresh re-path right after one —
        // the pathfinder's old goal was planned around the CLOSED
        // door, and it stalls in the doorway (run 57) instead of
        // routing through the open one.
        globalThis._lastDoorOpenedAt = Date.now()
        globalThis._lastDoorOpenedPos = door.position.clone()
        return true
      }
      // iron door: needs redstone — find a plate / button / lever nearby
      const opener = bot.findBlock({
        matching: b => b && b.name && (
          b.name.includes('pressure_plate') || b.name.includes('_button') || b.name === 'lever'
        ),
        maxDistance: 3
      })
      if (opener) {
        await bot.activateBlock(opener)
        await sleepMs(300)
        logEvent('door', 'pressed ' + opener.name + ' for iron door at ' + door.position)
        // v10.5.1 (item 4): same door-opened record as the wooden case.
        globalThis._lastDoorOpenedAt = Date.now()
        globalThis._lastDoorOpenedPos = door.position.clone()
        return true
      }
      return false // iron door with no opener nearby — do NOT break it
    } catch (e) { return false }
  }

  // v10.5 FAST FOLLOW: the old loop called setGoal(GoalFollow)
  // every 500ms — and setGoal calls resetPath() every time, so the A*
  // restarted constantly and long-distance follow ran at ~0.6 blocks/s
  // (run 82). The pathfinder ALREADY re-plans a moving goal on its own
  // (GoalFollow.hasChanged() -> resetPath('goal_moved')), so the goal
  // is set ONCE and only re-set when: there is no goal, the owner
  // moved >3 blocks since the last goal, or the owner's ENTITY object
  // changed (the server re-creates it — a stale entity freezes the
  // target). Sprint is the pathfinder's own job (allowSprinting, on
  // when food >= 10 via updateSprint) — it sprints on straight lines.
  let followRunning = false
  async function followLoop () {
    if (followRunning) return
    followRunning = true
    updateSprint()
    // v10: NEVER dig while following. canDig=true let the pathfinder
    // break the cobblestone above a closed door (Tash's report). While
    // following, Segs opens doors or says it cannot get there — it
    // never destroys the owner's house to reach him.
    const savedCanDig = pathMovements ? pathMovements.canDig : true
    if (pathMovements) pathMovements.canDig = false
    let lastPos = null, lastMove = Date.now()
    let lastGoalOwnerPos = null
    let lastGoalOwnerEnt = null
    // v10.5.1 (item 4): separate throttles for the stuck-2s jump pulse
    // and re-path — they must NOT touch lastMove (see the stuck block
    // below: touching it capped stuckMs and starved the 6s door assist).
    let lastFollowJump = 0, lastFollowRepath = 0
    let followStartPos = bot.entity ? bot.entity.position.clone() : null
    let followStartAt = Date.now()
    let measuring = true // measure speed until Segs first catches up
    let teleportedFar = false
    let lastOwnerPos = null
    try {
    while (following && bot && bot.entity) {
      const ownerEnt = resolveOwnerEntity()
      if (!ownerEnt) { await sleepMs(500); continue }
      // v10.3: HORIZONTAL distance for the trigger, not 3D. If
      // the owner is 1 block above Segs (directly overhead), the 3D
      // distance is 1 and the old code never moved — Segs stood
      // below the owner forever (run 71). Horizontal distance makes
      // Segs close the gap AND jump up onto the ledge.
      // v10.4 FOLLOW (Wurst): re-target the owner BY NAME every
      // 500ms (10 ticks) — the stored entity goes stale when the
      // server re-creates it, same bug combat hit in v10.
      const dx = ownerEnt.position.x - bot.entity.position.x
      const dz = ownerEnt.position.z - bot.entity.position.z
      const dist = Math.sqrt(dx * dx + dz * dz)
      // owner teleported? a >30-block jump in one 500ms tick is not walking
      if (lastOwnerPos && ownerEnt.position.distanceTo(lastOwnerPos) > 30) {
        teleportedFar = true
        logEvent('follow', 'owner teleported ~' + Math.round(ownerEnt.position.distanceTo(lastOwnerPos)) + ' blocks away')
      }
      lastOwnerPos = ownerEnt.position.clone()
      if (dist > 2) {
        // re-arm the speed measurement when the owner walks away again
        if (!measuring && dist > 5) { measuring = true; followStartPos = bot.entity.position.clone(); followStartAt = Date.now() }
        // v10: proactive door open — do not wait 6s stuck. If a closed
        // door is in the way, open it now, then (re-)set the follow
        // goal so the pathfinder routes through the open doorway.
        await openDoorInWay()
        // v10.5: re-path ONLY when needed — never every tick.
        const ownerMoved = !lastGoalOwnerPos || ownerEnt.position.distanceTo(lastGoalOwnerPos) > 3
        const entChanged = ownerEnt !== lastGoalOwnerEnt
        const noGoal = !bot.pathfinder.goal
        if (ownerMoved || entChanged || noGoal) {
          try { bot.pathfinder.setGoal(new goals.GoalFollow(ownerEnt, 2)) } catch (e) {}
          lastGoalOwnerPos = ownerEnt.position.clone()
          lastGoalOwnerEnt = ownerEnt
        }
        // v10.3 AUTO-JUMP: if Segs has not moved in 2s while
        // following (dist > 2), PULSE jump — a 1-block step the
        // pathfinder is struggling with. Tash: "he cant auto jump
        // like walking and see 1 block high". This is the auto-jump.
        // v9.4: stuck at a door? If Segs has not moved in 6s while
        // following, try the door assist (open a nearby door and walk
        // through it), then re-set the follow goal.
        const nowPos = bot.entity.position
        if (lastPos && nowPos.distanceTo(lastPos) < 0.5) {
          const stuckMs = Date.now() - lastMove
          if (stuckMs > 2000 && stuckMs < 6000) {
            // v10.5.1 (item 4): separate throttles for the jump pulse
            // and the re-path — the old code set
            // `lastMove = Date.now() - 4000` here, which CAPPED stuckMs
            // at ~4500 forever, so the 6s door-assist branch below
            // NEVER fired (run 57 retest: Segs pressed the west wall
            // for 18s, stuckMs hovering 4500-5000, door assist never
            // ran). lastMove must keep accumulating so 6s is reachable;
            // the jump and the re-path throttle on their own clocks.
            // v10.5.1 IDLE-JUMP FIX: only pulse jump when there is
            // actually a 1-block STEP ahead toward the owner (low
            // block solid, block above it air). On flat land Segs
            // stands at the follow radius (dist 2.0-2.1) not moving
            // — that is CAUGHT UP, not stuck on a step — and jumping
            // every 2s there is the idle-jump bug Tash reported
            // (flat land, no wall, no ledge, jumps every 1-2s).
            // A step check also stops the pulse when Segs is pressed
            // against a 2-high wall (low + high both solid — the
            // door assist / sidestep owns that, not jumping).
            const stepAhead = (() => {
              try {
                const p = bot.entity.position
                const dx = ownerEnt.position.x - p.x, dz = ownerEnt.position.z - p.z
                const len = Math.hypot(dx, dz) || 1
                const ax = Math.floor(p.x + (dx / len) * 1.5), ay = Math.floor(p.y), az = Math.floor(p.z + (dz / len) * 1.5)
                const low = bot.blockAt(new (require('vec3').Vec3)(ax, ay, az))
                const high = bot.blockAt(new (require('vec3').Vec3)(ax, ay + 1, az))
                const solid = b => b && b.name !== 'air' && b.name !== 'water'
                return solid(low) && !solid(high)
              } catch (e) { return false }
            })()
            if (stepAhead && (!lastFollowJump || Date.now() - lastFollowJump > 2000) && Date.now() >= jumpHoldUntil) {
              lastFollowJump = Date.now()
              bot.setControlState('jump', true)
              setTimeout(() => { try { bot.setControlState('jump', false) } catch (e) {} }, 500)
            }
            if (!lastFollowRepath || Date.now() - lastFollowRepath > 2000) {
              lastFollowRepath = Date.now()
              // v10.5.1 (item 4): force a FRESH GoalFollow re-path the
              // moment Segs is stuck 2s while following — ANY cause, not
              // just after 6s. The old loop only re-pathed at stuck >6s
              // (or when the owner moved >3 blocks); a stationary owner
              // on the other side of a door meant the stale goal
              // (planned around the CLOSED door) was never replaced and
              // Segs said "im stuck following you" in the doorway (run
              // 57). Nulling lastGoalOwnerPos/Ent makes the next 500ms
              // iteration re-set the goal fresh (ownerMoved is true when
              // either is null). If a door was opened within 3 blocks in
              // the last 5s, log it — that is the doorway case.
              const doorAt = globalThis._lastDoorOpenedAt || 0
              const doorPos = globalThis._lastDoorOpenedPos
              const doorRecent = doorAt && Date.now() - doorAt < 5000 && doorPos && bot.entity.position.distanceTo(doorPos) < 3
              if (doorRecent) logEvent('follow', 'stuck 2s right after a door opened at ' + doorPos + ' — forcing fresh re-path through it')
              lastGoalOwnerPos = null
              lastGoalOwnerEnt = null
            }
          }
          if (stuckMs > 6000) {
            lastMove = Date.now()
            // stuck: the goal may be stale — force a re-path next tick
            lastGoalOwnerPos = null
            lastGoalOwnerEnt = null
            if (await tryDoorAssist(ownerEnt.position)) {
              try { bot.pathfinder.setGoal(new goals.GoalFollow(ownerEnt, 2)) } catch (e) {}
              lastGoalOwnerPos = ownerEnt.position.clone()
              lastGoalOwnerEnt = ownerEnt
            } else if (ownerEnt.position.y < bot.entity.position.y - 1.5) {
              // v10.4.1 PARKOUR: stuck following while the owner is
              // below — the pathfinder will not route the drop, so
              // walk off the ledge by hand, then resume following.
              if (await attemptDropDown(ownerEnt.position)) {
                try { bot.pathfinder.setGoal(new goals.GoalFollow(ownerEnt, 2)) } catch (e) {}
                lastGoalOwnerPos = ownerEnt.position.clone()
                lastGoalOwnerEnt = ownerEnt
                lastPos = bot.entity.position.clone(); lastMove = Date.now()
              }
            }
          }
          // stuck 15s while following: say so and stop (Tash had to
          // walk back and make a path for him — now Segs tells him).
          // v10.5: if the owner teleported far away, OFFER /tpa
          // instead of just complaining — but NEVER auto-tpa.
          if (stuckMs > 15000) {
            if (teleportedFar) say('im stuck following you — looks like you teleported far away, want me to tpa to you? say segs tp to me')
            else say('im stuck following you, i cant reach you — come get me or tell me to tp')
            logEvent('follow', 'stuck 15s following, gave up and told owner' + (teleportedFar ? ' (owner teleported far)' : ''))
            following = null
            try { bot.pathfinder.setGoal(null) } catch (e) {}
            break
          }
        } else {
          lastPos = nowPos.clone()
          lastMove = Date.now()
        }
      } else {
        // caught up — report the measured speed once per chase
        if (measuring && followStartPos) {
          const covered = followStartPos.distanceTo(bot.entity.position)
          const secs = Math.max(0.1, (Date.now() - followStartAt) / 1000)
          logEvent('follow', `caught up: covered ${covered.toFixed(1)} blocks in ${secs.toFixed(1)}s = ${(covered / secs).toFixed(2)} blocks/s, now ${dist.toFixed(1)} behind owner`)
          measuring = false
        }
        lastPos = bot.entity.position.clone()
        lastMove = Date.now()
      }
      await sleepMs(500)
    }
    } finally {
      followRunning = false
      // restore digging (for mining / digging tasks when told)
      if (pathMovements) pathMovements.canDig = savedCanDig
    }
  }

  let replantWarned = false
  function startFarming (cropName) {
    if (farming) stopFarming()
    farming = true
    replantWarned = false
    const center = config.farmCenter
      ? new Vec3(config.farmCenter[0], config.farmCenter[1], config.farmCenter[2])
      : bot.entity.position.clone()
    say(pick([`farming ${cropName}, tell me segs stop farm to stop`, `ok, farming ${cropName} around here`]))
    farmTimer = setInterval(() => { farmOnce(cropName, center).catch(e => log('farm: ' + e.message)) }, 5000)
    farmOnce(cropName, center).catch(() => {})
  }
  function stopFarming () {
    farming = false
    if (farmTimer) { clearInterval(farmTimer); farmTimer = null }
  }

  async function farmOnce (cropName, center) {
    if (!farming || !bot.entity) return
    const crop = CROPS[cropName]
    const mcData = mcDataFor(bot.version)
    if (!mcData.blocksByName[crop.block]) { say('i dont know that crop on this version'); stopFarming(); return }
    const blocks = bot.findBlocks({
      matching: (b) => b.name === crop.block && b.metadata === crop.maxAge,
      maxDistance: config.farmRadius || 16,
      count: 20,
    })
    if (!blocks.length) return
    // v10.4 AUTOFARM (Wurst): nearest-first, one crop at a time in
    // order, and remember which seed goes on each spot.
    blocks.sort((a, b) => bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b))
    for (const pos of blocks) {
      if (!farming) break
      const block = bot.blockAt(pos)
      if (!block) continue
      try {
        // walk to the crop; if one block is unreachable, skip it quietly
        // (simulation: 5 chat-spam "cant reach there" lines for blocks the
        // bot had already harvested or could not stand next to)
        try { await gotoPosQuiet(pos) } catch (e) { log('farm skip unreachable ' + pos); continue }
        recordFarmSpot(pos, cropName, crop.seed)
        await bot.dig(block)
        bumpStat('cropsFarmed')
        logEvent('farm', `harvested 1x ${cropName} at ${pos.x}, ${pos.y}, ${pos.z}`)
        // v10.3 PICKUP: the drop lands on the ground — walk onto it
        // BEFORE moving to the next crop, or the wheat stays on the
        // ground and looks like Segs threw it (Tash's report). Wait
        // for the item entity, step onto it, then replant.
        await sleepMs(400)
        const drop = bot.nearestEntity(e => e.type === 'object' && e.objectType === 'Item' && e.position.distanceTo(pos) < 3)
        if (drop) { try { await gotoPosQuiet(drop.position) } catch (e) {} await sleepMs(300) }
        await sleepMs(300)
        const seed = bot.inventory.items().find(i => i.name === crop.seed)
        if (seed) {
          await bot.equip(seed, 'hand')
          const soil = bot.blockAt(pos.offset(0, -1, 0))
          if (soil && soil.name === 'farmland') { await bot.placeBlock(soil, new Vec3(0, 1, 0)); logEvent('autofarm', 'replanted ' + crop.seed + ' at ' + pos.x + ',' + pos.y + ',' + pos.z + ' (spot remembered)') }
        } else if (!replantWarned) {
          replantWarned = true
          say(`i need ${crop.seed} to replant ${cropName}`)
        }
      } catch (e) { log('harvest one failed: ' + e.message) }
    }
  }

  function startAfk () {
    if (afkMode) return
    afkMode = true
    const spot = config.afkSpot
      ? new Vec3(config.afkSpot[0], config.afkSpot[1], config.afkSpot[2])
      : bot.entity.position.clone()
    gotoPos(spot).catch(() => {})
    let dir = 1
    afkTimer = setInterval(() => {
      if (!afkMode || !bot.entity) return
      try {
        bot.look(bot.entity.yaw + dir * 0.6, 0)
        dir *= -1
        bot.setControlState('forward', true)
        setTimeout(() => bot.setControlState('forward', false), 600)
        bot.setControlState('jump', true)
        setTimeout(() => bot.setControlState('jump', false), 300)
      } catch (e) {}
    }, 25000)
  }
  function stopAfk () {
    afkMode = false
    if (afkTimer) { clearInterval(afkTimer); afkTimer = null }
    try { bot.setControlState('forward', false); bot.setControlState('jump', false) } catch (e) {}
  }

  async function tossItem (itemName, count) {
    // "drop everything": toss every stack in the inventory, one by one.
    if (itemName === 'everything' || itemName === '' || itemName === 'all') {
      const items = bot.inventory.items()
      if (!items.length) { say('i dont have anything to drop'); return }
      let n = 0
      for (const it of items) { try { await bot.toss(it.type, null, it.count); n += it.count } catch (e) {} }
      say(`here, dropped everything (${n} items)`)
      return
    }
    // (v10.5.1: count across ALL slots, not items() — items() skips
    // the offhand and armor. If the item is only in the offhand or
    // worn, say so honestly instead of "i dont have it".)
    const allSlots = (bot.inventory && bot.inventory.slots) || []
    const item = allSlots.find(i => i && i.name === itemName)
    if (!item) { say(`i dont have ${itemName}`); return }
    const inInv = allSlots.slice(9, 45).some(i => i && i.name === itemName)
    if (!inInv) { say(`${itemName} is in my offhand / worn, i cant drop it from there — move it to my inventory first`); return }
    // count = Infinity ("all") means ALL stacks of it, summed — the old
    // code used item.count (the FIRST stack only), so "drop all seeds"
    // with seeds in two stacks dropped one stack and reported it as all.
    const totalHave = allSlots.slice(9, 45).filter(i => i && i.name === itemName).reduce((a, i) => a + i.count, 0)
    const n = (count === Infinity) ? totalHave : Math.min(count, totalHave)
    try {
      await bot.toss(item.type, null, n)
      say(`here, dropped ${n}x ${itemName}`)
    } catch (e) { say('couldnt drop that') }
  }

  async function fetchBlock (itemName, count, username) {
    // if we already have it, just bring it to you
    const have = bot.inventory.items().find(i => i.name === itemName)
    if (have && have.count >= count) { await tossItem(itemName, count); return }
    const mcData = mcDataFor(bot.version)
    // item name -> block name: "oak log" is a block, "iron pickaxe" is not
    const blockName = itemName.replace(/_log$/, '_log')
    const block = bot.findBlock({ matching: b => b.name === blockName || b.name === itemName, maxDistance: 32 })
    if (!block) { say(`i cant see any ${itemName} near me`); return }
    say(`ok, getting ${count}x ${itemName} for you`)
    try {
      await bot.collectBlock.collect(block, { count })
      say(`got ${itemName}, coming back to you`)
      const player = bot.players[username]?.entity
      if (player) await gotoPos(player.position)
      await tossItem(itemName, count)
    } catch (e) { log('fetch failed: ' + e.message); say(`couldnt get ${itemName}, maybe too far or i need a better tool`) }
  }

  // ---- v6: SURVIVAL — the bot takes care of itself, and narrates every step ----
  // The whole point: when Segs is hungry it does not just stand there.
  // It SAYS what it is doing in chat, then does it: check inventory -> eat,
  // else go to a farm it was shown -> harvest -> cook in a smoker/furnace
  // it was shown (checking a chest for coal first if it has none) -> eat.
  // Teach it your base with: "Segs this is the potato farm", "Segs this is
  // the food chest", "Segs this is the smoker", "Segs this is the furnace".
  const FOOD_ITEMS = ['baked_potato', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton', 'cooked_rabbit', 'bread', 'apple', 'carrot', 'potato', 'cooked_cod', 'cooked_salmon', 'cookie', 'melon_slice', 'pumpkin_pie', 'mushroom_stew', 'beetroot_soup']
  const COOKABLE = { potato: 'baked_potato', beef: 'cooked_beef', porkchop: 'cooked_porkchop', chicken: 'cooked_chicken', mutton: 'cooked_mutton', rabbit: 'cooked_rabbit', cod: 'cooked_cod', salmon: 'cooked_salmon', kelp: 'dried_kelp' }
  const FUEL_ITEMS = ['coal', 'charcoal', 'oak_log', 'oak_planks', 'coal_block']
  function hasFood () { return bot.inventory.items().find(i => FOOD_ITEMS.includes(i.name)) }
  function hasRawFood () { return bot.inventory.items().find(i => COOKABLE[i.name]) }
  // Open the nearest chest (or a chest landmark) and take what we need.
  // v10.5.1 CHEST SCAN FIX: the old version opened ONLY the nearest
  // chest (bot.findBlock singular) and gave up if that one lacked the
  // item — "checked the chest, no X" while the chest NEXT to it had
  // it. Now it opens EVERY nearby chest in turn (deduped, radius 32)
  // and takes from the first one that has the item, reporting how
  // many chests it searched.
  async function checkChestFor (wantedNames, takeCount = 8) {
    const chests = findNearbyContainers(32)
    if (!chests.length) { say('i cant see a chest near me'); return null }
    let searched = 0
    for (const pos of chests) {
      searched++
      try {
        try { await gotoWithTimeout(new goals.GoalNear(pos.x, pos.y, pos.z, 1), 6000) } catch (e) { continue }
        const chestBlock = bot.blockAt(pos)
        if (!chestBlock || !chestBlock.name.includes('chest')) continue
        const chest = await bot.openChest(chestBlock)
        try {
          const items = chest.containerItems()
          const found = items.find(i => i && wantedNames.includes(i.name))
          if (!found) continue
          const take = Math.min(takeCount, found.count)
          await chest.withdraw(found.type, found.metadata, take)
          bumpStat('chestsChecked')
          logEvent('chest', `took ${take}x ${found.name} from chest at ${pos} (searched ${searched} chests)`)
          say(`found ${take}x ${found.name} in a chest nearby (checked ${searched} chest${searched === 1 ? '' : 's'})`)
          return found.name
        } finally { try { chest.close() } catch (e) {} }
      } catch (e) { log('chest check failed at ' + pos + ': ' + e.message) }
    }
    say(`checked ${searched} chest${searched === 1 ? '' : 's'} nearby, no ${wantedNames[0]} in any of them`)
    return null
  }
  // v10.5.1: "Segs check the chests" / "what is in the chests nearby"
  // — open EVERY nearby chest, sum the contents by item, report the
  // totals (like the status fix: summed, every item, no truncation).
  async function checkAllChests () {
    const chests = findNearbyContainers(32)
    if (!chests.length) { say('i cant see any chest near me'); return }
    const totals = new Map()
    let opened = 0
    for (const pos of chests) {
      try {
        try { await gotoWithTimeout(new goals.GoalNear(pos.x, pos.y, pos.z, 1), 6000) } catch (e) { continue }
        const chestBlock = bot.blockAt(pos)
        if (!chestBlock || !chestBlock.name.includes('chest')) continue
        const chest = await bot.openChest(chestBlock)
        try {
          opened++
          for (const it of chest.containerItems()) {
            if (!it) continue
            totals.set(it.name, (totals.get(it.name) || 0) + it.count)
          }
        } finally { try { chest.close() } catch (e) {} }
      } catch (e) { log('check-all-chests failed at ' + pos + ': ' + e.message) }
    }
    if (!opened) { say('i couldnt open any chest nearby'); return }
    const parts = [...totals.entries()].map(([name, count]) => `${name} x${count}`)
    logEvent('chest', `checked ${opened} chests, contents: ${parts.join(', ') || 'empty'}`)
    if (!parts.length) { say(`checked ${opened} chest${opened === 1 ? '' : 's'} — they are all empty`); return }
    sayInventoryLines(`in ${opened} chest${opened === 1 ? '' : 's'} nearby: `, parts)
  }
  // Cook raw food in a smoker (fast, for food) or furnace. Checks for fuel first.
  // ---- v10.5: CRAFT / COOK / SMELT FROM NEARBY CHESTS ----
  // Ingredients, fuel and workstations no longer have to be in Segs'
  // inventory. Segs searches ALL chests / trapped chests within 12
  // blocks (double chests included — they are one container). SHULKERS
  // are NEVER opened or touched without the owner's explicit permission,
  // and ender chests are skipped too (personal storage).
  const SMELT_OUTPUT = { iron_ore: 'iron_ingot', deepslate_iron_ore: 'iron_ingot', gold_ore: 'gold_ingot', deepslate_gold_ore: 'gold_ingot', copper_ore: 'copper_ingot', deepslate_copper_ore: 'copper_ingot', ancient_debris: 'netherite_scrap', sand: 'glass', red_sand: 'glass', cobblestone: 'stone', stone: 'smooth_stone', clay_ball: 'brick', kelp: 'dried_kelp', cactus: 'green_dye', netherrack: 'nether_brick', beef: 'cooked_beef', porkchop: 'cooked_porkchop', chicken: 'cooked_chicken', mutton: 'cooked_mutton', rabbit: 'cooked_rabbit', cod: 'cooked_cod', salmon: 'cooked_salmon', potato: 'baked_potato' }
  const RAW_FOOD_WORDS = { beef: 'beef', pork: 'porkchop', porkchop: 'porkchop', chicken: 'chicken', mutton: 'mutton', rabbit: 'rabbit', cod: 'cod', salmon: 'salmon', fish: 'cod' }
  // "cook beef" means beef (the raw item is just 'beef' — there is
  // no 'raw_beef' item in 1.13+). The alias table maps beef to
  // cooked_beef (for eating), which is wrong for cooking. Un-alias
  // cooked food words back to their raw form for cook/smelt.
  function rawNameFor (name) {
    if (!name) return name
    if (RAW_FOOD_WORDS[name]) return RAW_FOOD_WORDS[name]
    if (name === 'cooked_beef') return 'beef'
    if (name === 'cooked_porkchop') return 'porkchop'
    if (name === 'cooked_chicken') return 'chicken'
    if (name === 'cooked_mutton') return 'mutton'
    if (name === 'cooked_rabbit') return 'rabbit'
    if (name === 'cooked_cod') return 'cod'
    if (name === 'cooked_salmon') return 'salmon'
    return name
  }
  // v10.5.1 CHEST SCAN FIX (Tash: "he just checked the next block
  // chest, but beside that one there was another double chest"):
  // findBlocks DEFAULTS count to 1 when omitted (fork blocks.js:160),
  // so this only ever returned ONE chest however many were beside it.
  // Now: count 100, radius 32 (a real player sees the whole room,
  // not just 12 blocks), double chests deduped to one position (keep
  // the west/north half — opening either half opens the same
  // container), and every container seen is REMEMBERED in brain
  // (pos + type, not contents) so Segs knows what is in his base
  // even when he is not standing next to it.
  function findNearbyContainers (radius = 32) {
    try {
      const raw = bot.findBlocks({ matching: b => b && (b.name === 'chest' || b.name === 'trapped_chest' || b.name === 'barrel'), maxDistance: radius, count: 100 })
      const seen = new Set()
      const out = []
      for (const pos of raw) {
        const key = pos.x + ',' + pos.y + ',' + pos.z
        if (seen.has(key)) continue
        seen.add(key)
        // double chest: if the west or north neighbour is also a
        // chest, this is the second half — skip it (one container).
        const w = bot.blockAt(new Vec3(pos.x - 1, pos.y, pos.z))
        const n = bot.blockAt(new Vec3(pos.x, pos.y, pos.z - 1))
        if ((w && (w.name === 'chest' || w.name === 'trapped_chest')) || (n && (n.name === 'chest' || n.name === 'trapped_chest'))) continue
        out.push(pos)
      }
      // container memory (Wurst ChestESP point): remember every
      // container seen, so "list chests" and cook/craft can use them
      // even when Segs is not standing next to them right now.
      try {
        if (!brain.containers) brain.containers = []
        for (const pos of out) {
          const b = bot.blockAt(pos)
          const type = b ? b.name : 'chest'
          if (!brain.containers.some(c => c.pos[0] === pos.x && c.pos[1] === pos.y && c.pos[2] === pos.z)) {
            brain.containers.push({ pos: [pos.x, pos.y, pos.z], type, seenAt: Date.now() })
          }
        }
        if (brain.containers.length > 60) brain.containers = brain.containers.slice(-60)
        saveBrain()
      } catch (e) {}
      return out
    } catch (e) { return [] }
  }
  // Open each nearby chest in turn and withdraw what is needed.
  // Returns { got, searched } — got is how many were taken.
  async function withdrawFromChests (itemName, count, radius = 32) {
    const mcData = mcDataFor(bot.version)
    const def = mcData.itemsByName[itemName] || mcData.blocksByName[itemName]
    if (!def) return { got: 0, searched: 0 }
    // v10.5 run 112 fix: findBlocks only sees LOADED chunks. Right
    // after a spawn/teleport the chest's chunk may not be in yet, so a
    // first search can return 0 chests even though one is 2 blocks
    // away (run 112 beef leg: "checked 0 chests"). Wait 1.5s and retry
    // once before concluding there are no chests.
    // v10.5 run 112b fix: one 1.5s retry is not enough — after a
    // teleport the chunk data can take several seconds to arrive even
    // for a chest 2 blocks away (beef leg still found 0 chests at
    // 1.5s, the same chest was found 36s later). Retry up to 3 times
    // (4.5s total) before concluding there are no chests.
    let chests = findNearbyContainers(radius)
    for (let attempt = 0; !chests.length && attempt < 3; attempt++) {
      await sleepMs(1500)
      chests = findNearbyContainers(radius)
    }
    // v10.5.1 CONTAINER MEMORY: also try REMEMBERED containers within
    // the radius that are not currently visible (chunk not loaded, or
    // Segs walked away). Each walk is capped, so an unreachable
    // remembered chest is skipped, not waited on. Sorted nearest-first
    // so the closest chest with the item is tried before a far one.
    try {
      const seenPos = new Set(chests.map(p => p.x + ',' + p.y + ',' + p.z))
      for (const c of (brain.containers || [])) {
        const key = c.pos[0] + ',' + c.pos[1] + ',' + c.pos[2]
        if (seenPos.has(key)) continue
        const d = Math.hypot(c.pos[0] - bot.entity.position.x, c.pos[2] - bot.entity.position.z)
        if (d > radius) continue
        chests.push(new Vec3(c.pos[0], c.pos[1], c.pos[2]))
      }
      chests.sort((a, b) => (Math.hypot(a.x - bot.entity.position.x, a.z - bot.entity.position.z) - Math.hypot(b.x - bot.entity.position.x, b.z - bot.entity.position.z)))
    } catch (e) {}
    let got = 0
    for (const pos of chests) {
      if (got >= count) break
      try {
        // v10.5.1 (item 3): CAP the walk to the chest at 6s. The
        // unbounded gotoPosQuiet HANGS forever if the chest is
        // unreachable — run 113: after the house is built, the mats
        // chest sits UNDER the floor cell (-138,71,160), so the
        // pathfinder can never route to it and ensureItem never
        // returns (the second build produced nothing for 54s). A
        // chest Segs cannot reach in 6s is skipped, not waited on.
        // v10.5.1 CHEST SCAN: the cap is distance-aware — a chest
        // 20 blocks away needs ~10s to walk to, a chest under the
        // floor is unreachable at any cap. Cap = 5s + 0.8s per block,
        // max 20s, so far-but-reachable chests are reached and
        // unreachable ones still fail fast.
        const chestDist = bot.entity ? Math.hypot(pos.x - bot.entity.position.x, pos.z - bot.entity.position.z) : 0
        const walkCap = Math.min(20000, 5000 + Math.round(chestDist * 800))
        try { await gotoWithTimeout(new goals.GoalNear(pos.x, pos.y, pos.z, 1), walkCap) } catch (e) {
          log('chest walk to ' + pos + ' failed: ' + e.message)
          // v10.5.1: a remembered chest Segs cannot walk to is stale
          // (broken, or from an old area) — forget it so the next
          // search does not waste another walk on it. It is re-added
          // if findNearbyContainers ever sees it again.
          try {
            if (brain.containers) {
              const before = brain.containers.length
              brain.containers = brain.containers.filter(c => !(c.pos[0] === pos.x && c.pos[1] === pos.y && c.pos[2] === pos.z))
              if (brain.containers.length !== before) saveBrain()
            }
          } catch (e2) {}
          continue
        }
        const block = bot.blockAt(pos)
        if (!block || !block.name.includes('chest')) continue
        const chest = await bot.openChest(block)
        try {
          const items = chest.containerItems()
          const found = items.find(i => i && i.type === def.id)
          if (found) {
            const take = Math.min(count - got, found.count)
            await chest.withdraw(found.type, found.metadata, take)
            got += take
            bumpStat('chestsChecked')
            logEvent('chest', `took ${take}x ${itemName} from chest at ${pos}`)
          }
        } finally { try { chest.close() } catch (e) {} }
      } catch (e) { log('chest withdraw failed at ' + pos + ': ' + e.message) }
    }
    return { got, searched: chests.length }
  }
  // Make sure Segs holds `count` of an item: inventory first, then
  // nearby chests. Returns { have, searched }.
  async function ensureItem (itemName, count, radius = 32) {
    const mcData = mcDataFor(bot.version)
    const def = mcData.itemsByName[itemName] || mcData.blocksByName[itemName]
    if (!def) return { have: 0, searched: 0 }
    let have = bot.inventory.count(def.id, null)
    if (have >= count) return { have, searched: 0 }
    const res = await withdrawFromChests(itemName, count - have, radius)
    have = bot.inventory.count(def.id, null)
    return { have, searched: res.searched }
  }
  // Find a workstation: a taught landmark first, else the nearest
  // matching block within 12. Returns the block or null.
  function findWorkstation (names, radius = 12) {
    for (const mark of Object.values(brain.landmarks || {})) {
      if (mark) {
        const markName = mark.type === 'table' ? 'crafting_table' : mark.type
        if (names.includes(markName)) {
          const b = bot.blockAt(new Vec3(mark.pos[0], mark.pos[1], mark.pos[2]))
          if (b && names.includes(b.name)) return b
        }
      }
    }
    try { return bot.findBlock({ matching: b => b && names.includes(b.name), maxDistance: radius }) } catch (e) { return null }
  }
  // Cook raw food in a smoker (fast, for food) or furnace. Checks for fuel first.
  // v10.5: cookOrSmelt (below) does the real work — input AND fuel are
  // fetched from nearby chests when Segs does not carry them, the right
  // workstation is found within 12 blocks, and the output is polled
  // until it is actually cooked (the old fixed 12s wait was too short
  // for 4x beef in a smoker: 5s each = 20s) and taken out.
  async function cookFood (rawName, count = 4) {
    return cookOrSmelt(rawName, count, 'cook')
  }
  // Cook or smelt, fetching input + fuel from nearby chests when
  // needed, using the right workstation, and TAKING the output out.
  // verb is 'cook' (food, prefers a smoker) or 'smelt' (ores, prefers
  // a blast furnace, furnace otherwise). Returns true on success.
  async function cookOrSmelt (itemName, count = 4, verb = 'cook') {
    const mcData = mcDataFor(bot.version)
    let rawName = rawNameFor(aliasItem(itemName))
    // "smelt iron" -> iron_ingot is not smeltable; the ore is.
    const INGOT_TO_ORE = { iron_ingot: 'iron_ore', gold_ingot: 'gold_ore', copper_ingot: 'copper_ore' }
    if (INGOT_TO_ORE[rawName]) rawName = INGOT_TO_ORE[rawName]
    const outName = SMELT_OUTPUT[rawName] || COOKABLE[rawName]
    if (!outName) { say(`${rawName} cant be ${verb === 'cook' ? 'cooked' : 'smelted'}`); return false }
    const isFood = !!COOKABLE[rawName]
    // 1. input: inventory first, then nearby chests (12 blocks)
    const input = await ensureItem(rawName, count)
    if (input.have <= 0) {
      say(`i dont have any ${rawName} — i checked ${input.searched} chest(s) nearby and found none`)
      logEvent('smelt', `missing input ${rawName} (searched ${input.searched} chests)`)
      return false
    }
    const toCook = Math.min(count, input.have)
    // 2. fuel: inventory first, then chests (coal, charcoal, then logs/planks)
    let fuel = bot.inventory.items().find(i => FUEL_ITEMS.includes(i.name))
    let fuelSearched = 0
    if (!fuel) {
      let r = await withdrawFromChests('coal', 1)
      fuelSearched = r.searched
      if (!r.got) { r = await withdrawFromChests('charcoal', 1); fuelSearched = Math.max(fuelSearched, r.searched) }
      fuel = bot.inventory.items().find(i => FUEL_ITEMS.includes(i.name))
      if (!fuel) {
        r = await withdrawFromChests('oak_log', 1)
        fuelSearched = Math.max(fuelSearched, r.searched)
        if (!r.got) { r = await withdrawFromChests('oak_planks', 1); fuelSearched = Math.max(fuelSearched, r.searched) }
        fuel = bot.inventory.items().find(i => FUEL_ITEMS.includes(i.name))
      }
    }
    if (!fuel) {
      say(`i have ${toCook}x ${rawName} but no fuel — no coal or wood in my inventory or the ${fuelSearched} chest(s) nearby`)
      logEvent('smelt', `missing fuel for ${rawName} (searched ${fuelSearched} chests)`)
      return false
    }
    // 3. workstation: smoker for food, blast furnace for ores, furnace otherwise
    const wantNames = (verb === 'cook' && isFood) ? ['smoker', 'furnace'] : (!isFood ? ['blast_furnace', 'furnace'] : ['furnace', 'smoker'])
    const cooker = findWorkstation(wantNames, 12)
    if (!cooker) {
      const want = (verb === 'cook' && isFood) ? 'a smoker or furnace' : (!isFood ? 'a blast furnace or furnace' : 'a furnace')
      say(`i have ${toCook}x ${rawName} and fuel, but there is no ${want} within 12 blocks of me`)
      logEvent('smelt', `missing workstation for ${rawName} (wanted ${wantNames.join('/')})`)
      return false
    }
    // 4. cook it, polling the output slot until it is actually done,
    // then TAKE the output out (never leave it in the furnace).
    try {
      await gotoPos(cooker.position)
      const win = await bot.openFurnace(cooker)
      const raw = mcData.itemsByName[rawName] || mcData.blocksByName[rawName]
      const have = bot.inventory.items().find(i => i.type === raw.id)
      if (!have) { say(`i lost track of the ${rawName}`); win.close(); return false }
      const outDef = mcData.itemsByName[outName]
      const beforeOut = outDef ? bot.inventory.count(outDef.id, null) : 0
      const n = Math.min(toCook, have.count)
      say(`cooking ${n}x ${rawName} in the ${cooker.name}`)
      await win.putInput(have.type, null, n)
      await win.putFuel(fuel.type, null, 1)
      logEvent('smelt', `cooking ${n}x ${rawName} in ${cooker.name} with ${fuel.name}`)
      const perItem = cooker.name === 'furnace' ? 10000 : 5000
      const deadline = Date.now() + n * perItem + 10000
      // v10.5 run 112 fix: do NOT break after the first output — a
      // blast furnace makes 1 ingot per 5s, so taking the first ingot
      // at 6s and stopping left 3 ore still cooking (got 1x from 4x).
      // Keep polling until all n are out or the deadline passes.
      // v10.5.1: a newer command cancels the cook — stop polling and
      // stay silent (no stale "got X" after the owner moved on).
      const cookToken = moveToken
      while (Date.now() < deadline) {
        await sleepMs(2000)
        if (cookToken !== moveToken) { try { win.close() } catch (e) {}; return false }
        try { await win.takeOutput() } catch (e) { /* output not ready yet */ }
        const gotSoFar = outDef ? bot.inventory.count(outDef.id, null) - beforeOut : 0
        if (gotSoFar >= n) break
      }
      if (cookToken !== moveToken) { try { win.close() } catch (e) {}; return false }
      try { await win.takeOutput() } catch (e) {}
      win.close()
      const gotOut = outDef ? bot.inventory.count(outDef.id, null) - beforeOut : 0
      bumpStat('smeltsDone')
      if (gotOut > 0) {
        say(`got ${gotOut}x ${outName}`)
        logEvent('smelt', `done: got ${gotOut}x ${outName} from ${n}x ${rawName}`)
        return true
      }
      say(`the ${cooker.name} is still cooking — nothing came out yet, give it a bit longer`)
      logEvent('smelt', `output not ready in time for ${n}x ${rawName}`)
      return false
    } catch (e) { log('cook failed: ' + e.message); say('couldnt cook that'); return false }
  }
  // The full survival routine. Run by "Segs get food" / "Segs survive",
  // and on its own when the hunger watchdog fires.
  let surviving = false
  async function survive () {
    if (surviving) { say('already sorting food out, give me a sec'); return }
    surviving = true
    bumpStat('timesHungry')
    try {
      logEvent('survive', `survival routine started, food ${bot.food}/20 health ${Math.round(bot.health)}/20`)
      // 1. already have food? just eat.
      const food = hasFood()
      if (food) {
        say(`i have ${food.name}, eating now`)
        // v10.5.2: verified eat — the old code counted foodEaten and
        // said "fed, all good" even when the eat timed out or was
        // refused, and could drop food at full hunger.
        if (await tryEatOnce()) { bumpStat('foodEaten'); say('fed, all good') }
        else say(bot.food >= 20 ? 'im already full' : 'i tried to eat but my hunger didnt go up')
        return
      }
      say('i need food, going to get some')
      // v10.3: wheat in inventory? make bread FIRST (3 wheat = 1
      // bread) instead of walking to a farm while holding food.
      const wheatHeld = bot.inventory.items().find(i => i.name === 'wheat')
      if (wheatHeld && wheatHeld.count >= 3) {
        const breads = Math.floor(wheatHeld.count / 3)
        say(`i have wheat, making ${breads}x bread`)
        await doCraft('bread', breads)
        const bread = bot.inventory.items().find(i => i.name === 'bread')
        if (bread) { if (await tryEatOnce()) { bumpStat('foodEaten'); say('fed, all good') } else say(bot.food >= 20 ? 'im already full' : 'i tried to eat but my hunger didnt go up'); return }
      }
      // 2. raw food in inventory? cook it.
      const raw = hasRawFood()
      if (raw) {
        say(`i have raw ${raw.name}, cooking it`)
        if (await cookFood(raw.name, 4)) { if (await tryEatOnce()) { bumpStat('foodEaten'); say('fed, all good') } else say(bot.food >= 20 ? 'im already full' : 'i tried to eat but my hunger didnt go up') }
        return
      }
      // 3. go to a farm we were shown (potato first, then any farm landmark)
      const farmMark = Object.values(brain.landmarks || {}).find(l => l.type === 'farm' && l.crop === 'potato')
        || Object.values(brain.landmarks || {}).find(l => l.type === 'farm')
      if (farmMark) {
        say(`going to the ${farmMark.crop || ''} farm to harvest`)
        logEvent('survive', `going to ${farmMark.name} farm at ${farmMark.pos}`)
        await gotoPos(new Vec3(farmMark.pos[0], farmMark.pos[1], farmMark.pos[2]))
        startFarming(farmMark.crop || 'potato')
        await sleepMs(12000)
        stopFarming()
        const got = bot.inventory.items().find(i => i.name === 'potato' || i.name === 'carrot' || i.name === 'wheat' || i.name === 'beetroot')
        if (got) {
          // v10.3: WHEAT -> BREAD. Wheat is not edible raw and not
          // cookable — the old code said "got wheat, cooking it now"
          // then fell through to "the farm had nothing ripe to eat"
          // while HOLDING 24 wheat (Tash's screenshot). 3 wheat = 1
          // bread, and bread IS food. Craft it and eat it.
          if (got.name === 'wheat') {
            const wheatCount = bot.inventory.count(mcDataFor(bot.version).itemsByName.wheat.id, null)
            const breads = Math.floor(wheatCount / 3)
            if (breads > 0) {
              say(`got wheat, making ${breads}x bread`)
              await doCraft('bread', breads)
              const bread = bot.inventory.items().find(i => i.name === 'bread')
              if (bread) { if (await tryEatOnce()) { bumpStat('foodEaten'); say('fed, all good') } else say(bot.food >= 20 ? 'im already full' : 'i tried to eat but my hunger didnt go up'); return }
              say('couldnt make bread — i need a crafting table nearby'); return
            }
          }
          say(`got ${got.name}, cooking it now`)
          if (got.name === 'potato' && await cookFood('potato', 4)) { if (await tryEatOnce()) { bumpStat('foodEaten'); say('fed, all good') } else say(bot.food >= 20 ? 'im already full' : 'i tried to eat but my hunger didnt go up'); return }
          if (FOOD_ITEMS.includes(got.name)) { if (await tryEatOnce()) { bumpStat('foodEaten'); say('fed, all good') } else say(bot.food >= 20 ? 'im already full' : 'i tried to eat but my hunger didnt go up'); return }
        }
        say('the farm had nothing ripe to eat')
      }
      // 4. check a chest for food
      say('checking the chest for food')
      const fromChest = await checkChestFor(FOOD_ITEMS)
      if (fromChest) { if (await tryEatOnce()) { bumpStat('foodEaten'); say('fed, all good') } else say(bot.food >= 20 ? 'im already full' : 'i tried to eat but my hunger didnt go up'); return }
      // 5. nothing worked - ask the owner, out loud, like a player would
      say('i need food and i cant find any, can you give me some or show me the farm')
      logEvent('survive', 'survival routine ended: no food found, asked owner')
    } finally { surviving = false }
  }
  // Hunger watchdog: every 30s, if Segs is getting hungry, it sorts
  // itself out. It says so in chat first, and it will not spam (60s
  // cooldown). Threshold 19 matches autoEat's minHunger: autoEat eats what
  // Segs has; if it has nothing, food keeps falling and this takes over.
  // v10.5.1: fires whenever hungry, NOT only when idle — Tash: "he
  // should have auto eat, when hunger bar drops below 19, he eats".
  // The old idle-only + 5-min cooldown meant Segs walked around hungry.
  // (Simulation run 4: threshold was <12 with a 60s check — food sat at
  // exactly 12 at the check and the watchdog never fired. 30s + <14 fixes it.)
  let lastHungrySay = 0
  setInterval(() => {
    try {
      if (!bot || !bot.entity || bot.health <= 0) return
      if (bot.food < 19 && Date.now() - lastHungrySay > 60 * 1000) {
        lastHungrySay = Date.now()
        say('im getting hungry, sorting food out myself')
        survive().catch(e => log('survive watchdog: ' + e.message))
      }
      updateSprint()
      // v8: a bed remembered during the day — sleep in it tonight to set spawn
      if (brain.pendingSpawnBed) sleepPendingBed().catch(e => log('sleepPendingBed: ' + e.message))
    } catch (e) {}
  }, 30000)

  // v8: enemy evade — check every 5s, flee like a villager if one gets close.
  setInterval(() => { evadeTick().catch(e => log('evade: ' + e.message)) }, 5000)

  // ---- v5: dig / mine / chop / place / fish / smelt ----
  // v10 NO-TOOL RULE: blocks that need a pickaxe. Digging one by hand
  // is slow and gives nothing from ores — Segs refuses and asks for
  // the tool instead.
  const NEEDS_PICKAXE = new Set([
    'stone', 'cobblestone', 'mossy_cobblestone', 'deepslate', 'cobbled_deepslate',
    'andesite', 'diorite', 'granite', 'tuff', 'calcite', 'basalt', 'blackstone',
    'netherrack', 'end_stone', 'obsidian', 'crying_obsidian', 'prismarine',
    'purpur_block', 'bricks', 'stone_bricks', 'nether_bricks', 'quartz_block',
    'coal_ore', 'deepslate_coal_ore', 'iron_ore', 'deepslate_iron_ore',
    'gold_ore', 'deepslate_gold_ore', 'diamond_ore', 'deepslate_diamond_ore',
    'emerald_ore', 'deepslate_emerald_ore', 'redstone_ore', 'deepslate_redstone_ore',
    'lapis_ore', 'deepslate_lapis_ore', 'copper_ore', 'deepslate_copper_ore',
    'nether_quartz_ore', 'nether_gold_ore', 'ancient_debris'
  ])
  async function digBlock (itemName, count) {
    const mcData = mcDataFor(bot.version)
    const blockName = aliasItem(itemName)
    const blockDef = mcData.blocksByName[blockName] || mcData.blocksByName[blockName.replace(/_log$/, '_log')]
    if (!blockDef) { say(`i dont know how to dig ${itemName}`); return }
    // v10 NO-TOOL RULE: stone / ore needs a pickaxe. No pickaxe in the
    // inventory = refuse, do not dig by hand.
    if (NEEDS_PICKAXE.has(blockName)) {
      const hasPick = bot.inventory.items().some(i => i.name.endsWith('_pickaxe'))
      if (!hasPick) {
        say(`i need a pickaxe to dig ${itemName} — i wont dig it by hand`)
        logEvent('dig', `refused to dig ${itemName} by hand (no pickaxe)`)
        return
      }
    }
    // only look nearby (16 blocks) - far targets make pathfinder wander and
    // hand-digging stone takes forever (simulation v5 run 2: never finished).
    const block = bot.findBlock({ matching: b => b.name === blockName, maxDistance: 16 })
    if (!block) { say(`i cant see any ${itemName} near me, get closer to some`); return }
    // equip the best tool for this block if we have one (mineflayer-tool)
    try { await bot.tool.equipForBlock(block) } catch (e) {}
    // v10.4 ANTIBREAK (patch S): check AFTER equipForBlock — the
    // equip re-picks the best tool and would undo the swap if the
    // check ran first (run 79: iron 5/250 was swapped out, then
    // re-equipped by equipForBlock).
    checkAntiBreak()
    say(`ok, digging ${count}x ${itemName}`)
    let dug = 0
    for (let i = 0; i < count; i++) {
      const b = bot.findBlock({ matching: x => x.name === blockName, maxDistance: 16 })
      if (!b) break
      try {
        // v10.4 AUTOMINE (Wurst default): hold attack at NORMAL speed
        // with the CORRECT tool for the block (mineflayer-tool plugin).
        // No super-fast mode. Re-equip per block — the best tool can
        // change as Segs moves between blocks.
        try { await bot.tool.equipForBlock(bot.blockAt(b.position)) } catch (e) {}
        checkAntiBreak() // v10.4 ANTIBREAK (patch S): after the equip, so the swap sticks
        logEvent('automine', 'digging ' + blockName + ' with ' + (bot.heldItem ? bot.heldItem.name : 'hand'))
        await gotoPos(b.position)
        await bot.dig(bot.blockAt(b.position))
        dug++
        // learn where it found this stuff
        brain.found[blockName] = [Math.floor(b.position.x), Math.floor(b.position.y), Math.floor(b.position.z)]; saveBrain()
      } catch (e) { log('dig failed: ' + e.message); break }
    }
    say(dug > 0 ? `dug ${dug}x ${itemName}` : `couldnt dig ${itemName}, maybe i need a better tool`)
    if (dug > 0) { bumpStat('blocksDug', dug); logEvent('dig', `dug ${dug}x ${itemName}`) }
  }
  async function placeBlock (itemName, count) {
    const mcData = mcDataFor(bot.version)
    const blockName = aliasItem(itemName)
    const item = bot.inventory.items().find(i => i.name === blockName || i.name === itemName)
    if (!item) { say(`i dont have any ${itemName} to place, give me some`); return }
    const ref = bot.blockAt(bot.entity.position.offset(0, -1, 0))
    if (!ref || ref.name === 'air') { say('i need solid ground under me to place that'); return }
    try {
      await bot.equip(item, 'hand')
      await bot.placeBlock(ref, new Vec3(0, 1, 0))
      say(`placed ${itemName}`)
    } catch (e) { log('place failed: ' + e.message); say(`couldnt place ${itemName} here`) }
  }
  async function goFishing () {
    const rod = bot.inventory.items().find(i => i.name === 'fishing_rod')
    if (!rod) { say('i need a fishing rod to fish, give me one'); return }
    const water = bot.findBlock({ matching: b => b.name === 'water', maxDistance: 8 })
    if (!water) { say('i need water nearby to fish'); return }
    try {
      await bot.equip(rod, 'hand')
      say('fishing, give me a sec')
      await bot.fish()
      say('caught something')
    } catch (e) { log('fish failed: ' + e.message); say('didnt catch anything this time') }
  }
  async function smeltItem (itemName, count) {
    // v10.5: smelt/cook now go through cookOrSmelt (chest input + fuel,
    // right workstation, output taken out). Kept as a wrapper so older
    // callers still work.
    await cookOrSmelt(itemName, count, 'smelt')
  }
  async function dropAll () {
    const keep = ['iron_sword', 'diamond_sword', 'iron_pickaxe', 'diamond_pickaxe', 'bow', 'shield']
    const items = bot.inventory.items().filter(i => !keep.includes(i.name))
    if (!items.length) { say('nothing to drop'); return }
    for (const item of items) { try { await bot.toss(item.type, null, item.count) } catch (e) {} }
    say(`dropped ${items.length} stacks, kept my tools`)
  }

  // ---- v10.5: AUTOBUILD SCHEMATIC TOOL v1 ----
  // Schematics live in schematics/ as JSON:
  //   { "name": "house", "blocks": [{ "dx": 0, "dy": 0, "dz": 0, "block": "cobblestone" }] }
  // relative to a marked origin ("Segs this is the build site").
  // "Segs build house here" counts the mats, searches nearby chests
  // (16 blocks) for mats AND raw mats, crafts what it can from raw
  // (planks from logs, sticks from planks), reports the exact
  // missing-mats list and STOPS if anything is missing, then builds
  // layer by layer (Y ascending, nearest-first in each layer) at
  // HUMAN speed — 1 block per tick, normal reach, line of sight.
  // It NEVER breaks a non-air block, NEVER uses fastPlace or 6-block
  // reach (those were the CHEAT parts of NiceWurst AutoBuild).
  const RAW_CRAFT = { oak_planks: 'oak_log', spruce_planks: 'spruce_log', birch_planks: 'birch_log', stick: 'oak_planks' }
  function loadSchematic (name) {
    try {
      const safe = String(name || '').replace(/[^a-z0-9_-]/gi, '')
      const p = require('path').join(__dirname, 'schematics', safe + '.json')
      const data = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (!data || !Array.isArray(data.blocks) || !data.blocks.length) return null
      return data
    } catch (e) { return null }
  }
  async function autobuild (name) {
    // v10.5.1 (item 3): one build at a time. A second "build house
    // here" while a build is running used to start a SECOND build
    // loop — the two loops interleaved, both moving Segs and placing,
    // and neither ever finished or reported (run 113: the first build
    // never said its summary, the second was cut off by the run end).
    if (globalThis._autobuildRunning) { say('im already building — wait for this one to finish'); return }
    globalThis._autobuildRunning = true
    try {
    const schem = loadSchematic(name)
    if (!schem) { say(`i dont have a schematic called ${name} — check schematics/${name}.json`); return }
    if (!brain.buildSite) { say('i dont know where the build site is — stand at the corner and tell me: segs this is the build site'); return }
    const origin = brain.buildSite.pos
    // count materials
    const need = {}
    for (const b of schem.blocks) need[b.block] = (need[b.block] || 0) + 1
    // gather: inventory + chests within 16, crafting raw mats where possible
    let searched = 0
    for (const [mat, n] of Object.entries(need)) {
      const res = await ensureItem(mat, n, 16)
      searched = Math.max(searched, res.searched)
      if (res.have < n && RAW_CRAFT[mat]) {
        // try crafting the shortfall from raw (planks from logs, etc.)
        const short = n - res.have
        const rawMat = RAW_CRAFT[mat]
        const rawRes = await ensureItem(rawMat, short, 16)
        searched = Math.max(searched, rawRes.searched)
        if (rawRes.have > 0) {
          const perRaw = mat === 'stick' ? 2 : 4 // 1 log -> 4 planks, 1 plank -> 2 sticks
          const crafts = Math.ceil(short / perRaw)
          await doCraft(mat, crafts * perRaw)
        }
      }
    }
    const missing = []
    for (const [mat, n] of Object.entries(need)) {
      const mcData = mcDataFor(bot.version)
      const def = mcData.itemsByName[mat] || mcData.blocksByName[mat]
      const have = def ? bot.inventory.count(def.id, null) : 0
      if (have < n) missing.push(`${n - have}x ${mat}`)
    }
    if (missing.length) {
      say(`i cant build ${schem.name || name} — im missing ${missing.join(', ')} (checked ${searched} chest(s) within 16 blocks)`)
      logEvent('autobuild', `${name}: missing ${missing.join(', ')}`)
      return
    }
    say(`building ${schem.name || name} — ${schem.blocks.length} blocks, layer by layer`)
    logEvent('autobuild', `${name}: starting, ${schem.blocks.length} blocks from origin ${origin.join(',')}`)
    // v10.5 run 113 fix: BUILD FROM OUTSIDE. The first build placed
    // only 23/65 because Segs walked INSIDE the footprint to place the
    // floor, then could not step aside (it was standing on the next
    // cell, "im stuck"), so placeBlock was refused and the roof had
    // nothing to attach to. Segs now NEVER stands inside the
    // footprint — it works from the perimeter (reach 4.5 covers a 5x5
    // house from outside) and steps out before every place.
    let minDx = Infinity, maxDx = -Infinity, minDz = Infinity, maxDz = -Infinity
    for (const b of schem.blocks) {
      minDx = Math.min(minDx, b.dx); maxDx = Math.max(maxDx, b.dx)
      minDz = Math.min(minDz, b.dz); maxDz = Math.max(maxDz, b.dz)
    }
    const insideFootprint = (x, z) => x >= origin[0] + minDx - 0.5 && x <= origin[0] + maxDx + 0.5 && z >= origin[2] + minDz - 0.5 && z <= origin[2] + maxDz + 0.5
    // a stand point outside the footprint, within reach of the cell
    const standOutside = (cell) => {
      const cands = []
      for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (const d of [2, 3, 4]) {
          const px = cell.x + 0.5 + sx * d, pz = cell.z + 0.5 + sz * d
          if (!insideFootprint(px, pz)) { cands.push(new Vec3(px, cell.y, pz)); break }
        }
      }
      if (!cands.length) return null
      const cur = bot.entity.position
      cands.sort((a, b) => a.distanceTo(cur) - b.distanceTo(cur))
      return cands[0]
    }
    // layer by layer (Y ascending), nearest-first within each layer
    const layers = {}
    for (const b of schem.blocks) { (layers[b.dy] = layers[b.dy] || []).push(b) }
    const dys = Object.keys(layers).map(Number).sort((a, b) => a - b)
    let placed = 0, skipped = 0, wrong = 0
    for (const dy of dys) {
      const layer = layers[dy]
      // nearest-first from Segs' current position
      const cur = bot.entity.position
      layer.sort((a, b) => {
        const da = Math.hypot(origin[0] + a.dx - cur.x, origin[2] + a.dz - cur.z)
        const db = Math.hypot(origin[0] + b.dx - cur.x, origin[2] + b.dz - cur.z)
        return da - db
      })
      for (const b of layer) {
        if (!bot || !bot.entity || bot.health <= 0) break
        const cell = new Vec3(origin[0] + b.dx, origin[1] + b.dy, origin[2] + b.dz)
        const existing = bot.blockAt(cell)
        if (existing && existing.name !== 'air') { skipped++; logEvent('autobuild', `skipped ${cell} — ${existing.name} already there`); continue }
        // never stand inside the footprint — step out first, then
        // stand outside within reach of the cell
        const feet = bot.entity.position
        // 6s cap per stand move — a blocked stand point is abandoned,
        // not waited on for the pathfinder's full ~25s timeout.
        // v10.5.1 (item 3): cancel the stale pathfinder goal after
        // the race. Promise.race leaves the loser's goal RUNNING —
        // when the 6s sleep wins, gotoPosQuiet's goal keeps driving
        // Segs (and its lookAt) while the place fires, so the place
        // is refused ("Server refused to place ... the block is still
        // air") while Segs is still settling from the step-out
        // (run 113e). setGoal(null) kills the stale goal.
        const moveCapped = async (p) => {
          try { await Promise.race([gotoPosQuiet(p), sleepMs(6000)]) } catch (e) {}
          try { bot.pathfinder.setGoal(null) } catch (e) {}
          try { bot.clearControlStates() } catch (e) {}
        }
        let standMoved = false
        if (insideFootprint(feet.x, feet.z)) {
          const out = standOutside(cell)
          if (out) { await moveCapped(out); standMoved = true }
        }
        const dist = bot.entity.position.distanceTo(new Vec3(cell.x + 0.5, cell.y, cell.z + 0.5))
        if (dist > 3.5 || insideFootprint(bot.entity.position.x, bot.entity.position.z)) {
          const stand = standOutside(cell)
          if (stand) { await moveCapped(stand); standMoved = true }
        }
        // reference block: the solid block below, else any solid neighbour
        // v10.5.1 (item 3): NEVER place against a CONTAINER. A
        // right-click on a chest/furnace/crafting table OPENS it
        // instead of placing the block (the server treats the click
        // as "use", not "place") — run 113: the floor cell (-138,71,160)
        // sits directly above the mats chest, so its ref was the chest
        // and every attempt was refused ("Server refused to place ...
        // the block is still air"). Skip containers and use a
        // neighbouring already-placed cell (or the ground) instead.
        const isContainer = (b) => b && b.name && (
          b.name === 'chest' || b.name === 'trapped_chest' || b.name === 'ender_chest' ||
          b.name === 'barrel' || b.name === 'furnace' || b.name === 'smoker' ||
          b.name === 'blast_furnace' || b.name === 'crafting_table' || b.name === 'hopper' ||
          b.name === 'dropper' || b.name === 'dispenser' || b.name === 'brewing_stand' ||
          b.name === 'enchanting_table' || b.name === 'anvil' || b.name.endsWith('_shulker_box')
        )
        // v10.5.1 (item 3): the ref search reads the CLIENT's world
        // state, which lags the server by a tick or two — a neighbour
        // placed a moment ago still reads as air. Run 113 retest: the
        // chest cell (-138,71,160) skipped with "nothing solid to
        // place against" because the chest is (correctly) skipped as a
        // container and its just-placed cobblestone neighbours had not
        // landed in the client's state yet. Wait 500ms and re-run the
        // ref search once before giving up on the cell.
        const findRef = () => {
          const b0 = bot.blockAt(cell.offset(0, -1, 0))
          if (b0 && b0.name !== 'air' && !isContainer(b0)) return { ref: b0, face: new Vec3(0, 1, 0) }
          for (const [ox, oy, oz, fx, fy, fz] of [[1,0,0,-1,0,0],[-1,0,0,1,0,0],[0,0,1,0,0,-1],[0,0,-1,0,0,1],[0,1,0,0,-1,0],[0,-1,0,0,1,0]]) {
            const nb = bot.blockAt(cell.offset(ox, oy, oz))
            if (nb && nb.name !== 'air' && !isContainer(nb)) return { ref: nb, face: new Vec3(fx, fy, fz) }
          }
          return null
        }
        let found = findRef()
        if (!found) { await sleepMs(500); found = findRef() }
        if (!found) { skipped++; logEvent('autobuild', `skipped ${cell} — nothing solid to place against`); continue }
        const ref = found.ref, face = found.face
        // v10.5.1 (item 3): settle BEFORE every place, not just on
        // retry. The north edge (z=160) lost blocks to "Server refused
        // to place" because Segs was still settling from the stand
        // move when the first place fired (run 113e). Wait for
        // onGround=true AND ~stillness before every place attempt.
        // Speed is the cost: the first version used a 3s cap + 0.05
        // threshold and the build took 260s (the velocity rarely drops
        // below 0.05, so almost every cell burned the full 3s). Now:
        // 1500ms cap, 0.1 threshold (a slow drift does not break a
        // place — only a moving Segs does), and NO settle at all when
        // no stand move happened (Segs is already still).
        const settleBeforePlace = async () => {
          if (!standMoved) { await sleepMs(200); return true }
          const t0 = Date.now()
          while (Date.now() - t0 < 1500) {
            const v = bot.entity ? bot.entity.velocity : null
            const sp = v ? Math.hypot(v.x, v.z) : 99
            if (bot.entity && bot.entity.onGround && sp < 0.1) {
              await sleepMs(300)
              const v2 = bot.entity.velocity
              if (v2 && Math.hypot(v2.x, v2.z) < 0.1 && bot.entity.onGround) return true
            }
            await sleepMs(100)
          }
          return false
        }
        // v10.5 run 113d fix: retry each place. The north edge
        // (z=160) lost 20 blocks to transient "Server refused to place"
        // — Segs is still settling from the stand move when the first
        // place fires. A second try (re-stand, re-equip, 300ms settle)
        // lands the ones the first attempt missed.
        // v10.5.1 (item 3): up to 3 attempts (was 2), each with a
        // fresh lookAt + re-equip + settle, so a transient refusal
        // does not cost a block.
        let done = false
        for (let attempt = 0; attempt < 3 && !done; attempt++) {
          if (attempt > 0) {
            const stand2 = standOutside(cell)
            if (stand2) await moveCapped(stand2)
          }
          await settleBeforePlace()
          // face the cell fresh every attempt — a stale look from the
          // stand move is what the server refuses on.
          try { await bot.lookAt(new Vec3(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5)) } catch (e) {}
          // v10.5.1 (item 3): let the server RECEIVE the look before
          // the place fires. lookAt resolves when the look is set
          // locally, but the look packet rides the next per-tick
          // position packet — firing placeBlock in the same tick means
          // the server raycasts the OLD look and refuses/misses
          // (run 113: (-140,72,160) "did not answer" x3 despite a
          // fresh lookAt each attempt). 200ms is ~4 ticks of margin.
          await sleepMs(200)
          // re-find the item FRESH on every equip attempt (a stale
          // slot from a previous place desyncs the equip), close any
          // stale window first, settle 300ms, 3 tries.
          let held = false
          for (let e = 0; e < 3 && !held; e++) {
            const fresh = bot.inventory.items().find(i => i.name === b.block)
            if (!fresh) break
            try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow) } catch (err) {}
            try { await bot.equip(fresh, 'hand') } catch (err) {}
            await sleepMs(300)
            held = !!(bot.heldItem && bot.heldItem.name === b.block)
          }
          if (!held) {
            const have = bot.inventory.count(bot.registry.itemsByName[b.block]?.id, null)
            if (!have) { skipped++; logEvent('autobuild', `skipped ${cell} — out of ${b.block} mid-build`); done = true; break }
            if (attempt === 2) {
              skipped++
              logEvent('autobuild', `place failed at ${cell} (${b.block}): equip did not land (holding ${bot.heldItem ? bot.heldItem.name : 'nothing'}, have ${have}x in inventory)`)
              done = true
            }
            continue
          }
          try {
            await bot.placeBlock(ref, face)
            await sleepMs(50) // 1 block per tick — human speed
            const check = bot.blockAt(cell)
            if (check && check.name === b.block) { placed++; done = true }
            else if (attempt === 2) { wrong++; logEvent('autobuild', `WRONG block at ${cell}: expected ${b.block}, got ${check ? check.name : '?'}`); done = true }
          } catch (e) {
            if (attempt === 2) {
              skipped++
              logEvent('autobuild', `place failed at ${cell} (${b.block}): ${e.message}`)
              done = true
            }
          }
        }
      }
    }
    say(`built ${schem.name || name}: ${placed}/${schem.blocks.length} blocks placed, ${skipped} skipped, ${wrong} wrong`)
    logEvent('autobuild', `${name}: done — placed ${placed}/${schem.blocks.length}, skipped ${skipped}, wrong ${wrong}`)
    } finally {
      globalThis._autobuildRunning = false
    }
  }

  async function doCraft (itemName, count) {
    const mcData = mcDataFor(bot.version)
    const item = mcData.itemsByName[itemName]
    if (!item) { say(`i dont know ${itemName}, try another name`); return }
    // recipesFor() filters by inventory, so with no ingredients it returns []
    // and the old code wrongly said "no recipe". recipesAll() lists the recipe
    // no matter what we carry, so we can tell the user what is really missing.
    // (Simulation v5 run 3: bread said "no recipe" - the recipe exists, it just
    // needs a crafting table and 3 wheat.)
    const allRecipes = (bot.recipesAll ? bot.recipesAll(item.id, null, true) : []) || []
    if (!allRecipes.length) { say(`no recipe for ${itemName}`); return }
    // v10.5 run 111 fix: a recipe can have VARIANTS (torch = coal OR
    // charcoal). If this variant is missing an ingredient, TRY THE NEXT
    // VARIANT instead of giving up — the chest may hold the other one.
    // Only report missing after every variant has failed.
    let lastMissing = null, lastSearched = 0
    let table = null
    for (const recipe of allRecipes) {
      const craftsNeeded = Math.ceil(count / (recipe.result.count || 1))
      const missing = []
      for (const d of (recipe.delta || [])) {
        if (d.count >= 0) continue
        const need = -d.count * craftsNeeded
        const have = bot.inventory.count(d.id, null)
        if (have < need) {
          const name = mcData.items[d.id]?.name || mcData.blocks[d.id]?.name || `id ${d.id}`
          missing.push({ name, short: need - have })
        }
      }
      // v10.5: fetch missing ingredients from nearby chests (12 blocks)
      // before giving up — "craft torch" works with sticks + planks in
      // a chest now, not just in the inventory.
      let searched = 0
      for (const m of missing) {
        const def = mcData.itemsByName[m.name] || mcData.blocksByName[m.name]
        const before = def ? bot.inventory.count(def.id, null) : 0
        const res = await ensureItem(m.name, m.short)
        searched = Math.max(searched, res.searched)
        const after = def ? bot.inventory.count(def.id, null) : 0
        m.short = Math.max(0, m.short - (after - before))
      }
      const stillMissing = missing.filter(m => m.short > 0)
      if (stillMissing.length) {
        // save the missing list and try the next recipe variant
        lastMissing = stillMissing; lastSearched = searched
        continue
      }
      // v10.5 run 111b fix: do NOT craft with the stale recipesAll
      // recipe (its delta was computed before the chest fetch, and the
      // count read right after bot.craft races the result packet).
      // Re-resolve a FRESH recipe from the current inventory, craft ONE
      // at a time, and wait 500ms after each so the result lands.
      if (recipe.requiresTable) {
        table = findWorkstation(['crafting_table'], 12)
        if (!table) { say(`i can make ${itemName}, but i need a crafting table nearby`); return }
      }
      const fresh = (bot.recipesFor ? bot.recipesFor(item.id, null, 1, table || null) : []) || []
      const useRecipe = fresh[0] || recipe
      const haveBefore = bot.inventory.count(item.id, null)
      let made = 0
      for (let i = 0; i < craftsNeeded; i++) {
        try {
          await bot.craft(useRecipe, 1, table)
        } catch (e) {
          log('craft attempt failed: ' + e.message)
          break
        }
        // v10.5.1 run 111 fix: a fixed 500ms settle is not enough
        // for the FIRST craft after a teleport — the result packet
        // can lag and the inventory still reads 0, so the loop
        // concluded "craft produced nothing" and fell through to
        // the next recipe variant (torch: coal fetched, then it
        // reported charcoal missing). Poll the count for up to 2s
        // (100ms steps) and only conclude no-progress after that.
        let now = 0
        for (let w = 0; w < 20; w++) {
          await sleepMs(100)
          now = bot.inventory.count(item.id, null) - haveBefore
          if (now > made) break
        }
        if (now <= made) break // no progress — stop, do not burn ingredients
        made = now
      }
      if (made <= 0) { log('craft produced nothing, trying next recipe'); continue }
      bumpStat('itemsCrafted', made)
      logEvent('craft', `crafted ${made}x ${itemName} (asked ${count})`)
      say(pick([`done, crafted ${made}x ${itemName}`, `here you go, ${made}x ${itemName} ready`]))
      return
    }
    if (lastMissing) {
      say(`i need ${lastMissing.map(m => `${m.short}x ${m.name}`).join(', ')} for ${count}x ${itemName} — i checked ${lastSearched} chest(s) nearby`)
      return
    }
    say(`could not craft ${itemName}`)
  }
}

process.on('SIGINT', () => { stopping = true; log('Stopping bot...'); process.exit(0) })

if (!config.host || config.host.includes('PUT_')) {
  console.log('Edit config.json first: set host, port, version, username, owner, and authPassword.')
  console.log('Segs uses the SAME AuthMe password you registered Segs with on your Mac.')
  console.log('Then run: node bot.js')
  process.exit(0)
}

createBot()
