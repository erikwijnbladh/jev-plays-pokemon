import { sym, allMaps } from './data.js';
import { decode } from './text.js';

// Static game data read from the ROM using pokered symbol addresses.

export const TYPE_NAMES: Record<number, string> = {
  0x00: 'NORMAL', 0x01: 'FIGHTING', 0x02: 'FLYING', 0x03: 'POISON', 0x04: 'GROUND', 0x05: 'ROCK',
  0x07: 'BUG', 0x08: 'GHOST', 0x14: 'FIRE', 0x15: 'WATER', 0x16: 'GRASS', 0x17: 'ELECTRIC',
  0x18: 'PSYCHIC', 0x19: 'ICE', 0x1a: 'DRAGON',
};

/** Gen 1: the move's type decides physical vs special. */
export const PHYSICAL_TYPES = new Set(['NORMAL', 'FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BUG', 'GHOST']);

export interface MoveData { id: number; name: string; effect: number; power: number; type: string; accuracy: number; pp: number }
export interface SpeciesData { id: number; dex: number; name: string; types: string[]; catchRate: number }
export interface Warp { x: number; y: number; destMap: number; destWarp: number }
export interface Sign { x: number; y: number; textId: number }
export interface MapObject { index: number; sprite: number; x: number; y: number; textId: number; trainer?: string; item?: number }
export type EdgeDir = 'north' | 'south' | 'west' | 'east';
export interface Connection { dir: EdgeDir; map: number }
export interface MapData { id: number; name: string; tileset: number; width: number; height: number; connections: Connection[]; warps: Warp[]; signs: Sign[]; objects: MapObject[] }

/** The map ID the game uses in warp data for "wherever you came from". */
export const LAST_MAP = 0xff;

export class Rom {
  readonly species = new Map<number, SpeciesData>();
  readonly speciesByName = new Map<string, SpeciesData>();
  readonly moves = new Map<number, MoveData>();
  readonly movesByName = new Map<string, MoveData>();
  readonly items = new Map<number, string>();
  readonly maps = new Map<number, MapData>();
  private typeChart = new Map<string, number>();
  private trainerNames: string[] = [];

  constructor(readonly b: Uint8Array) {
    this.loadMoves();
    this.loadItems();
    this.loadSpecies();
    this.loadTypeChart();
    this.trainerNames = this.strings(sym('TrainerNames'), 47);
    this.loadMaps();
  }

  u16(a: number) {
    return this.b[a] | (this.b[a + 1] << 8);
  }

  /** Resolve a banked pointer to a flat ROM offset. */
  flat(bank: number, ptr: number) {
    return ptr < 0x4000 ? ptr : bank * 0x4000 + (ptr - 0x4000);
  }

  /** Damage multiplier of an attacking type against a defender's types (missing chart entries are x1). */
  effectiveness(moveType: string, defTypes: string[]): number {
    return defTypes.reduce((m, t) => m * (this.typeChart.get(`${moveType}>${t}`) ?? 1), 1);
  }

  private strings(start: number, count: number): string[] {
    const out: string[] = [];
    let a = start;
    for (let i = 0; i < count; i++) {
      out.push(decode(this.b, a, 32));
      while (this.b[a] !== 0x50) a++;
      a++;
    }
    return out;
  }

  private loadMoves() {
    const names = this.strings(sym('MoveNames'), 165);
    for (let i = 0; i < 165; i++) {
      const a = sym('Moves') + i * 6;
      const mv: MoveData = {
        id: i + 1, name: names[i], effect: this.b[a + 1], power: this.b[a + 2],
        type: TYPE_NAMES[this.b[a + 3]] ?? '?', accuracy: Math.round((this.b[a + 4] / 255) * 100), pp: this.b[a + 5],
      };
      this.moves.set(mv.id, mv);
      this.movesByName.set(mv.name, mv);
    }
  }

  private loadItems() {
    this.strings(sym('ItemNames'), 97).forEach((n, i) => this.items.set(i + 1, n));
    for (let i = 1; i <= 5; i++) this.items.set(0xc3 + i, `HM0${i}`);
    for (let i = 1; i <= 50; i++) this.items.set(0xc8 + i, `TM${String(i).padStart(2, '0')}`);
  }

  private loadSpecies() {
    // species are stored by internal index; base stats are in Pokédex order
    for (let id = 1; id <= 190; id++) {
      const dex = this.b[sym('PokedexOrder') + id - 1];
      if (!dex) continue; // MISSINGNO slots
      const a = dex === 151 ? sym('MewBaseStats') : sym('BaseStats') + (dex - 1) * 28;
      const t1 = TYPE_NAMES[this.b[a + 6]], t2 = TYPE_NAMES[this.b[a + 7]];
      const sp: SpeciesData = {
        id, dex, name: decode(this.b, sym('MonsterNames') + (id - 1) * 10, 10),
        types: t1 === t2 ? [t1] : [t1, t2], catchRate: this.b[a + 8],
      };
      this.species.set(id, sp);
      this.speciesByName.set(sp.name, sp);
    }
  }

  private loadTypeChart() {
    for (let a = sym('TypeEffects'); this.b[a] !== 0xff; a += 3) {
      this.typeChart.set(`${TYPE_NAMES[this.b[a]]}>${TYPE_NAMES[this.b[a + 1]]}`, this.b[a + 2] / 10);
    }
  }

  /** Map headers: connections, then the object data (warps, signs, people/items). */
  private loadMaps() {
    for (const [idStr, meta] of Object.entries(allMaps())) {
      const id = +idStr;
      if (meta.name.startsWith('UNUSED')) continue;
      const bank = this.b[sym('MapHeaderBanks') + id];
      let h = this.flat(bank, this.u16(sym('MapHeaderPointers') + id * 2));
      const tileset = this.b[h], height = this.b[h + 1], width = this.b[h + 2], flags = this.b[h + 9];
      h += 10;
      const connections: Connection[] = [];
      for (const [bit, dir] of [[3, 'north'], [2, 'south'], [1, 'west'], [0, 'east']] as const) {
        if (!(flags & (1 << bit))) continue;
        connections.push({ dir, map: this.b[h] });
        h += 11;
      }
      let o = this.flat(bank, this.u16(h)) + 1; // skip the border block
      const warps: Warp[] = [];
      for (let n = this.b[o++], i = 0; i < n; i++, o += 4) warps.push({ y: this.b[o], x: this.b[o + 1], destWarp: this.b[o + 2], destMap: this.b[o + 3] });
      const signs: Sign[] = [];
      for (let n = this.b[o++], i = 0; i < n; i++, o += 3) signs.push({ y: this.b[o], x: this.b[o + 1], textId: this.b[o + 2] });
      const objects: MapObject[] = [];
      for (let n = this.b[o++], i = 0; i < n; i++) {
        const t = this.b[o + 5];
        const obj: MapObject = { index: i + 1, sprite: this.b[o], y: this.b[o + 1] - 4, x: this.b[o + 2] - 4, textId: t & 0x3f };
        if (t & 0x40) { obj.trainer = this.trainerNames[this.b[o + 6] - 201] ?? 'TRAINER'; o += 8; }
        else if (t & 0x80) { obj.item = this.b[o + 6]; o += 7; }
        else o += 6;
        objects.push(obj);
      }
      this.maps.set(id, { id, name: meta.name, tileset, width, height, connections, warps, signs, objects });
    }
  }
}
