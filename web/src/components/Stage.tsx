import { forwardRef } from 'react';
import type { OverlaySnapshot } from '../../../src/overlay/types';

/** The Game Boy in its bezel. The screen is drawn at exactly 4x (640x576) so every pixel is the same size. */
export const Stage = forwardRef<HTMLCanvasElement, { s: OverlaySnapshot | null; connected: boolean }>(function Stage({ s, connected }, ref) {
  return (
    <section className="flex w-[808px] shrink-0 flex-col items-center justify-between border-4 border-ink bg-bezel px-9 pt-7 pb-[18px] shadow-hard">
      <div className="mt-auto border-4 border-ink bg-white">
        <canvas ref={ref} width={160} height={144} className="pixelated block h-[576px] w-[640px]" />
      </div>
      <div className="mt-auto flex w-full items-center justify-between pt-6 font-pixel text-xs leading-3 text-lilac uppercase">
        <div className="flex items-center gap-2">
          <div className={`size-2.5 shrink-0 ${connected ? 'bg-red' : 'bg-stone'}`} />
          POWER
        </div>
        <div>
          {s ? `${s.location} · step ${s.step.toLocaleString('en-US')} · ${s.speed ? `${s.speed}× speed` : 'max speed'}` : 'connecting…'}
        </div>
      </div>
    </section>
  );
});
