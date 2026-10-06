// The overlay's live state, shared by the harness (producer) and the web app (consumer).

export type DecisionKind = 'battle' | 'menu' | 'overworld' | 'focus' | 'nickname';

export interface OverlayOption {
  key: string;
  label: string;
  sub?: string;
  /** Jev's probability, once it answered */
  p?: number;
}

export interface OverlayDecision {
  /** running count of Jev decisions */
  n: number;
  kind: DecisionKind;
  title: string;
  subtitle?: string;
  status: 'deciding' | 'decided';
  /** top options by probability (input order while deciding) */
  options: OverlayOption[];
  /** options not shown */
  more: number;
  /** the option that was executed */
  picked?: string;
  /** the harness executed something other than Jev's top pick (loop breaking) */
  overridden?: boolean;
  model?: string;
  latencyMs?: number;
  inputTokens?: number;
}

export interface OverlayLogEntry {
  kind: DecisionKind;
  text: string;
  /** probability Jev gave the executed option */
  p?: number;
  overridden?: boolean;
}

export interface OverlayMon {
  nickname: string;
  species: string;
  level: number;
  hp: number;
  maxHp: number;
  /** ACTIVE, READY, FNT, PSN, SLP, BRN, FRZ, PAR */
  chip: string;
  active: boolean;
  /** 256 shade digits ('0' transparent .. '3' darkest), a 16x16 party icon read from the ROM */
  icon: string;
}

export interface OverlaySnapshot {
  running: boolean;
  backend: string;
  goal: { index: number; total: number; title: string; place: string };
  /** the game's own play clock, HH:MM:SS */
  playTime: string;
  location: string;
  step: number;
  speed: number;
  decision: OverlayDecision | null;
  totals: { costUsd: number; inputTokens: number; calls: number; perCall: number; avgLatencyMs: number };
  log: OverlayLogEntry[];
  party: OverlayMon[];
  badges: { count: number; owned: boolean[]; next: string | null };
}
