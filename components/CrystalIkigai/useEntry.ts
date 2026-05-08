'use client';

import { useEffect, useState } from 'react';

export function useEntryProgress(duration = 1100, deps: unknown[] = []): number {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const x = Math.min(1, (t - start) / duration);
      setP(1 - Math.pow(1 - x, 3));
      if (x < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return p;
}
