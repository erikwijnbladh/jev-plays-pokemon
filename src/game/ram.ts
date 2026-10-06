import type { Emulator } from '../emu/emulator.js';
import type { Rom } from './rom.js';
import { sym, eventBit, mapName } from './data.js';
import { decode, decodeTile } from './text.js';

// Reads live game state from WRAM. Pure observation: it never writes memory.

export interface Move { id: number; name: string; type: string; power: number; accuracy: number; pp: number; maxPp: number }
export interface Mon {
  slot: number; speciesId: number; species: string; nickname: string; level: number;
  hp: number; maxHp: number; status: string; types: string[]; moves: Move[];
  stats: { atk: number; def: number; spd: number; spc: number };
}
export interface Battler {
  species: string; speciesId: number; level: number; hp: number; maxHp: number; status: string; types: string[]; catchRate: number;
  stats: { atk: number; def: number; spd: number; spc: number };
}

export interface Screen {
  /** 18 rows of 20 tiles; each tile decoded to its text (a tile can be several chars, e.g. POKé) */
  cells: string[][];
  rows: string[];
  /** box-drawing tiles are on screen (a text box or a menu) */
  hasTextBox: boolean;
  /** font/UI tiles on screen; overworld map tiles are all below $60 */
  uiTiles: number;
  /** the text inside the bottom dialog box */
  dialog: string;
  /** ▼ in the dialog box: the game waits for A */
  waitingForA: boolean;
  /** the ▶ menu cursor */
  cursor: { x: number; y: number } | null;
}

const statusName = (b: number) =>
  b & 0x07 ? 'ASLEEP' : b & 0x08 ? 'POISONED' : b & 0x10 ? 'BURNED' : b & 0x20 ? 'FROZEN' : b & 0x40 ? 'PARALYZED' : 'OK';

export class GameState {
  constructor(private emu: Emulator, private rom: Rom) {}

  get m() { return this.emu.mem; }
  u8(name: string, off = 0) { return this.m[sym(name) + off]; }
  private be16(a: number) { return (this.m[a] << 8) | this.m[a + 1]; }

  get mapId() { return this.u8('wCurMap'); }
  get mapName() { return mapName(this.mapId); }
  get x() { return this.u8('wXCoord'); }
  get y() { return this.u8('wYCoord'); }
  get mapWidth() { return this.u8('wCurMapWidth'); }
  get mapHeight() { return this.u8('wCurMapHeight'); }
  /** 0 none, 1 wild, 2 trainer, 0xff lost */
  get inBattle() { return this.u8('wIsInBattle'); }
  get badges() { return this.u8('wObtainedBadges'); }
  get badgeCount() { let n = 0; for (let b = this.badges; b; b >>= 1) n += b & 1; return n; }
  get facing() { return this.u8('wSpritePlayerStateData1FacingDirection'); }

  /** The game is moving the player itself or ignoring input (cutscene, scripted walk). */
  get scripted() {
    return (this.u8('wJoyIgnore') & 0xf0) !== 0 || (this.u8('wStatusFlags5') & 0x80) !== 0 || this.u8('wWalkCounter') !== 0;
  }

  get money() {
    const a = sym('wPlayerMoney');
    const bcd = (v: number) => (v >> 4) * 10 + (v & 0xf);
    return bcd(this.m[a]) * 10000 + bcd(this.m[a + 1]) * 100 + bcd(this.m[a + 2]);
  }

  event(name: string): boolean {
    const bit = eventBit(name);
    return !!(this.m[sym('wEventFlags') + (bit >> 3)] & (1 << (bit & 7)));
  }

  /** Number of story/trainer event flags set so far (a coarse progress signal). */
  eventCount(): number {
    let n = 0;
    for (let a = sym('wEventFlags'); a < sym('wEventFlags') + 0x140; a++) for (let b = this.m[a]; b; b &= b - 1) n++;
    return n;
  }

  ownsDex(dex: number): boolean {
    return !!(this.m[sym('wPokedexOwned') + ((dex - 1) >> 3)] & (1 << ((dex - 1) & 7)));
  }

  private moves(movesAt: number, ppAt: number): Move[] {
    const out: Move[] = [];
    for (let j = 0; j < 4; j++) {
      const id = this.m[movesAt + j];
      const mv = id ? this.rom.moves.get(id) : undefined;
      if (!mv) continue;
      const pp = this.m[ppAt + j];
      out.push({ id, name: mv.name, type: mv.type, power: mv.power, accuracy: mv.accuracy, pp: pp & 0x3f, maxPp: mv.pp + Math.floor(mv.pp / 5) * (pp >> 6) });
    }
    return out;
  }

