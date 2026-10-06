import type { Ctx } from './ctx.js';
import { tap, basics, monLine } from './ctx.js';
import { sym, prettyMap } from '../game/data.js';
import { sample } from '../jev/client.js';
import type { EntryType } from '@typesafe-ai/sdk';

// Screen-reading helpers for menus. They find labels that are ON SCREEN and move the cursor to them;
// what to pick is decided elsewhere (by Jev, or by a house rule).

export interface Label { text: string; x: number; y: number; index?: number }

/** Finds `text` on screen; with several matches, the one closest to the cursor. */
export function findLabel(ctx: Ctx, text: string): Label | null {
  const s = ctx.gs.screen();
  const want = text.toUpperCase();
  const hits: Label[] = [];
  for (let y = 0; y < 18; y++) {
    // a tile can decode to several chars (POKé): map string positions back to tile columns
    const col: number[] = [];
    s.cells[y].forEach((c, x) => { for (let k = 0; k < c.length; k++) col.push(x); });
    const row = s.cells[y].join('').toUpperCase();
    for (let i = row.indexOf(want); i >= 0; i = row.indexOf(want, i + 1)) hits.push({ text, x: col[i], y });
  }
  if (!hits.length) return null;
  const c = s.cursor ?? { x: 0, y: 17 };
  const dist = (l: Label) => Math.abs(l.y - c.y) * 4 + Math.abs(l.x - c.x);
  return hits.sort((a, b) => dist(a) - dist(b))[0];
}

/** Moves the ▶ cursor next to `text`, scrolling a list down if it isn't visible yet. */
export async function cursorTo(ctx: Ctx, text: string, maxPresses = 40): Promise<boolean> {
  let waited = 0;
  for (let i = 0; i < maxPresses; i++) {
    const cur = ctx.gs.screen().cursor;
    const lab = findLabel(ctx, text);
    if (!cur || (!lab && waited < 45)) { waited += 5; await ctx.emu.wait(5); continue; }
    if (!lab) { await tap(ctx, 'DOWN', 6); continue; } // assume a scrolling list
    const tx = lab.x - 1;
    if (cur.y === lab.y && Math.abs(cur.x - tx) <= 1) return true;
    if (cur.y > lab.y) await tap(ctx, 'UP', 6);
    else if (cur.y < lab.y) await tap(ctx, 'DOWN', 6);
    else await tap(ctx, cur.x > tx ? 'LEFT' : 'RIGHT', 6);
  }
  return false;
}

/**
 * Moves the cursor to the row whose text (right of the cursor column) is exactly `text`.
 * Safer than cursorTo for lists where one entry is a prefix of another (THUNDER / THUNDERBOLT).
 */
export async function cursorToExact(ctx: Ctx, text: string): Promise<boolean> {
  for (let i = 0; i < 12; i++) {
    const s = ctx.gs.screen();
    if (!s.cursor) { await ctx.emu.wait(5); continue; }
    const col = s.cursor.x;
    const rowText = (y: number) => s.cells[y].slice(col + 1).join('').replace(/[│▶▷]/g, ' ').trim();
    let target = -1;
    for (let y = 0; y < 18; y++) if (rowText(y) === text) { target = y; break; }
    if (target < 0) return false;
    if (target === s.cursor.y) return true;
    await tap(ctx, target < s.cursor.y ? 'UP' : 'DOWN', 6);
  }
  return false;
}

/** Moves the cursor to a list index using the game's own cursor register (0-based in the party menu). */
export async function cursorToIndex(ctx: Ctx, index: number): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    const cur = ctx.gs.menu().current;
    if (cur === index) return true;
    await tap(ctx, cur > index ? 'UP' : 'DOWN', 6);
  }
  return ctx.gs.menu().current === index;
}

/** Press A and wait for the screen to react; a menu that just opened can drop the first press, so retry once. */
export async function confirm(ctx: Ctx) {
  const before = ctx.gs.screen().rows.join('');
  for (let attempt = 0; attempt < 2; attempt++) {
    await tap(ctx, 'A', 8);
    for (let i = 0; i < 60; i++) {
      if (ctx.gs.screen().rows.join('') !== before) return;
      await ctx.emu.frame();
    }
  }
}

export async function select(ctx: Ctx, text: string): Promise<boolean> {
  if (!(await cursorTo(ctx, text))) return false;
  await confirm(ctx);
  return true;
}

/** Let text that is still printing finish before reading the screen. */
export async function waitStable(ctx: Ctx, frames = 8, max = 120) {
  let last = '', stable = 0;
  for (let f = 0; f < max && stable < frames; f++) {
    const now = ctx.gs.screen().rows.join('');
    stable = now === last ? stable + 1 : 0;
    last = now;
    await ctx.emu.frame();
  }
}

/** True when the CPU is inside the game's menu input loop (an old menu can stay drawn while new text prints). */
export async function menuActive(ctx: Ctx): Promise<boolean> {
  const core = ctx.emu.core, lo = sym('HandleMenuInput'), hi = sym('PlaceMenuCursor');
  for (let f = 0; f < 4; f++) {
    const sp = core.stackPointer;
    for (let i = 0; i < 12; i++) {
      const ret = core.memoryRead(sp + 2 * i) | (core.memoryRead(sp + 2 * i + 1) << 8);
      if (ret >= lo && ret < hi) return true;
    }
    await ctx.emu.frame();
  }
  return false;
}

