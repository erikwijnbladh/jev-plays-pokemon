import { useEffect, useRef, useState } from 'react';
import type { OverlaySnapshot } from '../../src/overlay/types';

export type FrameListener = (frame: { p: number[]; d: string }) => void;

/**
 * Subscribes to the harness's /api/live stream. State updates go through React;
 * frames (up to ~30/s) go straight to a listener so drawing them doesn't re-render the overlay.
 */
export function useLive(onFrame: FrameListener) {
  const [state, setState] = useState<OverlaySnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const frameRef = useRef(onFrame);
  frameRef.current = onFrame;

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      es = new EventSource('/api/live');
      es.onopen = () => setConnected(true);
      es.addEventListener('state', (e) => setState(JSON.parse((e as MessageEvent).data)));
      es.addEventListener('frame', (e) => frameRef.current(JSON.parse((e as MessageEvent).data)));
      es.onerror = () => {
        setConnected(false);
        es?.close();
        retry = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => { es?.close(); clearTimeout(retry); };
  }, []);

  return { state, connected };
}
