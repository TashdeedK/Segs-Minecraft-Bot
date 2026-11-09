// apply-mineflayer-player-input-patch.js — v10.5.3 Segs (shipped fork patch).
// Applies patches/mineflayer-player-input.patch to one or more mineflayer
// copies: the cloned repo (../segs-26.3/mineflayer) and/or this bot's
// node_modules copy. Usage: node patches/apply-mineflayer-player-input-patch.js [targetDir ...]
// With no args it tries both standard locations relative to this repo.
// Idempotent: if the patch is already applied it skips that target.
// Needs git on PATH; see apply-prismarine-physics-patch.js for why
// GIT_CEILING_DIRECTORIES is set (git apply silently skips patches for
// ignored paths inside a parent repo, and --check then exits 0 vacuously).
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = path.join(__dirname, '..')
const PATCH = path.join(__dirname, 'mineflayer-player-input.patch')
const DEFAULT_TARGETS = [
  path.join(REPO, '..', 'segs-26.3', 'mineflayer'),
  path.join(REPO, 'node_modules', 'mineflayer')
]

function run (cmd, args, cwd) {
  try {
    const env = Object.assign({}, process.env, { GIT_CEILING_DIRECTORIES: path.dirname(cwd) })
    execFileSync(cmd, args, { cwd, stdio: 'pipe', env })
    return true
  } catch (e) {
    return false
  }
}

function applyTo (target) {
  if (!fs.existsSync(target)) {
    console.log(`[patch] skip ${target} (not present)`)
    return
  }
  if (!fs.existsSync(path.join(target, 'lib', 'plugins', 'physics.js'))) {
    console.log(`[patch] skip ${target} (no lib/plugins/physics.js — not a mineflayer copy)`)
    return
  }
  if (!fs.existsSync(PATCH)) {
    console.log('[patch] patch file missing: ' + PATCH)
    return
  }
  if (run('git', ['apply', '--check', '--reverse', PATCH], target)) {
    console.log(`[patch] already applied: ${target}`)
    return
  }
  if (run('git', ['apply', '--check', PATCH], target) && run('git', ['apply', PATCH], target)) {
    console.log(`[patch] applied player-input patch to ${target}`)
    return
  }
  console.log(`[patch] WARNING: could not apply player-input patch to ${target} — the server will never see jump=true and Segs cannot swim up. Apply manually: cd ${target} && git apply ${PATCH}`)
}

const targets = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_TARGETS
for (const t of targets) applyTo(path.resolve(t))
