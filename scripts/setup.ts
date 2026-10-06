// One-time setup: downloads names, constants and symbol addresses from the pret/pokered disassembly
// and writes data/pokered.json. No ROM data is downloaded; game data is read from your own ROM at runtime.
import fs from 'node:fs';
import crypto from 'node:crypto';

// Pinned so addresses can't drift. The symbols branch is pret's own build output of the same source.
const SOURCE = 'https://raw.githubusercontent.com/pret/pokered/d2704a63c26f9ba046ade877445216b3de0519a4';
const SYMBOLS = 'https://raw.githubusercontent.com/pret/pokered/3f618d59edf43918f48f5e558c34e04cb2fc5619/pokered.sym';
const RED_SHA1 = 'ea9bcae617fdf159b045185467ae58b2e4a48b9a';

async function get(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res.text();
}

const lines = (s: string) => s.split('\n').map((l) => l.replace(/;.*$/, '').trimEnd());

function parseMaps(src: string) {
  const maps: Record<number, { name: string; width: number; height: number }> = {};
  let id = 0;
  for (const line of lines(src)) {
    const m = line.match(/^\s*map_const\s+(\w+),\s*(\d+),\s*(\d+)/);
    if (m) maps[id++] = { name: m[1], width: +m[2], height: +m[3] };
  }
  return maps;
}

/** `const` lists with const_def / const_skip / const_next, as used by event and sprite constants. */
function parseConsts(src: string, prefix: string) {
  const out: Record<string, number> = {};
  let v = 0;
  for (const line of lines(src)) {
    let m;
    if ((m = line.match(/^\s*const_def\s*(\d+)?/))) v = m[1] ? +m[1] : 0;
    else if ((m = line.match(/^\s*const_skip\s*(\d+)?/))) v += m[1] ? +m[1] : 1;
    else if ((m = line.match(/^\s*const_next\s+\$([0-9a-fA-F]+)/))) v = parseInt(m[1], 16);
    else if ((m = line.match(/^\s*const_next\s+(\d+)/))) v = +m[1];
    else if ((m = line.match(new RegExp(`^\\s*const\\s+(${prefix}\\w+)`)))) out[m[1]] = v++;
  }
  return out;
}

function parseCharmap(src: string) {
  const out: Record<number, string> = {};
  for (const line of src.split('\n')) {
    const m = line.match(/^\s*charmap\s+"(.+?)",\s*\$([0-9a-fA-F]{2})/);
    // entries tagged with a gfx file are special-screen glyphs (town map arrows, naming screen ED) that share codes with the font
    if (!m || /;\s*gfx\//.test(line)) continue;
    const code = parseInt(m[2], 16);
    // printable font tiles start at $79 (box drawing); $4a and $54 are the PKMN / POKé shorthands
    if (code < 0x79 && code !== 0x4a && code !== 0x54) continue;
    if (out[code] !== undefined) continue;
    out[code] = m[1].replace('<PK>', 'PK').replace('<MN>', 'MN').replace('<PKMN>', 'PKMN').replace('<DOT>', '.');
  }
  out[0x54] = 'POKé';
  out[0x7f] = ' ';
  return out;
}

/** WRAM/HRAM symbols keep their CPU address; ROM symbols become flat file offsets. */
function parseSymbols(src: string) {
  const out: Record<string, number> = {};
  for (const line of src.split('\n')) {
    const m = line.match(/^([0-9a-f]{2}):([0-9a-f]{4}) (\S+)$/);
    if (!m || m[3].includes('.')) continue;
    const bank = parseInt(m[1], 16), addr = parseInt(m[2], 16);
    out[m[3]] = addr >= 0x4000 && addr < 0x8000 ? bank * 0x4000 + (addr - 0x4000) : addr;
  }
  return out;
}

async function main() {
  const [maps, events, charmap, sprites, sym] = await Promise.all([
    get(`${SOURCE}/constants/map_constants.asm`).then(parseMaps),
    get(`${SOURCE}/constants/event_constants.asm`).then((s) => parseConsts(s, 'EVENT_')),
    get(`${SOURCE}/constants/charmap.asm`).then(parseCharmap),
    get(`${SOURCE}/constants/sprite_constants.asm`).then((s) => parseConsts(s, 'SPRITE_')),
    get(SYMBOLS).then(parseSymbols),
  ]);
  const spriteNames = Object.fromEntries(Object.entries(sprites).map(([k, v]) => [v, k.replace(/^SPRITE_/, '')]));
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync('data/pokered.json', JSON.stringify({ maps, events, charmap, sprites: spriteNames, sym }));
  console.log(`data/pokered.json: ${Object.keys(maps).length} maps, ${Object.keys(events).length} events, ${Object.keys(sym).length} symbols`);

  const rom = process.env.ROM_PATH ?? 'roms/red.gb';
  if (!fs.existsSync(rom)) {
    console.log(`\nNext: put your own Pokémon Red (US/EU) ROM at ${rom} (SHA-1 ${RED_SHA1}).`);
    return;
  }
  const sha = crypto.createHash('sha1').update(fs.readFileSync(rom)).digest('hex');
  console.log(sha === RED_SHA1 ? `${rom}: SHA-1 matches Pokémon Red (US/EU).` : `WARNING: ${rom} has SHA-1 ${sha}, expected ${RED_SHA1}. Other versions use different addresses and won't work.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
