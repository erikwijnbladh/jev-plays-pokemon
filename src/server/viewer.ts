import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Emulator } from '../emu/emulator.js';
import { encodePng } from '../emu/png.js';
import type { Overlay } from '../overlay/state.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon',
};

/** A frame as palette + one index byte per pixel (the Game Boy shows a handful of colors), base64. */
function encodeFrame(rgba: ArrayLike<number>): string {
  const palette: number[] = [];
  const lookup = new Map<number, number>();
  const idx = Buffer.alloc(160 * 144);
  for (let p = 0; p < idx.length; p++) {
    const c = (rgba[p * 4] << 16) | (rgba[p * 4 + 1] << 8) | rgba[p * 4 + 2];
    let i = lookup.get(c);
    if (i === undefined) { i = palette.length; lookup.set(c, i); palette.push(c); }
    idx[p] = i;
  }
  return JSON.stringify({ p: palette, d: idx.toString('base64') });
}

/**
 * Serves the built overlay (web/dist) and one Server-Sent Events stream, /api/live:
 * `frame` events at up to ~30 fps of wall-clock time, and `state` events on every decision and twice a second.
 */
export function startViewer(opts: { emu: Emulator; overlay: Overlay; port: number; webDir: string }) {
  const { emu, overlay } = opts;
  const clients = new Set<http.ServerResponse>();
  const send = (event: string, data: string) => { for (const c of clients) c.write(`event: ${event}\ndata: ${data}\n\n`); };

  let lastFrame = 0;
  emu.onFrame = () => {
    if (!clients.size) return;
    const now = performance.now();
    if (now - lastFrame < 33) return;
    lastFrame = now;
    send('frame', encodeFrame(emu.screen()));
  };
  let lastVersion = -1, lastState = 0;
  const pushState = (force = false) => {
    if (!clients.size) return;
    const now = performance.now();
    if (!force && overlay.version === lastVersion && now - lastState < 500) return;
    lastVersion = overlay.version;
    lastState = now;
    send('state', JSON.stringify(overlay.snapshot()));
  };
  // decisions push immediately; everything else (HP, play clock) refreshes twice a second
  setInterval(() => pushState(), 100).unref();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/live') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      clients.add(res);
      req.on('close', () => clients.delete(res));
      res.write(`event: frame\ndata: ${encodeFrame(emu.screen())}\n\n`);
      res.write(`event: state\ndata: ${JSON.stringify(overlay.snapshot())}\n\n`);
      return;
    }
    if (url.pathname === '/api/state') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(overlay.snapshot()));
    }
    if (url.pathname === '/api/frame.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      return res.end(encodePng(emu.screen()));
    }
    // static files from the built web app; unknown paths fall back to index.html
    const file = path.join(opts.webDir, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(opts.webDir, 'index.html');
    if (!fs.existsSync(target)) {
      res.writeHead(503, { 'content-type': 'text/plain' });
      return res.end('The overlay is not built yet: run `npm run web:build` (or `npm run web:dev` for development).');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream' });
    fs.createReadStream(target).pipe(res);
  });
  server.listen(opts.port, '127.0.0.1', () => console.log(`Overlay: http://localhost:${opts.port}`));
  return { pushState };
}
