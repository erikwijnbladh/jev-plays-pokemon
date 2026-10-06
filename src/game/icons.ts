import type { Rom } from './rom.js';
import { sym } from './data.js';

// Party-menu icons (16x16, 4 shades), read from the player's own ROM at runtime.
// All icons except the helix are left/right symmetric: the game stores the left column (top and bottom
// 8x8 tiles) and draws the right column X-flipped (WriteSymmetricMonPartySpriteOAM).

const ICON_MON = 0;
const ENTRIES = 14; // first animation frame of every icon type in MonPartySpritePointers

/** 256 shade indices (0 = transparent, 3 = darkest), row-major 16x16. */
export type Icon = number[];

export class PartyIcons {
  private byType = new Map<number, Icon>();

  constructor(private rom: Rom) {
    // mon_icon_header: dw gfx pointer (+ tile offset), db tile count, db bank, dw vSprites destination
    const slots = new Map<number, number>(); // vSprites tile slot -> ROM offset of that tile
    for (let i = 0; i < ENTRIES; i++) {
      const a = sym('MonPartySpritePointers') + i * 6;
      const ptr = rom.u16(a), count = rom.b[a + 2], bank = rom.b[a + 3], vram = rom.u16(a + 4);
      const slot = (vram - 0x8000) / 16;
      for (let t = 0; t < count; t++) slots.set(slot + t, rom.flat(bank, ptr) + t * 16);
    }
    for (let type = 0; type < 16; type++) {
      const top = slots.get(type * 4), bottom = slots.get(type * 4 + 2);
      if (top !== undefined && bottom !== undefined) this.byType.set(type, this.assemble(top, bottom));
    }
  }

  /** Icon type for a species: one nybble per Pokédex number in MonPartyData (odd numbers use the high nybble). */
  typeOf(speciesId: number): number {
    const dex = this.rom.species.get(speciesId)?.dex;
    if (!dex) return ICON_MON;
    const byte = this.rom.b[sym('MonPartyData') + ((dex - 1) >> 1)];
    return dex & 1 ? byte >> 4 : byte & 0x0f;
  }

  forSpecies(speciesId: number): Icon {
    return this.byType.get(this.typeOf(speciesId)) ?? this.byType.get(ICON_MON)!;
  }

  private assemble(top: number, bottom: number): Icon {
    const out: Icon = new Array(256).fill(0);
    for (const [tile, y0] of [[top, 0], [bottom, 8]] as const) {
      for (let r = 0; r < 8; r++) {
        const lo = this.rom.b[tile + r * 2], hi = this.rom.b[tile + r * 2 + 1];
        for (let c = 0; c < 8; c++) {
          const shade = (((hi >> (7 - c)) & 1) << 1) | ((lo >> (7 - c)) & 1);
          out[(y0 + r) * 16 + c] = shade;
          out[(y0 + r) * 16 + 15 - c] = shade; // mirrored right half
        }
      }
    }
    return out;
  }
}
