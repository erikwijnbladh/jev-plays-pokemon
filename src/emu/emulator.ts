import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const Gameboy = require('serverboy');

export type Button = 'A' | 'B' | 'START' | 'SELECT' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

const GB_FPS = 59.73;

/**
 * serverboy (GameBoy-Online core) with direct memory access, save states and frame pacing.
 * Frames are async so a real-time run can sleep between them and the viewer's HTTP server stays responsive.
 */
export class Emulator {
  private gb: any;
  frames = 0;
  /** 0 = as fast as possible; 1 = real time; 2 = double speed... */
  speed = 0;
  private clockStart = 0;
  private clockFrames = 0;
  onFrame?: (frame: number) => void;

  constructor(rom: Buffer) {
    this.gb = new Gameboy();
    this.gb.loadRom(rom);
  }

  /** The GameBoyCore instance (serverboy keeps it behind a private symbol-like key). */
  get core(): any {
    return (Object.values(this.gb)[0] as any).gameboy;
  }

  get mem(): Uint8Array {
    return this.core.memory;
  }

  get rom(): Uint8Array {
    return this.core.ROM;
  }

  /** RGBA, 160x144. */
  screen(): ArrayLike<number> {
    return this.gb.getScreen();
  }

  /** Advance one frame, optionally holding buttons during it. */
  async frame(hold: Button[] = []) {
    if (hold.length) this.gb.pressKeys(hold);
    this.gb.doFrame();
    this.frames++;
    this.onFrame?.(this.frames);
    await this.pace();
  }

  async wait(n: number) {
    for (let i = 0; i < n; i++) await this.frame();
  }

  /** Tap a button: hold for `hold` frames, then release for `release` frames. */
  async press(b: Button, hold = 6, release = 10) {
    for (let i = 0; i < hold; i++) await this.frame([b]);
    await this.wait(release);
  }

  private async pace() {
    if (this.speed <= 0) {
      // unthrottled: still yield to the event loop now and then (viewer, signals)
      if (this.frames % 120 === 0) await new Promise((r) => setImmediate(r));
      return;
    }
    const now = performance.now();
    // restart the clock after a pause (a Jev call) instead of fast-forwarding to catch up
    if (!this.clockStart || now - this.clockStart - (this.clockFrames * 1000) / (GB_FPS * this.speed) > 250) {
      this.clockStart = now;
      this.clockFrames = 0;
    }
    this.clockFrames++;
    const due = this.clockStart + (this.clockFrames * 1000) / (GB_FPS * this.speed);
    if (due > now) await new Promise((r) => setTimeout(r, due - now));
  }

  saveState(file: string) {
    fs.writeFileSync(file, JSON.stringify({ frames: this.frames, state: this.core.saveState() }));
  }

  loadState(file: string) {
    const { frames, state } = JSON.parse(fs.readFileSync(file, 'utf8'));
    this.core.saving(state);
    this.frames = frames;
  }
}
