# Jev Plays Pokémon Red

A harness where [Jev](https://docs.typesafe.ai/models), TypeSafe's System One model, plays Pokémon Red. The harness reads the game's memory, lists the legal options with facts about each, and Jev picks one. Inspired by [christianmat/jev-pokemon](https://github.com/christianmat/jev-pokemon).

> You need your own legally obtained copy of Pokémon Red. No ROM is included or downloaded.

## How it works

```
 Game Boy emulator ──► read RAM ──► game state (map, party, battle, on-screen text)
        ▲                                     │
        │ button presses                      ▼
  harness mechanics ◄── Jev picks one ◄── options + facts computed in code
  (A* pathfinding, menus)                (type matchups, damage as words, "leads toward the objective")
```

**Jev decides:** what to focus on (progress, heal, train, catch, explore), where to go and who to talk to, every battle action, every menu answer (starter, YES/NO, which move to forget), and nicknames (picked from made-up candidates).

**Code decides nothing about strategy.** It only reads memory, computes facts, and presses buttons. It never writes game memory. Its only game knowledge is the list of story milestones in [`src/knowledge/milestones.ts`](src/knowledge/milestones.ts), and completion is checked against the game's own event flags.

### How the questions are designed

These choices follow the [TypeSafe docs](https://docs.typesafe.ai/concepts/how-to-build-with-system-one):

- **Arithmetic stays in code.** Damage ranges, catch odds and speed comparisons are computed in code and shown to Jev as words ("likely knocks it out", "low chance to catch it"), because Jev reads semantic labels better than raw numbers.
- **Option order is shuffled** on every call, since Jev can lean toward the first option.
- **Each decision gets only the state it needs**: a battle sees the battle, a menu sees the recent dialog and the team. Irrelevant context costs accuracy.
- **Options are structured** as `{ action, facts: [...] }`, so each fact is a separate, readable claim.
- **Select, don't generate.** Nicknames are built from syllables in code, and Jev picks one.
- **Probabilities are used for loop breaking.** When an option has been tried without progress, the harness samples from the rest of Jev's distribution.

## Setup

Requires Node 20+.

```bash
npm install
npm run setup                          # downloads names and symbol addresses from pret/pokered into data/
mkdir -p roms && cp /path/to/your/pokered.gb roms/red.gb
cp .env.example .env                   # then set JEV_MODE=typesafe and TYPESAFE_API_KEY
```

The ROM must be the US/EU release (SHA-1 `ea9bcae617fdf159b045185467ae58b2e4a48b9a`). RAM addresses come from the pret/pokered disassembly of that exact build.

## Run

```bash
npm start                              # real time; viewer at http://localhost:8787
npm start -- --speed 4                 # 4x speed
npm start -- --resume                  # continue from the latest save
npm start -- --load <name>             # load saves/<name>.state.json
npm run headless -- --steps 2000       # max speed, logs only
```

Ctrl+C stops after the current step and saves to `saves/manual-*.json`. Milestones are saved automatically.

| Variable | What it does |
|---|---|
| `JEV_MODE` | `typesafe` for real Jev, `mock` for a free stand-in with no game sense (default) |
| `TYPESAFE_API_KEY` | Your TypeSafe API key |
| `TYPESAFE_DEFAULT_MODEL` | `jev-latest`, or pin a version such as `jev-1.13.0` |
| `JEV_MIN_INTERVAL_MS`, `JEV_MAX_PER_MIN` | Throttling (defaults 250 ms, 90/min) |
| `STUCK_EXPLORE` | Decisions without progress before overworld picks are sampled (default 30) |

### Logs

- `logs/jev-calls.jsonl`: every Jev call with its state, questions, full probability distributions, model version and latency.
- `logs/events.jsonl`: decisions, maps, milestones, saves and errors.

## Cost

Jev 1.13 costs $0.042 per million input tokens, and output is free. A battle decision is about 600 tokens. At the default throttle ceiling (90 calls/min nonstop) that is at most about $5 a day.

## Status

This is stage 1, a playable core: boot and naming, dialog and menus, battles (moves, switches, healing items, balls, running), and overworld navigation (doors, map edges, people, signs, tall grass) with milestone tracking.

Not yet handled: field moves (Cut, Surf, Strength), the PC and team management, shopping beyond the generic menu, puzzles (boulders, spinner tiles, teleport pads), Safari Zone rules, and region-level route planning that accounts for ledges and blocked paths.

## Project layout

| Path | What |
|---|---|
| `src/emu/` | serverboy wrapper (frame pacing, save states), PNG encoder |
| `src/game/` | pret data, ROM tables, RAM reader, collision grid + A*, map graph |
| `src/jev/` | Jev client (TypeSafe SDK, throttle, cache, log) and mock |
| `src/agent/` | mode detection, dialog/menus, battle, overworld |
| `src/knowledge/` | story milestones |
| `web/` | local viewer |

## Legal

No ROM or Nintendo assets are included. Game data is read at runtime from your ROM, and names and addresses come from the [pret/pokered](https://github.com/pret/pokered) disassembly during setup (`data/` is gitignored). Not affiliated with Nintendo, Game Freak, The Pokémon Company or TypeSafe AI. Licensed GPL-2.0-or-later because it uses the GPL [serverboy](https://gitlab.com/piglet-plays/serverboy.js) emulator core.
