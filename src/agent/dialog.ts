import type { Ctx } from './ctx.js';
import { tap, rememberDialog } from './ctx.js';
import { decideMenu, findLabel, cursorTo, menuActive, select } from './menus.js';

const PLAYER_NAME = process.env.PLAYER_NAME ?? 'JEV';
const RIVAL_NAME = process.env.RIVAL_NAME ?? 'BLUE';

export function isNamingScreen(ctx: Ctx): boolean {
  return ctx.gs.screen().rows.some((r) => /A B C D E F G H I/.test(r.replace(/[▶▷]/g, ' ')));
}

/** wOptions: text speed in the low nibble (1 = fast), bit 7 = battle animations off. */
const optionsSet = (ctx: Ctx) => (ctx.gs.u8('wOptions') & 0x8f) === 0x81;

/** Types a name on the naming keyboard by finding each letter on screen and walking the cursor to it. */
async function typeName(ctx: Ctx, name: string) {
  for (const ch of name) {
    for (let i = 0; i < 24; i++) {
      const s = ctx.gs.screen();
      let pos: { x: number; y: number } | null = null;
      for (let y = 4; y < 16 && !pos; y++) {
        for (let x = 0; x < 20; x++) if (s.rows[y][x] === ch && (x === 0 || s.rows[y][x - 1] !== ch)) { pos = { x, y }; break; }
      }
      const cur = s.cursor;
      if (!pos || !cur) break;
      if (cur.y === pos.y && cur.x === pos.x - 1) { await tap(ctx, 'A', 8); break; }
      if (cur.y !== pos.y) await tap(ctx, cur.y > pos.y ? 'UP' : 'DOWN', 6);
      else await tap(ctx, cur.x > pos.x - 1 ? 'LEFT' : 'RIGHT', 6);
    }
  }
  await tap(ctx, 'START', 30);
  if (isNamingScreen(ctx)) await tap(ctx, 'A', 30); // START moved the cursor to ED: confirm
}

// Made-up nickname candidates are built in code; Jev only selects (it isn't a text generator).
const SYLLABLES = ['ZO', 'RA', 'KI', 'MU', 'PO', 'LEX', 'TA', 'VI', 'NO', 'BRU', 'FEN', 'DO', 'LI', 'SKA', 'MIR', 'TOK', 'JU', 'BEL', 'QUA', 'RIN', 'ZAP', 'GRU', 'SOL', 'PIX', 'NYX', 'BO', 'KAI', 'DRA', 'FLU', 'MOX'];

function nicknameCandidates(taken: Set<string>, n = 10): string[] {
  const out = new Set<string>();
  for (let guard = 0; out.size < n && guard < 500; guard++) {
    const parts = 2 + (Math.random() < 0.25 ? 1 : 0);
    let name = '';
    for (let i = 0; i < parts; i++) name += SYLLABLES[Math.floor(Math.random() * SYLLABLES.length)];
    if (name.length <= 10 && !taken.has(name)) out.add(name);
  }
  return [...out];
}

async function chooseNickname(ctx: Ctx) {
  const rows = ctx.gs.screen().rows;
  const species = (rows[1] ?? '').slice(4).replace(/[^A-Z0-9♂♀.\- ]/g, '').trim();
  const sp = ctx.rom.speciesByName.get(species);
  const taken = new Set([...ctx.rom.speciesByName.keys(), ...ctx.gs.party().map((p) => p.nickname)]);
  const names = nicknameCandidates(taken);
  const options = Object.fromEntries(names.map((n) => [`name_${n}`, n]));
  const { choice } = await ctx.jev.choose(
    'nickname',
    { pokemon: { species: species || 'the new Pokémon', types: sp?.types ?? [] } },
    'Which of these made-up nicknames suits `pokemon` best?',
    options,
  );
  const name = choice.slice('name_'.length);
  ctx.log('decision', `nickname for ${species}: ${name}`);
  await typeName(ctx, name);
}

let staleWaits = 0;

/** Advances dialog; menus that need a judgment go to Jev, house rules handle the rest. */
export async function dialogStep(ctx: Ctx, purpose = 'menu') {
  const s = ctx.gs.screen();
  if (isNamingScreen(ctx)) {
    if (s.rows.some((r) => /NICKNAME/.test(r))) return chooseNickname(ctx);
    const rival = s.rows.some((r) => /RIVAL/.test(r));
    ctx.log('info', `naming screen → ${rival ? RIVAL_NAME : PLAYER_NAME}`);
    return typeName(ctx, rival ? RIVAL_NAME : PLAYER_NAME);
  }
  if (s.dialog) rememberDialog(ctx, s.dialog);

  // house rule: text speed FAST, battle animations OFF, set once before starting
  if (findLabel(ctx, 'TEXT SPEED') && findLabel(ctx, 'ANIMATION')) {
    if (!optionsSet(ctx)) {
      await ctx.emu.wait(20);
      for (const b of ['LEFT', 'LEFT', 'DOWN', 'RIGHT'] as const) await tap(ctx, b, 10);
      ctx.log('info', `options → ${optionsSet(ctx) ? 'text FAST, animations OFF' : `not set yet (wOptions ${ctx.gs.u8('wOptions').toString(16)})`}`);
    }
    if (optionsSet(ctx)) await tap(ctx, 'B', 40);
    return;
  }
  if (findLabel(ctx, 'NEW GAME') && findLabel(ctx, 'OPTION')) {
    if (!optionsSet(ctx)) { if (await cursorTo(ctx, 'OPTION')) await tap(ctx, 'A', 40); }
    else await select(ctx, 'NEW GAME');
    return;
  }

  if (s.cursor && !s.waitingForA) {
    // an old menu can stay drawn while new text prints: only answer once the game is really in its menu loop
    if (!(await menuActive(ctx)) && staleWaits++ < 40) { await ctx.emu.wait(6); return; }
    staleWaits = 0;
    // the start menu is never opened on purpose in this stage: close it
    if (findLabel(ctx, 'EXIT') && (findLabel(ctx, 'POKéDEX') || (findLabel(ctx, 'SAVE') && findLabel(ctx, 'OPTION')))) { await tap(ctx, 'B', 10); return; }
    // house rule: the player and rival get fixed names
    if (findLabel(ctx, 'NEW NAME')) { await select(ctx, 'NEW NAME'); return; }
    if (await decideMenu(ctx, purpose)) return;
  }
  await advanceText(ctx);
}

/** Press A, then let text print until a prompt or menu shows or the box closes. */
export async function advanceText(ctx: Ctx, maxFrames = 150) {
  await tap(ctx, 'A', 4);
  for (let i = 0; i < maxFrames; i++) {
    const s = ctx.gs.screen();
    if (s.waitingForA || s.cursor || !s.hasTextBox) return;
    await ctx.emu.frame();
  }
}
