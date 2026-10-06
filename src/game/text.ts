import { charmap } from './data.js';

/** Decode a Gen 1 string ($50-terminated). */
export function decode(bytes: ArrayLike<number>, start = 0, max = 64): string {
  const cm = charmap();
  let s = '';
  for (let i = start; i < start + max && i < bytes.length; i++) {
    if (bytes[i] === 0x50) break;
    s += cm[bytes[i]] ?? '';
  }
  return s.trim();
}

/** Decode one tile; non-font tiles (map graphics) become a space. */
export function decodeTile(t: number): string {
  return charmap()[t] ?? ' ';
}
