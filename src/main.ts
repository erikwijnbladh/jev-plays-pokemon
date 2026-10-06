import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { Emulator } from './emu/emulator.js';
import { encodePng } from './emu/png.js';
import { Rom } from './game/rom.js';
import { GameState } from './game/ram.js';
import { WorldGraph } from './game/world.js';
import { prettyMap } from './game/data.js';
import { Jev, type CallRecord } from './jev/client.js';
import { Agent } from './agent/agent.js';
import { newMemory, objective, monLine, type Ctx } from './agent/ctx.js';

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
const recent: { at: number; kind: string; msg: string }[] = [];

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
    recent.push({ at, kind, msg });
    if (recent.length > 40) recent.shift();
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

let lastCall: CallRecord | undefined;
jev.onCall = (r) => { lastCall = r; };

function status() {
  const { m } = objective(ctx);
  const lat = [...jev.latencyMs].sort((a, b) => a - b);
  return {
    backend: jev.backend.name,
    frames: emu.frames,
    mode: agent.mode(),
    location: prettyMap(gs.mapName),
    objective: m?.goal ?? 'Game complete',
    focus: ctx.mem.focus?.value ?? null,
    badges: gs.badgeCount,
    team: gs.party().map(monLine),
    jev: { calls: jev.calls, cacheHits: jev.cacheHits, inputTokens: jev.inputTokens, costUsd: +jev.costUsd.toFixed(4), medianLatencyMs: lat[Math.floor(lat.length / 2)] ?? null },
    lastDecision: lastCall && {
      purpose: lastCall.purpose,
      answers: lastCall.answers,
      options: Object.fromEntries(Object.entries(lastCall.questions).map(([k, q]) => [k, 'criteria' in q ? q.criteria : null])),
    },
    log: recent.slice(-15),
  };
}

/** A frame as palette + one index byte per pixel (the Game Boy shows a handful of colors), base64 for SSE. */
function encodeFrame(rgba: ArrayLike<number>): string {
  const palette: number[] = [];
  const lookup = new Map<number, number>();
  const idx = Buffer.alloc(160 * 144);
  for (let p = 0; p < idx.length; p++) {
    const c = (rgba[p * 4] << 16) | (rgba[p * 4 + 1] << 8) | rgba[p * 4 + 2];
    let i = lookup.get(c);
    if (i === undefined) { i = palette.length; lookup.set(c, i); palette.push(c); }
    idx[p] = i;
  }
  return JSON.stringify({ p: palette, d: idx.toString('base64') });
}

if (!args.headless) {
  const page = fs.readFileSync(new URL('../web/index.html', import.meta.url));
  // live frames over Server-Sent Events, capped at ~30 fps of wall-clock time
  const streams = new Set<http.ServerResponse>();
  let lastSent = 0;
  emu.onFrame = () => {
    if (!streams.size) return;
    const now = performance.now();
    if (now - lastSent < 33) return;
    lastSent = now;
    const msg = `data: ${encodeFrame(emu.screen())}\n\n`;
    for (const s of streams) s.write(msg);
  };
  http.createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname; // the page adds ?t= to defeat caching
    if (path === '/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`data: ${encodeFrame(emu.screen())}\n\n`);
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }
    if (path === '/frame.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      return res.end(encodePng(emu.screen()));
    }
    if (path === '/status') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(status()));
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page);
  }).listen(+args.port!, '127.0.0.1', () => console.log(`Viewer: http://localhost:${args.port}`));
}

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
agent.save(`manual-${new Date().toISOString().replace(/[:.]/g, '-')}`);
console.log(`Done. Jev calls: ${jev.calls} (${jev.cacheHits} cached), input tokens: ${jev.inputTokens}, cost ~$${jev.costUsd.toFixed(4)}`);
process.exit(0);
