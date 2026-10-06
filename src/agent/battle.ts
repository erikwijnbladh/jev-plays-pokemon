import type { EntryType } from '@typesafe-ai/sdk';
import type { Ctx } from './ctx.js';
import { tap, remember, rememberDialog, basics, effectivenessWord, hpWord, levelGap, monLine } from './ctx.js';
import { findLabel, select, cursorTo, cursorToExact, cursorToIndex, confirm, decideMenu, isPartyMenu, waitStable } from './menus.js';
import { advanceText, isNamingScreen, dialogStep } from './dialog.js';
import { PHYSICAL_TYPES } from '../game/rom.js';
import type { Battler, Move } from '../game/ram.js';

const HEALS: Record<string, number> = { POTION: 20, 'SUPER POTION': 50, 'HYPER POTION': 200, 'MAX POTION': 999, 'FULL RESTORE': 999, 'FRESH WATER': 50, 'SODA POP': 60, LEMONADE: 80 };
const CURES: Record<string, string[]> = { ANTIDOTE: ['POISONED'], 'BURN HEAL': ['BURNED'], 'ICE HEAL': ['FROZEN'], AWAKENING: ['ASLEEP'], 'PARLYZ HEAL': ['PARALYZED'], 'FULL HEAL': ['POISONED', 'BURNED', 'FROZEN', 'ASLEEP', 'PARALYZED'] };

/** Gen 1 damage range (no crits). Information only: it becomes a word before Jev sees it. */
function damageRange(level: number, power: number, atk: number, def: number, stab: boolean, eff: number): [number, number] {
  if (!power || !eff) return [0, 0];
  const base = Math.floor(Math.floor((Math.floor((2 * level) / 5 + 2) * power * atk) / Math.max(1, def)) / 50) + 2;
  const hi = Math.floor(base * (stab ? 1.5 : 1) * eff);
  return [Math.floor((hi * 217) / 255), hi];
}

/** Fixed-damage moves ignore the formula. */
function fixedDamage(move: string, myLevel: number, enemyHp: number): number | undefined {
  switch (move) {
    case 'SONIC BOOM': return 20;
    case 'DRAGON RAGE': return 40;
    case 'SEISMIC TOSS': case 'NIGHT SHADE': return myLevel;
    case 'SUPER FANG': return Math.floor(enemyHp / 2);
  }
  return undefined;
}

function damageWord(lo: number, hi: number, hp: number): string {
  if (hi <= 0) return 'no damage';
  if (lo >= hp) return 'certainly knocks it out';
  if (hi >= hp) return 'likely knocks it out';
  if (hi >= hp * 0.5) return 'takes about half or more of its remaining HP';
  if (hi >= hp * 0.2) return 'moderate damage';
  return 'small damage';
}

/** Rough Gen 1 capture probability for one ball. */
function catchChance(ball: string, e: Battler): number {
  if (/MASTER/.test(ball)) return 1;
  const range = /GREAT/.test(ball) ? 201 : /ULTRA|SAFARI/.test(ball) ? 151 : 256;
  const s = e.status === 'ASLEEP' || e.status === 'FROZEN' ? 25 : e.status === 'OK' ? 0 : 12;
  const f = Math.min(255, Math.floor(Math.floor((e.maxHp * 255) / (/GREAT/.test(ball) ? 8 : 12)) / Math.max(1, Math.floor(e.hp / 4))));
  const pStatus = s / range;
  const pRate = Math.max(0, Math.min(e.catchRate + 1, range - s) / range);
  return Math.min(1, pStatus + pRate * ((f + 1) / 256));
}

function catchWord(p: number): string {
  return p >= 0.75 ? 'very likely to catch it' : p >= 0.4 ? 'decent chance to catch it' : p >= 0.15 ? 'low chance to catch it' : 'very low chance to catch it';
}

function speedWord(mine: number, theirs: number): string {
  return mine > theirs * 1.1 ? 'faster than the enemy (moves first)' : mine < theirs * 0.9 ? 'slower than the enemy (moves second)' : 'about as fast as the enemy';
}

const STATS = ['attack', 'defense', 'speed', 'special', 'accuracy', 'evasion'];

