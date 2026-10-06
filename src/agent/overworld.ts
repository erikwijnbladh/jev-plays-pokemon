import type { EntryType } from '@typesafe-ai/sdk';
import type { Ctx } from './ctx.js';
import { tap, remember, basics, teamSummary, objective, hpWord, monLine } from './ctx.js';
import { buildGrid, findPath, DIRS, type Dir, type Grid, type Step } from '../game/grid.js';
import { mapName, mapId, prettyMap, spriteName, sym, allMaps } from '../game/data.js';

const allMapIds = () => Object.keys(allMaps()).map(Number);
import { LAST_MAP, type EdgeDir } from '../game/rom.js';
import { sample } from '../jev/client.js';
import { resetMenuHistory } from './menus.js';

type Target =
  | { kind: 'warp'; x: number; y: number; dest: number }
  | { kind: 'edge'; dir: EdgeDir; dest: number }
  | { kind: 'person'; index: number; x: number; y: number }
  | { kind: 'sign'; x: number; y: number }
  | { kind: 'grass' };

export interface Candidate { key: string; target: Target; path: Step[]; criteria: { action: string; facts: string[] } }

const key = (x: number, y: number) => `${x},${y}`;
const EDGE_DIR: Record<EdgeDir, Dir> = { north: 'up', south: 'down', west: 'left', east: 'right' };
const FACING: Record<Dir, number> = { down: 0x0, up: 0x4, left: 0x8, right: 0xc };

function blockedByPeople(ctx: Ctx, except = -1): Set<string> {
  return new Set(ctx.gs.sprites().filter((s) => !s.hidden && s.index !== except).map((s) => key(s.x, s.y)));
}

/** Squares to stand on to talk to someone at (tx,ty): next to them, or across a counter. */
function talkSpots(g: Grid, tx: number, ty: number): { x: number; y: number }[] {
  const out = [];
  for (const [dx, dy] of Object.values(DIRS)) {
    const ax = tx + dx, ay = ty + dy;
    if (g.counter(ax, ay)) out.push({ x: tx + 2 * dx, y: ty + 2 * dy });
    else if (g.walkable(ax, ay)) out.push({ x: ax, y: ay });
  }
  return out.filter((p) => g.walkable(p.x, p.y));
}

function personLabel(ctx: Ctx, index: number, picture: number): string {
  const obj = ctx.rom.maps.get(ctx.gs.mapId)?.objects.find((o) => o.index === index);
  if (obj?.item) return 'an item lying on the ground (a Poké Ball)';
  const name = spriteName(picture).toLowerCase().replace(/_/g, ' ');
  if (obj?.trainer) return `a trainer (${obj.trainer.toLowerCase()})`;
  if (name === 'poke ball') return 'a Poké Ball';
  if (name === 'nurse') return 'the nurse at the counter (heals your Pokémon)';
  if (name === 'clerk') return 'the shop clerk';
  return `a person (${name})`;
}

