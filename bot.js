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

function log (msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`) }
function say (msg) { try { bot.chat(msg) } catch (e) { log('chat failed: ' + e.message) } }
function pick (arr) { return arr[Math.floor(Math.random() * arr.length)] }
function isOwner (username) { return username && username.toLowerCase() === OWNER }
function sleepMs (ms) { return new Promise(r => setTimeout(r, ms)) }

const CROPS = {
  wheat: { block: 'wheat', maxAge: 7, seed: 'wheat_seeds' },
  carrots: { block: 'carrots', maxAge: 7, seed: 'carrot' },
  carrot: { block: 'carrots', maxAge: 7, seed: 'carrot' },
  potatoes: { block: 'potatoes', maxAge: 7, seed: 'potato' },
  potato: { block: 'potatoes', maxAge: 7, seed: 'potato' },
  beetroot: { block: 'beetroot', maxAge: 3, seed: 'beetroot_seeds' },
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
let brain = { home: null, farm: null, lastTask: null, lastPos: null, bases: {}, facts: [], macros: {}, deaths: [], found: {} }
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

  bot.on('chat', (username, message) => {
    if (!bot || username === BOT_NAME) return
    const msg = message.trim()
    log(`<${username}> ${msg}`)
    if (!loggedIn && config.autoLogin && config.authPassword && !config.authPassword.includes('PUT_')) {
      if (/please register|\/register|not registered/i.test(msg)) { tryRegister(); return }
      if (/please login|\/login|not logged in|login with/i.test(msg)) { tryLogin(); return }
    }
    if (/logged in successfully|welcome back|successfully logged/i.test(msg)) { loggedIn = true; return }
    handleTalk(username, msg).catch(e => { log('talk error: ' + e.message) })
  })

  bot.on('messagestr', (message) => {
    if (!loggedIn && config.autoLogin && config.authPassword && !config.authPassword.includes('PUT_')) {
      if (/please register|\/register/i.test(message)) tryRegister()
      else if (/please login|\/login/i.test(message)) tryLogin()
    }
    if (/logged in successfully/i.test(message)) loggedIn = true
  })

  bot.on('whisper', (username, message) => {
    if (!bot || username === BOT_NAME) return
    handleTalk(username, message.trim(), true).catch(() => {})
  })

  bot.on('sleep', () => log('Segs is sleeping'))
  bot.on('wake', () => { say(pick(['morning', 'awake, ready to work', 'good morning, what now'])) })

  // v5 LEARNING from playing: when it dies, remember where and warn next time.
  // This is coded memory, not AI training - it just does not forget what happened.
  bot.on('death', () => {
    const pos = bot.entity ? [Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y), Math.floor(bot.entity.position.z)] : [0, 0, 0]
    brain.deaths.push({ what: 'died', pos, at: new Date().toISOString() })
    if (brain.deaths.length > 10) brain.deaths = brain.deaths.slice(-10)
    saveBrain()
    log('Segs died at ' + pos.join(', ') + ' - remembered, will be careful there')
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

    // greetings / small talk - anyone can say hi, commands are owner-only
    if (/^(hi|hello|hey|yo|hii|hello there|good morning|good afternoon|good evening)$/.test(req)) {
      say(pick(['yo', 'hey, whats up', 'yo, ready when you are'])); return
    }
    if (/^(thanks|thank you|thx|nice|good bot|good job)$/.test(req)) {
      say(pick(['np', 'anytime', 'you got it'])); return
    }
    if (/^(bye|good night|goodbye|see you)$/.test(req) && !req.includes('sleep')) {
      say(pick(['bye, see you', 'later'])); return
    }
    if (req.includes('who are you') || req.includes('your name') || req === 'who r u') {
      say("i'm Segs, Tash made me"); return
    }

    // from here: orders. Owner only.
    if (!isOwner(username)) {
      say(`sorry ${username}, only ${config.owner} can tell me what to do`)
      return
    }

    // help
    if (req.includes('help') || req.includes('what can you do')) {
      say('just talk to me like: segs tp to me, segs follow me, segs sleep, segs farm wheat, segs craft iron pickaxe, segs dig stone, segs place torch, segs fish, segs smelt iron ore, segs remember this is home, segs go to mine, segs list bases, segs learn daily means go to the farm and farm wheat and come back, segs what do you remember, segs inventory, segs afk, segs guard me, segs eat, segs status, segs stop')
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

    // tp / come to me - bot cannot /tp unless it has op, so it walks/runs to you
    if (req.includes('tp to me') || req.includes('teleport to me') || req.includes('come to me') || req.includes('come here') || req === 'come' || req === 'tp' || req === 'teleport' || req.includes('come to') || req.includes('tp me')) {
      const player = bot.players[username]?.entity
      if (!player) { say('i cant see you right now'); return }
      brain.lastPos = [Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y), Math.floor(bot.entity.position.z)]; saveBrain()
      stopAllMovement()
      say(pick(['on my way', 'coming to you', 'got it, coming']))
      await gotoPos(player.position)
      say(pick(['here', 'im here', 'made it']))
      return
    }

    // follow
    if (req.includes('follow me') || req.includes('follow') || req.includes('stay with me')) {
      following = username
      say(pick(['ok, following you', 'following you now', 'got it, sticking with you']))
      followLoop()
      return
    }

    // go to a place - MUST come before "farm", or "go to the farm" starts
    // farming instead of just walking there (simulation run 3 bug).
    if (req.startsWith('go to') || req.startsWith('go to the') || req === 'go farm' || req === 'go home') {
      // named base? "go to mine", "go to farm base", "go to home"
      const place = req.replace(/^go to (the )?/, '').replace(/ base$/, '').trim()
      if (place && brain.bases[place]) {
        stopAllMovement(); say(`going to ${place}`)
        await gotoPos(new Vec3(brain.bases[place][0], brain.bases[place][1], brain.bases[place][2]))
        say(`at ${place}`); return
      }
      if (place === 'farm' && config.farmCenter) {
        stopAllMovement(); await gotoPos(new Vec3(config.farmCenter[0], config.farmCenter[1], config.farmCenter[2])); say('at the farm'); return
      }
      const coordMatch = req.match(/(-?\d+)\s+(-?\d+)\s+(-?\d+)/)
      if (coordMatch) {
        const [x, y, z] = coordMatch.slice(1).map(Number)
        stopAllMovement(); say('on my way there')
        await gotoPos(new Vec3(x, y, z)); say('here'); return
      }
      if (place) { say(`i dont know where ${place} is, tell me: segs remember this is ${place}`); return }
      // "go to" with nothing after - fall through to other handlers
    }

    // farm
    if (req.includes('farm') || req.includes('harvest')) {
      const cropName = ['wheat', 'carrot', 'carrots', 'potato', 'potatoes', 'beetroot'].find(c => req.includes(c)) || 'wheat'
      const key = cropName === 'carrots' ? 'carrot' : cropName === 'potatoes' ? 'potato' : cropName
      if (!CROPS[key]) { say('farm what? wheat, carrot, potato, beetroot'); return }
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
      stopAllMovement(); say('going home'); await gotoPos(new Vec3(home[0], home[1], home[2])); say('home'); return
    }
    if (req.includes('come back') || req === 'return' || req.includes('go back')) {
      // "come back to me" means come to the OWNER, not to the last place.
      // (Simulation v5 run 3: it said "back where?" inside a long plan.)
      if (req.includes('to me') || req.includes('to you')) {
        const player = bot.players[username]?.entity
        if (!player) { say('i cant see you right now'); return }
        stopAllMovement(); say('coming back to you')
        await gotoPos(player.position); say('here'); return
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
    following = null
    stopFarming()
    stopAfk()
    try { bot.pathfinder.setGoal(null) } catch (e) {}
    try { bot.pvp.stop() } catch (e) {}
  }

  async function gotoPos (pos) {
    try { await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 1)) }
    catch (e) { log('goto failed: ' + e.message); say('i cant reach there, too far or blocked') }
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

  function startFarming (cropName) {
    if (farming) stopFarming()
    farming = true
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
        await gotoPos(pos)
        await bot.dig(block)
        const seed = bot.inventory.items().find(i => i.name === crop.seed)
        if (seed) {
          await bot.equip(seed, 'hand')
          const soil = bot.blockAt(pos.offset(0, -1, 0))
          if (soil && soil.name === 'farmland') await bot.placeBlock(soil, new Vec3(0, 1, 0))
        } else {
          say(`i need ${crop.seed} to replant ${cropName}`)
          await sleepMs(1000)
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
