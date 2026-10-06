import type { OverlaySnapshot } from '../../../src/overlay/types';

export function Pokeball({ className = 'size-11' }: { className?: string }) {
  return (
    <svg viewBox="0 0 13 13" shapeRendering="crispEdges" className={className} aria-hidden>
      <path d="M4 0h5v1h2v1h1v2h1v5h-1v2h-1v1h-2v1H4v-1H2v-1H1V9H0V4h1V2h1V1h2z" fill="var(--color-ink)" />
      <path d="M4 1h5v1h2v2h1v2H8V5H5v1H1V4h1V2h2z" fill="var(--color-red)" />
      <path d="M1 7h4v1h3V7h4v2h-1v2H9v1H4v-1H2V9H1z" fill="#fff" />
      <path d="M6 6h1v1H6z" fill="#fff" />
      <path d="M4 2h2v1H5v1H4z" fill="var(--color-pink)" />
    </svg>
  );
}

export function TopBar({ s, connected }: { s: OverlaySnapshot | null; connected: boolean }) {
  const running = connected && !!s?.running;
  return (
    <header className="flex h-16 shrink-0 items-center gap-5">
      <div className="flex shrink-0 items-center gap-4 pr-2">
        <Pokeball />
        <div className="flex items-baseline gap-4 font-pixel text-2xl leading-7">
          <span className="text-ink">JEV PLAYS</span>
          <span className="text-red">POKéMON RED</span>
        </div>
      </div>

      <div className="flex h-16 min-w-0 grow items-center gap-4 border-4 border-ink bg-white px-5 shadow-hard-sm">
        <div className="shrink-0 bg-red px-2 py-1.5 font-pixel text-xs leading-3 text-white">
          GOAL {s?.goal.index ?? '–'}/{s?.goal.total ?? 33}
        </div>
        <div className="shrink-0 font-sans text-2xl font-bold leading-7 text-black">{s?.goal.title ?? 'Waiting for the game…'}</div>
        <div className="truncate font-sans text-base text-stone">{s?.goal.place}</div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className={`flex h-16 items-center gap-2.5 border-4 border-ink px-4 shadow-hard-sm ${running ? 'bg-red' : 'bg-stone'}`}>
          <div className={`size-2.5 shrink-0 bg-white ${running ? 'animate-blink' : ''}`} />
          <span className="font-pixel text-xs leading-3.5 text-white">{running ? 'RUNNING' : connected ? 'PAUSED' : 'OFFLINE'}</span>
        </div>
        <div className="flex h-16 flex-col items-end justify-center gap-1 border-4 border-ink bg-ink px-4 shadow-hard-sm">
          <span className="font-pixel text-xs leading-3 text-lilac">PLAY TIME</span>
          <span className="font-sans text-[22px] font-bold leading-6 text-white tabular-nums">{s?.playTime ?? '--:--:--'}</span>
        </div>
      </div>
    </header>
  );
}