/** Everything the player can do from here right now, with facts. Unreachable things aren't options. */
export function buildCandidates(ctx: Ctx, focus?: Focus): Candidate[] {
  const { gs, rom, world, mem } = ctx;
  const g = buildGrid(ctx.emu, rom, gs);
  const md = rom.maps.get(gs.mapId);
  if (!md) return [];
  const here = { x: gs.x, y: gs.y };
  const blocked = blockedByPeople(ctx);
  const { m } = objective(ctx);
  const goalMaps = m ? m.maps.map(mapId) : [];
  const hopsHere = world.hops(gs.mapId, goalMaps);
  const visited = new Set(mem.visited);
  const out: Candidate[] = [];
  const tried = (k: string) => mem.tried[`${gs.mapName}:${k}`] ?? 0;
  const triedFact = (k: string) => (tried(k) ? [`already chosen ${tried(k)} time(s) since the last progress`] : []);

  const destFacts = (dest: number) => {
    const f: string[] = [];
    if (goalMaps.includes(dest)) f.push('the objective is there');
    else {
      const h = world.hops(dest, goalMaps);
      if (h < hopsHere) f.push(`leads toward the objective (${h} map${h === 1 ? '' : 's'} from there)`);
      else if (h > hopsHere && isFinite(h)) f.push('leads away from the objective');
    }
    if (focus === 'heal' && !/POKECENTER/.test(mapName(dest))) {
      const pc = pokecenterHops(ctx, dest);
      if (pc < pokecenterHops(ctx, gs.mapId)) f.push(`leads toward the nearest Pokémon Center (${pc} map${pc === 1 ? '' : 's'} from there)`);
    }
    f.push(visited.has(mapName(dest)) ? 'visited before' : 'not visited yet');
    if (/POKECENTER/.test(mapName(dest))) f.push('a Pokémon Center (heals your Pokémon)');
    if (/_MART$/.test(mapName(dest))) f.push('a Poké Mart (shop)');
    return f;
  };

  // exits through doors, stairs, cave entrances; several warp squares to the same place count as one exit
  const lastMap = gs.u8('wLastMap');
  const byDest = new Map<number, Candidate>();
  for (const w of md.warps) {
    const dest = w.destMap === LAST_MAP ? lastMap : w.destMap;
    if (here.x === w.x && here.y === w.y) continue;
    const path = findPath(g, here.x, here.y, [{ x: w.x, y: w.y }], { blocked, grassCost: 3 });
    if (!path) continue;
    const prev = byDest.get(dest);
    if (prev && prev.path.length <= path.length) continue;
    const k = `go_${mapName(dest)}`;
    byDest.set(dest, { key: k, target: { kind: 'warp', x: w.x, y: w.y, dest }, path, criteria: { action: `Go to ${prettyMap(mapName(dest))}`, facts: [...destFacts(dest), ...triedFact(k)] } });
  }
  out.push(...byDest.values());

  // walking off the map edge into a connected map
  for (const c of md.connections) {
    const d = EDGE_DIR[c.dir];
    const [dx, dy] = DIRS[d];
    const exits: { x: number; y: number }[] = [];
    const len = d === 'up' || d === 'down' ? g.w : g.h;
    for (let i = 0; i < len; i++) {
      const ix = d === 'left' ? 0 : d === 'right' ? g.w - 1 : i;
      const iy = d === 'up' ? 0 : d === 'down' ? g.h - 1 : i;
      if (g.walkable(ix, iy)) exits.push({ x: ix + dx, y: iy + dy });
    }
    const exitSet = new Set(exits.map((p) => key(p.x, p.y)));
    const path = findPath(g, here.x, here.y, exits, { blocked, grassCost: 3, allowExit: (x, y) => exitSet.has(key(x, y)) });
    if (!path) continue;
    const k = `go_${mapName(c.map)}`;
    if (byDest.has(c.map)) continue;
    out.push({ key: k, target: { kind: 'edge', dir: c.dir, dest: c.map }, path, criteria: { action: `Leave ${c.dir} to ${prettyMap(mapName(c.map))}`, facts: [...destFacts(c.map), ...triedFact(k)] } });
  }

  // people and objects
  for (const s of gs.sprites()) {
    if (s.hidden) continue;
    const spots = talkSpots(g, s.x, s.y);
    const atSpot = spots.some((p) => p.x === here.x && p.y === here.y);
    const path = atSpot ? [] : findPath(g, here.x, here.y, spots, { blocked: blockedByPeople(ctx, s.index), grassCost: 3 });
    if (!path) continue;
    const k = `talk_${s.index}`;
    const who = personLabel(ctx, s.index, s.picture);
    const saidKey = `${gs.mapName}:${k}`;
    const facts = [
      mem.talked[saidKey] ? `talked ${mem.talked[saidKey]} time(s) before` : "haven't talked yet",
      ...(mem.said[saidKey] ? [`last time: "${mem.said[saidKey]}"`] : []),
      ...triedFact(k),
    ];
    out.push({ key: k, target: { kind: 'person', index: s.index, x: s.x, y: s.y }, path, criteria: { action: `Interact with ${who}`, facts } });
  }

  // signs
  for (const [i, sign] of md.signs.entries()) {
    const spots = talkSpots(g, sign.x, sign.y);
    const atSpot = spots.some((p) => p.x === here.x && p.y === here.y);
    const path = atSpot ? [] : findPath(g, here.x, here.y, spots, { blocked, grassCost: 3 });
    if (!path) continue;
    const k = `sign_${i}`;
    const saidKey = `${gs.mapName}:${k}`;
    const facts = [mem.talked[saidKey] ? `read before: "${mem.said[saidKey] ?? ''}"` : 'not read yet', ...triedFact(k)];
    out.push({ key: k, target: { kind: 'sign', x: sign.x, y: sign.y }, path, criteria: { action: 'Read the sign', facts } });
  }

  // tall grass: wild Pokémon for training and catching
  const grass: { x: number; y: number }[] = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.grass(x, y) && !blocked.has(key(x, y))) grass.push({ x, y });
  if (grass.length) {
    const path = grass.some((p) => p.x === here.x && p.y === here.y) ? [] : findPath(g, here.x, here.y, grass, { blocked });
    if (path) out.push({ key: 'grass', target: { kind: 'grass' }, path, criteria: { action: 'Walk around in the tall grass to meet wild Pokémon', facts: ['wild Pokémon appear there', ...triedFact('grass')] } });
  }
  return out;
}

