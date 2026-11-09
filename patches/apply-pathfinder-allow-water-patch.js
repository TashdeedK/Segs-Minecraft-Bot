// apply-pathfinder-allow-water-patch.js — v10.5.3 Segs (shipped pathfinder patch).
// Applies patches/pathfinder-allow-water.patch to one or more
// mineflayer-pathfinder copies. Usage:
//   node patches/apply-pathfinder-allow-water-patch.js [targetDir ...]
// With no args it tries the standard location relative to this repo.
// Idempotent: if the patch is already applied it skips that target.
// Needs git on PATH; GIT_CEILING_DIRECTORIES is set because git apply
// silently skips patches for ignored paths inside a parent repo.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = path.join(__dirname, '..')
const PATCH = path.join(__dirname, 'pathfinder-allow-water.patch')
const DEFAULT_TARGETS = [
  path.join(REPO, 'node_modules', 'mineflayer-pathfinder')
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
  if (!fs.existsSync(path.join(target, 'lib', 'movements.js'))) {
    console.log(`[patch] skip ${target} (no lib/movements.js — not a mineflayer-pathfinder copy)`)
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
    console.log(`[patch] applied allow-water patch to ${target}`)
    return
  }
  console.log(`[patch] WARNING: could not apply allow-water patch to ${target} — the A* water exemption for grave recovery will be missing. Apply manually: cd ${target} && git apply ${PATCH}`)
}

const targets = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_TARGETS
for (const t of targets) applyTo(path.resolve(t))
