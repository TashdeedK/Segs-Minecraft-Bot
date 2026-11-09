#!/usr/bin/env python3
"""Build the Segs A-to-Z guide PDF (v10.5.3).

Generates Segs-A-to-Z-Guide.pdf in this folder: cover, table of contents
(with page numbers, two-pass), then one section per topic. Every command
is listed with the exact words to say. No invented features — everything
here is in bot.js v10.5.3 and simulation-tested where noted.
"""
from fpdf import FPDF

TITLE = "Segs — The A-to-Z Guide"
SUBTITLE = "Everything the bot can do, how to teach it your base, and every command"
VERSION = "Version 10.5.3  •  Minecraft 26.3 (native, no ViaVersion)  •  2026-11-09"

# (title, body) — body is a list of blocks: ('h', text), ('p', text),
# ('b', text) bullet, ('c', text) command line, ('n', text) note.
SECTIONS = [
("1  Setup — do this once", [
 ("p", "Segs runs on your own Mac or PC. It only stays online while node bot.js is running — if your PC sleeps or you close the terminal, Segs logs off."),
 ("h", "What you need"),
 ("b", "Node.js 22 or newer. Check with: node --version"),
 ("b", "The bot folder (tash-minecraft-bot-v10.5.3.zip, unzipped) next to the segs-26.3 folder."),
 ("b", "Your Minecraft account name for Segs — it is already registered as a cracked player on youniga.deployd.sh."),
 ("h", "First run"),
 ("b", "Windows: double-click setup-26.3.bat. Mac: run bash setup-26.3.sh in a terminal. This clones the six Mineflayer fork repos and links them (one-time, a few minutes)."),
 ("b", "Open config.json and put the SAME password Segs was registered with into authPassword. Never share config.json or the password — it is gitignored and never leaves your PC."),
 ("b", "Start it: node bot.js. You should see it join as Segs and say hello in chat."),
 ("b", "To stop it: Ctrl+C in the terminal. To restart it: node bot.js again."),
 ("n", "RAM: the bot uses about 200 MB. The 500 MB – 1 GB target is met easily. View distance and simulation distance are 7 on the test server; on Youniga they are the server owner's setting — Segs cannot change them from the bot."),
]),
("2  How to talk to Segs", [
 ("p", "Talk to it like a person. No ! prefix. Only OrewaSegs (you) can give it orders — anyone else talking to it is ignored."),
 ("b", "Start with its name: \"Segs sort my room\", \"Segs come to me\", \"Segs sleep\"."),
 ("b", "Say it however you like. \"Segs sort my room and move to storage unit\" works the same as \"Segs sort my room\". It understands the idea, not one exact phrase."),
 ("b", "Long messages are fine. \"Go to the farm and farm wheat and then come back to me\" is split into steps and done one by one."),
 ("b", "If it does not understand, it says: \"hmm, i didn't get that. try: segs help\". If you make a typo it guesses: \"Segs top\" gets \"did you mean segs stop?\"."),
 ("b", "Say it however you like — \"Segs craft yourself an axe\", \"Segs equip axe\", \"Segs hold beef\" all work. Filler words (yourself, your, a, the) are ignored."),
 ("b", "Segs never drops what it is holding when you give it a command. If it ever does, tell Mu exactly what you said and what it was holding."),
 ("b", "Segs answers fast now: when you give it a command it replies at once (\"on it\", \"coming\", \"got it\") and then does the work and reports the result — it no longer stays silent while it thinks."),
 ("b", "In v10.5.1 the newest command always wins: if you tell it to do something new while it is still walking or cooking, it drops the old job and starts the new one straight away (it says \"dropping X, doing Y\" so you know). \"Segs stop\" answers in under a second and the old job never reports back late. \"Segs status\" and \"Segs inventory\" answer at once even while a long job is running. If you say \"tp to me\" three times, it only sends ONE tpa request — the extra ones just remind you to accept the first one."),
 ("b", "\"Segs help\" lists the main commands in chat."),
 ("b", "It answers in plain, casual words — never like a robot, and it is honest about being a bot, not an AI."),
 ("h", "AI chat (AutoChat — Groq, optional, off by default)"),
 ("c", "Segs enable AI  •  Segs disable AI  •  Segs ai status"),
 ("p", "With AI on, Segs answers open questions with a real AI (Groq, free tier) instead of its fixed replies. It only answers when you mention it or whisper it, keeps replies short (140 characters), and never calls the AI for simple questions like \"where are you\" — those get a plain local answer with no API call. It stops calling the AI before it hits the daily free limit and falls back to its normal replies."),
 ("p", "The Groq API key goes ONLY in config.json on your PC (groqApiKey). Never paste it in chat or a screenshot — a pasted key is an exposed key. Only OrewaSegs can turn AI on or off. With no key in config.json, \"Segs enable AI\" says so and stays on its normal replies."),
 ("n", "Segs never rewrites its own code and never learns from the AI — the AI only chats. What Segs learns from playing is still the log system in section 13."),
 ("n", "A line starting with / is a server command, not chat to Segs. If you type /enchant Segs sharpness 3, Segs ignores it instead of answering."),
]),
("3  Teaching it your base — walk it around once", [
 ("p", "Segs cannot guess what a place IS. A trading hall and a house are just blocks to it. The reliable way is: walk Segs to the place, stand next to it, and name it. It remembers the spot in brain.json on your PC."),
 ("h", "Your room (where sorting starts)"),
 ("c", "Segs this is my room"),
 ("p", "Stand in your room. Segs records every chest and barrel within 5 blocks (but never a chest that already belongs to a column). This is where \"sort my room\" takes items FROM."),
 ("h", "The storage unit (its permanent home, the centre of the map)"),
 ("c", "Segs this is the storage unit"),
 ("p", "Stand in the big storage room. Segs marks it as its permanent home and the centre of its base map. If it has no permanent home yet, this sets it."),
 ("h", "A column (one column = one type of item)"),
 ("c", "Segs this is the ore column"),
 ("p", "Stand right next to the column (1 block away). Segs records every chest and barrel in that column — up to 10 chests tall — and remembers which item goes in which chest, so next time it goes straight there without re-checking. See section 5 for the 16 columns."),
 ("b", "If you say \"Segs this is a column\" without a type, it notes the column as blank. Later, when you sort a category that has no column, Segs claims a blank column for it and starts using it."),
 ("h", "The trash chest"),
 ("c", "Segs this is the trash chest"),
 ("p", "Junk goes here (see section 8). If you never teach one, Segs drops junk on the ground and tells you."),
 ("h", "The sugarcane farm chest"),
 ("c", "Segs this is the sugarcane farm chest"),
 ("p", "Segs takes sugarcane from these chests, crafts it into paper, and puts the paper in the paper column. Teach every sugarcane chest."),
 ("h", "Any other place"),
 ("p", "You can say it WITH or WITHOUT \"the\": \"Segs this is food chest\" and \"Segs this is the food chest\" both work. Same for \"Segs this is Storage unit\"."),
 ("c", "Segs this is the trading hall"),
 ("p", "Any name works — trading hall, a friend's house, the farm, the nether portal. Segs remembers the spot on its base map. \"Segs go to the trading hall\" walks there."),
 ("h", "Landmarks (older, still works)"),
 ("c", "Segs this is the potato farm  •  Segs this is the food chest  •  Segs this is the smoker"),
 ("p", "Same idea: Segs records the nearest matching block (the farm, the chest, the smoker), not where its feet are. The survival routine uses these."),
 ("h", "Bed = spawn point"),
 ("c", "Segs set this bed as your bed"),
 ("p", "Segs walks to the bed and sleeps in it. That bed becomes its respawn point. Ask again at another bed and the spawn point moves there. In the daytime it says so, remembers the bed, and sleeps in it on its own the first night it can."),
 ("h", "Permanent home (its room)"),
 ("c", "Segs remember this is your permanent home"),
 ("p", "Marks where Segs stands as its permanent home (its room in your base, with its chests). It stays even if the bed/spawn point moves later. \"Segs go home\" goes there."),
 ("n", "Everything taught is saved in brain.json. If you delete brain.json, Segs forgets it all and you teach it again."),
]),
("4  Sorting — the storage unit", [
 ("p", "The storage unit is the big room where the whole team's items get sorted. One column = one type. Segs moves items from your room into the right column, and remembers where everything is."),
 ("c", "Segs sort my room"),
 ("p", "Takes everything out of your room's chests and moves it, sorted, into the storage unit columns. A permanent move — it does not bring things back unless you ask."),
 ("c", "Segs move the ores to the ore column"),
 ("p", "Sorts just one category. Any category works: \"move the foods to the food column\", \"sort the woods\", \"move the tools to the tools column\"."),
 ("c", "Segs sort my room and move to storage unit"),
 ("p", "Same as \"sort my room\". Phrasing is flexible — say it your way each time."),
 ("c", "Segs list columns"),
 ("p", "Lists every column Segs knows, with how many chests each has, and how many blank columns are waiting."),
 ("c", "Segs list places"),
 ("p", "Lists every named place on the base map."),
 ("c", "Segs where is the ore column"),
 ("p", "Gives you the coordinates of a column (or a place: \"where is the trading hall\")."),
 ("c", "Segs go to the trading hall"),
 ("p", "Walks to a named place on the base map."),
 ("h", "Stop and continue"),
 ("c", "Segs stop"),
 ("p", "Stops the sort mid-way. Segs puts back what it was carrying, saves exactly how far it got, and stops. It tells you how much it moved."),
 ("c", "Segs continue last sorting"),
 ("p", "Segs reports first: \"last sorting was your whole room from my room — i moved N stacks, M left. do you want to continue this one, or do another sorting? if another one, which one?\" Then it waits. Reply \"continue\" or \"yes\" to resume it, or name a different sort."),
 ("p", "A fresh sort starts from the beginning but skips anything already sorted — it does not redo work."),
 ("h", "How it decides where things go"),
 ("b", "It checks the item against the 16 categories (section 5)."),
 ("b", "It remembers which chest an item went in last time (the item-to-chest index), so the next sort goes straight there."),
 ("b", "If a category has no column and a whole column is empty, Segs claims that empty column for the category."),
 ("b", "If a column is full, or a category has no column and no blank column, the item overflows to the misc column."),
 ("b", "Shulker boxes are never opened, moved or sorted — Segs reports them and leaves them alone."),
 ("n", "Segs must start near your room when you ask it to sort. Long walks across rough ground can time out — it will say \"i cant reach there\" honestly instead of pretending. On a flat built base (like yours) the walks are short."),
]),
("5  The 16 columns", [
 ("p", "Build these 16 columns in the storage unit. One column = one type. Each column can be up to 10 chests tall, with stairways so Segs can climb to the upper chests."),
 ("h", "Your 8 columns"),
 ("b", "flowers — all flowers"),
 ("b", "building blocks — stone, bricks, dirt, sand, glass, and other building blocks"),
 ("b", "ores — raw ore, ingots, and ore blocks (any)"),
 ("b", "tools — best to worst, top to bottom: netherite at the top, then diamond, iron, gold, stone, wood at the bottom"),
 ("b", "foods — raw or cooked, any food"),
 ("b", "farm items — wheat, potato and carrot ONLY, nothing else"),
 ("b", "paper — Segs crafts sugarcane into paper and puts it here"),
 ("b", "woods — logs and planks, all types"),
 ("h", "The other 8 columns"),
 ("b", "redstone — redstone dust, repeaters, comparators, pistons, and redstone parts"),
 ("b", "mob drops — bones, string, gunpowder, ender pearls, and mob drops"),
 ("b", "nether — netherrack, quartz, glowstone, soul sand, basalt, blackstone, nether brick, warped/crimson blocks"),
 ("b", "valuables — diamond, emerald, netherite, ancient debris, lapis, amethyst, and other treasures"),
 ("b", "brewing / potions — nether wart, blaze powder, ghast tears, potions, glass bottles, brewing ingredients"),
 ("b", "armor — helmets, chestplates, leggings, boots (any material)"),
 ("b", "seeds & plants — seeds, saplings, and plants"),
 ("b", "misc — everything else, and the overflow when a category has no column"),
 ("n", "Tools order (netherite > diamond > iron > gold > stone > wood) is a best guess — tell Mu if gold should sit somewhere else and it will be corrected."),
]),
("6  Paper — made on its own", [
 ("c", "Segs make paper"),
 ("p", "Segs takes sugarcane from the sugarcane farm chests, crafts it into paper at a crafting table, and puts the paper in the paper column. It needs a crafting table within 16 blocks."),
 ("p", "During a sort, sugarcane is crafted automatically — it never gets stored as raw cane if a table is near. Leftover cane (that did not fit into a craft) goes into the paper column as stock."),
 ("n", "Teach the sugarcane farm chests first (section 3), and keep a crafting table in or near the storage unit."),
]),
("7  Moving around, teleporting and homes", [
 ("c", "Segs come to me  •  Segs tp to me  •  Segs come here"),
 ("p", "Segs sends you a /tpa request — type /tpaccept Segs. If you do not accept within 15 seconds, Segs walks to you instead."),
 ("c", "Segs follow me  •  Segs stop following"),
 ("p", "Follows you around, 2 blocks behind you. It jumps up 1-block steps on its own (if it is stuck for 2 seconds it pulses jump), and if a wall blocks the way it sidesteps left or right to go around it instead of standing at the wall. It now keeps up properly: it only re-plans its route when you have moved more than 3 blocks, instead of restarting the path every half second (the old way made it crawl at about 0.6 blocks a second over a long walk). If it is stuck for 15 seconds while following, it tells you and stops so you know. If you teleport far away it finds you again by name and keeps coming — and if it is stuck after you teleported, it offers to /tpa to you instead of just complaining (it never teleports on its own, you have to say \"Segs tp to me\")."),
 ("p", "It opens doors instead of breaking them, and never digs through stone to reach you. Fixed in v10.5.1: following you through a closed door now works — Segs opens the door, walks to the doorway, lines itself up on the open side of the door, and walks straight through to 2 blocks behind you. If it truly cannot reach you, it says so honestly."),
 ("p", "Downhill (Parkour): Segs walks down a 3-block drop on its own (a 3-block fall does no damage). If the pathfinder cannot find a way down — a sheer drop it refuses to route — Segs walks to the edge and steps off by hand instead of giving up. A 4-block drop costs 1 hp, so it only does that when there is no other way down."),
 ("p", "Uphill and rough ground: if Segs falls into a dip and the pathfinder gives up, it now backs up and takes a running jump at the wall (it times the jump so it is in the air over the wall, not jumping too early and landing at its foot), and it climbs stairs in a slow hop-step instead of running at them and getting wedged. A 2-high wall it still goes around, not through — it never digs through a wall to cheat a path."),
 ("p", "When you say \"Segs go to\" somewhere, it only says \"here\" when it actually arrived. If it cannot get there it says \"i cant reach there\" instead of pretending — and it now offers to teleport to you (\"want me to tp to you?\") so you can bring it over with one /tpaccept. If it is truly sealed in somewhere it cannot get out of (tested in v10.5.3 with a bedrock box), it reports that within about 15 seconds instead of sitting there silently. It never teleports on its own."),
 ("c", "Segs go to the farm  •  Segs go to <place>"),
 ("p", "Walks to a named place, a landmark, or a base it knows. \"Segs go to the trading hall\" uses the base map."),
 ("c", "Segs go home"),
 ("p", "Goes to its permanent home (its room). It tries /home <name> first if a server home is linked, otherwise it walks."),
 ("c", "Segs sethome <name>  •  Segs set home <name>"),
 ("p", "Sets a server home where Segs stands. Maximum 3 homes, overworld only. If the server refuses (same name, or the 3-home limit — the message is in French), Segs tells you and does not pretend it worked. Never use bare /home — that opens a GUI."),
 ("c", "Segs home <name>  •  Segs go to home <name>"),
 ("p", "Teleports to a server home with /home <name>. It stands completely still for 3 seconds (moving cancels it), then checks it arrived. If the teleport did not happen, it walks instead."),
 ("c", "Segs delhome <name>"),
 ("p", "Deletes a server home."),
 ("c", "Segs where is home  •  Segs list homes"),
 ("p", "Lists the server homes it knows, and where its permanent home is."),
 ("n", "Homes and teleporting use the server's own player commands (/tpa, /sethome, /home) — the only commands that work without ranks. Segs never uses /tp, /give or /gamemode."),
]),
("8  Junk, enchanted items and shulkers — the rules", [
 ("p", "These rules are fixed, so you never lose a good item by accident."),
 ("h", "Junk — thrown away"),
 ("p", "Rotten flesh, arrows, and non-enchanted wood, stone, iron or gold tools, weapons and armour (and leather armour) are junk. If you taught a trash chest, junk goes there. If not, Segs drops it on the ground and tells you what it dropped."),
 ("h", "Enchanted — never junk, never thrown away"),
 ("p", "If an item is enchanted, it goes to the misc column — even if it is a wooden sword or a low-tier tool. Enchanted gear is never trashed and never dropped, so a netherite item you stored by mistake cannot be lost."),
 ("h", "Shulker boxes — never touched"),
 ("p", "Segs never opens a shulker box, never moves it, never sorts it. It reports shulkers it finds (\"left 1 shulker boxes alone\") and leaves them where they are. It needs your explicit permission before it ever touches one."),
 ("h", "Anything else"),
 ("p", "Segs can open any other chest or barrel. If an item does not match any category, it goes to misc."),
]),
("9  Farming, food and survival", [
 ("c", "Segs farm wheat  •  Segs farm potato  •  Segs farm carrot  •  Segs farm beetroot  •  Segs farm all"),
 ("p", "Farms a crop at the farm you taught it (AutoFarm). It replants FIRST and then harvests, one crop at a time, and remembers which seed goes on each spot. It farms wheat, carrot, potato and beetroot — pumpkins and melons grow differently (on stems) so it does not farm those."),
 ("c", "Segs eat  •  Segs get food"),
 ("p", "Segs finds food: it checks its inventory, then the farm, then a chest. If it has raw food and a smoker or furnace, it cooks it first. If it has wheat, it makes BREAD (3 wheat = 1 bread) and eats that — wheat on its own is not food. It narrates what it is doing (\"no coal, checking the chest\", \"found 8x coal\", \"cooked, got baked_potato\", \"making 3x bread\")."),
 ("p", "When it eats (AutoEat), it picks the best food first by saturation (how filling it is) — cooked beef before bread, bread before an apple — and it never eats rotten flesh or other poison food. In v10.5.1 it eats when its food drops below 19 (it used to wait until 13, which was too late), and eats more when it is hurt. Say \"Segs autoeat\" to check it is on, \"Segs autoeat off\" to turn it off. It also eats on its own when hungry even while it is walking or working, not only when it is idle. FIXED in v10.5.2: eating used to drop 1 piece of food on the ground every time (a wrong packet was sent before each meal) — now nothing is dropped, and \"Segs eat\" when already full just says \"im already full\" instead of eating anyway. It also checks its hunger actually went up after eating, and says so honestly if it did not."),
 ("p", "On its own, every 30 seconds, if its food drops below 19, it goes and gets food by itself (60-second cooldown so it does not spam)."),
 ("c", "Segs sleep  •  Segs wake up"),
 ("p", "Sleeps in a nearby bed (and sets its spawn point, section 3), or wakes up."),
 ("c", "Segs guard me  •  Segs stop guard"),
 ("p", "Follows you and attacks anything that attacks you. Say stop guard to stand down."),
 ("c", "Segs check for enemies"),
 ("p", "Scans 20 blocks and reports what it can SEE (\"i can see: zombie 3 blocks away\", or \"all clear\"). It only counts mobs on the same level with a clear line of sight — a zombie in a cave below does not count, so it will not say mobs are there when nothing is on the surface."),
 ("p", "On its own, every 5 seconds, if a hostile gets within 8 blocks while Segs is idle (4 while busy) it runs away from it, sprinting, and says so. It never runs while guarding. It sprints when its food is 10 or higher and walks when hungry, so it does not burn food it does not have."),
 ("p", "It avoids lava, fire, magma blocks, cactus and sweet berry bushes when pathfinding — it routes around them instead of walking through. It will not walk into lava."),
 ("c", "Segs status"),
 ("p", "Reports hp, food, where it is, and what it is carrying — every item, summed across all stacks including what it is holding in its off hand (in v10.5.1 it used to show only the first 5 stacks and miss the off hand entirely). If the list is long it comes in more than one chat line instead of cutting items off."),
 ("c", "Segs stats"),
 ("p", "Reports counters: how much it sorted, picked up, stored, graves recovered, deaths, and more."),
]),
("10  Pickup, store, graves and dying", [
 ("c", "Segs pick up the carrot  •  Segs pick up the items"),
 ("p", "Walks right onto a dropped item and collects it, then tells you if it got it (\"got it\") or could not reach it. Works for anything: food, tools, blocks. Say the item name or just \"pick up the items\". When farming it picks up each crop drop before moving to the next crop."),
 ("c", "Segs keep these items at your base"),
 ("p", "Segs goes to its permanent home and puts everything from its inventory into the room chests. It keeps its tools, weapons and armour and stores the rest."),
 ("c", "Segs drop seeds  •  Segs drop 1 wheat  •  Segs drop all seeds  •  Segs drop everything"),
 ("p", "\"Segs drop seeds\" drops ALL the seeds it has. \"Segs drop 1 wheat\" drops just 1. \"Segs drop all seeds\", \"Segs drop seeds x64\" and \"Segs drop 64x wheat_seeds\" all work. \"Segs drop everything\" drops the whole inventory."),
 ("c", "Segs equip axe  •  Segs hold beef  •  Segs equip shield"),
 ("p", "Holds the item you name in its hand (or the shield in its off-hand). \"Segs equip best weapon\" holds its best sword or axe."),
 ("c", "Segs keep wheat in this chest  •  Segs store iron in this chest"),
 ("p", "Puts the item you name into the nearest chest."),
 ("c", "Segs get your stuff  •  Segs go to your grave"),
 ("p", "Walks back to where it died and takes everything out of its grave. A grave only lasts 10 minutes — if Segs cannot reach the spot it says the coordinates in chat so you can go yourself."),
 ("p", "When Segs dies it remembers the death spot. After respawning it walks back on its own (about 8 seconds later), opens the grave like a chest and takes everything out. If it cannot reach it, it announces the coords and how much time is left. NEW in v10.5.3: if the grave is in water (for example it died in a river), Segs swims to it and gets its stuff back — it does not refuse the water for a grave, even though it normally refuses to walk into water. It says \"got my stuff back from my grave (18 items)\" when it is done."),
 ("p", "When Segs dies (AutoRespawn) it respawns right where it died, on the same connection — no kick, no reconnect needed. (Paper used to kick a dead client with \"Invalid move player packet\"; that is fixed in v10.4.1. If it is ever kicked for another reason, it still reconnects on its own after 10 seconds.)"),
 ("n", "The grave block type on the real server (SimpleGraves) has not been confirmed yet — the code opens it like a chest first, and falls back to sneak + right-click. If the grave looks different on youniga, tell Mu what it is."),
]),
("11  Fighting — combat and guard", [
 ("p", "Segs fights like a player: it keeps its distance, hits only when its weapon is ready, and moves so it does not get hit. Give it a sword or an axe first — without a weapon it runs away and asks for one."),
 ("c", "Segs guard me  •  Segs stop guard"),
 ("p", "Follows you and fights anything that attacks you or it. Say stop guard to stand down."),
 ("c", "Segs kill that zombie  •  Segs fight the skeleton"),
 ("p", "Attacks the mob you name. It sticks to one target until it is dead instead of spreading damage around."),
 ("c", "Segs block  •  Segs lower shield"),
 ("p", "Raises its shield (if it has one) to block arrows, or lowers it."),
 ("p", "Weapons: sword for groups (it sweeps), axe for one tough target. A bow works at range — Segs shoots skeletons from 10-14 blocks away and never gets hit. It kills creepers with the bow too: it plants its feet to shoot (moving while the bow charges makes the arrows miss), aims with real arrow physics, and kills a creeper in 2-3 arrows without taking a hit (v10.5.3 simulation: 8 out of 9 arena runs, zero hits in the 8 wins, 25 of 26 arrows used). One honest note: very rarely a shot fires but the arrow is not used up — the cause is still unknown, and if it happens the creeper gets close and Segs takes the explosion, so keep an eye on it and tell Mu if you ever see it. If a creeper does get right up to Segs and there is nowhere safe to run (for example it is cornered at a wall), Segs now notices the run is going nowhere and fights it with the sword instead of standing still — two sword hits kill a creeper before its fuse finishes."),
 ("p", "Segs never attacks endermen, animals or villagers. It only fights hostile mobs, and only ones it can see — a zombie in a cave below does not count."),
 ("p", "It turns at a human speed, only hits when it is actually facing the mob and can see it, and times its hits to the weapon's real cooldown instead of spamming. (AimAssist + KillauraLegit discipline only — capped turn speed, line-of-sight gate, facing check before every hit, timing jitter. No auto-aim, no auto-attack.) If its health drops low it retreats, eats, and heals before fighting again. Say \"Segs stats\" to see kills, hits taken and hits landed."),
 ("h", "Looking after its gear"),
 ("b", "AutoArmor: Segs wears its best armour on its own (best piece per slot, swapped only while standing still)."),
 ("b", "AutoTotem: if Segs has a totem, it holds it in its off-hand all the time — a totem only saves it if it is already there when the killing hit lands. If it pops, the spare goes straight in. The shield is the backup when there is no totem."),
 ("b", "AntiBreak: before a tool is about to break, Segs swaps to the next best tool of the same kind and tells you — it will not break your good pickaxe by accident."),
]),
("12  Crafting, smelting and other work", [
 ("c", "Segs craft iron pickaxe  •  Segs make paper"),
 ("p", "Crafts an item if it has the materials. \"Segs craft iron pickaxe\" works for any recipe it can make. It needs a crafting table nearby for 3-wide recipes (like paper). NEW in v10.5: it fetches the materials from any chest within 12 blocks — it does not need to be carrying them. If a recipe has two ways to make it (a torch takes coal OR charcoal) it tries both, and it tells you the real number it made, not just the number you asked for."),
 ("c", "Segs smelt iron ore  •  Segs smelt the iron"),
 ("p", "Smelts ore in a furnace or smoker it knows, if it has fuel (coal). NEW in v10.5: it fetches the ore AND the fuel from any chest within 12 blocks, picks the right workstation itself (smoker for food, blast furnace for ore, furnace otherwise — and says exactly which one is missing if there is none nearby), waits until everything is cooked, and TAKES the cooked items out into its inventory and says \"got 4x cooked_beef\" — it never leaves the result sitting in the furnace. If the ingredient, the fuel, or the workstation is missing it says exactly what is missing and where it looked."),
 ("c", "Segs dig dirt  •  Segs mine stone  •  Segs chop oak log"),
 ("p", "Digs, mines or chops (AutoMine) a block you name, with the right tool for the block (shovel for dirt, pickaxe for stone). It will say if it does not have the right tool — and it will not dig stone by hand. It also will not dig a block that needs a pickaxe if it has none, and it swaps out a tool that is about to break before it digs."),
 ("c", "Segs place torch  •  Segs place cobblestone"),
 ("p", "Places a block from its inventory."),
 ("c", "Segs fish"),
 ("p", "Fishes with a fishing rod, if it has one and is near water."),
 ("c", "Segs dance  •  Segs jump  •  Segs wave  •  Segs joke"),
 ("p", "Just for fun. It also answers casual chat — \"how are you\", \"tell me a story\", \"sing me a song\" — in plain words."),
 ("c", "Segs remember <fact>"),
 ("p", "Teaches it a fact: \"Segs remember the potato farm is at the north field\". It saves it and can recall it with \"Segs what do you remember\"."),
 ("c", "Segs learn <trigger> = <reply>"),
 ("p", "Teaches it a reply: \"Segs learn hello = hey, what do you need\" — then when you say hello, it answers that way."),
]),
("13  Logs — how Segs improves day by day", [
 ("p", "Segs keeps a log on your PC, in the logs/ folder next to bot.js. Nothing with your password is ever written there."),
 ("b", "A daily log file (everything Segs did, with times)."),
 ("b", "actions.jsonl — every action, one per line."),
 ("b", "chat.jsonl — every chat message, one per line."),
 ("b", "learning.jsonl — facts and macros it learned."),
 ("b", "stats.json — the counters behind \"Segs stats\"."),
 ("p", "Logs rotate: 30 days kept, 5 MB maximum per file. Old logs are deleted automatically."),
 ("h", "Sending logs to Mu"),
 ("b", "Zip the whole logs/ folder."),
 ("b", "Send the zip to Mu (here, in this chat)."),
 ("b", "Mu reads it, finds what went wrong or what Segs did not understand, and improves the bot. Then you get a new version."),
 ("n", "The more you use Segs, the better the logs get — real things it said and did on your server are worth more than any test."),
]),
("14  If something goes wrong", [
 ("h", "Segs will not connect"),
 ("b", "Check that node bot.js is running, and that config.json has the right host (youniga.deployd.sh), port (25565) and password."),
 ("b", "Segs cannot be online on your Mac and as the bot at the same time — same name gets kicked. Close Minecraft on your Mac first, or log the bot out."),
 ("b", "If it says \"Outdated client\", the server wants 26.3 — this bot is native 26.3, so it should not happen. Tell Mu if it does."),
 ("h", "Segs says \"i cant reach there\""),
 ("b", "The walk is too long or blocked (rough ground, a wall, water, or a column with no stairs to the upper chests). Stand closer, or give it a clear path. It says this honestly instead of pretending it arrived, and it offers to teleport to you (\"want me to tp to you?\") — say \"Segs tp to me\" and accept. If a wall blocks it, it sidesteps left or right to go around (that is the first thing it tries now, v10.5.1) — if it still cannot reach, the wall may be too long."),
 ("h", "Segs is stuck in the water"),
 ("b", "It swims to the shore and does not drown. Climbing out onto a straight 1-block wall is still an honest limit, but it is better than it was: in v10.5.3 simulation it got out 2 times out of the last 4 tries (the server runs its own copy of the physics and never lifts the player, so whether it makes it is a coin flip on the water bobbing — the shore top is a full block above the water and Segs only rises about 0.7 blocks). After 60 seconds it stops trying and asks you to come get it. Tell it \"Segs tp to me\" and accept, or break a block at the edge so it can walk out. A gradual bank is easier than a straight wall. What is fixed: it avoids water when it walks — if there is a dry path around a river, it takes it (run 124); if there is no dry path, it now says so BEFORE going in (run 148: it refuses the water, stays dry on the bank, and tells you within about 20 seconds) instead of walking into the river and sitting there for 5 minutes."),
 ("h", "Segs drops what it is holding"),
 ("b", "The v10.3.1 bug is fixed — it no longer drops the held item when you give it a command (tp, sleep, stop, and so on). The eat-drop is fixed too in v10.5.2: eating used to drop 1 piece of food on the ground every time, because the auto-eat plugin's release packet was the wrong one (status 5 is DROP_ITEM in 26.3, status 6 is the real release) and the fix for it was wiped out when the game code loaded its own version over it. The fix now survives the load, and eating drops nothing (proven in simulation runs 136-140: beef, bread, porkchop and chicken, 0 dropped). If anything is ever dropped again, tell Mu exactly what you said and what Segs was holding."),
 ("h", "Segs dies and gets kicked"),
 ("b", "Fixed in v10.4.1 — Segs now respawns in place on the same connection. If you see a kick after a death anyway, zip logs/ and send it to Mu with the time it happened."),
 ("h", "Packet rate (PacketRate — staying under the server's limit)"),
 ("b", "Segs counts every packet it sends and writes the rate to bot.log every 10 seconds (about 22 per second when idle, 60-76 in a fight — far under the limit). If it ever did send too many, it would slow down its own chat first; movement packets are never slowed. You do not need to do anything about this — it is a safety net."),
 ("h", "Segs says \"i need a crafting table near me to make paper\""),
 ("b", "Put a crafting table within 16 blocks of where Segs is working — in or near the storage unit."),
 ("h", "Segs says \"i dont know where the ore column is\""),
 ("b", "Teach it: walk Segs to the column and say \"Segs this is the ore column\" (section 3)."),
 ("h", "Segs says \"i cant see any chests to sort from\""),
 ("b", "Teach your room: stand in it and say \"Segs this is my room\" (section 3)."),
 ("h", "Segs sorted nothing / moved 0 stacks"),
 ("b", "Check its inventory is not full (\"Segs status\"). A full inventory cannot sort — empty it first (\"Segs drop everything\" or \"Segs keep these items at your base\")."),
 ("h", "Segs answers your /commands"),
 ("b", "It should not anymore (v9 ignores lines starting with /). If it does, tell Mu the exact command you typed."),
 ("h", "Anything else"),
 ("b", "Zip logs/ and send it to Mu with what you said and what Segs did (or did not do). That is the fastest way to get it fixed."),
]),
("15  The 16 columns — quick reference", [
 ("p", "One column per type. Teach each one with \"Segs this is the <type> column\"."),
 ("b", "flowers  •  building blocks  •  ores  •  tools (best to worst, top to bottom)  •  foods  •  farm items (wheat, potato, carrot only)  •  paper  •  woods"),
 ("b", "redstone  •  mob drops  •  nether  •  valuables  •  brewing / potions  •  armor  •  seeds & plants  •  misc"),
 ("p", "Full list with what goes where: section 5."),
 ("p", "Setup order: (1) build the 16 columns in the storage unit, (2) teach your room, (3) teach the storage unit, (4) teach each column, (5) teach the trash chest and the sugarcane farm chests, (6) say \"Segs sort my room\"."),
]),
("16  Autobuild — build from a schematic (new in v10.5, fixed to 65/65 in v10.5.1)", [
 ("p", "Segs can build a small structure from a plan you give it. The plan is a JSON file in the schematics/ folder: a name and a list of blocks, each with its offset (dx, dy, dz) from the corner where Segs stands and the block to place. One example ships with the bot: house (a 5x3x5 house, 65 blocks — cobblestone floor, oak plank walls and roof, with a door gap)."),
 ("c", "Segs this is the build site"),
 ("p", "Stand at the corner of where the house should go. Segs marks that spot as the origin — the plan is built from there."),
 ("c", "Segs build house here"),
 ("p", "Segs reads schematics/house.json, counts the materials, and looks in every chest within 16 blocks for them (and for raw materials it can craft from, like planks from logs). If anything is missing it tells you the exact list and STOPS — it never starts a build it cannot finish. If it has everything, it builds layer by layer from the bottom up, nearest block first, one block per tick (human speed), at normal reach. It never breaks a block that is already there, and it never uses fast placing or long reach — those are cheats and Segs does not do them."),
 ("n", "Fixed in v10.5.1 (simulation run 113): the first build now places all 65 of 65 blocks with 0 wrong — it waits for Segs to settle before every place, never places against a chest or furnace (that would open it instead of placing), and retries each block up to 3 times. It reports the real count (\"built house: 65/65 blocks placed, 0 skipped, 0 wrong\") so you can see what is missing. A second build after re-stocking places 0 and skips 65 — it never breaks or replaces a block that is already right. One honest note: a 65-block house takes about 5 minutes to build at one block per tick, because Segs walks to each block and settles before placing it."),
 ("b", "To make your own plan, copy schematics/house.json to a new name, change the blocks list, and say \"Segs build <name> here\". Keep it small (a house, a shed, a pen) — big builds take a long time at one block per tick."),
]),
]