const POKECENTERS = () => [...allMapIds()].filter((id) => /POKECENTER/.test(mapName(id)));
/** Map changes from `from` to the nearest Pokémon Center. */
function pokecenterHops(ctx: Ctx, from: number): number {
  return ctx.world.hops(from, POKECENTERS());
}

const FOCI = {
  progress: 'Move toward the current objective.',
  heal: 'Heal the team at a Pokémon Center.',
  train: 'Train: fight wild Pokémon to gain levels before the objective.',
  catch: 'Catch wild Pokémon to build a bigger, more varied team.',
  explore: 'Explore this area and talk to people for items and information.',
} as const;
type Focus = keyof typeof FOCI;

/** What the overworld works toward. Re-decided only when the situation changes, to keep calls (and flip-flopping) low. */
async function decideFocus(ctx: Ctx): Promise<Focus> {
  const { gs } = ctx;
  const party = gs.party();
  const hp = party.reduce((a, p) => a + p.hp, 0), maxHp = party.reduce((a, p) => a + p.maxHp, 0);
  const fainted = party.filter((p) => p.hp === 0).length;
  const balls = gs.bag().filter((i) => /BALL$/.test(i.name)).reduce((a, i) => a + i.qty, 0);
  const levels = party.reduce((a, p) => a + p.level, 0);
  const sig = `${hp / Math.max(1, maxHp) < 0.4 ? 'low' : 'ok'}|${fainted}|${party.length}|${Math.floor(levels / 4)}|${gs.badges}|${objective(ctx).index}|${balls > 0}`;
  const f = ctx.mem.focus;
  const healed = party.every((p) => p.hp === p.maxHp && p.status === 'OK');
  const finished = f?.value === 'heal' && healed;
  if (f && f.key === sig && !finished && ++f.age < 25) return f.value as Focus;

  const options: Partial<Record<Focus, EntryType>> = {};
  options.progress = { focus: FOCI.progress };
  const pcHops = pokecenterHops(ctx, gs.mapId);
  const health = `team health: ${hpWord(hp, maxHp)} overall, ${fainted} of ${party.length} fainted`;
  const wipeRisk = 'if every team member faints, you are sent back to the last Pokémon Center and lose half your money';
  if (party.length && !healed) options.heal = { focus: FOCI.heal, facts: [health, pcHops === 0 ? 'you are in a Pokémon Center' : `the nearest Pokémon Center is ${pcHops} map${pcHops === 1 ? '' : 's'} away`] };
  if (party.length) options.train = { focus: FOCI.train, facts: [health, wipeRisk] };
  if (party.length && balls > 0) options.catch = { focus: FOCI.catch, facts: [`${balls} Poké Ball(s) in the bag`, `team has ${party.length} of 6 Pokémon`] };
  options.explore = { focus: FOCI.explore };
  const state = { ...basics(ctx), ...teamSummary(ctx), bag: gs.bag().map((i) => `${i.name} x${i.qty}`) };
  const res = await ctx.jev.choose('focus', state, "You are playing Pokémon Red. Given the objective and the team's health and levels, what should the player focus on right now?", options, {
    kind: 'focus',
    title: 'What should Jev focus on?',
    subtitle: objective(ctx).m?.title,
    labels: Object.fromEntries((Object.keys(options) as Focus[]).map((k) => [k, { label: k.toUpperCase(), sub: FOCI[k] }])),
    logPrefix: 'Focus: ',
  });
  ctx.mem.focus = { value: res.choice, key: sig, age: 0 };
  ctx.log('decision', `focus → ${res.choice}`, { confidence: res.confidence });
  return res.choice;
}

/** A focus suggests which options fit it; Jev still weighs them (facts, not a filter). */
const FITS: Record<Focus, RegExp> = {
  progress: /toward the objective|objective is there/,
  heal: /Pokémon Center|nurse/,
  train: /wild Pokémon/,
  catch: /wild Pokémon/,
  explore: /not visited yet|haven't talked|not read yet/,
};

// ---- execution ----

type WalkResult = 'ok' | 'warped' | 'interrupted' | 'blocked';

const interrupted = (ctx: Ctx) => ctx.gs.inBattle !== 0 || ctx.gs.screen().hasTextBox;

async function settle(ctx: Ctx) {
  for (let f = 0, calm = 0; f < 600 && calm < 12; f++) {
    await ctx.emu.frame();
    calm = ctx.gs.scripted || interrupted(ctx) ? 0 : calm + 1;
    if (interrupted(ctx)) return;
  }
}

