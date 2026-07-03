import { useCallback, useEffect, useRef, useState } from "react";

/**
 * KenjiBurst — a standalone, self-contained burst effect.
 *
 * Wrap any content (e.g. <Monk />) with <KenjiBurst>...</KenjiBurst>.
 * Clicking anywhere on the wrapped area triggers a celebratory burst
 * BEHIND the children. Pure SVG + requestAnimationFrame, no deps.
 *
 * Props:
 *   - effect: "stars" | "confetti" | "balloons" | "fireworks" (default "confetti")
 *   - duration: ms per burst (default 1400)
 *   - particleCount: override default count
 *   - colors: override palette
 *   - children: the thing to render in front (Kenji, etc.)
 */

export type BurstEffect = "stars" | "confetti" | "balloons" | "fireworks";

type Particle = {
  id: number;
  x: number; // start x (% of box)
  y: number; // start y (% of box)
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  size: number;
  color: string;
  shape: "circle" | "rect" | "star" | "balloon" | "spark";
  life: number; // 0..1
};

const PALETTES: Record<BurstEffect, string[]> = {
  stars: ["#fde68a", "#fcd34d", "#fbbf24", "#ffffff", "#f0abfc"],
  confetti: ["#f87171", "#fbbf24", "#34d399", "#60a5fa", "#a78bfa", "#f472b6"],
  balloons: ["#fca5a5", "#fdba74", "#fcd34d", "#86efac", "#93c5fd", "#c4b5fd"],
  fireworks: ["#fde68a", "#fca5a5", "#a5f3fc", "#c4b5fd", "#f9a8d4"],
};

export function KenjiBurst({
  effect = "confetti",
  duration = 1400,
  particleCount,
  colors,
  children,
  className = "",
}: {
  effect?: BurstEffect;
  duration?: number;
  particleCount?: number;
  colors?: string[];
  children: React.ReactNode;
  className?: string;
}) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [tick, setTick] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const idRef = useRef(0);

  const palette = colors ?? PALETTES[effect];
  const count =
    particleCount ??
    (effect === "balloons" ? 22 : effect === "fireworks" ? 110 : 70);

  const spawn = useCallback(() => {
    const next: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const angle =
        effect === "balloons"
          ? -Math.PI / 2 + (Math.random() - 0.5) * 0.9
          : Math.random() * Math.PI * 2;
      const speed =
        effect === "balloons"
          ? 70 + Math.random() * 50
          : effect === "fireworks"
          ? 260 + Math.random() * 180
          : 200 + Math.random() * 200;
      const shape: Particle["shape"] =
        effect === "stars"
          ? "star"
          : effect === "balloons"
          ? "balloon"
          : effect === "fireworks"
          ? "spark"
          : Math.random() > 0.5
          ? "rect"
          : "circle";
      next.push({
        id: idRef.current++,
        x: 50 + (Math.random() - 0.5) * 6,
        y: 55 + (Math.random() - 0.5) * 6,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: Math.random() * 360,
        vrot: (Math.random() - 0.5) * 540,
        size:
          effect === "balloons"
            ? 18 + Math.random() * 10
            : effect === "stars"
            ? 14 + Math.random() * 10
            : effect === "fireworks"
            ? 5 + Math.random() * 4
            : 9 + Math.random() * 8,
        color: palette[Math.floor(Math.random() * palette.length)],
        shape,
        life: 0,
      });
    }
    setParticles(next);
    startRef.current = performance.now();
  }, [count, effect, palette]);

  useEffect(() => {
    if (particles.length === 0) return;
    const animate = (now: number) => {
      const start = startRef.current ?? now;
      const p = Math.min(1, (now - start) / duration);
      setTick(p);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setParticles([]);
      }
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [particles, duration]);

  const gravity = effect === "balloons" ? -30 : 180;
  const drag = effect === "balloons" ? 0.6 : 0.25;

  return (
    <div
      className={`relative inline-block cursor-pointer select-none ${className}`}
      onClick={spawn}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          spawn();
        }
      }}
    >
      {/* Burst layer BEHIND children */}
      <div className="pointer-events-none absolute inset-0 overflow-visible">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
        >
          {particles.map((p) => {
            const t = tick;
            const x = p.x + (p.vx * t) / 4;
            const y = p.y + (p.vy * t) / 4 + (gravity * t * t) / 8;
            const fade = Math.max(0, 1 - t);
            const scale = 1 - t * drag * 0.4;
            const rot = p.rot + p.vrot * t;
            return (
              <g
                key={p.id}
                transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`}
                opacity={fade}
              >
                <Shape p={p} />
              </g>
            );
          })}
        </svg>
      </div>

      {/* Foreground content (Kenji) */}
      <div className="relative">{children}</div>
    </div>
  );
}

function Shape({ p }: { p: Particle }) {
  // sizes are in viewBox units (0-100). Scale particle.size accordingly.
  const s = p.size / 8;
  switch (p.shape) {
    case "circle":
      return <circle r={s} fill={p.color} />;
    case "rect":
      return (
        <rect
          x={-s}
          y={-s * 0.5}
          width={s * 2}
          height={s}
          rx={s * 0.2}
          fill={p.color}
        />
      );
    case "star":
      return <path d={starPath(s)} fill={p.color} />;
    case "balloon":
      return (
        <g>
          <ellipse rx={s * 0.9} ry={s * 1.1} fill={p.color} />
          <ellipse
            cx={-s * 0.3}
            cy={-s * 0.4}
            rx={s * 0.2}
            ry={s * 0.3}
            fill="#fff"
            opacity={0.5}
          />
          <line
            x1={0}
            y1={s * 1.1}
            x2={0}
            y2={s * 2.2}
            stroke={p.color}
            strokeWidth={0.2}
          />
        </g>
      );
    case "spark":
      return (
        <g stroke={p.color} strokeWidth={s * 0.5} strokeLinecap="round">
          <line x1={-s} y1={0} x2={s} y2={0} />
          <circle r={s * 0.6} fill={p.color} stroke="none" />
        </g>
      );
  }
}

function starPath(s: number) {
  const spikes = 5;
  const outer = s * 1.2;
  const inner = s * 0.5;
  let path = "";
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i * Math.PI) / spikes - Math.PI / 2;
    path += (i === 0 ? "M" : "L") + Math.cos(a) * r + " " + Math.sin(a) * r;
  }
  return path + "Z";
}

export default KenjiBurst;