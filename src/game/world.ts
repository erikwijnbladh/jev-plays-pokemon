import { LAST_MAP, type Rom } from './rom.js';

/**
 * Map-to-map graph (warps + edge connections), used only to annotate options with how many maps lie
 * between a destination and the objective. It never picks anything.
 * Coarse on purpose: it doesn't know that a map can be split in parts (ledges, Cut trees, water).
 */
export class WorldGraph {
  private edges = new Map<number, Set<number>>();
  private cache = new Map<number, Map<number, number>>();

  constructor(rom: Rom) {
    const add = (a: number, b: number) => (this.edges.get(a) ?? this.edges.set(a, new Set()).get(a)!).add(b);
    const into = new Map<number, number[]>();
    for (const md of rom.maps.values()) {
      for (const w of md.warps) if (w.destMap !== LAST_MAP) (into.get(w.destMap) ?? into.set(w.destMap, []).get(w.destMap)!).push(md.id);
    }
    for (const md of rom.maps.values()) {
      for (const c of md.connections) add(md.id, c.map);
      for (const w of md.warps) {
        if (w.destMap !== LAST_MAP) add(md.id, w.destMap);
        // "back where you came from": every map with a warp into this one
        else for (const src of into.get(md.id) ?? []) add(md.id, src);
      }
    }
  }

  /** Shortest number of map changes from `from` to any of `to` (Infinity when unconnected). */
  hops(from: number, to: number[]): number {
    let best = Infinity;
    for (const t of to) best = Math.min(best, this.distancesTo(t).get(from) ?? Infinity);
    return best;
  }

  /** BFS over reversed edges from the target, cached per target. */
  private distancesTo(target: number): Map<number, number> {
    let d = this.cache.get(target);
    if (d) return d;
    const rev = new Map<number, number[]>();
    for (const [a, bs] of this.edges) for (const b of bs) (rev.get(b) ?? rev.set(b, []).get(b)!).push(a);
    d = new Map([[target, 0]]);
    const q = [target];
    while (q.length) {
      const c = q.shift()!;
      for (const n of rev.get(c) ?? []) if (!d.has(n)) { d.set(n, d.get(c)! + 1); q.push(n); }
    }
    this.cache.set(target, d);
    return d;
  }
}
