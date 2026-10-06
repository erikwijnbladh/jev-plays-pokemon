import fs from 'node:fs';
import crypto from 'node:crypto';
import { TypeSafeClient, AuthenticationError, choice, type EntryType, type Questions, type ChoiceResponse, type SystemOneResult } from '@typesafe-ai/sdk';
import { MockJev } from './mock.js';

export type Backend = { name: string; systemOne(req: { state: EntryType; questions: Questions }): Promise<SystemOneResult<Questions>> };

/** State for a decision: any JSON-like value. `undefined` fields are dropped before sending. */
export type StateInput = EntryType | Record<string, unknown>;

export interface CallRecord {
  n: number; at: number; purpose: string; model: string; latencyMs: number; cached: boolean;
  state: StateInput; questions: Questions; answers: SystemOneResult<Questions>['answers']; inputTokens: number;
}

/** What the overlay shows for a decision. Never sent to Jev. */
export interface Display<K extends string = string> {
  kind: 'battle' | 'menu' | 'overworld' | 'focus' | 'nickname';
  /** the question, e.g. "What should BLOOPA do?" */
  title: string;
  subtitle?: string;
  /** short label + one-line summary per option (falls back to the option key) */
  labels?: Partial<Record<K, { label: string; sub?: string }>>;
  /** log line prefix, e.g. "BLOOPA → " */
  logPrefix?: string;
}

export interface DecisionEvent {
  display: Display;
  keys: string[];
  /** set once Jev answered */
  probabilities?: Record<string, number>;
  choice?: string;
  model?: string;
  latencyMs?: number;
  inputTokens?: number;
  cached?: boolean;
}

/** Jev 1.13 input price, USD per million tokens (output is free). */
export const USD_PER_MTOK = 0.042;

/**
 * Throttled, cached, logged access to Jev.
 * - Choice options are shuffled on every call: Jev can lean toward the first option (docs: "Choice option order").
 * - Identical (state, questions) pairs are answered from a small cache.
 * - Every call is appended to logs/jev-calls.jsonl with its state, questions and full answer distribution.
 */
export class Jev {
  readonly backend: Backend;
  calls = 0;
  cacheHits = 0;
  inputTokens = 0;
  latencyMs: number[] = [];
  onCall?: (r: CallRecord) => void;
  /** a Choice with a Display started (no answer yet), and when it was answered */
  onDecisionStart?: (e: DecisionEvent) => void;
  onDecision?: (e: DecisionEvent) => void;
  /** the harness executed a different option than Jev's top pick (loop breaking) */
  onOverride?: (key: string) => void;
  private last = 0;
  private window: number[] = [];
  private cache = new Map<string, SystemOneResult<Questions>>();
  private log: fs.WriteStream;
  private minIntervalMs = +(process.env.JEV_MIN_INTERVAL_MS ?? 250);
  private maxPerMinute = +(process.env.JEV_MAX_PER_MIN ?? 90);

  constructor(mode = process.env.JEV_MODE ?? 'mock') {
    if (mode === 'typesafe') {
      const client = new TypeSafeClient({ timeout: 15_000 });
      this.backend = { name: 'typesafe', systemOne: (req) => client.systemOne(req) };
    } else if (mode === 'mock') {
      this.backend = new MockJev();
    } else throw new Error(`JEV_MODE must be "typesafe" or "mock", got "${mode}"`);
    fs.mkdirSync('logs', { recursive: true });
    this.log = fs.createWriteStream('logs/jev-calls.jsonl', { flags: 'a' });
  }

  get costUsd() {
    return (this.inputTokens / 1e6) * USD_PER_MTOK;
  }

