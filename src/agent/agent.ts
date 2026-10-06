import fs from 'node:fs';
import type { Ctx, Memory } from './ctx.js';
import { tap, objective } from './ctx.js';
import { dialogStep, isNamingScreen } from './dialog.js';
import { overworldStep, overworldReady } from './overworld.js';
import { battleStep } from './battle.js';
import { MILESTONES } from '../knowledge/milestones.js';
import { sym } from '../game/data.js';

export type Mode = 'battle' | 'dialog' | 'overworld' | 'busy' | 'boot';

const STUCK_EXPLORE = +(process.env.STUCK_EXPLORE ?? 30);

export class Agent {
  milestoneIndex = -1;
  decisionsSinceProgress = 0;
  private progressKey = '';
  private lastMap = -1;
  private wiped = false;

  constructor(private ctx: Ctx, private saveDir = 'saves') {}

  mode(): Mode {
    const { gs } = this.ctx;
    if (gs.inBattle) return 'battle';
    const s = gs.screen();
    if (s.hasTextBox || s.cursor || isNamingScreen(this.ctx)) return 'dialog';
    if (gs.scripted) return 'busy';
    if (overworldReady(this.ctx)) return 'overworld';
    if (s.uiTiles > 0) return 'dialog'; // full-screen UI: title screen, Pokédex page, ...
    if (gs.mapWidth > 0 && gs.m[sym('wSpriteStateData1')] !== 0) return 'busy'; // on a map that is still loading
    return 'boot';
  }

  async step() {
    this.ctx.mem.stats.steps++;
    const mode = this.mode();
    this.track(mode);
    switch (mode) {
      case 'battle': return battleStep(this.ctx);
      case 'dialog': return dialogStep(this.ctx);
      case 'busy': return this.ctx.emu.wait(8);
      case 'boot': return tap(this.ctx, 'START', 20);
      case 'overworld': {
        // loop protection: after many decisions without progress, sample Jev's distribution instead of its top pick
        const exploring = this.decisionsSinceProgress >= STUCK_EXPLORE;
        return overworldStep(this.ctx, { exploring, onDecision: () => this.decisionsSinceProgress++ });
      }
    }
  }

  /** Visited maps, losses, progress and milestones; autosaves when a milestone completes. */
  private track(mode: Mode) {
    const { gs, mem } = this.ctx;
    const party = gs.party();
    const wiped = gs.inBattle !== 0 && party.length > 0 && party.every((p) => p.hp === 0);
    if (wiped && !this.wiped) {
      mem.losses[gs.mapName] = (mem.losses[gs.mapName] ?? 0) + 1;
      this.ctx.log('warn', `team wiped at ${gs.mapName} (${mem.losses[gs.mapName]}x)`);
    }
    this.wiped = wiped;
    if (mode === 'overworld' && gs.mapId !== this.lastMap) {
      this.lastMap = gs.mapId;
      if (!mem.visited.includes(gs.mapName)) mem.visited.push(gs.mapName);
      this.ctx.log('map', `entered ${gs.mapName}`);
    }
    const { index, m } = objective(this.ctx);
    if (index !== this.milestoneIndex) {
      if (this.milestoneIndex >= 0 && index > this.milestoneIndex) {
        this.ctx.log('milestone', `✔ ${MILESTONES[this.milestoneIndex].id} → next: ${m?.id ?? 'game complete'}`);
        this.save(`milestone-${String(index).padStart(2, '0')}-${MILESTONES[index - 1].id}`);
      }
      this.milestoneIndex = index;
    }
    // progress = anything that moves the story or the team forward; experience counts only while training
    let exp = 0;
    for (let i = 0; i < party.length; i++) {
      const a = sym('wPartyMons') + i * 44 + 14;
      exp += (gs.m[a] << 16) | (gs.m[a + 1] << 8) | gs.m[a + 2];
    }
    const training = mem.focus?.value === 'train' || mem.focus?.value === 'catch';
    const key = `${index}|${mem.visited.length}|${gs.badges}|${party.length}|${gs.eventCount()}|${training ? Math.floor(exp / 200) : ''}`;
    if (key !== this.progressKey) {
      this.progressKey = key;
      this.decisionsSinceProgress = 0;
      mem.tried = {};
    }
  }

  save(name: string) {
    fs.mkdirSync(this.saveDir, { recursive: true });
    this.ctx.emu.saveState(`${this.saveDir}/${name}.state.json`);
    fs.writeFileSync(`${this.saveDir}/${name}.memory.json`, JSON.stringify(this.ctx.mem));
    fs.writeFileSync(`${this.saveDir}/latest.txt`, name);
    this.ctx.log('save', `saved ${name}`);
  }

  load(name: string) {
    this.ctx.emu.loadState(`${this.saveDir}/${name}.state.json`);
    const memFile = `${this.saveDir}/${name}.memory.json`;
    if (fs.existsSync(memFile)) {
      const saved = JSON.parse(fs.readFileSync(memFile, 'utf8')) as Memory;
      Object.assign(this.ctx.mem, saved, { tried: {}, talkingTo: null, stats: { ...this.ctx.mem.stats, ...saved.stats } });
    }
    this.lastMap = -1;
    this.ctx.log('save', `loaded ${name}`);
  }

  latestSave(): string | null {
    const f = `${this.saveDir}/latest.txt`;
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : null;
  }
}
