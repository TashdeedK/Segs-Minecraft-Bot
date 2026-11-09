@echo off
REM Segs v4 setup (Windows) - native Minecraft 26.3, no ViaVersion, no npm Mineflayer.
REM Clones the Misty4119 six-repo fork, installs it, then installs this bot.
REM Run this from the parent folder that contains Segs-Minecraft-Bot, e.g. C:\Users\you\
REM After it finishes: copy config.example.json to config.json, fill in the password, node bot.js
setlocal
cd /d "%~dp0.."
if not exist segs-26.3 mkdir segs-26.3
cd segs-26.3
if not exist mineflayer git clone --depth 1 https://github.com/Misty4119/mineflayer.git mineflayer
if not exist node-minecraft-protocol git clone --depth 1 https://github.com/Misty4119/node-minecraft-protocol.git node-minecraft-protocol
if not exist prismarine-chunk git clone --depth 1 https://github.com/Misty4119/prismarine-chunk.git prismarine-chunk
if not exist prismarine-item git clone --depth 1 https://github.com/Misty4119/prismarine-item.git prismarine-item
if not exist prismarine-physics git clone --depth 1 https://github.com/Misty4119/prismarine-physics.git prismarine-physics
if not exist minecraft-data git clone --depth 1 https://github.com/Misty4119/minecraft-data.git minecraft-data
REM v10.5.1: patch the cloned prismarine-physics so the water climb-out ships (idempotent)
node "%~dp0patches\apply-prismarine-physics-patch.js" "%CD%\prismarine-physics"
REM v10.5.1: patch the cloned mineflayer so Paper sees the full player input (jump held) (idempotent)
node "%~dp0patches\apply-mineflayer-collision-sync-patch.js" "%CD%\mineflayer"
REM v10.5.3: patch the cloned mineflayer to send full player_input (jump/shift/forward) on control changes (idempotent)
node "%~dp0patches\apply-mineflayer-player-input-patch.js" "%CD%\mineflayer"
cd mineflayer
call npm install --no-audit --no-fund
cd ..\..
cd Segs-Minecraft-Bot
call npm install --no-audit --no-fund
node link-prismarine.js
node --check bot.js
echo DONE. Next: copy config.example.json to config.json, fill in host + password, then node bot.js