async function walk(ctx: Ctx, path: Step[]): Promise<WalkResult> {
  const { gs, emu } = ctx;
  const map0 = gs.mapId;
  for (const st of path) {
    const x0 = gs.x, y0 = gs.y;
    const btn = st.dir.toUpperCase() as 'UP';
    let moved = false;
    // the first frames may only turn the player; busy maps can take a while per step
    for (let f = 0; f < 60 && !moved; f++) {
      await emu.frame([btn]);
      moved = gs.x !== x0 || gs.y !== y0 || gs.mapId !== map0;
      if (!moved && interrupted(ctx)) return 'interrupted';
    }
    for (let i = 0; i < 30 && gs.u8('wWalkCounter') !== 0; i++) await emu.frame();
    if (st.jump) await emu.wait(16);
    if (gs.mapId !== map0) { await settle(ctx); return 'warped'; }
    if (interrupted(ctx)) return 'interrupted';
    if (!moved) return 'blocked';
  }
  return 'ok';
}

async function face(ctx: Ctx, tx: number, ty: number) {
  const dx = Math.sign(tx - ctx.gs.x), dy = Math.sign(ty - ctx.gs.y);
  const d: Dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
  for (let i = 0; i < 4 && ctx.gs.facing !== FACING[d]; i++) await ctx.emu.press(d.toUpperCase() as 'UP', 3, 6);
}

async function execute(ctx: Ctx, c: Candidate): Promise<WalkResult> {
  const t = c.target;
  let res = await walk(ctx, c.path);
  // someone stepped into the way: wait a moment and replan to the same target (twice at most)
  for (let i = 0; i < 2 && res === 'blocked'; i++) {
    await ctx.emu.wait(30);
    const again = buildCandidates(ctx, ctx.mem.focus?.value as Focus | undefined).find((k) => k.key === c.key);
    if (!again) break;
    c = again;
    res = await walk(ctx, again.path);
  }
  if (res !== 'ok') return res;
  const map0 = ctx.gs.mapId;
  if (t.kind === 'warp') {
    // doormats and some stairs warp only when you keep walking: push the last direction, then the others
    const last = c.path[c.path.length - 1]?.dir ?? 'down';
    for (const d of [last, 'down', 'up', 'left', 'right'] as Dir[]) {
      if (ctx.gs.mapId !== map0 || interrupted(ctx)) break;
      for (let f = 0; f < 24 && ctx.gs.mapId === map0 && !interrupted(ctx); f++) await ctx.emu.frame([d.toUpperCase() as 'UP']);
    }
    await settle(ctx);
    return ctx.gs.mapId !== map0 ? 'warped' : 'blocked';
  }
  if (t.kind === 'person' || t.kind === 'sign') {
    const s = t.kind === 'person' ? ctx.gs.sprites().find((sp) => sp.index === t.index) : undefined;
    const tx = s?.x ?? t.x, ty = s?.y ?? t.y;
    await face(ctx, tx, ty);
    ctx.mem.talkingTo = `${ctx.gs.mapName}:${c.key}`;
    ctx.mem.talked[ctx.mem.talkingTo] = (ctx.mem.talked[ctx.mem.talkingTo] ?? 0) + 1;
    // the first press right after a step is often dropped: settle, then retry a couple of times
    await ctx.emu.wait(4);
    for (let attempt = 0; attempt < 3 && !interrupted(ctx); attempt++) {
      await tap(ctx, 'A', 4);
      for (let f = 0; f < 30 && !interrupted(ctx); f++) await ctx.emu.frame();
    }
    return interrupted(ctx) ? 'interrupted' : 'blocked';
  }
  if (t.kind === 'grass') {
    // pace between grass squares until a wild Pokémon appears
    const g = buildGrid(ctx.emu, ctx.rom, ctx.gs);
    for (let i = 0; i < 40 && !interrupted(ctx); i++) {
      const dirs = (Object.keys(DIRS) as Dir[]).filter((d) => g.grass(ctx.gs.x + DIRS[d][0], ctx.gs.y + DIRS[d][1]));
      if (!dirs.length) break;
      const r = await walk(ctx, [{ dir: dirs[i % dirs.length], x: 0, y: 0 }]);
      if (r !== 'ok') return r;
    }
    return interrupted(ctx) ? 'interrupted' : 'ok';
  }
  return res;
}

let lastMap = -1;

