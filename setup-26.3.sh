#!/usr/bin/env bash
# Segs v4 setup (Mac / Linux) - native Minecraft 26.3, no ViaVersion, no npm Mineflayer.
# Clones the Misty4119 six-repo fork (pinned commits, tested 2026-11-07),
# installs it, then installs this bot and links the fork's prismarine packages.
# Layout after this script (both folders side by side in the SAME parent folder):
#   segs-26.3/mineflayer, node-minecraft-protocol, prismarine-chunk, ...
#   Segs-Minecraft-Bot/bot.js  (this repo)
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$(dirname "$0")/.."
PIN_MINEFLAYER=af53e8744eb46e1a56bf45c5b2b03f4bb8ed973d
PIN_PROTOCOL=cc1bfca769d36e90f8941138c1f63144e55d3403
PIN_CHUNK=23149f443d08aa15c4d4ddc868dfd3536c7b6110
PIN_ITEM=9c3c7ab88aab28072a0222b9bfa599e516fcbaf9
PIN_PHYSICS=0e9d8c5f0876fcfab37443aa39de58c26ca319fe
PIN_DATA=1d37505b338710f2f347aa00efaa48a054754b19
mkdir -p segs-26.3
cd segs-26.3
clone_pin () {
  local repo="$1" pin="$2"
  if [ -d "$repo" ]; then echo "== $repo exists, skipping clone =="; else git clone --depth 1 "https://github.com/Misty4119/$repo.git" "$repo"; fi
  (cd "$repo" && git fetch --depth 1 origin "$pin" 2>/dev/null || true; git checkout "$pin" 2>/dev/null || echo "NOTE: could not checkout $pin in $repo, using cloned HEAD")
}
clone_pin mineflayer "$PIN_MINEFLAYER"
clone_pin node-minecraft-protocol "$PIN_PROTOCOL"
clone_pin prismarine-chunk "$PIN_CHUNK"
clone_pin prismarine-item "$PIN_ITEM"
clone_pin prismarine-physics "$PIN_PHYSICS"
clone_pin minecraft-data "$PIN_DATA"
echo "== applying Segs water-climb patch to prismarine-physics (v10.5.1) =="
node "$SCRIPT_DIR/patches/apply-prismarine-physics-patch.js" ./prismarine-physics || true
echo "== applying Segs collision+sync patch to mineflayer (v10.5.1) =="
node "$SCRIPT_DIR/patches/apply-mineflayer-collision-sync-patch.js" ./mineflayer || true
echo "== applying Segs player-input patch to mineflayer (v10.5.3) =="
node "$SCRIPT_DIR/patches/apply-mineflayer-player-input-patch.js" ./mineflayer || true
echo "== installing fork mineflayer (this takes a minute) =="
cd mineflayer && npm install --no-audit --no-fund && cd ..
echo "== verifying native 26.3 data =="
node -e "const mc=require('./mineflayer/node_modules/minecraft-data')('26.3'); console.log('26.3 OK:', mc.version.minecraftVersion, 'protocol', mc.version.version, 'dataVersion', mc.version.dataVersion)"
echo "== installing Segs bot =="
cd ../Segs-Minecraft-Bot 2>/dev/null || cd "$(dirname "$0")"
npm install --no-audit --no-fund
node link-prismarine.js
node --check bot.js
echo ""
echo "DONE. Next:"
echo "  1. cp config.example.json config.json"
echo "  2. Edit config.json: host youniga.deployd.sh, authPassword = the SAME password Segs was registered with (never share it)"
echo "  3. Log out as Segs on your Mac, play as OrewaSegs"
echo "  4. node bot.js"
