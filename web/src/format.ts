export const pct = (p: number | undefined) => (p === undefined ? '…' : `${Math.round(p * 100)}%`);

export const count = (n: number) => n.toLocaleString('en-US');

export function tokens(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export function usd(n: number) {
  return n >= 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}