  /** Ask any set of questions about one state. Questions run in parallel on Jev's side and can't see each other. */
  async ask<Q extends Questions>(purpose: string, state: StateInput, questions: Q): Promise<SystemOneResult<Q>> {
    const cacheKey = crypto.createHash('sha1').update(JSON.stringify([state, questions])).digest('hex');
    const t0 = Date.now();
    let res = this.cache.get(cacheKey);
    const cached = !!res;
    if (!res) {
      await this.throttle();
      res = await this.callWithRetry({ state: jsonSafe(state) as EntryType, questions: jsonSafe(questions) as Questions });
      this.calls++;
      this.inputTokens += res.usage.input_tokens;
      this.latencyMs.push(Date.now() - t0);
      if (this.latencyMs.length > 500) this.latencyMs.shift();
      this.cache.set(cacheKey, res);
      if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!);
    } else this.cacheHits++;
    const rec: CallRecord = {
      n: this.calls, at: Date.now(), purpose, model: res.model, latencyMs: Date.now() - t0, cached,
      state, questions, answers: res.answers, inputTokens: cached ? 0 : res.usage.input_tokens,
    };
    this.log.write(JSON.stringify(rec) + '\n');
    this.onCall?.(rec);
    return res as SystemOneResult<Q>;
  }

  /**
   * One Choice between options keyed by label. Options are shuffled before sending.
   * Returns Jev's pick and the full distribution (callers use it for loop breaking).
   */
  async choose<K extends string>(
    purpose: string, state: StateInput, instructions: EntryType, options: Partial<Record<K, EntryType>>, display?: Display<K>,
  ): Promise<{ choice: K; probabilities: Record<K, number>; confidence: number }> {
    const keys = Object.keys(options) as K[];
    if (keys.length === 0) throw new Error(`choose(${purpose}) called with no options`);
    if (keys.length === 1) return { choice: keys[0], probabilities: { [keys[0]]: 1 } as Record<K, number>, confidence: 1 };
    const criteria: Record<string, EntryType> = {};
    for (const k of shuffle(keys)) criteria[k] = options[k] ?? null;
    const event: DecisionEvent | undefined = display && { display: display as Display, keys };
    if (event) this.onDecisionStart?.(event);
    const t0 = Date.now();
    let call: CallRecord | undefined;
    const prev = this.onCall;
    this.onCall = (r) => { call = r; prev?.(r); };
    let res;
    try { res = await this.ask(purpose, state, { decision: choice(instructions, criteria) }); }
    finally { this.onCall = prev; }
    const a = res.answers.decision as ChoiceResponse;
    if (event) {
      Object.assign(event, { probabilities: a.probabilities, choice: a.choice, model: res.model, latencyMs: Date.now() - t0, inputTokens: call?.inputTokens ?? 0, cached: call?.cached });
      this.onDecision?.(event);
    }
    return { choice: a.choice as K, probabilities: a.probabilities as Record<K, number>, confidence: a.confidence };
  }

  /** Report that the harness executed `key` instead of Jev's top pick. */
  override(key: string) {
    this.onOverride?.(key);
  }

  private async callWithRetry(req: { state: EntryType; questions: Questions }) {
    // the SDK already retries 429/5xx and connection errors; this outer loop keeps a long run alive through an outage
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.backend.systemOne(req);
      } catch (e) {
        if (e instanceof AuthenticationError) throw new Error('TypeSafe rejected the API key: check TYPESAFE_API_KEY in .env');
        if (attempt >= 5) throw e;
        const wait = Math.min(60_000, 2000 * 2 ** attempt);
        console.error(`[jev] call failed (${(e as Error).message?.slice(0, 100)}); retrying in ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  private async throttle() {
    for (;;) {
      const now = Date.now();
      this.window = this.window.filter((t) => now - t < 60_000);
      const wait = Math.max(this.last + this.minIntervalMs - now, this.window.length >= this.maxPerMinute ? this.window[0] + 60_000 - now : 0);
      if (wait <= 0) break;
      await new Promise((r) => setTimeout(r, wait));
    }
    this.last = Date.now();
    this.window.push(this.last);
  }
}

/** Draw a key from a distribution, mixed with uniform so a near-certain answer can still be escaped. */
export function sample<K extends string>(p: Record<K, number>, uniformMix = 0.3, exclude: K[] = []): K {
  const keys = (Object.keys(p) as K[]).filter((k) => !exclude.includes(k));
  if (!keys.length) return Object.keys(p)[0] as K;
  const w = keys.map((k) => (1 - uniformMix) * (p[k] ?? 0) + uniformMix / keys.length);
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < keys.length; i++) if ((r -= w[i]) <= 0) return keys[i];
  return keys[keys.length - 1];
}

function shuffle<T>(a: T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Strict JSON: drops undefined fields, turns NaN/Infinity into null. */
function jsonSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
