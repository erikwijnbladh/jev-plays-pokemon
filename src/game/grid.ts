import type { Rom } from './rom.js';
import type { GameState } from './ram.js';
import type { Emulator } from '../emu/emulator.js';
import { sym } from './data.js';

export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const FACING_DIR: Record<number, Dir> = { 0x0: 'down', 0x4: 'up', 0x8: 'left', 0xc: 'right' };

export interface Grid {
  /** in 16x16 squares (the unit of wXCoord / wYCoord) */
  w: number;
  h: number;
  tile: (x: number, y: number) => number;
  walkable: (x: number, y: number) => boolean;
  grass: (x: number, y: number) => boolean;
  /** a shop / Pokémon Center counter: you talk across it */
  counter: (x: number, y: number) => boolean;
  /** jumping down a ledge from (x,y) moving d */
  ledge: (x: number, y: number, d: Dir) => boolean;
  pairBlocked: (from: number, to: number) => boolean;
}

/** Walkability of the current map, from the live block map in WRAM and the tileset's collision list in ROM. */
export function buildGrid(emu: Emulator, rom: Rom, gs: GameState): Grid {
  const m = emu.mem, r = rom.b;
  const W = gs.mapWidth, H = gs.mapHeight, tileset = gs.u8('wCurMapTileset');
  const bank = gs.u8('wTilesetBank');
  const blocks = rom.flat(bank, m[sym('wTilesetBlocksPtr')] | (m[sym('wTilesetBlocksPtr') + 1] << 8));
  const passable = new Set<number>();
  for (let a = rom.flat(bank, m[sym('wTilesetCollisionPtr')] | (m[sym('wTilesetCollisionPtr') + 1] << 8)); r[a] !== 0xff; a++) passable.add(r[a]);
  const grassTile = gs.u8('wGrassTile');
  // Tilesets entries are 12 bytes; the three counter tiles are at +7
  const header = sym('Tilesets') + tileset * 12;
  const counters = new Set([r[header + 7], r[header + 8], r[header + 9]].filter((t) => t !== 0xff));
  const overworld = sym('wOverworldMap');

  // a square is the bottom-left 8x8 tile of its 16x16 quarter of a 32x32 block; the block map has a 3-block border
  const tile = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W * 2 || y >= H * 2) return -1;
    const block = m[overworld + ((y >> 1) + 3) * (W + 6) + (x >> 1) + 3];
    return r[blocks + block * 16 + ((y & 1) * 2 + 1) * 4 + (x & 1) * 2];
  };

  const ledges: { dir: Dir; stand: number; ledge: number }[] = [];
  if (tileset === 0) for (let a = sym('LedgeTiles'); r[a] !== 0xff; a += 4) ledges.push({ dir: FACING_DIR[r[a]], stand: r[a + 1], ledge: r[a + 2] });
  const pairs: [number, number][] = [];
  for (let a = sym('TilePairCollisionsLand'); r[a] !== 0xff; a += 3) if (r[a] === tileset) pairs.push([r[a + 1], r[a + 2]]);

  return {
    w: W * 2, h: H * 2, tile,
    walkable: (x, y) => passable.has(tile(x, y)),
    grass: (x, y) => grassTile !== 0xff && tile(x, y) === grassTile,
    counter: (x, y) => counters.has(tile(x, y)),
    ledge: (x, y, d) => {
      const [dx, dy] = DIRS[d];
      const s = tile(x, y), l = tile(x + dx, y + dy);
      return ledges.some((e) => e.dir === d && e.stand === s && e.ledge === l);
    },
    pairBlocked: (a, b) => pairs.some(([p, q]) => (p === a && q === b) || (p === b && q === a)),
  };
}

export interface Step { dir: Dir; x: number; y: number; jump?: boolean }

export interface PathOpts {
  /** squares occupied by people */
  blocked?: Set<string>;
  /** squares just outside the map that count as walkable (map-edge exits) */
  allowExit?: (x: number, y: number) => boolean;
  /** extra cost for tall grass (avoid wild battles when just travelling) */
  grassCost?: number;
  maxNodes?: number;
}

const key = (x: number, y: number) => `${x},${y}`;

/** A* (uniform-cost with a Manhattan heuristic toward the nearest goal) from the player's square. */
export function findPath(g: Grid, sx: number, sy: number, goals: { x: number; y: number }[], opts: PathOpts = {}): Step[] | null {
  if (!goals.length) return null;
  const goalSet = new Set(goals.map((p) => key(p.x, p.y)));
  const h = (x: number, y: number) => Math.min(...goals.map((p) => Math.abs(p.x - x) + Math.abs(p.y - y)));
  const heap = new MinHeap<{ x: number; y: number; g: number }>();
  heap.push({ x: sx, y: sy, g: 0 }, h(sx, sy));
  const came = new Map<string, { from: string; step: Step }>();
  const cost = new Map<string, number>([[key(sx, sy), 0]]);
  for (let n = 0; heap.size && n < (opts.maxNodes ?? 20000); n++) {
    const cur = heap.pop()!;
    const ck = key(cur.x, cur.y);
    if (cur.g > (cost.get(ck) ?? Infinity)) continue;
    if (goalSet.has(ck) && (cur.x !== sx || cur.y !== sy)) {
      const path: Step[] = [];
      for (let k = ck; came.has(k); k = came.get(k)!.from) path.unshift(came.get(k)!.step);
      return path;
    }
    if (cur.x < 0 || cur.y < 0 || cur.x >= g.w || cur.y >= g.h) continue; // off-map squares are terminal
    for (const d of Object.keys(DIRS) as Dir[]) {
      const [dx, dy] = DIRS[d];
      let nx = cur.x + dx, ny = cur.y + dy, jump = false;
      const outside = nx < 0 || ny < 0 || nx >= g.w || ny >= g.h;
      if (outside) {
        if (!opts.allowExit?.(nx, ny)) continue;
      } else if (g.ledge(cur.x, cur.y, d)) {
        nx += dx; ny += dy; jump = true;
        if (!g.walkable(nx, ny)) continue;
      } else {
        if (!g.walkable(nx, ny) || opts.blocked?.has(key(nx, ny))) continue;
        if (g.pairBlocked(g.tile(cur.x, cur.y), g.tile(nx, ny))) continue;
      }
      const nk = key(nx, ny);
      const gc = cur.g + (jump ? 2 : 1) + (!outside && g.grass(nx, ny) ? opts.grassCost ?? 0 : 0);
      if (gc < (cost.get(nk) ?? Infinity)) {
        cost.set(nk, gc);
        came.set(nk, { from: ck, step: { dir: d, x: nx, y: ny, jump } });
        heap.push({ x: nx, y: ny, g: gc }, gc + h(nx, ny));
      }
    }
  }
  return null;
}

class MinHeap<T> {
  private items: { v: T; p: number }[] = [];
  get size() { return this.items.length; }
  push(v: T, p: number) {
    const a = this.items;
    a.push({ v, p });
    for (let i = a.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (a[parent].p <= a[i].p) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0].v;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < a.length && a[l].p < a[s].p) s = l;
        if (r < a.length && a[r].p < a[s].p) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    return top;
  }
}
