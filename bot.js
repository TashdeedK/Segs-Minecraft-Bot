// Segs - free Mineflayer bot, v9.2 - wall-safe column teaching
//   (v9.1: bottom-first fill, owner-only commands, double-chest dedup;
//    v9: 16-column sorting + base map + A-to-Z guide;
//    v8: bed spawn, permanent home, grave recovery, pickup + store,
//    enemy evade, hunger-dependent sprint, danger avoidance;
//    v7: /tpa + /sethome /home, command queue, honest walks, goto timeout)
//   v9.2 changes: scanColumnChests anchors on the nearest container
//   (exact x,z footprint) so a continuous wall of columns no longer
//   bleeds into its neighbours; re-teaching a column MERGES instead
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
let stats = { started: new Date().toISOString(), tasksDone: 0, chatsAnswered: 0, cropsFarmed: 0, itemsCrafted: 0, blocksDug: 0, deaths: 0, foodEaten: 0, chestsChecked: 0, smeltsDone: 0, timesHungry: 0, itemsSorted: 0, sortsDone: 0 }
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
function parseItemAndCount (text) {
  let t = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  let count = 1
  const numMatch = t.match(/\b(\d+)\b/)
  if (numMatch) { count = parseInt(numMatch[1], 10); t = t.replace(numMatch[0], ' ').trim() }
  else {
    for (const [w, n] of Object.entries(NUMBER_WORDS)) {
      if (new RegExp(`\\b${w}\\b`).test(t)) { count = n; t = t.replace(new RegExp(`\\b${w}\\b`), ' ').trim(); break }
    }
  }
  t = t.replace(/\b(a|an|some|please|me|the)\b/g, ' ').replace(/\s+/g, ' ').trim()
  // plural -> singular for common tools, keep it simple
  const itemName = aliasItem(t.replace(/ /g, '_'))
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
let brain = { home: null, farm: null, lastTask: null, lastPos: null, bases: {}, facts: [], macros: {}, deaths: [], found: {}, landmarks: {}, serverHomes: [], permanentHome: null, spawnBed: null, pendingSpawnBed: null, roomChests: [], lastGrave: null, columns: {}, areas: {}, itemChest: {}, sortJob: null, trashChest: null, sugarcaneChests: [], myRoom: null }
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
    // LOW RAM: tell the server to send only 5 chunks around us (view distance 5).
    // The bot does not render, so this is the main RAM lever: ~121 chunks instead
    // of ~500+ at view 12. Server may cap it lower/higher; 5 is our request.
    // On a 500MB-1GB machine this keeps the bot at ~200-400MB.
    viewDistance: 5,
  })

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(pvp)
  bot.loadPlugin(collectBlock)
  bot.loadPlugin(toolPlugin)
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

  try {
    if (bot.autoEat) {
      bot.autoEat.setOpts({
        priority: 'foodPoints',
        minHunger: 14,
        minHealth: 14,
        bannedFood: ['rotten_flesh', 'pufferfish', 'chorus_fruit', 'poisonous_potato', 'spider_eye'],
      })
      bot.autoEat.enableAuto()
    }
  } catch (e) { log('autoEat setup: ' + e.message) }

  bot.once('spawn', async () => {
    connected = true
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
      // v8: danger blocks. Lava + fire are already in the default
      // blocksToAvoid; add magma blocks (burn feet) and cactus (thorns).
      // Water stays allowed — Segs can swim, it just goes slower.
      try {
        if (mcData.blocksByName.magma_block) movements.blocksToAvoid.add(mcData.blocksByName.magma_block.id)
        if (mcData.blocksByName.cactus) movements.blocksToAvoid.add(mcData.blocksByName.cactus.id)
        if (mcData.blocksByName.sweet_berry_bush) movements.blocksToAvoid.add(mcData.blocksByName.sweet_berry_bush.id)
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
  let talkQueue = Promise.resolve()
  function queueTalk (username, msg, isWhisper) {
    talkQueue = talkQueue.then(() => handleTalk(username, msg, isWhisper)).catch(e => { log('talk error: ' + e.message); logEvent('error', 'talk error: ' + e.message) })
    return talkQueue
  }
  // moveToken: bumped every time movement is cancelled. A walk in progress
  // checks it and aborts silently instead of retrying a walk the user stopped.
  let moveToken = 0

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
    // v7: "stop" must interrupt a running walk NOW, not wait behind it in
    // the queue — cancel the movement immediately, then let the queued
    // handler say "ok stopped" when its turn comes.
    // v9: ONLY the owner may stop Segs. Without this check any player
    // could say "Segs stop" and cancel its walk / pause a sort mid-way
    // (that is a griefing hole — the queued handler already gates orders
    // on isOwner, but this immediate stop bypassed it).
    if (isOwner(username)) {
      const stopReq = msg.toLowerCase().replace(/^segs\s+/, '')
      if (/^(stop|stay|wait|wait here|stay here|chill|hold on)$/.test(stopReq) || stopReq === 'stop following' || stopReq === 'stop follow' || stopReq.includes('stop farm') || stopReq.includes('stop afk') || stopReq.includes('stop guard') || stopReq.includes('stop protecting')) {
        if (/^(stop|stay|wait|wait here|stay here|chill|hold on)$/.test(stopReq)) sortStopRequested = true
        stopAllMovement()
      }
    }
    queueTalk(username, msg)
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
    queueTalk(username, message.trim(), true)
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
    try { bot.clearControlStates() } catch (e) {}
    try { bot._client.write('client_command', { actionId: 0 }); log('respawning...') } catch (e) { log('respawn failed: ' + e.message) }
    const respawnTimer = setInterval(() => {
      if (!bot || bot.health > 0) { clearInterval(respawnTimer); return }
      try { bot._client.write('client_command', { actionId: 0 }) } catch (e) {}
    }, 500)
    setTimeout(() => clearInterval(respawnTimer), 5000)
  })

  bot.on('entityHurt', (entity) => {
    if (!bot.entity || entity !== bot.entity) return
    defendCheck()
  })

  bot.on('health', () => {
    if (!bot) return
    if (bot.health < 8) {
      try { const p = bot.autoEat?.eat(); if (p && p.catch) p.catch(() => {}) } catch (e) {}
      try {
        const target = bot.nearestEntity(e => e.type === 'mob' || e.type === 'player')
        if (target) {
          const away = bot.entity.position.clone().subtract(target.position).normalize().scale(6)
          bot.pathfinder.setGoal(new goals.GoalBlock(bot.entity.position.x + away.x, bot.entity.position.y, bot.entity.position.z + away.z))
        }
      } catch (e) {}
    }
    if (bot.food <= 14) { try { const p = bot.autoEat?.eat(); if (p && p.catch) p.catch(() => {}) } catch (e) {} }
  })

  setInterval(() => {
    if (!bot || !bot.entity || bot.health <= 0) return
    defendCheck()
  }, 1500)

  function defendCheck () {
    if (!config.autoDefend && !guardMode) return
    if (!bot.entity) return
    const target = bot.nearestEntity(e => {
      if (!e.position || e === bot.entity) return false
      if (e.type === 'player' && e.username && e.username.toLowerCase() === OWNER) return false
      if (e.type === 'player' && e.username === BOT_NAME) return false
      const dist = e.position.distanceTo(bot.entity.position)
      if (dist > 6) return false
      if (e.type === 'mob') {
        const hostile = ['zombie', 'skeleton', 'spider', 'creeper', 'enderman', 'witch', 'pillager', 'husk', 'drowned', 'phantom', 'slime', 'blaze', 'ghast']
        return hostile.some(h => (e.name || '').toLowerCase().includes(h))
      }
      if (e.type === 'player') return guardMode
      return false
    })
    if (target) {
      log('Defending vs ' + (target.username || target.name))
      equipBestWeapon()
      try { bot.pvp.attack(target) } catch (e) { log('pvp: ' + e.message) }
    }
  }

  function equipBestWeapon () {
    try {
      const swords = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword']
      for (const name of swords) {
        const item = bot.inventory.items().find(i => i.name === name)
        if (item) { bot.equip(item, 'hand'); break }
      }
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

    // Long messages: "go to the farm and farm wheat and then come back to me"
    // Split into steps and do them one by one, in order.
    const clauses = splitClauses(req)
    if (clauses.length > 1 && isOwner(username)) {
      say(pick(['ok, doing it step by step', 'got it, one thing at a time']))
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
      say('im a bot, not AI. Tash coded me, i just do what im told and remember stuff'); return
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

    // help
    if (req.includes('help') || req.includes('what can you do')) {
      say('just talk to me like: segs tp to me, segs follow me, segs sleep, segs farm wheat, segs farm potato, segs farm all, segs craft iron pickaxe, segs dig stone, segs place torch, segs fish, segs smelt iron ore, segs get food, segs this is the potato farm, segs this is the smoker, segs what is here, segs remember this is home, segs go to mine, segs list bases, segs sethome mine, segs go to mine, segs list homes, segs forget home mine, segs learn daily means go to the farm and farm wheat and come back, segs what do you remember, segs stats, segs inventory, segs afk, segs guard me, segs eat, segs status, segs stop, segs set this bed as your bed, segs remember this is your permanent home, segs pick up the items, segs keep these items at your base, segs check for enemies, segs get your stuff, segs this is the ore column, segs this is my room, segs this is the trading hall, segs sort my room, segs move the ores to the ore column, segs make paper, segs continue last sorting, segs list columns, segs list places, segs go to the trading hall')
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
    if (isOwner(username) && req.startsWith('this is the')) {
      const name = req.replace(/^this is the\s*/, '').trim()
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
    if (req.includes('stop guard') || req.includes('stop protecting')) { guardMode = false; try { bot.pvp.stop() } catch (e) {}; say('ok, guard off'); return }
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
    if (req.includes('tp to me') || req.includes('teleport to me') || req.includes('come to me') || req.includes('come here') || req === 'come' || req === 'tp' || req === 'teleport' || req.includes('come to') || req.includes('tp me')) {
      const player = bot.players[username]?.entity
      if (!player) { say('i cant see you right now'); return }
      brain.lastPos = [Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y), Math.floor(bot.entity.position.z)]; saveBrain()
      stopAllMovement()
      say('sent you a tpa request, type /tpaccept Segs')
      serverCmd(`/tpa ${config.owner}`)
      logEvent('tpa', 'sent /tpa to ' + config.owner)
      const tpaToken = moveToken
      await sleepMs(15000)
      if (tpaToken !== moveToken) return // stopped while waiting, do not walk
      const ownerNow = bot.players[username]?.entity
      if (ownerNow && bot.entity.position.distanceTo(ownerNow.position) < 5) {
        say(pick(['here', 'im here', 'made it'])); return
      }
      say('you didnt accept, walking to you instead')
      logEvent('tpa', 'tpa not accepted in 15s, walking instead')
      const playerAgain = bot.players[username]?.entity
      if (!playerAgain) { say('i cant see you right now'); return }
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
    if (req.includes('list columns') || req.includes('what columns') || req.includes('show columns') || req.includes('my columns')) {
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

    // eat
    if (req === 'eat' || req.includes('eat something') || req.includes('eat food') || req.includes('you hungry')) {
      try { await bot.autoEat?.eat(); say(pick(['ate, thanks', 'yum, done'])) } catch (e) { say('no food to eat, give me food') }
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

    // give / drop me an item
    if (req.startsWith('give me') || req.startsWith('drop')) {
      const rest = req.replace(/^(give me|drop)\s*/, '')
      const { itemName, count } = parseItemAndCount(rest)
      await tossItem(itemName, count)
      return
    }

    // pickup
    if (req.includes('pick up') || req.includes('pickup') || req.includes('collect')) {
      const item = bot.nearestEntity(e => e.type === 'object' && e.objectType === 'Item')
      if (!item) { say('no dropped items near me'); return }
      say('picking it up')
      await gotoPos(item.position)
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
        await gotoPos(new Vec3(x, y, z))
        say('here')
        return
      }
    }

    // v6: "Segs stats" — show what it has done (from logs/stats.json)
    if (req === 'stats' || req.includes('show stats') || req.includes('your stats')) {
      say(`my stats: ${stats.cropsFarmed} crops farmed, ${stats.itemsCrafted} items crafted, ${stats.blocksDug} blocks dug, ${stats.foodEaten} times fed, ${stats.chestsChecked} chests checked, ${stats.smeltsDone} smelts, ${stats.deaths} deaths, ${stats.timesHungry} times hungry, ${stats.itemsPicked || 0} items picked up, ${stats.itemsStored || 0} items stored, ${stats.graves || 0} graves recovered, ${stats.itemsSorted || 0} items sorted, ${stats.sortsDone || 0} sorts done`)
      return
    }
    // status
    if (req.includes('status') || req.includes('how are you') || req.includes('what are you doing') || req.includes('where are you')) {
      const inv = bot.inventory.items().slice(0, 5).map(i => `${i.name} x${i.count}`).join(', ') || 'empty'
      say(`hp ${Math.round(bot.health)}/20 food ${bot.food}/20 at ${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.z)} - ${inv}`)
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
    if (req === 'go home' || req.includes('go home') || req.includes('take me home')) {
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
    // smelt: "Segs smelt iron ore" (needs a furnace + coal nearby)
    if (req.startsWith('smelt') || req.startsWith('cook')) {
      const rest = req.replace(/^(smelt|cook)\s*/, '')
      const { itemName, count } = parseItemAndCount(rest)
      await smeltItem(itemName, count)
      return
    }
    // inventory: "Segs inventory" / "Segs what do you have"
    if (req === 'inventory' || req.includes('show inventory') || req.includes('what is in your inventory')) {
      const items = bot.inventory.items()
      if (!items.length) { say('my inventory is empty'); return }
      say('i have: ' + items.map(i => `${i.name} x${i.count}`).join(', ')); return
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
        try { bot.pvp.attack(target) } catch (e) {}
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
        // If the mob is exactly on top of Segs the vector is (0,0,0) and
        // normalize() gives NaN — run away in the direction Segs faces.
        const Vec3 = require('vec3').Vec3
        if (!isFinite(away.x) || !isFinite(away.z) || away.distanceTo(new Vec3(0, 0, 0)) < 0.1) {
          away = new Vec3(-Math.sin(bot.entity.yaw), 0, -Math.cos(bot.entity.yaw))
        } else { away = away.normalize() }
        const target = pos.clone().add(away.clone().scale(10))
        if (!isFinite(target.x) || !isFinite(target.z)) { logEvent('evade', `bad target: pos=${pos} away=${away} mobPos=${m.position} yaw=${bot.entity.yaw} mob=${m.name}@${m.position}`); stopFlee('bad target'); return }
        bot.lookAt(target)
        bot.setControlState('forward', true)
        bot.setControlState('sprint', true)
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
  function findGraveBlock () {
    try {
      return bot.findBlock({ matching: b => b.name === 'chest' || b.name === 'trapped_chest' || b.name === 'player_head' || b.name === 'barrel', maxDistance: 5 })
    } catch (e) { return null }
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
    try {
      say(`i died at ${g.pos.join(', ')} — going back for my stuff`)
      logEvent('grave', `recovering grave at ${g.pos.join(', ')}, died ${Math.round(ageMin)} min ago`)
      const arrived = await gotoPos(new Vec3(g.pos[0], g.pos[1], g.pos[2]))
      if (!arrived) { say(`i cant reach my grave at ${g.pos.join(', ')} — my stuff is there, ${Math.max(0, Math.round(10 - ageMin))} minutes left on it`); brain.lastGrave.recovered = true; saveBrain(); return false }
      const grave = findGraveBlock()
      if (!grave) { say(`im at the spot where i died (${g.pos.join(', ')}) but i cant see my grave — it should be right here`); brain.lastGrave.recovered = true; saveBrain(); return false }
      // Take everything out of the grave. Right-click opens it like a
      // chest (the user: "press right click u can access it as chest"), so
      // open it properly with openChest — that WAITS for the window to open
      // instead of hoping it is there after a fixed sleep. (v8 run 21b: the
      // old activateBlock + sleep-800ms + currentWindow path silently found
      // no window and took nothing, while the chest still held 5 bread +
      // 1 sword. openChest is the same API checkChestFor uses — proven in v6.)
      // Shift+right-click is the plugin's take-all shortcut; withdrawing
      // every stack by hand ends with the same inventory.
      const beforeCount = bot.inventory.items().length
      let took = 0
      let opened = false
      try {
        const win = await bot.openChest(grave)
        opened = true
        const items = win.containerItems().filter(Boolean)
        for (const it of items) {
          try { await win.withdraw(it.type, it.metadata, it.count); took += it.count } catch (e) { log('grave withdraw failed for ' + it.name + ': ' + e.message) }
        }
        try { win.close() } catch (e) {}
      } catch (e) {
        // not a chest-like block after all (e.g. a player head): fall back
        // to the plugin's own shortcut, shift + right click.
        log('grave openChest failed (' + e.message + '), trying shift+right-click')
        try { bot.setControlState('sneak', true); await sleepMs(200); await bot.activateBlock(grave); await sleepMs(1200) } catch (e2) { log('grave activate: ' + e2.message) }
        try { bot.setControlState('sneak', false) } catch (e2) {}
        try {
          if (bot.currentWindow) {
            opened = true
            const win = bot.currentWindow
            const items = win.containerItems().filter(Boolean)
            for (const it of items) { try { await win.withdraw(it.type, it.metadata, it.count); took += it.count } catch (e2) { log('grave withdraw failed for ' + it.name + ': ' + e2.message) } }
            try { win.close() } catch (e2) {}
          }
        } catch (e2) {}
      }
      log('grave: window opened=' + opened + ', took ' + took + ' item(s)')
      const afterCount = bot.inventory.items().length
      brain.lastGrave.recovered = true; saveBrain()
      bumpStat('graves', 1)
      // took>0 means items moved out of the grave; slot counts alone lie
      // (withdrawing into an existing stack adds no slot — run 21b).
      say(took > 0 ? 'got my stuff back from my grave (' + took + ' items)' : 'opened my grave — check if my stuff is back, it should all be there')
      logEvent('grave', `grave recovered at ${g.pos.join(', ')}, took ${took} items, inventory slots ${beforeCount} -> ${afterCount}`)
      return true
    } finally { recoveringGrave = false }
  }

  function stopAllMovement () {
    moveToken++
    following = null
    stopFarming()
    stopAfk()
    stopFlee()
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
  async function gotoWithTimeout (goal, ms = 25000) {
    let timer
    try {
      await Promise.race([
        bot.pathfinder.goto(goal),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('goto timeout after ' + ms + 'ms')), ms) })
      ])
    } catch (e) {
      try { bot.pathfinder.setGoal(null) } catch (_) {}
      throw e
    } finally { clearTimeout(timer) }
  }

  // Returns true if Segs got within 2 blocks of pos, false otherwise.
  // Long walks fail when the goal sits in unloaded chunks (the pathfinder
  // plans the whole route up front and view distance is only 5), so a
  // failed direct walk is retried in 16-block stages toward the goal —
  // chunks load as Segs moves. Callers MUST check the result: never
  // announce arrival on false (run 11 proved both "made it" and "at home"
  // were said after walks that never arrived).
  async function gotoPos (pos) {
    updateSprint() // sprint when fed, walk when hungry — before every walk
    const tok = moveToken
    const stopped = () => tok !== moveToken
    const from = bot.entity ? bot.entity.position.clone() : null
    try {
      await gotoWithTimeout(new goals.GoalNear(pos.x, pos.y, pos.z, 2))
      return true
    } catch (e) {
      log(`gotoPos FAIL: from ${from} to ${pos.x},${pos.y},${pos.z}: ${e.message} (still at ${bot.entity ? bot.entity.position : '?'})`)
      if (stopped()) return false // cancelled by a stop command, not a failure
      log('goto failed, retrying in stages: ' + e.message)
    }
    const start = bot.entity.position.clone()
    const stages = Math.max(1, Math.ceil(start.distanceTo(pos) / 16))
    for (let i = 1; i <= stages; i++) {
      if (stopped()) return false
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
        if (stopped()) return false
        log(`goto stage ${i}/${stages} failed: ` + e.message)
        say('i cant reach there, too far or blocked')
        return false
      }
    }
    if (stopped()) return false
    try {
      await gotoWithTimeout(new goals.GoalNear(pos.x, pos.y, pos.z, 2))
      return true
    } catch (e) {
      if (stopped()) return false
      log('goto final step failed: ' + e.message)
      say('i cant reach there, too far or blocked')
      return false
    }
  }
  // same walk, but silent on failure (for farming: one unreachable crop
  // should not spam chat, the caller decides what to do)
  async function gotoPosQuiet (pos) {
    await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 1))
  }

  async function followLoop () {
    while (following && bot && bot.entity) {
      const p = bot.players[following]
      if (!p || !p.entity) { await sleepMs(1000); continue }
      const dist = p.entity.position.distanceTo(bot.entity.position)
      if (dist > 3) {
        try { bot.pathfinder.setGoal(new goals.GoalFollow(p.entity, 2)) } catch (e) {}
      }
      await sleepMs(1000)
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
    for (const pos of blocks) {
      if (!farming) break
      const block = bot.blockAt(pos)
      if (!block) continue
      try {
        // walk to the crop; if one block is unreachable, skip it quietly
        // (simulation: 5 chat-spam "cant reach there" lines for blocks the
        // bot had already harvested or could not stand next to)
        try { await gotoPosQuiet(pos) } catch (e) { log('farm skip unreachable ' + pos); continue }
        await bot.dig(block)
        bumpStat('cropsFarmed')
        logEvent('farm', `harvested 1x ${cropName} at ${pos.x}, ${pos.y}, ${pos.z}`)
        // wait a moment for the drop to land in the inventory before
        // checking for seed to replant (simulation: it said "i need potato
        // to replant" right after harvesting a potato)
        await sleepMs(600)
        const seed = bot.inventory.items().find(i => i.name === crop.seed)
        if (seed) {
          await bot.equip(seed, 'hand')
          const soil = bot.blockAt(pos.offset(0, -1, 0))
          if (soil && soil.name === 'farmland') await bot.placeBlock(soil, new Vec3(0, 1, 0))
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
    const item = bot.inventory.items().find(i => i.name === itemName)
    if (!item) { say(`i dont have ${itemName}`); return }
    try {
      await bot.toss(item.type, null, Math.min(count, item.count))
      say(`here, dropped ${Math.min(count, item.count)}x ${itemName}`)
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
  const COOKABLE = { potato: 'baked_potato', raw_beef: 'cooked_beef', raw_porkchop: 'cooked_porkchop', raw_chicken: 'cooked_chicken', raw_mutton: 'cooked_mutton', raw_rabbit: 'cooked_rabbit', raw_cod: 'cooked_cod', raw_salmon: 'cooked_salmon', kelp: 'dried_kelp' }
  const FUEL_ITEMS = ['coal', 'charcoal', 'oak_log', 'oak_planks', 'coal_block']
  function hasFood () { return bot.inventory.items().find(i => FOOD_ITEMS.includes(i.name)) }
  function hasRawFood () { return bot.inventory.items().find(i => COOKABLE[i.name]) }
  // Open the nearest chest (or a chest landmark) and take what we need.
  async function checkChestFor (wantedNames, takeCount = 8) {
    let chestBlock = null
    const chestMark = Object.values(brain.landmarks || {}).find(l => l.type === 'chest')
    if (chestMark) chestBlock = bot.blockAt(new Vec3(chestMark.pos[0], chestMark.pos[1], chestMark.pos[2]))
    if (!chestBlock || !chestBlock.name.includes('chest')) {
      chestBlock = bot.findBlock({ matching: b => b.name.includes('chest'), maxDistance: 8 })
    }
    if (!chestBlock) { say('i cant see a chest near me'); return null }
    try {
      await gotoPos(chestBlock.position)
      const chest = await bot.openChest(chestBlock)
      const items = chest.containerItems()
      const found = items.find(i => i && wantedNames.includes(i.name))
      if (!found) { say(`checked the chest, no ${wantedNames[0]} in there`); chest.close(); return null }
      const take = Math.min(takeCount, found.count)
      await chest.withdraw(found.type, found.metadata, take)
      chest.close()
      bumpStat('chestsChecked')
      logEvent('chest', `took ${take}x ${found.name} from chest at ${chestBlock.position}`)
      say(`found ${take}x ${found.name} in the chest`)
      return found.name
    } catch (e) { log('chest check failed: ' + e.message); say('couldnt open that chest'); return null }
  }
  // Cook raw food in a smoker (fast, for food) or furnace. Checks for fuel first.
  async function cookFood (rawName, count = 4) {
    const cookedName = COOKABLE[rawName]
    if (!cookedName) { say(`${rawName} cant be cooked`); return false }
    let cooker = null
    const smokerMark = Object.values(brain.landmarks || {}).find(l => l.type === 'smoker')
    const furnaceMark = Object.values(brain.landmarks || {}).find(l => l.type === 'furnace')
    for (const mark of [smokerMark, furnaceMark]) {
      if (mark) { const b = bot.blockAt(new Vec3(mark.pos[0], mark.pos[1], mark.pos[2])); if (b && (b.name === 'smoker' || b.name === 'furnace')) { cooker = b; break } }
    }
    if (!cooker) cooker = bot.findBlock({ matching: b => b.name === 'smoker' || b.name === 'furnace', maxDistance: 8 })
    if (!cooker) { say('i need a smoker or furnace nearby to cook this'); return false }
    let fuel = bot.inventory.items().find(i => FUEL_ITEMS.includes(i.name))
    if (!fuel) {
      say('no coal, checking the chest for coal')
      logEvent('survive', 'no fuel in inventory, checking chest for coal')
      const got = await checkChestFor(FUEL_ITEMS)
      if (!got) { say('no coal anywhere, i cant cook this'); return false }
      fuel = bot.inventory.items().find(i => FUEL_ITEMS.includes(i.name))
    }
    try {
      await gotoPos(cooker.position)
      // openFurnace works for furnace, smoker AND blast furnace (same window type)
      const win = await bot.openFurnace(cooker)
      const mcData = mcDataFor(bot.version)
      const raw = mcData.itemsByName[rawName]
      const have = bot.inventory.items().find(i => i.type === raw.id)
      if (!have) { say(`i dont have any ${rawName} to cook`); win.close(); return false }
      say(`cooking ${rawName} in the ${cooker.name}`)
      await win.putInput(have.type, null, Math.min(count, have.count))
      await win.putFuel(fuel.type, null, 1)
      logEvent('smelt', `cooking ${Math.min(count, have.count)}x ${rawName} in ${cooker.name}`)
      // wait for it to cook (smoker ~5s each, furnace ~10s), then take it
      await sleepMs(12000)
      try { await win.takeOutput() } catch (e) {}
      win.close()
      bumpStat('smeltsDone')
      say(`cooked, got ${cookedName}`)
      return true
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
        try { await bot.autoEat?.eat() } catch (e) {}
        bumpStat('foodEaten')
        say('fed, all good')
        return
      }
      say('i need food, going to get some')
      // 2. raw food in inventory? cook it.
      const raw = hasRawFood()
      if (raw) {
        say(`i have raw ${raw.name}, cooking it`)
        if (await cookFood(raw.name, 4)) { try { await bot.autoEat?.eat() } catch (e) {}; bumpStat('foodEaten'); say('fed, all good') }
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
          say(`got ${got.name}, cooking it now`)
          if (got.name === 'potato' && await cookFood('potato', 4)) { try { await bot.autoEat?.eat() } catch (e) {}; bumpStat('foodEaten'); say('fed, all good'); return }
          if (FOOD_ITEMS.includes(got.name)) { try { await bot.autoEat?.eat() } catch (e) {}; bumpStat('foodEaten'); say('fed, all good'); return }
        }
        say('the farm had nothing ripe to eat')
      }
      // 4. check a chest for food
      say('checking the chest for food')
      const fromChest = await checkChestFor(FOOD_ITEMS)
      if (fromChest) { try { await bot.autoEat?.eat() } catch (e) {}; bumpStat('foodEaten'); say('fed, all good'); return }
      // 5. nothing worked - ask the owner, out loud, like a player would
      say('i need food and i cant find any, can you give me some or show me the farm')
      logEvent('survive', 'survival routine ended: no food found, asked owner')
    } finally { surviving = false }
  }
  // Hunger watchdog: every 30s, if Segs is idle and getting hungry, it sorts
  // itself out. It says so in chat first, and it will not spam (5 min
  // cooldown). Threshold 14 matches autoEat's minHunger: autoEat eats what
  // Segs has; if it has nothing, food keeps falling and this takes over.
  // (Simulation run 4: threshold was <12 with a 60s check — food sat at
  // exactly 12 at the check and the watchdog never fired. 30s + <14 fixes it.)
  let lastHungrySay = 0
  setInterval(() => {
    try {
      if (!bot || !bot.entity || bot.health <= 0) return
      if (bot.food < 14 && currentJob() === 'idle, waiting for you' && Date.now() - lastHungrySay > 5 * 60 * 1000) {
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
  async function digBlock (itemName, count) {
    const mcData = mcDataFor(bot.version)
    const blockName = aliasItem(itemName)
    const blockDef = mcData.blocksByName[blockName] || mcData.blocksByName[blockName.replace(/_log$/, '_log')]
    if (!blockDef) { say(`i dont know how to dig ${itemName}`); return }
    // only look nearby (16 blocks) - far targets make pathfinder wander and
    // hand-digging stone takes forever (simulation v5 run 2: never finished).
    const block = bot.findBlock({ matching: b => b.name === blockName, maxDistance: 16 })
    if (!block) { say(`i cant see any ${itemName} near me, get closer to some`); return }
    // equip the best tool for this block if we have one (mineflayer-tool)
    try { await bot.tool.equipForBlock(block) } catch (e) {}
    say(`ok, digging ${count}x ${itemName}`)
    let dug = 0
    for (let i = 0; i < count; i++) {
      const b = bot.findBlock({ matching: x => x.name === blockName, maxDistance: 16 })
      if (!b) break
      try {
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
    const furnaceBlock = bot.findBlock({ matching: b => b.name === 'furnace', maxDistance: 6 })
    if (!furnaceBlock) { say('i need a furnace nearby to smelt that'); return }
    const fuel = bot.inventory.items().find(i => ['coal', 'charcoal', 'oak_log', 'oak_planks'].includes(i.name))
    if (!fuel) { say('i need coal or wood as fuel to smelt'); return }
    try {
      const furnace = await bot.openFurnace(furnaceBlock)
      const mcData = mcDataFor(bot.version)
      const raw = mcData.itemsByName[aliasItem(itemName)] || mcData.blocksByName[aliasItem(itemName)]
      if (!raw) { say(`i dont know what ${itemName} is`); return }
      const have = bot.inventory.items().find(i => i.type === raw.id)
      if (!have) { say(`i dont have any ${itemName} to smelt`); return }
      await furnace.putInput(have.type, null, Math.min(count, have.count))
      await furnace.putFuel(fuel.type, null, 1)
      say(`smelting ${itemName}, come back in a bit`)
      setTimeout(async () => { try { await furnace.takeOutput() } catch (e) {} }, 15000)
    } catch (e) { log('smelt failed: ' + e.message); say('couldnt use that furnace') }
  }
  async function dropAll () {
    const keep = ['iron_sword', 'diamond_sword', 'iron_pickaxe', 'diamond_pickaxe', 'bow', 'shield']
    const items = bot.inventory.items().filter(i => !keep.includes(i.name))
    if (!items.length) { say('nothing to drop'); return }
    for (const item of items) { try { await bot.toss(item.type, null, item.count) } catch (e) {} }
    say(`dropped ${items.length} stacks, kept my tools`)
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
    for (const recipe of allRecipes) {
      const craftsNeeded = Math.ceil(count / (recipe.result.count || 1))
      const missing = []
      for (const d of (recipe.delta || [])) {
        if (d.count >= 0) continue
        const need = -d.count * craftsNeeded
        const have = bot.inventory.count(d.id, null)
        if (have < need) {
          const name = mcData.items[d.id]?.name || mcData.blocks[d.id]?.name || `id ${d.id}`
          missing.push(`${need - have}x ${name}`)
        }
      }
      if (missing.length) {
        say(`i need ${missing.join(', ')} for ${count}x ${itemName}`)
        return
      }
      try {
        let table = null
        if (recipe.requiresTable) {
          table = bot.findBlock({ matching: b => b.name === 'crafting_table', maxDistance: 6 })
          if (!table) { say(`i can make ${itemName}, but i need a crafting table nearby`); return }
        }
        await bot.craft(recipe, craftsNeeded, table)
        bumpStat('itemsCrafted', count)
        logEvent('craft', `crafted ${count}x ${itemName}`)
        say(pick([`done, crafted ${count}x ${itemName}`, `here you go, ${count}x ${itemName} ready`]))
        return
      } catch (e) {
        log('craft failed, trying next recipe: ' + e.message)
        continue
      }
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