  /** party_struct is 44 bytes: species, hp, ..., moves @8, PP @29, level @33, max HP @34, stats @36. */
  party(): Mon[] {
    const out: Mon[] = [];
    for (let i = 0; i < Math.min(this.u8('wPartyCount'), 6); i++) {
      const a = sym('wPartyMons') + i * 44;
      const sp = this.rom.species.get(this.m[a]);
      out.push({
        slot: i, speciesId: this.m[a], species: sp?.name ?? '?', nickname: decode(this.m, sym('wPartyMonNicks') + i * 11, 11),
        level: this.m[a + 33], hp: this.be16(a + 1), maxHp: this.be16(a + 34), status: statusName(this.m[a + 4]),
        types: sp?.types ?? [], moves: this.moves(a + 8, a + 29),
        stats: { atk: this.be16(a + 36), def: this.be16(a + 38), spd: this.be16(a + 40), spc: this.be16(a + 42) },
      });
    }
    return out;
  }

  /** battle_struct: species, hp, ..., moves @8, level @14, max HP @15, stats @17, PP @25. */
  private battler(a: number): Battler {
    const sp = this.rom.species.get(this.m[a]);
    return {
      species: sp?.name ?? '?', speciesId: this.m[a], level: this.m[a + 14], hp: this.be16(a + 1), maxHp: this.be16(a + 15),
      status: statusName(this.m[a + 4]), types: sp?.types ?? [], catchRate: sp?.catchRate ?? 0,
      stats: { atk: this.be16(a + 17), def: this.be16(a + 19), spd: this.be16(a + 21), spc: this.be16(a + 23) },
    };
  }

  battle() {
    const p = sym('wBattleMon');
    return {
      kind: this.inBattle === 1 ? ('wild' as const) : ('trainer' as const),
      enemy: this.battler(sym('wEnemyMon')),
      enemyPartyCount: this.u8('wEnemyPartyCount'),
      player: { ...this.battler(p), slot: this.u8('wPlayerMonNumber'), moves: this.moves(p + 8, p + 25) },
    };
  }

  bag(): { id: number; name: string; qty: number }[] {
    const out = [];
    for (let i = 0; i < Math.min(this.u8('wNumBagItems'), 20); i++) {
      const a = sym('wBagItems') + i * 2;
      out.push({ id: this.m[a], name: this.rom.items.get(this.m[a]) ?? `ITEM_${this.m[a]}`, qty: this.m[a + 1] });
    }
    return out;
  }

  /** People and objects on the current map (sprite slots 1-15), with live positions. */
  sprites(): { index: number; x: number; y: number; hidden: boolean; picture: number }[] {
    const hidden = new Set<number>();
    // wToggleableObjectList: (sprite index, global toggle index) pairs, $FF-terminated; a set flag hides the object
    for (let a = sym('wToggleableObjectList'); this.m[a] !== 0xff && a < sym('wToggleableObjectList') + 34; a += 2) {
      const g = this.m[a + 1];
      if (this.m[sym('wToggleableObjectFlags') + (g >> 3)] & (1 << (g & 7))) hidden.add(this.m[a]);
    }
    const out = [];
    for (let i = 1; i <= Math.min(this.u8('wNumSprites'), 15); i++) {
      const picture = this.m[sym('wSpriteStateData1') + i * 16];
      // map coordinates are stored +4
      const y = this.m[sym('wSpriteStateData2') + i * 16 + 4] - 4;
      const x = this.m[sym('wSpriteStateData2') + i * 16 + 5] - 4;
      out.push({ index: i, x, y, hidden: hidden.has(i) || picture === 0, picture });
    }
    return out;
  }

  screen(): Screen {
    const base = sym('wTileMap');
    const cells: string[][] = [];
    let hasTextBox = false, waitingForA = false, uiTiles = 0;
    let cursor: Screen['cursor'] = null;
    for (let y = 0; y < 18; y++) {
      const row: string[] = [];
      for (let x = 0; x < 20; x++) {
        const t = this.m[base + y * 20 + x];
        if (t >= 0x60) uiTiles++;
        if (t >= 0x79 && t <= 0x7e) hasTextBox = true;
        if (t === 0xed) cursor = { x, y };
        if (t === 0xee && y >= 12) waitingForA = true;
        row.push(decodeTile(t));
      }
      cells.push(row);
    }
    const rows = cells.map((r) => r.join(''));
    const dialog = hasTextBox
      ? [rows[14], rows[16]].map((r) => r.replace(/[┌─┐│└┘▼]/g, '').trim()).filter(Boolean).join(' ')
      : '';
    return { cells, rows, hasTextBox, uiTiles, dialog, waitingForA, cursor };
  }

  /** The cursor-driven menu registers. */
  menu() {
    return {
      current: this.u8('wCurrentMenuItem'), max: this.u8('wMaxMenuItem'),
      topY: this.u8('wTopMenuItemY'), topX: this.u8('wTopMenuItemX'), scroll: this.u8('wListScrollOffset'),
    };
  }
}
