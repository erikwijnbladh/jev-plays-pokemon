import { useCallback, useEffect, useRef, useState } from 'react';
import { useLive, type FrameListener } from './useLive';
import { TopBar } from './components/TopBar';
import { Stage } from './components/Stage';
import { Brain } from './components/Brain';
import { Rail } from './components/Rail';
import { Party, Badges } from './components/Party';

const W = 1920, H = 1080;

/** The overlay is laid out at exactly 1920x1080 (an OBS browser source); in a normal window it scales to fit. */
function useFitScale() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return scale;
}

export function App() {
  const screen = useRef<HTMLCanvasElement>(null);
  const image = useRef<ImageData | null>(null);

  // frames arrive as a small palette plus one index byte per pixel
  const draw = useCallback<FrameListener>(({ p, d }) => {
    const g = screen.current?.getContext('2d');
    if (!g) return;
    const img = (image.current ??= g.createImageData(160, 144));
    const idx = Uint8Array.from(atob(d), (c) => c.charCodeAt(0));
    const px = img.data;
    for (let i = 0; i < idx.length; i++) {
      const c = p[idx[i]];
      px[i * 4] = c >> 16;
      px[i * 4 + 1] = (c >> 8) & 255;
      px[i * 4 + 2] = c & 255;
      px[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, []);

  const { state: s, connected } = useLive(draw);
  const scale = useFitScale();

  return (
    <div className="flex h-screen w-screen items-center justify-center overflow-hidden">
      <div style={{ width: W * scale, height: H * scale }}>
        <main
          className="flex origin-top-left flex-col gap-5 bg-paper p-6"
          style={{ width: W, height: H, transform: `scale(${scale})` }}
        >
          <TopBar s={s} connected={connected} />
          <div className="flex h-[760px] shrink-0 gap-5">
            <Stage ref={screen} s={s} connected={connected} />
            <Brain d={s?.decision ?? null} />
            <Rail s={s} />
          </div>
          <div className="flex min-h-0 grow gap-5">
            <Party party={s?.party ?? []} />
            <Badges b={s?.badges} />
          </div>
        </main>
      </div>
    </div>
  );
}