/** What a non-damaging move does, and whether it can still do anything (stat stages cap at ±6). */
function statusMoveFacts(ctx: Ctx, effect: number, enemyStatus: string): string[] {
  // stat mods are stored 1..13 (7 = unchanged), in the order of STATS
  const stage = (who: 'wEnemyMonStatMods' | 'wPlayerMonStatMods', i: number) => ctx.gs.u8(who, i) - 7;
  const amount = (n: number) => (n === 0 ? 'unchanged so far' : Math.abs(n) <= 2 ? `changed a little so far (${n > 0 ? '+' : ''}${n})` : `changed a lot so far (${n > 0 ? '+' : ''}${n})`);
  const down = effect >= 0x12 && effect <= 0x17 ? effect - 0x12 : effect >= 0x3a && effect <= 0x3f ? effect - 0x3a : -1;
  const up = effect >= 0x0a && effect <= 0x0f ? effect - 0x0a : effect >= 0x32 && effect <= 0x37 ? effect - 0x32 : -1;
  if (down >= 0) {
    const n = stage('wEnemyMonStatMods', down);
    return [`lowers the enemy's ${STATS[down]}`, n <= -6 ? "the enemy's " + STATS[down] + ' is already as low as it can go: no effect' : `enemy's ${STATS[down]} is ${amount(n)}`];
  }
  if (up >= 0) {
    const n = stage('wPlayerMonStatMods', up);
    return [`raises your ${STATS[up]}`, n >= 6 ? `your ${STATS[up]} is already as high as it can go: no effect` : `your ${STATS[up]} is ${amount(n)}`];
  }
  const inflicts: Record<number, string> = { 0x20: 'ASLEEP', 0x42: 'POISONED', 0x43: 'PARALYZED' };
  if (inflicts[effect]) {
    const word = { ASLEEP: 'puts the enemy to sleep', POISONED: 'poisons the enemy', PARALYZED: 'paralyzes the enemy' }[inflicts[effect]];
    return [word!, enemyStatus === 'OK' ? 'the enemy has no status problem yet' : `the enemy is already ${enemyStatus}: no effect`];
  }
  return ['status move, does no damage'];
}

interface Option { criteria: EntryType; run: () => Promise<void> }

async function useMove(ctx: Ctx, name: string) {
  if (!(await select(ctx, 'FIGHT'))) return;
  for (let i = 0; i < 60 && !ctx.gs.screen().rows.some((r) => r.includes('TYPE/')); i++) await ctx.emu.frame();
  await waitStable(ctx);
  if (await cursorToExact(ctx, name)) await confirm(ctx);
  else { ctx.log('warn', `move ${name} not found in the move list`); await tap(ctx, 'B', 12); }
}

async function openBagAt(ctx: Ctx, item: string): Promise<boolean> {
  if (!(await select(ctx, 'ITEM'))) return false;
  for (let i = 0; i < 90 && !/CANCEL|×/.test(ctx.gs.screen().rows.join(' ')); i++) await ctx.emu.frame();
  if (!(await cursorTo(ctx, item, 80))) { await tap(ctx, 'B', 20); return false; }
  await confirm(ctx);
  return true;
}

async function pickPartySlot(ctx: Ctx, slot: number) {
  for (let i = 0; i < 150 && !isPartyMenu(ctx); i++) await ctx.emu.frame();
  await waitStable(ctx);
  await cursorToIndex(ctx, slot);
  await confirm(ctx);
}

