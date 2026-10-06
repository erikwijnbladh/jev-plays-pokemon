import type { Emulator, Button } from '../emu/emulator.js';
import type { Rom } from '../game/rom.js';
import type { GameState, Mon } from '../game/ram.js';
import type { WorldGraph } from '../game/world.js';
import type { Jev } from '../jev/client.js';
import { currentMilestone } from '../knowledge/milestones.js';
import { prettyMap } from '../game/data.js';

/** What the agent remembers between decisions. Saved next to every save state. */
export interface Memory {
  visited: string[];
  /** "MAP:target" -> times interacted */
  talked: Record<string, number>;
  /** "MAP:target" -> what that person/sign said last time */
  said: Record<string, string>;
  /** recent dialog lines */
  dialog: string[];
  /** recent decisions, human readable */
  actions: string[];
  /** what the overworld is working toward right now, and the situation it was chosen in */
  focus: { value: string; key: string; age: number } | null;
  /** "MAP:option" -> times chosen since the last progress */
  tried: Record<string, number>;
  /** the interaction whose dialog is being recorded */
  talkingTo: string | null;
  /** whole-team losses per place */
  losses: Record<string, number>;
  /** totals across sessions (saved with the game): Jev calls, input tokens, summed latency, agent steps */
  stats: { calls: number; inputTokens: number; latencyMs: number; steps: number };
}

export function newMemory(): Memory {
  return { visited: [], talked: {}, said: {}, dialog: [], actions: [], focus: null, tried: {}, talkingTo: null, losses: {}, stats: { calls: 0, inputTokens: 0, latencyMs: 0, steps: 0 } };
}

export interface Ctx {
  emu: Emulator;
  rom: Rom;
  gs: GameState;
  jev: Jev;
  world: WorldGraph;
  mem: Memory;
  log: (kind: string, msg: string, data?: unknown) => void;
}

/** Tap a button and let the game react. */
export async function tap(ctx: Ctx, b: Button, settle = 10) {
  await ctx.emu.press(b, 6, settle);
}

export function remember(list: string[], v: string, max: number) {
  if (list[list.length - 1] === v) return;
  list.push(v);
  while (list.length > max) list.shift();
}

/** Record dialog as whole lines: strip prompts and merge text that is still being typed out or scrolled. */
export function rememberDialog(ctx: Ctx, raw: string) {
  const line = raw.replace(/[▼▶▷]/g, '').replace(/\s+/g, ' ').trim();
  if (!line) return;
  const d = ctx.mem.dialog;
  const last = d[d.length - 1];
  if (last && (last.endsWith(line) || last.startsWith(line))) return;
  if (last && line.startsWith(last)) d[d.length - 1] = line;
  else {
    // the box scrolled: the new text starts with the end of the previous line
    const words = last?.split(' ') ?? [];
    let merged = false;
    for (let k = Math.min(words.length, 6); k >= 2 && !merged; k--) {
      const tail = words.slice(-k).join(' ');
      if (line.startsWith(tail)) { d[d.length - 1] = `${last} ${line.slice(tail.length).trim()}`.trim(); merged = true; }
    }
    if (!merged) d.push(line);
  }
  while (d.length > 12) d.shift();
  // attribute what was said to whoever we're talking to
  const who = ctx.mem.talkingTo;
  if (who) ctx.mem.said[who] = d[d.length - 1].slice(-300);
}

export function visitedSet(ctx: Ctx) {
  return new Set(ctx.mem.visited);
}

export function objective(ctx: Ctx) {
  return currentMilestone(ctx.gs, visitedSet(ctx));
}

// ---- numbers into words: Jev reads semantic labels better than raw numbers (docs: "Math and Numbers") ----

export function effectivenessWord(mult: number): string {
  if (mult === 0) return 'has no effect';
  if (mult >= 4) return 'super effective (x4)';
  if (mult >= 2) return 'super effective';
  if (mult <= 0.25) return 'barely effective (x1/4)';
  if (mult < 1) return 'not very effective';
  return 'normal effectiveness';
}

export function hpWord(hp: number, max: number): string {
  if (hp <= 0) return 'fainted';
  const f = hp / Math.max(1, max);
  return f >= 1 ? 'full HP' : f > 0.7 ? 'most of its HP' : f > 0.4 ? 'about half HP' : f > 0.15 ? 'low HP' : 'very low HP';
}

export function levelGap(mine: number, theirs: number): string {
  const d = mine - theirs;
  if (d >= 8) return 'much higher level';
  if (d >= 3) return 'higher level';
  if (d > -3) return 'similar level';
  if (d > -8) return 'lower level';
  return 'much lower level';
}

export function monLine(p: Mon): string {
  const status = p.status === 'OK' ? '' : `, ${p.status}`;
  return `${p.nickname} (${p.species}, ${p.types.join('/')}, Lv${p.level}, ${hpWord(p.hp, p.maxHp)}${status})`;
}

/** Short shared facts: where we are and what we're trying to do. Each decision adds only what it needs. */
export function basics(ctx: Ctx) {
  const { m } = objective(ctx);
  return {
    location: prettyMap(ctx.gs.mapName),
    objective: m ? m.goal : 'The game is complete.',
    badges: ctx.gs.badgeCount,
  };
}

export function teamSummary(ctx: Ctx) {
  const party = ctx.gs.party();
  const { m } = objective(ctx);
  return {
    team: party.map(monLine),
    readiness: m?.level && party.length
      ? `Strongest team member Lv${Math.max(...party.map((p) => p.level))}; the objective's opponents are around Lv${m.level}.`
      : undefined,
  };
}