class GuidePDF(FPDF):
    def __init__(self):
        super().__init__(format="A4", unit="mm")
        self.set_auto_page_break(auto=True, margin=18)
        self.set_margins(18, 16, 18)
        self.toc = []  # (title, page)
        base = "/usr/share/fonts/truetype/liberation/"
        self.add_font("Liberation", "", base + "LiberationSans-Regular.ttf")
        self.add_font("Liberation", "B", base + "LiberationSans-Bold.ttf")
        self.add_font("Liberation", "I", base + "LiberationSans-Italic.ttf")
        self.add_font("Liberation", "BI", base + "LiberationSans-BoldItalic.ttf")
        self.add_font("LiberationMono", "", base + "LiberationMono-Regular.ttf")
        self.add_font("LiberationMono", "B", base + "LiberationMono-Bold.ttf")

    def header(self):
        if self.page_no() == 1:
            return
        self.set_font("Liberation", "I", 8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 6, "Segs — The A-to-Z Guide  •  v10.5.1", align="L")
        self.cell(0, 6, f"Page {self.page_no()}", align="R")
        self.ln(8)
        self.set_draw_color(200, 200, 200)
        self.line(18, self.get_y(), 192, self.get_y())
        self.ln(4)

    def footer(self):
        if self.page_no() == 1:
            return
        self.set_y(-14)
        self.set_font("Liberation", "I", 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 8, "Segs v10.5.1 — free, native Minecraft 26.3 — only OrewaSegs can command it", align="C")

    def section_title(self, title):
        self.add_page()
        self.toc.append((title, self.page_no()))
        self.set_font("Liberation", "B", 16)
        self.set_text_color(30, 30, 30)
        self.multi_cell(0, 8, title)
        self.ln(3)
        self.set_draw_color(160, 40, 40)
        self.set_line_width(0.8)
        self.line(18, self.get_y(), 60, self.get_y())
        self.set_line_width(0.2)
        self.ln(5)

    def heading(self, text):
        self.ln(3)
        self.set_font("Liberation", "B", 11.5)
        self.set_text_color(40, 40, 40)
        self.multi_cell(0, 6.5, text)
        self.ln(1)

    def para(self, text):
        self.set_font("Liberation", "", 10.5)
        self.set_text_color(50, 50, 50)
        self.multi_cell(0, 6, text)
        self.ln(1.5)

    def bullet(self, text):
        x = self.get_x()
        self.set_font("Liberation", "", 10.5)
        self.set_text_color(50, 50, 50)
        self.cell(6, 6, chr(8226))
        self.multi_cell(0, 6, text)
        self.ln(0.5)

    def command(self, text):
        self.set_fill_color(245, 240, 235)
        self.set_font("LiberationMono", "B", 10)
        self.set_text_color(30, 30, 30)
        self.set_x(22)
        self.multi_cell(166, 6.5, text, fill=True)
        self.ln(2)

    def note(self, text):
        self.set_fill_color(252, 248, 230)
        self.set_font("Liberation", "I", 10)
        self.set_text_color(90, 70, 20)
        self.set_x(22)
        self.multi_cell(166, 6, "Note: " + text, fill=True)
        self.ln(2)


