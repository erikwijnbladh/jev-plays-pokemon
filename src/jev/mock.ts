import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

/**
 * Free development stand-in for Jev with the same request/response shape. It has no game sense: it scores
 * choice options by a few cue words in the descriptions the harness writes, plus noise. Use it to exercise
 * the harness mechanics without spending tokens; use JEV_MODE=typesafe for real play.
 */
const CUES: [RegExp, number][] = [
  [/toward the objective|objective is here/i, 3],
  [/super effective/i, 2],
  [/likely knocks it out/i, 1.5],
  [/not visited yet|haven't talked/i, 1],
  [/matches the current focus/i, 1.5],
  [/no effect/i, -5],
  [/not very effective/i, -1.5],
  [/away from the objective/i, -1.5],
  [/unusable|0 PP/i, -6],
  [/tried \d+ time/i, -1],
];

const text = (v: EntryType | undefined) => (typeof v === 'string' ? v : JSON.stringify(v ?? ''));

export class MockJev {
  name = 'mock';

  async systemOne(req: { state: EntryType; questions: Questions }): Promise<SystemOneResult<Questions>> {
    const answers: Record<string, unknown> = {};
    let tokens = Math.ceil(text(req.state).length / 4);
    for (const [id, q] of Object.entries(req.questions)) {
      tokens += Math.ceil((text(q.instructions) + text(q.criteria as EntryType)).length / 4);
      if (q.type === 'choice') {
        const keys = Object.keys(q.criteria);
        const logits = keys.map((k) => CUES.reduce((s, [re, w]) => s + (re.test(`${k} ${text(q.criteria[k])}`) ? w : 0), Math.random()));
        const mx = Math.max(...logits);
        const ex = logits.map((l) => Math.exp((l - mx) / 0.6));
        const sum = ex.reduce((a, b) => a + b, 0);
        const probabilities = Object.fromEntries(keys.map((k, i) => [k, ex[i] / sum]));
        const best = keys[ex.indexOf(Math.max(...ex))];
        answers[id] = { type: 'choice', choice: best, probabilities, confidence: probabilities[best] };
      } else if (q.type === 'noul') {
        answers[id] = { type: 'noul', noul: 0.4 + Math.random() * 0.2 };
      } else {
        const n = q.criteria.length;
        const probabilities = Object.fromEntries(q.criteria.map((_, i) => [String(i), 1 / n]));
        answers[id] = { type: 'score', score: (n - 1) / 2, confidence: 0, legend: {}, probabilities };
      }
    }
    return { model: 'mock', answers, usage: { input_tokens: tokens, output_tokens: 0 } } as SystemOneResult<Questions>;
  }
}
