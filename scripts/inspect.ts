// Debug tool: load a save and print what the harness sees (screen text, sprites, options), plus a screenshot.
// Usage: npx tsx scripts/inspect.ts [save-name] [frames-to-run]
import fs from 'node:fs';
import { Emulator } from '../src/emu/emulator.js';
import { encodePng } from '../src/emu/png.js';
import { Rom } from '../src/game/rom.js';
import { GameState } from '../src/game/ram.js';
import { WorldGraph } from '../src/game/world.js';
import { spriteName } from '../src/game/data.js';
import { Jev } from '../src/jev/client.js';
import { newMemory, type Ctx } from '../src/agent/ctx.js';
import { Agent } from '../src/agent/agent.js';
import { buildCandidates } from '../src/agent/overworld.js';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const romBytes = fs.readFileSync(process.env.ROM_PATH ?? 'roms/red.gb');
const emu = new Emulator(romBytes);
const rom = new Rom(new Uint8Array(romBytes));
const gs = new GameState(emu, rom);
const ctx: Ctx = { emu, rom, gs, jev: new Jev('mock'), world: new WorldGraph(rom), mem: newMemory(), log: (k, m) => console.log(`[${k}] ${m}`) };
const agent = new Agent(ctx);
const name = process.argv[2] ?? agent.latestSave();
if (!name) throw new Error('no save given and saves/latest.txt is missing');
agent.load(name);
await emu.wait(+(process.argv[3] ?? 0));

const s = gs.screen();
console.log(`map ${gs.mapName} (${gs.mapId}) at ${gs.x},${gs.y} facing ${gs.facing} | mode ${agent.mode()} | battle ${gs.inBattle} | scripted ${gs.scripted}`);
console.log('screen:\n' + s.rows.map((r) => `  |${r}|`).join('\n'));
console.log('sprites:', gs.sprites().map((sp) => `${sp.index}:${spriteName(sp.picture)}@${sp.x},${sp.y}${sp.hidden ? '(hidden)' : ''}`).join(' '));
console.log('rom objects:', rom.maps.get(gs.mapId)?.objects.map((o) => `${o.index}:${spriteName(o.sprite)}@${o.x},${o.y}${o.trainer ? ` trainer ${o.trainer}` : ''}${o.item ? ` item ${rom.items.get(o.item)}` : ''}`).join(' '));
console.log('party:', gs.party().map((p) => `${p.nickname} ${p.species} Lv${p.level} ${p.hp}/${p.maxHp}`).join(', '));
if (agent.mode() === 'overworld') for (const c of buildCandidates(ctx)) console.log(`  option ${c.key}: ${c.criteria.action} [${c.criteria.facts.join('; ')}] path ${c.path.length}`);
fs.mkdirSync('logs', { recursive: true });
fs.writeFileSync('logs/inspect.png', encodePng(emu.screen()));
console.log('screenshot: logs/inspect.png');
