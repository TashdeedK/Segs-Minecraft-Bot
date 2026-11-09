// apply-prismarine-physics-patch.js — v10.5.1 Segs (shipped fork patch).
// Applies patches/prismarine-physics-water-climb.patch to one or more
// prismarine-physics copies: the cloned repo (../segs-26.3/prismarine-physics),
// mineflayer's node_modules copy, and/or this bot's node_modules copy.
// Usage: node patches/apply-prismarine-physics-patch.js [targetDir ...]
// With no args it tries all three standard locations relative to this repo.
// Idempotent: if the patch is already applied it skips that target.
// Needs git on PATH (setup-26.3 clones with git, so it is there); if git
// apply fails for another reason it warns and exits 0 — the bot still runs,
// just without the water climb-out fix (Segs then asks for /tpa as before).
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = path.join(__dirname, '..')
const PATCH = path.join(__dirname, 'prismarine-physics-water-climb.patch')
const DEFAULT_TARGETS = [
  path.join(REPO, '..', 'segs-26.3', 'prismarine-physics'),
  path.join(REPO, '..', 'segs-26.3', 'mineflayer', 'node_modules', 'prismarine-physics'),
  path.join(REPO, 'node_modules', 'prismarine-physics')
]

function run (cmd, args, cwd) {
  try {
    // GIT_CEILING_DIRECTORIES stops git finding a parent repo (e.g.
    // mineflayer's) above a node_modules copy: inside a repo, git apply
    // silently SKIPS patches for ignored paths like node_modules, and
    // --check then exits 0 vacuously, so an unpatched copy would be
    // reported as "already applied". With the ceiling, git treats the
    // target as its own working tree and the checks are real.
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
  if (!fs.existsSync(path.join(target, 'index.js'))) {
    console.log(`[patch] skip ${target} (no index.js — not a prismarine-physics copy)`)
    return
  }
  if (!fs.existsSync(PATCH)) {
    console.log('[patch] patch file missing: ' + PATCH)
    return
  }
  // Already applied? The reverse check passes only then.
  if (run('git', ['apply', '--check', '--reverse', PATCH], target)) {
    console.log(`[patch] already applied: ${target}`)
    return
  }
  if (run('git', ['apply', '--check', PATCH], target) && run('git', ['apply', PATCH], target)) {
    console.log(`[patch] applied water-climb patch to ${target}`)
    return
  }
  console.log(`[patch] WARNING: could not apply water-climb patch to ${target} — water climb-out stays unpatched (Segs will ask for /tpa instead). Apply manually: cd ${target} && git apply ${PATCH}`)
}

const targets = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_TARGETS
for (const t of targets) applyTo(path.resolve(t))
