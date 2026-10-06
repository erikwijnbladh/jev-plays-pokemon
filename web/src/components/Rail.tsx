import type { OverlaySnapshot, OverlayLogEntry } from '../../../src/overlay/types';
import { count, pct, tokens, usd } from '../format';

function Stat({ label, value, top }: { label: string; value: string; top?: boolean }) {
  return (
    <div className={`flex w-1/2 flex-col gap-1.5 ${top ? 'pt-3.5 pb-2.5' : 'pt-2.5'}`}>
      <div className="font-pixel text-xs leading-3 text-lilac">{label}</div>
      <div className="font-sans text-[28px] font-bold leading-7 text-white tabular-nums">{value}</div>
    </div>
  );
}

function Spend({ t }: { t: OverlaySnapshot['totals'] | undefined }) {
  return (
    <div className="flex flex-col gap-3.5 border-4 border-ink bg-ink px-6 py-5 shadow-hard-red">
      <div className="flex items-center justify-between">
        <div className="font-pixel text-[13px] leading-4 text-white">TOKENS &amp; JEV</div>
        <div className="font-pixel text-xs leading-3 text-lilac">$0.042 / 1M</div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="font-sans text-[64px] font-bold leading-[58px] tracking-[-0.02em] text-pink tabular-nums">{t ? usd(t.costUsd) : '$0'}</div>
        <div className="font-sans text-base text-lavender">spent so far</div>
      </div>
      <div className="flex flex-wrap border-t-[3px] border-slate">
        <Stat top label="TOKENS IN" value={t ? tokens(t.inputTokens) : '0'} />
        <Stat top label="JEV CALLS" value={t ? count(t.calls) : '0'} />
        <Stat label="PER CALL" value={t ? count(t.perCall) : '0'} />
        <Stat label="AVG LATENCY" value={t ? `${t.avgLatencyMs} ms` : '–'} />
      </div>
    </div>
  );
}

/** Battle = red square, menu/nickname = black square, overworld/focus = hollow square (as in the design). */
function Marker({ kind }: { kind: OverlayLogEntry['kind'] }) {
  if (kind === 'battle') return <div className="size-2.5 shrink-0 bg-red" />;
  if (kind === 'menu' || kind === 'nickname') return <div className="size-2.5 shrink-0 bg-ink" />;
  return <div className="size-2.5 shrink-0 border-2 border-ink" />;
}

function Log({ log }: { log: OverlayLogEntry[] }) {
  return (
    <div className="flex min-h-0 grow flex-col overflow-hidden border-4 border-ink bg-white shadow-hard">
      <div className="flex items-center justify-between border-b-4 border-ink px-5 py-3.5">
        <div className="font-pixel text-[13px] leading-4 text-black">JEV LOG</div>
        <div className="font-pixel text-xs leading-3 text-stone">PICK %</div>
      </div>
      <div className="flex flex-col px-5 py-1">
        {log.map((e, i) => (
          <div key={i} className={`flex items-center gap-3 py-2.5 ${i ? 'border-t-2 border-dashed border-dust' : ''}`}>
            <Marker kind={e.kind} />
            <div className={`min-w-0 grow truncate font-sans text-base leading-5 text-black ${i === 0 ? 'font-semibold' : ''}`}>{e.text}</div>
            <div className={`w-12 shrink-0 text-right font-sans text-base font-bold leading-5 tabular-nums ${e.overridden ? 'text-red' : i === 0 ? 'text-black' : 'text-stone'}`}>{pct(e.p)}</div>
          </div>
        ))}
        {!log.length && <div className="py-3 font-sans text-base text-stone">No decisions yet.</div>}
      </div>
    </div>
  );
}

export function Rail({ s }: { s: OverlaySnapshot | null }) {
  return (
    <section className="flex min-w-0 grow flex-col gap-5">
      <Spend t={s?.totals} />
      <Log log={s?.log ?? []} />
    </section>
  );
}
