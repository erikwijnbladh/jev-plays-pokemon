import type { Ctx } from '../agent/ctx.js';
import { objective } from '../agent/ctx.js';
import type { DecisionEvent, Jev } from '../jev/client.js';
import { USD_PER_MTOK } from '../jev/client.js';
import { PartyIcons } from '../game/icons.js';
import { prettyMap } from '../game/data.js';
import { MILESTONES, BADGES } from '../knowledge/milestones.js';
import type { OverlayDecision, OverlayLogEntry, OverlaySnapshot } from './types.js';

const SHOWN_OPTIONS = 5;
const LOG_LENGTH = 9;
const CHIPS: Record<string, string> = { POISONED: 'PSN', ASLEEP: 'SLP', BURNED: 'BRN', FROZEN: 'FRZ', PARALYZED: 'PAR' };

const pad = (n: number) => String(n).padStart(2, '0');

/** Collects what the stream overlay shows: the decision in progress, the log, totals, party and badges. */
export class Overlay {
  running = true;
  /** bumped on every change worth pushing right away (decisions) */
  version = 0;
  private decision: OverlayDecision | null = null;
  private event: DecisionEvent | null = null;
  private log: OverlayLogEntry[] = [];
  private icons: PartyIcons;

  constructor(private ctx: Ctx, jev: Jev, private speed: () => number) {
    this.icons = new PartyIcons(ctx.rom);
    jev.onDecisionStart = (e) => this.start(e);
    jev.onDecision = (e) => this.finish(e);
    jev.onOverride = (key) => this.override(key);
  }

  private label(e: DecisionEvent, key: string) {
    return e.display.labels?.[key] ?? { label: key };
  }

  private start(e: DecisionEvent) {
    this.event = e;
    this.decision = {
      n: this.ctx.mem.stats.calls + 1,
      kind: e.display.kind,
      title: e.display.title,
      subtitle: e.display.subtitle,
      status: 'deciding',
      options: e.keys.slice(0, SHOWN_OPTIONS).map((key) => ({ key, ...this.label(e, key) })),
      more: Math.max(0, e.keys.length - SHOWN_OPTIONS),
    };
    this.version++;
  }

  private finish(e: DecisionEvent) {
    const p = e.probabilities ?? {};
    const ranked = [...e.keys].sort((a, b) => (p[b] ?? 0) - (p[a] ?? 0));
    this.decision = {
      ...this.decision!,
      status: 'decided',
      options: ranked.slice(0, SHOWN_OPTIONS).map((key) => ({ key, ...this.label(e, key), p: p[key] })),
      picked: e.choice,
      model: e.model,
      latencyMs: e.latencyMs,
      inputTokens: e.inputTokens,
    };
    this.log.unshift({ kind: e.display.kind, text: `${e.display.logPrefix ?? ''}${this.label(e, e.choice!).label}`, p: p[e.choice!] });
    this.log.length = Math.min(this.log.length, LOG_LENGTH);
    this.version++;
  }

  private override(key: string) {
    const e = this.event;
    if (!e || !this.decision) return;
    const p = e.probabilities?.[key];
    this.decision = { ...this.decision, picked: key, overridden: true };
    // keep the executed option visible even when it isn't in the top five
    if (!this.decision.options.some((o) => o.key === key)) {
      this.decision.options = [...this.decision.options.slice(0, SHOWN_OPTIONS - 1), { key, ...this.label(e, key), p }];
    }
    this.log[0] = { kind: e.display.kind, text: `${e.display.logPrefix ?? ''}${this.label(e, key).label} · loop break`, p, overridden: true };
    this.version++;
  }

  snapshot(): OverlaySnapshot {
    const { gs, mem } = this.ctx;
    const { index, m } = objective(this.ctx);
    const inBattle = gs.inBattle !== 0;
    const activeSlot = inBattle ? gs.u8('wPlayerMonNumber') : -1;
    const firstMissing = BADGES.findIndex((_, i) => !(gs.badges & (1 << i)));
    const s = mem.stats;
    return {
      running: this.running,
      backend: this.ctx.jev.backend.name,
      goal: { index: Math.min(index + 1, MILESTONES.length), total: MILESTONES.length, title: m?.title ?? 'Hall of Fame', place: m?.place ?? 'Game complete' },
      playTime: `${pad(gs.u8('wPlayTimeHours'))}:${pad(gs.u8('wPlayTimeMinutes'))}:${pad(gs.u8('wPlayTimeSeconds'))}`,
      location: prettyMap(gs.mapName),
      step: s.steps,
      speed: this.speed(),
      decision: this.decision,
      totals: {
        costUsd: (s.inputTokens / 1e6) * USD_PER_MTOK,
        inputTokens: s.inputTokens,
        calls: s.calls,
        perCall: s.calls ? Math.round(s.inputTokens / s.calls) : 0,
        avgLatencyMs: s.calls ? Math.round(s.latencyMs / s.calls) : 0,
      },
      log: this.log,
      party: gs.party().map((p) => ({
        nickname: p.nickname,
        species: p.species.charAt(0) + p.species.slice(1).toLowerCase(),
        level: p.level,
        hp: p.hp,
        maxHp: p.maxHp,
        chip: p.hp === 0 ? 'FNT' : p.slot === activeSlot ? 'ACTIVE' : CHIPS[p.status] ?? 'READY',
        active: p.slot === activeSlot,
        icon: this.icons.forSpecies(p.speciesId).join(''),
      })),
      badges: {
        count: gs.badgeCount,
        owned: BADGES.map((_, i) => !!(gs.badges & (1 << i))),
        next: firstMissing < 0 ? null : `Next: ${BADGES[firstMissing].name} · ${BADGES[firstMissing].leader}, ${BADGES[firstMissing].where}`,
      },
    };
  }
}