export async function overworldStep(ctx: Ctx, agent: { exploring: boolean; onDecision: (desc: string) => void }) {
  if (ctx.gs.mapId !== lastMap) { lastMap = ctx.gs.mapId; await settle(ctx); if (interrupted(ctx)) return; }
  resetMenuHistory();
  ctx.mem.talkingTo = null;
  const focus = await decideFocus(ctx);
  const cands = buildCandidates(ctx, focus);
  if (!cands.length) {
    ctx.log('warn', `nothing reachable on ${ctx.gs.mapName} at ${ctx.gs.x},${ctx.gs.y}; waiting`);
    await tap(ctx, 'B', 30);
    return;
  }
  const criteria: Record<string, EntryType> = {};
  for (const c of cands) {
    const fits = FITS[focus].test(`${c.criteria.action} ${c.criteria.facts.join(' ')}`);
    criteria[c.key] = fits ? { ...c.criteria, facts: [...c.criteria.facts, 'matches the current focus'] } : c.criteria;
  }
  const state = {
    ...basics(ctx),
    currentFocus: FOCI[focus],
    team: ctx.gs.party().map(monLine),
    recentActions: ctx.mem.actions.slice(-5),
  };
  const res = await ctx.jev.choose(
    'overworld', state,
    'You are playing Pokémon Red. Which action best serves `currentFocus` and the objective? Prefer something new over repeating an action that was already chosen without progress.',
    criteria,
    {
      kind: 'overworld',
      title: 'Where to next?',
      subtitle: `${prettyMap(ctx.gs.mapName)} · focus: ${focus}`,
      labels: Object.fromEntries(cands.map((c) => [c.key, { label: c.criteria.action, sub: c.criteria.facts.slice(0, 2).join(' · ') }])),
    },
  );
  let pick = res.choice;
  // loop breaking: the same option chosen 3+ times without progress → sample from the rest of Jev's distribution;
  // a long stretch without any progress → sample from the whole distribution
  const triedKey = (k: string) => `${ctx.gs.mapName}:${k}`;
  if ((ctx.mem.tried[triedKey(pick)] ?? 0) >= 3 && cands.length > 1) {
    pick = sample(res.probabilities, 0.3, [pick]);
    ctx.jev.override(pick);
    ctx.log('info', `"${res.choice}" already tried ${ctx.mem.tried[triedKey(res.choice)]}x without progress → trying "${pick}"`);
  } else if (agent.exploring) {
    pick = sample(res.probabilities, 0.3);
    if (pick !== res.choice) ctx.jev.override(pick);
    if (pick !== res.choice) ctx.log('info', `no progress for a while → sampled "${pick}" instead of "${res.choice}"`);
  }
  const c = cands.find((k) => k.key === pick)!;
  ctx.mem.tried[triedKey(c.key)] = (ctx.mem.tried[triedKey(c.key)] ?? 0) + 1;
  const desc = `${prettyMap(ctx.gs.mapName)}: ${c.criteria.action}`;
  remember(ctx.mem.actions, desc, 12);
  agent.onDecision(desc);
  const from = { map: ctx.gs.mapName, x: ctx.gs.x, y: ctx.gs.y };
  ctx.log('decision', desc, { focus, options: cands.length, confidence: res.confidence, from, target: c.target, path: c.path.length });
  const r = await execute(ctx, c);
  if (r === 'blocked') ctx.log('info', `"${c.criteria.action}" didn't get anywhere`, { from, now: { map: ctx.gs.mapName, x: ctx.gs.x, y: ctx.gs.y }, people: ctx.gs.sprites().filter((s) => !s.hidden) });
  // a wild or trainer battle on the way isn't a failed attempt: don't count it toward loop breaking
  if (r === 'interrupted' && ctx.gs.inBattle) ctx.mem.tried[triedKey(c.key)]--;
}

/** Player can act in the overworld: on a map, not in a cutscene, no UI on screen. */
export function overworldReady(ctx: Ctx): boolean {
  const { gs } = ctx;
  // while crossing a map edge the coordinates are briefly outside the new map
  const inside = gs.x < gs.mapWidth * 2 && gs.y < gs.mapHeight * 2;
  return ctx.emu.mem[sym('wSpriteStateData1')] !== 0 && gs.mapWidth > 0 && inside && gs.screen().uiTiles === 0 && mapLoaded(ctx);
}

/** wCurMap changes before the new map's people are loaded: wait until the sprite slots match the map's object list. */
function mapLoaded(ctx: Ctx): boolean {
  const objects = ctx.rom.maps.get(ctx.gs.mapId)?.objects ?? [];
  const sprites = ctx.gs.sprites();
  if (sprites.length !== objects.length) return false;
  return sprites.every((s, i) => s.picture === 0 || s.picture === objects[i].sprite);
}
