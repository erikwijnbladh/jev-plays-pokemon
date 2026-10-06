import type { OverlayDecision } from '../../../src/overlay/types';
import { count, pct } from '../format';

function OptionRow({ o, top, picked, deciding }: { o: OverlayDecision['options'][number]; top: boolean; picked: boolean; deciding: boolean }) {
  const width = o.p === undefined ? 0 : Math.max(o.p > 0 ? 2 : 0, Math.round(o.p * 100));
  return (
    <div className={`flex items-center gap-3.5 ${top ? 'border-t-4 border-ink py-[22px]' : 'border-t-2 border-dashed border-dust py-5'}`}>
      <div className="w-[18px] shrink-0 font-pixel text-base leading-[18px] text-red">{picked ? '▶' : ''}</div>
      <div className="flex min-w-0 grow flex-col gap-2">
        <div className={`truncate font-pixel ${picked ? 'text-lg leading-[22px] text-black' : 'text-sm leading-[17px] text-slate'}`}>{o.label}</div>
        {o.sub && <div className={`truncate font-sans text-[17px] leading-[21px] ${picked ? 'text-slate' : 'text-stone'}`}>{o.sub}</div>}
      </div>
      <div className={`flex w-[120px] shrink-0 border-ink ${picked ? 'h-[22px] border-4' : 'h-4 border-[3px]'}`}>
        <div className={`${picked ? 'bg-red' : 'bg-pink'} transition-[width] duration-300`} style={{ width: `${width}%` }} />
      </div>
      <div className={`w-[68px] shrink-0 text-right font-sans tabular-nums ${picked ? 'text-[32px] font-bold leading-8 text-red' : 'text-[22px] font-semibold leading-6 text-slate'} ${deciding ? 'animate-pulse' : ''}`}>
        {pct(o.p)}
      </div>
    </div>
  );
}

function Meta({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex min-w-0 basis-0 grow flex-col gap-2 px-5 py-3.5 ${last ? '' : 'border-r-4 border-ink'}`}>
      <div className="font-pixel text-xs leading-3 text-stone">{label}</div>
      <div className="truncate font-sans text-[22px] font-bold leading-6 text-black">{value}</div>
    </div>
  );
}

/** "Jev is deciding": the question, the top options with Jev's probabilities, and the call's metadata. */
export function Brain({ d }: { d: OverlayDecision | null }) {
  const deciding = d?.status === 'deciding';
  return (
    <section className="flex w-[600px] shrink-0 flex-col border-4 border-ink bg-white shadow-hard">
      <div className="flex items-center justify-between bg-ink px-6 py-3.5">
        <div className="flex items-center gap-3">
          <div className={`size-2.5 shrink-0 bg-red ${deciding ? 'animate-blink' : ''}`} />
          <div className="font-pixel text-[13px] leading-4 text-white">{deciding ? 'JEV IS DECIDING' : 'JEV DECIDED'}</div>
        </div>
        <div className="font-pixel text-xs leading-3 text-lilac uppercase">{d ? `#${count(d.n)} · ${d.kind}` : ''}</div>
      </div>

      <div className="flex flex-col gap-2.5 px-7 pt-7 pb-6">
        <div className="line-clamp-2 font-sans text-[44px] font-bold leading-[48px] tracking-[-0.01em] text-black">{d?.title ?? 'Waiting for the first decision'}</div>
        <div className="truncate font-sans text-[19px] leading-6 text-slate">{d?.subtitle ?? ''}</div>
      </div>

      <div className="flex min-h-0 grow flex-col overflow-hidden px-7">
        {d?.options.map((o, i) => (
          <OptionRow key={o.key} o={o} top={i === 0} picked={!deciding && o.key === d.picked} deciding={deciding} />
        ))}
        {d && (d.more > 0 || d.overridden) && (
          <div className="flex justify-between border-t-2 border-dashed border-dust py-3 font-pixel text-xs leading-3 text-stone">
            <span>{d.more > 0 ? `+${d.more} MORE OPTIONS` : ''}</span>
            {d.overridden && <span className="bg-red px-1.5 py-1 text-white">LOOP BREAK</span>}
          </div>
        )}
      </div>

      <div className="flex border-t-4 border-ink">
        <Meta label="MODEL" value={d?.model ?? '–'} />
        <Meta label="LATENCY" value={d?.latencyMs !== undefined ? `${d.latencyMs} ms` : '–'} />
        <Meta label="THIS CALL" value={d?.inputTokens !== undefined ? `${count(d.inputTokens)} tokens` : '–'} last />
      </div>
    </section>
  );
}
