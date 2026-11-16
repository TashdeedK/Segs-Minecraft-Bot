// convert-schem.js — Sponge schematic (.schem v2/v3) -> compact Segs JSON schematic.
//
// Usage: node tools/convert-schem.js <input.schem> <output.json> [--verify <analysis.json>]
//
// The .schem file is BINARY and must never be committed to git. Only the
// converted JSON (plain text) lives in schematics/.
//
// Output format:
//   {
//     "name": "dom2", "format": "segs-schematic-v2", "sourceVersion": 2,
//     "dataVersion": 5023, "width": 121, "height": 55, "length": 69,
//     "offset": [0,0,0],
//     "palette": ["minecraft:air", "minecraft:oak_stairs[facing=north,half=bottom,shape=straight]", ...],
//     "blocks": [[dx,dy,dz,paletteIdx], ...],   // air excluded, YZX order (y, then z, then x)
//     "materials": { "oak_stairs": 2321, ... }, // counts per block id (no namespace, no states)
//     "blockEntities": { "count": 1632, "types": {"minecraft:sign": 375, ...},
//                        "list": [{"pos":[x,y,z],"id":"minecraft:sign"}, ...] }
//   }
//
// Parser logic is the PROVEN one from ~/workspace/segs-builder/parse-schem.js
// (prismarine-nbt, palette inversion, varint BlockData, index=(y*L+z)*W+x).
// Sponge v1 (numeric block ids) is rejected: it needs a legacy id mapping
// this tool deliberately does not guess.
'use strict'
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

function loadNbt () {
  const candidates = [
    'prismarine-nbt',
    path.join(__dirname, '..', 'node_modules', 'prismarine-nbt'),
    path.join(__dirname, '..', '..', 'segs-26.3', 'mineflayer', 'node_modules', 'prismarine-nbt'),
    path.join(__dirname, '..', '..', 'segs-26.3', 'test-segs', 'node_modules', 'prismarine-nbt')
  ]
  for (const c of candidates) {
    try { return require(c) } catch (e) { /* try next */ }
  }
  throw new Error('prismarine-nbt not found — run this from the bot folder after setup-26.3 (npm install)')
}

function unwrap (node) {
  if (node === null || node === undefined) return node
  if (Array.isArray(node)) return node.map(unwrap)
  if (typeof node !== 'object') return node
  if ('value' in node && 'type' in node) {
    const v = node.value
    if (node.type === 'compound') {
      const out = {}
      for (const k of Object.keys(v)) out[k] = unwrap(v[k])
      return out
    }
    if (node.type === 'list') {
      const arr = v && 'value' in v ? v.value : v
      return Array.isArray(arr) ? arr.map(unwrap) : arr
    }
    if (node.type === 'byteArray' || node.type === 'intArray' || node.type === 'longArray') return v
    return v
  }
  const out = {}
  for (const k of Object.keys(node)) out[k] = unwrap(node[k])
  return out
}

const AIR = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'])
function blockIdOf (stateStr) {
  return stateStr.split('[')[0].replace(/^minecraft:/, '')
}