async function decideTurn(ctx: Ctx) {
  const { gs, rom } = ctx;
  const b = gs.battle();
  const me = b.player, foe = b.enemy;
  const party = gs.party();
  const focus = ctx.mem.focus?.value;
  const balls = gs.bag().filter((i) => /BALL$/.test(i.name));
  const catching = b.kind === 'wild' && focus === 'catch' && balls.length > 0;
  const options: Record<string, Option> = {};

  const cantAct = me.status === 'FROZEN' ? 'Your Pokémon is frozen and cannot move this turn.' : me.status === 'ASLEEP' ? 'Your Pokémon is asleep and cannot move until it wakes up.' : undefined;
  me.moves.forEach((mv: Move) => {
    const key = `use_${mv.name}`;
    if (mv.pp === 0) return; // unusable
    const eff = rom.effectiveness(mv.type, foe.types);
    const facts: string[] = [`${mv.type} move`];
    if (mv.power > 0 || fixedDamage(mv.name, me.level, foe.hp) !== undefined) {
      const fixed = fixedDamage(mv.name, me.level, foe.hp);
      const phys = PHYSICAL_TYPES.has(mv.type);
      const [lo, hi] = fixed !== undefined
        ? (eff === 0 ? [0, 0] : [fixed, fixed])
        : damageRange(me.level, mv.power, phys ? me.stats.atk : me.stats.spc, phys ? foe.stats.def : foe.stats.spc, me.types.includes(mv.type), eff);
      facts.push(effectivenessWord(eff) + ` against ${foe.types.join('/')}`);
      const dmg = damageWord(lo, hi, foe.hp);
      facts.push(catching && /knocks it out/.test(dmg) ? `${dmg}, and a knocked-out Pokémon can't be caught` : dmg);
      if (mv.accuracy < 90) facts.push(mv.accuracy < 70 ? 'often misses' : 'sometimes misses');
    } else facts.push(...statusMoveFacts(ctx, rom.movesByName.get(mv.name)?.effect ?? 0, foe.status));
    if (mv.pp <= 3) facts.push(`only ${mv.pp} PP left`);
    if (cantAct) facts.push(cantAct);
    options[key] = { criteria: { action: `Use ${mv.name}`, facts }, run: () => useMove(ctx, mv.name) };
  });

  for (const p of party) {
    if (p.slot === me.slot || p.hp === 0) continue;
    const attacks = p.moves.filter((m) => m.power > 0);
    const best = attacks.length ? Math.max(...attacks.map((m) => rom.effectiveness(m.type, foe.types))) : -1;
    const threat = Math.max(...foe.types.map((t) => rom.effectiveness(t, p.types)));
    options[`switch_${p.nickname}`] = {
      criteria: {
        action: `Switch to ${monLine(p)}`,
        facts: [
          best < 0 ? 'it has no damaging moves' : `its best move is ${effectivenessWord(best)} against the enemy`,
          `the enemy's ${foe.types.join('/')} type is ${effectivenessWord(threat)} against it`,
          `${levelGap(p.level, foe.level)} than the enemy`,
          'switching uses this turn',
        ],
      },
      run: async () => {
        if (!(await select(ctx, 'PKMN'))) return;
        await pickPartySlot(ctx, p.slot);
        if (!(await select(ctx, 'SWITCH'))) await tap(ctx, 'B', 20);
      },
    };
  }

  for (const it of gs.bag()) {
    const heal = HEALS[it.name];
    if (heal && me.hp < me.maxHp) {
      const amount = heal >= me.maxHp - me.hp ? 'back to full HP' : heal >= (me.maxHp - me.hp) / 2 ? 'a good part of its missing HP' : 'a little HP';
      options[`item_${it.name}`] = {
        criteria: { action: `Use ${it.name} on your active Pokémon`, facts: [`heals ${amount}`, `your Pokémon has ${hpWord(me.hp, me.maxHp)}`, `${it.qty} left`, 'uses this turn'] },
        run: async () => { if (await openBagAt(ctx, it.name)) await pickPartySlot(ctx, me.slot); },
      };
    }
    if (CURES[it.name]?.includes(me.status)) {
      options[`item_${it.name}`] = {
        criteria: { action: `Use ${it.name}`, facts: [`cures your Pokémon's ${me.status.toLowerCase()} status`, `${it.qty} left`, 'uses this turn'] },
        run: async () => { if (await openBagAt(ctx, it.name)) await pickPartySlot(ctx, me.slot); },
      };
    }
    if (/BALL$/.test(it.name) && b.kind === 'wild') {
      const owned = ctx.gs.ownsDex(rom.species.get(foe.speciesId)?.dex ?? 0);
      const teamTypes = new Set(party.flatMap((p) => p.types));
      options[`throw_${it.name}`] = {
        criteria: {
          action: `Throw a ${it.name} at the wild ${foe.species}`,
          facts: [
            catchWord(catchChance(it.name, foe)),
            owned ? 'you already own this species' : "a species you don't own yet",
            foe.types.some((t) => !teamTypes.has(t)) ? `adds a type your team doesn't have (${foe.types.join('/')})` : 'your team already has its type',
            party.length >= 6 ? 'your team is full: a caught Pokémon goes to the PC box' : `your team has ${party.length} of 6 Pokémon`,
            `${it.qty} left`,
          ],
        },
        run: () => openBagAt(ctx, it.name).then(() => undefined),
      };
    }
  }

  if (b.kind === 'wild') {
    options.run = {
      criteria: { action: 'Run away', facts: [me.stats.spd >= foe.stats.spd ? 'escape is certain (you are faster)' : 'escape may fail (you are slower)', 'no experience gained'] },
      run: async () => { await select(ctx, 'RUN'); },
    };
  }

  // stuck with nothing usable (all PP gone): the game falls back to STRUGGLE through FIGHT
  if (!Object.keys(options).length) {
    options.struggle = { criteria: { action: 'Fight (no PP left: STRUGGLE)' }, run: async () => { await select(ctx, 'FIGHT'); await confirm(ctx); } };
  }

  const state = {
    ...basics(ctx),
    battle: {
      kind: b.kind === 'wild' ? 'wild Pokémon' : `trainer battle (${b.enemyPartyCount} Pokémon in the trainer's team)`,
      enemy: { species: foe.species, level: foe.level, types: foe.types, health: hpWord(foe.hp, foe.maxHp), status: foe.status },
      yourActive: { ...{ species: me.species, level: me.level, types: me.types, health: hpWord(me.hp, me.maxHp), status: me.status }, speed: speedWord(me.stats.spd, foe.stats.spd), levelVsEnemy: levelGap(me.level, foe.level) },
      bench: party.filter((p) => p.slot !== me.slot).map(monLine),
    },
    playerGoal: catching ? `Catch this wild ${foe.species}.` : b.kind === 'wild' && focus === 'train' ? 'Gain experience by defeating wild Pokémon.' : 'Win this battle.',
  };
  const keys = Object.keys(options);
  const criteria = Object.fromEntries(keys.map((k) => [k, options[k].criteria]));
  const res = await ctx.jev.choose('battle', state, 'You are in a Pokémon Red battle. Which action best serves `playerGoal` this turn?', criteria);
  const what = (options[res.choice].criteria as { action: string }).action;
  remember(ctx.mem.actions, `battle vs ${foe.species}: ${what}`, 12);
  ctx.log('decision', `battle vs ${foe.species} Lv${foe.level}: ${what}`, { confidence: res.confidence });
  await options[res.choice].run();
}