def build(path):
    pdf = GuidePDF()
    pdf.set_title(TITLE)
    pdf.set_author("Mu (for Tash / OrewaSegs)")

    # Cover
    pdf.add_page()
    pdf.ln(38)
    pdf.set_font("Liberation", "B", 30)
    pdf.set_text_color(30, 30, 30)
    pdf.multi_cell(174, 14, "Segs", align="C")
    pdf.set_font("Liberation", "", 16)
    pdf.set_text_color(120, 40, 40)
    pdf.multi_cell(174, 10, "The A-to-Z Guide", align="C")
    pdf.ln(6)
    pdf.set_font("Liberation", "", 11)
    pdf.set_text_color(80, 80, 80)
    pdf.multi_cell(174, 7, SUBTITLE, align="C")
    pdf.ln(10)
    pdf.set_font("Liberation", "I", 10)
    pdf.multi_cell(174, 6, VERSION, align="C")
    pdf.ln(14)
    pdf.set_font("Liberation", "", 10.5)
    pdf.set_text_color(60, 60, 60)
    pdf.multi_cell(174, 6, "Talk to it like a person. No ! needed.\nOnly OrewaSegs can give it orders.", align="C")
    pdf.ln(20)
    pdf.set_font("Liberation", "I", 9.5)
    pdf.set_text_color(130, 130, 130)
    pdf.multi_cell(174, 6, "Start with section 1 (setup), then section 3 (teach it your base).\nUse the contents on the next page to jump to any topic.", align="C")

    # Contents (page numbers filled on the second pass — we build the
    # sections first, record pages, then insert the TOC. fpdf2 has no
    # built-in two-pass TOC, so we do it by building twice.)
    return pdf


