// Segs - free Mineflayer bot, v2 - natural talk, no ! needed
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
let stats = { started: new Date().toISOString(), tasksDone: 0, chatsAnswered: 0, cropsFarmed: 0, itemsCrafted: 0, blocksDug: 0, deaths: 0, foodEaten: 0, chestsChecked: 0, smeltsDone: 0, timesHungry: 0 }
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
let brain = { home: null, farm: null, lastTask: null, lastPos: null, bases: {}, facts: [], macros: {}, deaths: [], found: {}, landmarks: {}, serverHomes: [] }
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
    log('Spawned at ' + bot.entity.position)
    loggedIn = false
    loginTried = false
    try {
      const mcData = mcDataFor(bot.version)
      const movements = new Movements(bot, mcData)
      movements.allowParkour = false
      movements.canDig = true
      movements.allow1by1towers = false
      bot.pathfinder.setMovements(movements)
    } catch (e) { log('movements: ' + e.message) }
    try { bot.armorManager.equipAll() } catch (e) {}
    await sleepMs(1500)
    tryLogin()
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
    if (/^(applied|gave|set|teleported|enchanted|summoned|filled|changed|cleared|removed|killed|spawned|granted|revoked)\b/i.test(msg)) return
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
    const stopReq = msg.toLowerCase().replace(/^segs\s+/, '')
    if (/^(stop|stay|wait|wait here|stay here|chill|hold on)$/.test(stopReq) || stopReq === 'stop following' || stopReq === 'stop follow' || stopReq.includes('stop farm') || stopReq.includes('stop afk') || stopReq.includes('stop guard') || stopReq.includes('stop protecting')) {
      stopAllMovement()
    }
    queueTalk(username, msg)
  })

  bot.on('messagestr', (message) => {
    // v7: tpa requests often arrive as system chat, not player chat
    if (maybeAcceptTpa(message)) return
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
          const away = bot.entity.position.clone().subtract(target.position).normalize().multiply(6)
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

  bot.on('kicked', (reason) => { log('Kicked: ' + reason); scheduleReconnect() })
  bot.on('error', (err) => { log('Error: ' + err.message) })
  bot.on('end', (reason) => { log('Disconnected: ' + (reason || '')); scheduleReconnect() })

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
      say('just talk to me like: segs tp to me, segs follow me, segs sleep, segs farm wheat, segs farm potato, segs farm all, segs craft iron pickaxe, segs dig stone, segs place torch, segs fish, segs smelt iron ore, segs get food, segs this is the potato farm, segs this is the smoker, segs what is here, segs remember this is home, segs go to mine, segs list bases, segs sethome mine, segs go to mine, segs list homes, segs forget home mine, segs learn daily means go to the farm and farm wheat and come back, segs what do you remember, segs stats, segs inventory, segs afk, segs guard me, segs eat, segs status, segs stop')
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
      stopAllMovement(); say(pick(['ok stopped', 'got it, staying here', 'ok, waiting here'])); return
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
      serverCmd(`/sethome ${name}`)
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
      say(`my stats: ${stats.cropsFarmed} crops farmed, ${stats.itemsCrafted} items crafted, ${stats.blocksDug} blocks dug, ${stats.foodEaten} times fed, ${stats.chestsChecked} chests checked, ${stats.smeltsDone} smelts, ${stats.deaths} deaths, ${stats.timesHungry} times hungry`)
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

  function stopAllMovement () {
    moveToken++
    following = null
    stopFarming()
    stopAfk()
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
    const before = bot.entity.position.clone()
    serverCmd(`/home ${name}`)
    await sleepMs(3000)
    const moved = bot.entity.position.distanceTo(before) > 2
    if (moved) logEvent('home', `teleported to /home ${name}`)
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
    const tok = moveToken
    const stopped = () => tok !== moveToken
    try {
      await gotoWithTimeout(new goals.GoalNear(pos.x, pos.y, pos.z, 2))
      return true
    } catch (e) {
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
    } catch (e) {}
  }, 30000)

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
