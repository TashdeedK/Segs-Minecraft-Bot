// link-prismarine.js - v4 fix for the plugin stack (run automatically as postinstall).
// Problem: mineflayer-pathfinder / -pvp / -collectblock / -auto-eat / -armor-manager
// are npm packages. They resolve prismarine-* and minecraft-* from THIS folder's
// node_modules, which are plain npm versions that do NOT know 26.3 - they crash
// with "Do not have data for 26.3" as soon as pathfinder loads.
// Fix: copy the fork-tested versions from ../segs-26.3/mineflayer/node_modules
// over the npm ones in ./node_modules. Copying (not symlinking) so it works
// on Windows, Mac and Linux without admin rights.
// Safe to re-run any time. If the fork folder is not there yet, it warns and exits 0.
const fs = require('fs')
const path = require('path')
const FORK = path.join(__dirname, '..', 'segs-26.3', 'mineflayer', 'node_modules')
const LOCAL = path.join(__dirname, 'node_modules')
const PACKAGES = [
  'minecraft-data', 'minecraft-data-base', 'minecraft-protocol', 'minecraft-folder-path',
  'prismarine-biome', 'prismarine-block', 'prismarine-chat', 'prismarine-chunk',
  'prismarine-entity', 'prismarine-item', 'prismarine-nbt', 'prismarine-physics',
  'prismarine-recipe', 'prismarine-registry', 'prismarine-windows', 'prismarine-world',
  'prismarine-auth'
]
if (!fs.existsSync(FORK)) {
  console.log('[link-prismarine] fork not found at ../segs-26.3/mineflayer - run setup-26.3.sh/.bat first, skipping')
  process.exit(0)
}
if (!fs.existsSync(LOCAL)) {
  console.log('[link-prismarine] ./node_modules not found - run npm install first, skipping')
  process.exit(0)
}
let linked = 0
for (const pkg of PACKAGES) {
  const src = path.join(FORK, pkg)
  const dst = path.join(LOCAL, pkg)
  if (!fs.existsSync(src)) { console.log(`[link-prismarine] skip ${pkg} (not in fork)`); continue }
  fs.rmSync(dst, { recursive: true, force: true })
  fs.cpSync(src, dst, { recursive: true })
  linked++
}
console.log(`[link-prismarine] linked ${linked} fork packages into ./node_modules`)
// v10.5.1: apply the shipped water-climb patch to this copy (idempotent;
// a no-op if the fork copy was already patched before the copy above).
try {
  const { execFileSync } = require('child_process')
  execFileSync(process.execPath, [path.join(__dirname, 'patches', 'apply-prismarine-physics-patch.js'), path.join(LOCAL, 'prismarine-physics')], { stdio: 'inherit' })
  execFileSync(process.execPath, [path.join(__dirname, 'patches', 'apply-mineflayer-collision-sync-patch.js'), path.join(LOCAL, 'mineflayer')], { stdio: 'inherit' })
  // v10.5.3: send full player_input (jump etc.) so Paper's swim-up works.
  execFileSync(process.execPath, [path.join(__dirname, 'patches', 'apply-mineflayer-player-input-patch.js'), path.join(LOCAL, 'mineflayer')], { stdio: 'inherit' })
  // v10.5.3: A* must never route through liquid (river-trench trap).
  execFileSync(process.execPath, [path.join(__dirname, 'patches', 'apply-pathfinder-head-water-patch.js'), path.join(LOCAL, 'mineflayer-pathfinder')], { stdio: 'inherit' })
  // v10.5.3: A* must never drop/step into a water landing (run 148 trench).
  execFileSync(process.execPath, [path.join(__dirname, 'patches', 'apply-pathfinder-no-water-landing-patch.js'), path.join(LOCAL, 'mineflayer-pathfinder')], { stdio: 'inherit' })
  // v10.5.3: A* water exemption for grave recovery only (run 127: the grave can be underwater).
  execFileSync(process.execPath, [path.join(__dirname, 'patches', 'apply-pathfinder-allow-water-patch.js'), path.join(LOCAL, 'mineflayer-pathfinder')], { stdio: 'inherit' })
  // v10.5.3: goto() must not resolve on an empty path unless at the goal (run 148 false "here").
  execFileSync(process.execPath, [path.join(__dirname, 'patches', 'apply-pathfinder-goto-empty-path-patch.js'), path.join(LOCAL, 'mineflayer-pathfinder')], { stdio: 'inherit' })
} catch (e) { console.log('[link-prismarine] patch step warning: ' + e.message) }
// verify 26.3 loads from here now
try {
  const mc = require(path.join(LOCAL, 'minecraft-data'))('26.3')
  console.log(`[link-prismarine] verify: minecraft-data 26.3 protocol ${mc.version.version} dataVersion ${mc.version.dataVersion}`)
} catch (e) {
  console.log('[link-prismarine] verify FAILED: ' + e.message)
}