def build_full(path):
    # Pass 1: build the whole document to learn each section's page.
    pdf = build(path)
    for title, blocks in SECTIONS:
        pdf.section_title(title)
        for kind, text in blocks:
            getattr(pdf, {"h": "heading", "p": "para", "b": "bullet", "c": "command", "n": "note"}[kind])(text)
    toc = list(pdf.toc)
    total = pdf.page_no()

    # Pass 2: rebuild with the real TOC page inserted after the cover.
    pdf = build(path)
    pdf.add_page()
    pdf.ln(6)
    pdf.set_font("Liberation", "B", 16)
    pdf.set_text_color(30, 30, 30)
    pdf.multi_cell(174, 8, "Contents")
    pdf.ln(3)
    pdf.set_draw_color(160, 40, 40)
    pdf.set_line_width(0.8)
    pdf.line(18, pdf.get_y(), 60, pdf.get_y())
    pdf.set_line_width(0.2)
    pdf.ln(6)
    # TOC page numbers shift by 1 (the TOC page itself is page 2).
    for title, page in toc:
        pdf.set_font("Liberation", "", 11)
        pdf.set_text_color(50, 50, 50)
        pdf.cell(150, 7, title)
        pdf.set_font("Liberation", "", 11)
        pdf.cell(0, 7, str(page + 1), align="R")
        pdf.ln(7)
    pdf.ln(6)
    pdf.set_font("Liberation", "I", 10)
    pdf.set_text_color(120, 120, 120)
    pdf.multi_cell(174, 6, f"{len(SECTIONS)} sections, {total + 1} pages. Find a command with your PDF reader's search (Ctrl+F / Cmd+F).")
    for title, blocks in SECTIONS:
        pdf.section_title(title)
        for kind, text in blocks:
            getattr(pdf, {"h": "heading", "p": "para", "b": "bullet", "c": "command", "n": "note"}[kind])(text)
    pdf.output(path)
    print(f"Wrote {path} ({pdf.page_no()} pages)")


if __name__ == "__main__":
    build_full("Segs-A-to-Z-Guide.pdf")
