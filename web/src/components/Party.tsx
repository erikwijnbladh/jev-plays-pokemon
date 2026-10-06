import { useEffect, useRef } from 'react';
import type { OverlayMon, OverlaySnapshot } from '../../../src/overlay/types';
import { Pokeball } from './TopBar';

const SHADES = ['transparent', '#ff8484', '#943a3a', '#101010'];
const FAINTED = ['transparent', '#c9c4ba', '#8a857c', '#101010'];

/** A 16x16 party icon from the ROM, drawn at 3x. */
function MonIcon({ icon, fainted }: { icon: string; fainted: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = ref.current?.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, 16, 16);
    const pal = fainted ? FAINTED : SHADES;
    for (let i = 0; i < 256; i++) {
      const shade = +icon[i];
      if (!shade) continue;
      g.fillStyle = pal[shade];
      g.fillRect(i % 16, Math.floor(i / 16), 1, 1);
    }
  }, [icon, fainted]);
  return <canvas ref={ref} width={16} height={16} className={`pixelated size-12 ${fainted ? 'opacity-55' : ''}`} />;
}

const CHIP: Record<string, string> = {
  ACTIVE: 'bg-red text-white', READY: 'bg-ink text-white', FNT: 'bg-stone text-white', PSN: 'bg-poison text-white',
  PAR: 'bg-hp-amber text-ink', BRN: 'bg-maroon text-white', FRZ: 'bg-bezel text-white', SLP: 'bg-lilac text-ink',
};

function hpColor(f: number) {
  return f > 0.5 ? 'bg-hp-green' : f > 0.2 ? 'bg-hp-amber' : 'bg-red';
}

function MonCard({ m }: { m: OverlayMon }) {
  const fainted = m.hp === 0;
  const f = m.hp / Math.max(1, m.maxHp);
  const frame = m.active ? 'border-red bg-white shadow-hard' : fainted ? 'border-ink bg-cream shadow-hard-stone' : 'border-ink bg-white shadow-hard';
  return (
    <div className={`flex min-w-0 basis-0 grow flex-col justify-between border-4 px-4 py-3.5 ${frame}`}>
      <div className="flex items-center gap-3">
        <div className={`flex size-[60px] shrink-0 items-center justify-center border-[3px] border-ink ${fainted ? 'bg-paper' : 'bg-blush'}`}>
          <MonIcon icon={m.icon} fainted={fainted} />
        </div>
        <div className="flex min-w-0 grow flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate font-pixel text-[13px] leading-4 text-black">{m.nickname}</div>
            <div className="shrink-0 font-sans text-[28px] font-bold leading-[26px] text-black">Lv {m.level}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="truncate font-sans text-[15px] leading-[18px] text-stone">{m.species}</div>
            <div className={`shrink-0 px-1.5 py-[3px] font-pixel text-xs leading-3 ${CHIP[m.chip] ?? CHIP.READY}`}>{m.chip}</div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex h-3 grow border-[3px] border-ink">
          <div className={`${hpColor(f)} transition-[width] duration-300`} style={{ width: `${Math.round(f * 100)}%` }} />
        </div>
        <div className="shrink-0 font-sans text-[15px] font-bold leading-4 text-black tabular-nums">{m.hp}/{m.maxHp}</div>
      </div>
    </div>
  );
}

function EmptySlot() {
  return (
    <div className="flex w-[120px] shrink-0 flex-col items-center justify-center gap-2.5 border-4 border-dashed border-taupe">
      <Pokeball className="size-10 opacity-35 grayscale" />
      <div className="font-pixel text-xs leading-3 text-stone">EMPTY</div>
    </div>
  );
}

export function Party({ party }: { party: OverlayMon[] }) {
  return (
    <section className="flex min-w-0 grow gap-3">
      {party.map((m, i) => <MonCard key={i} m={m} />)}
      {Array.from({ length: Math.max(0, 6 - party.length) }, (_, i) => <EmptySlot key={`e${i}`} />)}
    </section>
  );
}

export function Badges({ b }: { b: OverlaySnapshot['badges'] | undefined }) {
  const owned = b?.owned ?? Array(8).fill(false);
  const next = owned.indexOf(false);
  return (
    <section className="flex w-[424px] shrink-0 flex-col justify-between border-4 border-ink bg-white px-5 py-4 shadow-hard">
      <div className="flex items-baseline justify-between">
        <div className="font-pixel text-xs leading-3.5 text-black">BADGES</div>
        <div className="font-sans text-4xl font-bold leading-8 text-black">{b?.count ?? 0} / 8</div>
      </div>
      <div className="flex gap-1.5">
        {owned.map((has: boolean, i: number) => (
          <div key={i} className={`h-10 basis-0 grow border-[3px] ${has ? 'border-ink bg-red' : i === next ? 'border-dashed border-red bg-blush' : 'border-dashed border-dust'}`} />
        ))}
      </div>
      <div className="truncate font-sans text-base leading-5 text-slate">{b?.next ?? 'All eight badges!'}</div>
    </section>
  );
}