export function isPartyMenu(ctx: Ctx): boolean {
  const s = ctx.gs.screen();
  const party = ctx.gs.party();
  return !!s.cursor && s.cursor.x === 0 && party.length > 0 && s.rows[0].slice(3).startsWith(party[0].nickname);
}

const LABEL = /[A-Za-z]{2,}|^-$|^B?\d{1,2}F$/;

/** Options of the menu that owns the ▶ cursor. */
export function readMenuOptions(ctx: Ctx): Label[] {
  const s = ctx.gs.screen();
  if (!s.cursor) return [];
  if (isPartyMenu(ctx)) return ctx.gs.party().map((p, i) => ({ text: p.nickname, x: 3, y: i * 2, index: i }));
  const clean = (t: string) => t.replace(/[┌─┐│└┘▶▷▼]/g, ' ').replace(/\s{2,}.*$/, '').trim();
  // the menu registers describe most menus exactly: first row, column and item count (spacing 2 or 1)
  const { topY, topX, max } = ctx.gs.menu();
  if (s.cursor.x === topX) {
    for (const step of [2, 1]) {
      const opts: Label[] = [];
      for (let i = 0; i <= max && i < 12 && topY + i * step < 18; i++) {
        const y = topY + i * step;
        const text = clean(s.cells[y].slice(topX + 1).join(''));
        if (text) opts.push({ text, x: topX + 1, y, index: i });
      }
      if (opts.length === max + 1 && opts.every((o) => LABEL.test(o.text)) && new Set(opts.map((o) => o.text)).size === opts.length) return opts;
    }
  }
  // fallback: the rows of the box the cursor is in
  const col = s.cursor.x;
  const inBox = (y: number) => /[│ ▶▷]/.test(s.cells[y][col] ?? '') && !/[─┌└┐┘]/.test(s.cells[y][col] ?? '');
  let top = s.cursor.y, bot = s.cursor.y;
  while (top > 0 && inBox(top - 1)) top--;
  while (bot < 17 && inBox(bot + 1)) bot++;
  const opts: Label[] = [];
  for (let y = top; y <= bot; y++) {
    const text = clean(s.cells[y].slice(col + 1).join(''));
    if (text && LABEL.test(text)) opts.push({ text, x: col + 1, y });
  }
  return opts;
}

/** per menu (its options + prompt): last answer and how many times in a row */
const menuHistory = new Map<string, { choice: string; streak: number }>();
export function resetMenuHistory() { menuHistory.clear(); }

export interface MenuContext {
  /** facts about an option, by its on-screen label */
  facts?: (label: string) => string;
  /** options that can't be picked (e.g. a fainted Pokémon) */
  exclude?: (label: string) => boolean;
  /** decision-specific context added to the state */
  state?: Record<string, unknown>;
}

/** Ask Jev which option of the on-screen menu to pick, then pick it. */
export async function decideMenu(ctx: Ctx, purpose: string, mc: MenuContext = {}): Promise<string | null> {
  const facts = mc.facts ?? (() => '');
  await waitStable(ctx);
  const opts = readMenuOptions(ctx).filter((o) => !mc.exclude?.(o.text));
  if (!opts.length) return null;
  const prompt = ctx.mem.dialog.slice(-3);
  const criteria: Record<string, EntryType> = {};
  const byKey = new Map<string, Label>();
  for (const o of opts) {
    const k = `option_${o.text}`;
    if (byKey.has(k)) continue;
    byKey.set(k, o);
    const f = facts(o.text);
    criteria[k] = f ? { label: o.text, facts: f } : { label: o.text };
  }
  const id = `${[...byKey.keys()].join('|')}#${prompt.join(' ').slice(-120)}`;
  const state = { ...basics(ctx), team: ctx.gs.party().map(monLine), ...mc.state, recentDialog: prompt };
  const question = (prompt[prompt.length - 1] ?? '').replace(/\s+/g, ' ').trim();
  const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  const res = await ctx.jev.choose(purpose, state, 'You are playing Pokémon Red. A menu is open after `recentDialog`. Which option should the player pick?', criteria, {
    kind: purpose.startsWith('battle') ? 'battle' : 'menu',
    title: question ? clip(question, 60) : 'Pick an option',
    subtitle: prettyMap(ctx.gs.mapName),
    labels: Object.fromEntries([...byKey].map(([k, o]) => [k, { label: o.text, sub: facts(o.text) ? clip(facts(o.text), 70) : undefined }])),
    logPrefix: question ? `"${clip(question, 22)}" → ` : '',
  });
  let pick = res.choice;
  // the same answer to the same menu again and again: something isn't working, try another option
  const h = menuHistory.get(id);
  const streak = h?.choice === pick ? h.streak + 1 : 1;
  if (streak >= 4 && byKey.size > 1) {
    pick = sample(res.probabilities, 0.5, [pick]);
    ctx.jev.override(pick);
    ctx.log('info', `menu answered "${h!.choice}" ${streak - 1}x in a row → trying "${pick}"`);
  }
  menuHistory.set(id, { choice: pick, streak: pick === h?.choice ? streak : 1 });
  const label = byKey.get(pick)!;
  ctx.log('decision', `${purpose}: ${label.text}`, { options: [...byKey.values()].map((o) => o.text), confidence: res.confidence });
  if (label.index !== undefined && isPartyMenu(ctx)) await cursorToIndex(ctx, label.index);
  else if (!(await cursorTo(ctx, label.text))) { await tap(ctx, 'B', 10); return null; }
  await confirm(ctx);
  return label.text;
}