/** Facts for in-battle menus other than the main one: who to send out, which move to forget. */
function battleMenuContext(ctx: Ctx) {
  const party = ctx.gs.party();
  const recent = ctx.mem.dialog.slice(-3).join(' ');
  const learning = recent.match(/trying to learn ([A-Z0-9 -]+?)!?(?: |$)/)?.[1]?.trim();
  const newMove = learning ? ctx.rom.movesByName.get(learning) : undefined;
  const sendingOut = /Bring out which|Choose a POK/.test(recent) || ctx.gs.party().some((p) => p.hp === 0);
  const inBattle = ctx.gs.inBattle ? ctx.gs.battle() : undefined;
  return {
    facts: (label: string) => {
      const p = party.find((pp) => label.startsWith(pp.nickname));
      if (p) {
        const vs = inBattle ? `; the enemy ${inBattle.enemy.species}'s ${inBattle.enemy.types.join('/')} type is ${effectivenessWord(Math.max(...inBattle.enemy.types.map((t) => ctx.rom.effectiveness(t, p.types))))} against it` : '';
        return `${monLine(p)}${vs}`;
      }
      const mv = ctx.rom.movesByName.get(label.trim());
      if (mv) return `${mv.type} move, ${mv.power ? `power ${mv.power}` : 'no damage (status move)'}, accuracy ${mv.accuracy}%`;
      return '';
    },
    exclude: (label: string) => sendingOut && !!party.find((p) => label.startsWith(p.nickname) && p.hp === 0),
    state: newMove ? { moveBeingLearned: `${newMove.name}: ${newMove.type} move, ${newMove.power ? `power ${newMove.power}` : 'no damage (status move)'}, accuracy ${newMove.accuracy}%` } : {},
  };
}

export async function battleStep(ctx: Ctx) {
  const s = ctx.gs.screen();
  if (isNamingScreen(ctx)) return dialogStep(ctx); // nickname after a catch
  if (s.cursor && findLabel(ctx, 'FIGHT') && findLabel(ctx, 'RUN')) return decideTurn(ctx);
  // the move list re-opened (e.g. "No PP left!"): back out and decide again
  if (s.cursor && s.rows.some((r) => r.includes('TYPE/'))) { await tap(ctx, 'B', 12); return; }
  if (s.dialog) rememberDialog(ctx, s.dialog);
  if (s.cursor && !s.waitingForA && (await decideMenu(ctx, 'battle-menu', battleMenuContext(ctx)))) return;
  await advanceText(ctx, 90);
}
