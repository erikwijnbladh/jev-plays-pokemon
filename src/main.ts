import fs from 'node:fs';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { Emulator } from './emu/emulator.js';
import { Rom } from './game/rom.js';
import { GameState } from './game/ram.js';
import { WorldGraph } from './game/world.js';
import { prettyMap } from './game/data.js';
import { Jev } from './jev/client.js';
import { Agent } from './agent/agent.js';
import { newMemory, type Ctx } from './agent/ctx.js';
import { Overlay } from './overlay/state.js';
import { startViewer } from './server/viewer.js';
import { fileURLToPath } from 'node:url';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const { values: args } = parseArgs({
  options: {
    headless: { type: 'boolean', default: false },
    speed: { type: 'string', default: '1' },
    resume: { type: 'boolean', default: false },
    load: { type: 'string' },
    steps: { type: 'string' },
    port: { type: 'string', default: '8787' },
  },
});

const RED_SHA1 = 'ea9bcae617fdf159b045185467ae58b2e4a48b9a';
const romPath = process.env.ROM_PATH ?? 'roms/red.gb';
if (!fs.existsSync(romPath)) {
  console.error(`No ROM at ${romPath}. Put your own Pokémon Red (US/EU) dump there (SHA-1 ${RED_SHA1}).`);
  process.exit(1);
}
const romBytes = fs.readFileSync(romPath);
const sha = crypto.createHash('sha1').update(romBytes).digest('hex');
if (sha !== RED_SHA1) console.warn(`WARNING: ROM SHA-1 is ${sha}, expected ${RED_SHA1}. RAM addresses won't match other versions.`);

fs.mkdirSync('logs', { recursive: true });
const events = fs.createWriteStream('logs/events.jsonl', { flags: 'a' });

const emu = new Emulator(romBytes);
emu.speed = args.headless ? 0 : +args.speed!;
const rom = new Rom(new Uint8Array(romBytes));
const gs = new GameState(emu, rom);
const jev = new Jev();
const ctx: Ctx = {
  emu, rom, gs, jev, world: new WorldGraph(rom), mem: newMemory(),
  log(kind, msg, data) {
    const at = Date.now();
    events.write(JSON.stringify({ at, frame: emu.frames, kind, msg, data }) + '\n');
    if (kind !== 'debug') console.log(`[${kind}] ${msg}`);
  },
};
const agent = new Agent(ctx);

if (args.load) agent.load(args.load);
else if (args.resume) {
  const latest = agent.latestSave();
  if (latest) agent.load(latest);
  else console.log('No save to resume from; starting a new game.');
}

// totals that persist with the save (the overlay's spend panel covers the whole run, not just this session)
jev.onCall = (r) => {
  if (r.cached) return;
  ctx.mem.stats.calls++;
  ctx.mem.stats.inputTokens += r.inputTokens;
  ctx.mem.stats.latencyMs += r.latencyMs;
};
const overlay = new Overlay(ctx, jev, () => emu.speed);
if (!args.headless) startViewer({ emu, overlay, port: +args.port!, webDir: fileURLToPath(new URL('../web/dist', import.meta.url)) });

let stopping = false;
process.on('SIGINT', () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log('\nStopping after the current step (Ctrl+C again to quit now)...');
});

const maxSteps = args.steps ? +args.steps : Infinity;
console.log(`Jev backend: ${jev.backend.name}. Speed: ${emu.speed || 'max'}.`);
for (let step = 0; step < maxSteps && !stopping; step++) {
  try {
    await agent.step();
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (/API key|JEV_MODE/.test(msg)) { console.error(msg); break; }
    ctx.log('error', msg, { stack: (e as Error).stack });
    await emu.wait(30);
  }
  if (step % 200 === 0) console.log(`[status] step ${step}, ${prettyMap(gs.mapName)}, Jev calls ${jev.calls}, ~$${jev.costUsd.toFixed(4)}`);
}
overlay.running = false;
agent.save(`manual-${new Date().toISOString().replace(/[:.]/g, '-')}`);
console.log(`Done. Jev calls: ${jev.calls} (${jev.cacheHits} cached), input tokens: ${jev.inputTokens}, cost ~$${jev.costUsd.toFixed(4)}`);
process.exit(0);