async function convert (inputPath) {
  const nbt = loadNbt()
  const raw = fs.readFileSync(inputPath)
  const buf = raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw
  const { parsed } = await nbt.parse(buf)
  const root = unwrap(parsed)
  const schem = root.Schematic || root
  const version = schem.Version
  if (version !== 2 && version !== 3) {
    throw new Error(`unsupported Sponge schematic version ${version} (only v2/v3 with string palettes; v1 numeric ids are not supported)`)
  }
  const W = schem.Width, H = schem.Height, L = schem.Length
  if (!W || !H || !L) throw new Error('schematic has no Width/Height/Length')
  const total = W * H * L

  // Palette: { blockstateString: id } — invert to id-ordered array.
  const paletteObj = schem.Palette || {}
  const palette = []
  for (const [state, id] of Object.entries(paletteObj)) palette[id] = state
  if (palette.some(s => typeof s !== 'string')) throw new Error('palette has gaps — cannot build a dense index')

  // BlockData: varint array, index = (y*L + z)*W + x
  const bd = Buffer.from(schem.BlockData)
  let pos = 0
  const readVarint = () => {
    let val = 0, shift = 0, b
    do { b = bd[pos++]; val |= (b & 0x7f) << shift; shift += 7 } while (b & 0x80)
    return val
  }
  const blocks = []
  const materials = {}
  let idx = 0
  for (let y = 0; y < H; y++) {
    for (let z = 0; z < L; z++) {
      for (let x = 0; x < W; x++) {
        const id = readVarint()
        idx++
        const state = palette[id]
        if (state === undefined) throw new Error(`palette id ${id} at index ${idx} not in palette`)
        if (AIR.has(state.split('[')[0])) continue
        blocks.push([x, y, z, id])
        const bid = blockIdOf(state)
        materials[bid] = (materials[bid] || 0) + 1
      }
    }
  }
  if (idx !== total) throw new Error(`decoded ${idx} blocks but dimensions say ${total}`)

  const beList = (schem.BlockEntities || []).map(be => ({ pos: Array.isArray(be.Pos) ? be.Pos.slice(0, 3) : be.Pos, id: be.Id }))
  const beTypes = {}
  for (const be of beList) beTypes[be.id] = (beTypes[be.id] || 0) + 1

  const name = (schem.Metadata && schem.Metadata.Name) || path.basename(inputPath).replace(/\.(schem|schematic)$/i, '')
  return {
    name: String(name),
    format: 'segs-schematic-v2',
    sourceVersion: version,
    dataVersion: schem.DataVersion || null,
    width: W, height: H, length: L,
    offset: Array.isArray(schem.Offset) ? schem.Offset.slice(0, 3) : [0, 0, 0],
    palette,
    blocks,
    materials,
    blockEntities: { count: beList.length, types: beTypes, list: beList }
  }
}

async function main () {
  const args = process.argv.slice(2)
  const input = args[0]
  const output = args[1]
  if (!input || !output) {
    console.error('usage: node tools/convert-schem.js <input.schem> <output.json> [--verify <analysis.json>]')
    process.exit(2)
  }
  const out = await convert(input)
  fs.writeFileSync(output, JSON.stringify(out))
  console.log(`converted ${input} -> ${output}`)
  console.log(`dims ${out.width}x${out.height}x${out.length}, palette ${out.palette.length}, non-air blocks ${out.blocks.length}, block entities ${out.blockEntities.count}`)
  const vi = args.indexOf('--verify')
  if (vi >= 0 && args[vi + 1]) {
    const analysis = JSON.parse(fs.readFileSync(args[vi + 1], 'utf8'))
    const fails = []
    const check = (label, a, b) => { if (a !== b) fails.push(`${label}: converter=${a} analysis=${b}`) }
    check('width', out.width, analysis.width)
    check('height', out.height, analysis.height)
    check('length', out.length, analysis.length)
    check('nonAirBlocks', out.blocks.length, analysis.nonAirBlocks)
    check('paletteSize', out.palette.length, Object.keys(analysis.byState || {}).length)
    // per-block counts: analysis keys are "minecraft:<id>"
    const aByBlock = analysis.byBlock || {}
    for (const [k, v] of Object.entries(aByBlock)) {
      const id = k.replace(/^minecraft:/, '')
      if (AIR.has(k)) continue
      if ((out.materials[id] || 0) !== v) fails.push(`material ${id}: converter=${out.materials[id] || 0} analysis=${v}`)
    }
    for (const id of Object.keys(out.materials)) {
      if (aByBlock['minecraft:' + id] === undefined) fails.push(`material ${id}: present in converter, missing in analysis`)
    }
    const aBE = analysis.blockEntities || {}
    for (const [t, c] of Object.entries(aBE)) {
      if ((out.blockEntities.types[t] || 0) !== c) fails.push(`blockEntity ${t}: converter=${out.blockEntities.types[t] || 0} analysis=${c}`)
    }
    check('blockEntityCount', out.blockEntities.count, Object.values(aBE).reduce((s, n) => s + n, 0))
    if (fails.length) {
      console.log('VERIFY FAILED:')
      for (const f of fails) console.log('  ' + f)
      process.exit(1)
    }
    console.log('VERIFY OK: converter output matches analysis exactly')
  }
}

if (require.main === module) main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
module.exports = { convert }
