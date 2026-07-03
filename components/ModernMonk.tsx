import { useEffect, useMemo, useState } from "react";

export type MonkVariant = "current" | "sunset" | "aurora" | "ocean" | "sunrise" | "jade" | "twilight";
export type MonkMood = "calm" | "smile" | "wink" | "wow";
export type MonkActivity = "idle" | "meditate" | "quiet" | "reflect" | "dance" | "wave" | "sleep";

type Palette = {
  robeTop: string;
  robeBottom: string;
  sashTop: string;
  sashBottom: string;
  sleeve: string;
  skin: string;
  skinShadow: string;
  aura: string;
  floor: string;
  visor: string;
  visorLed: string;
  bead: string;
};

const PALETTES: Record<MonkVariant, Palette> = {
  current: {
    robeTop: "#6b8a84",
    robeBottom: "#3a4f4a",
    sashTop: "#e8d8a8",
    sashBottom: "#9a8a52",
    sleeve: "#5a7469",
    skin: "#f0c69a",
    skinShadow: "#d99e6a",
    aura: "#d4ebe8",
    floor: "#a8c4c0",
    visor: "#2d3748",
    visorLed: "#5f7f7b",
    bead: "#e8d8a8",
  },
  sunset: {
    robeTop: "#e08a4a",
    robeBottom: "#8a3a1e",
    sashTop: "#f4d27a",
    sashBottom: "#b8923a",
    sleeve: "#b85a2e",
    skin: "#f0c69a",
    skinShadow: "#d99e6a",
    aura: "#ffe7b0",
    floor: "#d4af6e",
    visor: "#2d3748",
    visorLed: "#e07a3c",
    bead: "#f0d078",
  },
  aurora: {
    robeTop: "#3a4e6a",
    robeBottom: "#1a2436",
    sashTop: "#8a96aa",
    sashBottom: "#5a6680",
    sleeve: "#2b344a",
    skin: "#c8a090",
    skinShadow: "#a08070",
    aura: "#94d3a2",
    floor: "#4a5e7a",
    visor: "#0a0e1a",
    visorLed: "#5eead4",
    bead: "#8a96aa",
  },
  ocean: {
    robeTop: "#4a7ea6",
    robeBottom: "#1e3a5a",
    sashTop: "#a8c8e8",
    sashBottom: "#5a8ab8",
    sleeve: "#2e5a84",
    skin: "#e8c8a0",
    skinShadow: "#c89e72",
    aura: "#b8d8f0",
    floor: "#6a9ac6",
    visor: "#1a2e3a",
    visorLed: "#1f7da6",
    bead: "#a8c8e8",
  },
  sunrise: {
    robeTop: "#e08a4a",
    robeBottom: "#8a3a1e",
    sashTop: "#f4d27a",
    sashBottom: "#b8923a",
    sleeve: "#b85a2e",
    skin: "#f0c69a",
    skinShadow: "#d99e6a",
    aura: "#ffe7b0",
    floor: "#d4af6e",
    visor: "#2d3748",
    visorLed: "#5eead4",
    bead: "#f0d078",
  },
  jade: {
    robeTop: "#5a9a78",
    robeBottom: "#234a3a",
    sashTop: "#e8d8a8",
    sashBottom: "#9a8a52",
    sleeve: "#3e6e54",
    skin: "#e8b88a",
    skinShadow: "#c89466",
    aura: "#c8f0d8",
    floor: "#7ac39a",
    visor: "#1a2e2a",
    visorLed: "#fbbf24",
    bead: "#e8d8a8",
  },
  twilight: {
    robeTop: "#6a5acd",
    robeBottom: "#2a1e5a",
    sashTop: "#d8b4fe",
    sashBottom: "#7c3aed",
    sleeve: "#4a3a9a",
    skin: "#ecc8a0",
    skinShadow: "#c89e72",
    aura: "#d8c8ff",
    floor: "#9a7acd",
    visor: "#0f0a2a",
    visorLed: "#f0abfc",
    bead: "#e8d8ff",
  },
};

export function Monk({
  variant = "current",
  mood = "smile",
  activity = "idle",
  size = 260,
  isTyping = false,
}: {
  variant?: MonkVariant;
  mood?: MonkMood;
  activity?: MonkActivity;
  size?: number;
  isTyping?: boolean;
}) {
  const p = PALETTES[variant];
  const [t, setT] = useState(0);
  const [blink, setBlink] = useState(false);

  // Activity-driven breath speed
  const breathSpeed =
    activity === "meditate" || activity === "sleep"
      ? 2200
      : activity === "dance"
      ? 500
      : activity === "quiet" || activity === "reflect"
      ? 1800
      : 1400;

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setT((now - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (activity === "sleep" || activity === "meditate") return;
    const id = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 140);
    }, 3200 + Math.random() * 1800);
    return () => clearInterval(id);
  }, [activity]);

  const breath = Math.sin((t * 1000) / breathSpeed) * 0.5 + 0.5;
  const floatY = (breath - 0.5) * (activity === "meditate" ? 10 : 6);
  const baseScale = 1 + (breath - 0.5) * 0.02;

  // Activity-driven body transforms
  const dance = activity === "dance";
  const reflect = activity === "reflect";
  const wave = activity === "wave";
  const meditate = activity === "meditate";
  const sleep = activity === "sleep";

  const sway = dance ? Math.sin(t * 5) * 8 : reflect ? Math.sin(t * 1.2) * 2 : 0;
  const tilt = dance
    ? Math.sin(t * 5) * 6
    : reflect
    ? Math.sin(t * 1.2) * 4
    : sleep
    ? 10
    : 0;
  const bounce = dance ? Math.abs(Math.sin(t * 5)) * -6 : 0;
  const armWiggle = dance ? Math.sin(t * 5 + Math.PI / 2) * 5 : 0;
  const waveAngle = wave ? Math.sin(t * 4) * 20 - 10 : 0;

  // Eyes closed when meditating, quiet, sleeping
  const eyesClosed = meditate || sleep || activity === "quiet";

  const auraBoost = meditate ? 14 + breath * 14 : breath * 8;
  const auraStrokeR = meditate ? 70 + breath * 18 : 62 + breath * 10;

  const mouth =
    sleep
      ? "M92 134 Q100 138 108 134"
      : mood === "smile"
      ? "M86 132 Q100 144 114 132"
      : mood === "wow"
      ? "M100 134 m-6 0 a6 5 0 1 0 12 0 a6 5 0 1 0 -12 0"
      : mood === "wink"
      ? "M86 134 Q100 140 114 134"
      : "M88 134 Q100 138 112 134";

  const eyeShape = (cx: number, isRight: boolean) => {
    if (eyesClosed) {
      return (
        <path
          d={`M${cx - 6} 116 Q${cx} 119 ${cx + 6} 116`}
          stroke="#1a1a1a"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      );
    }
    if (isRight && mood === "wink") {
      return (
        <path
          d={`M${cx - 6} 116 Q${cx} 116 ${cx + 6} 116`}
          stroke="#1a1a1a"
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
        />
      );
    }
    return (
      <ellipse cx={cx} cy="116" rx="2.6" ry={blink ? 0.3 : 2.6} fill="#1a1a1a" />
    );
  };

  const uid = variant;

  return (
    <div className="relative" style={{ width: size * (220 / 260), height: size }}>
      <svg
        viewBox="0 0 200 240"
        width={size * (220 / 260)}
        height={size}
        style={{
          transform: `translate(${sway}px, ${floatY + bounce}px) rotate(${tilt}deg) scale(${baseScale})`,
          transformOrigin: "100px 220px",
          transition: "transform 0.05s linear",
        }}
      >
        <defs>
          <radialGradient id={`floor-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={p.floor} stopOpacity="0.55" />
            <stop offset="100%" stopColor={p.floor} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`robe-${uid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={p.robeTop} />
            <stop offset="100%" stopColor={p.robeBottom} />
          </linearGradient>
          <linearGradient id={`sash-${uid}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor={p.sashTop} />
            <stop offset="100%" stopColor={p.sashBottom} />
          </linearGradient>
          <radialGradient id={`aura-${uid}`} cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor={p.aura} stopOpacity={meditate ? 1 : 0.9} />
            <stop offset="100%" stopColor={p.aura} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`skin-${uid}`} cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor={p.skin} />
            <stop offset="100%" stopColor={p.skinShadow} />
          </radialGradient>
        </defs>

        {/* Floor shadow */}
        <ellipse
          cx="100"
          cy="226"
          rx={46 - floatY * 0.4}
          ry={6}
          fill={`url(#floor-${uid})`}
        />



        {/* Aura halo */}
        <circle cx="100" cy="96" r={56 + auraBoost} fill={`url(#aura-${uid})`} />
        <circle
          cx="100"
          cy="96"
          r={auraStrokeR}
          fill="none"
          stroke={p.aura}
          strokeOpacity={(meditate ? 0.55 : 0.35) - breath * 0.2}
          strokeWidth={meditate ? 1 : 0.6}
        />
        {meditate && (
          <circle
            cx="100"
            cy="96"
            r={80 + breath * 24}
            fill="none"
            stroke={p.aura}
            strokeOpacity={0.4 - breath * 0.35}
            strokeWidth="1"
          />
        )}

      {/* Robe */}
      <path
        d="M52 220 Q60 150 100 150 Q140 150 148 220 Z"
        fill={`url(#robe-${uid})`}
      />
      {/* Sash */}
      <path
        d="M58 180 Q100 196 142 180 L140 192 Q100 208 60 192 Z"
        fill={`url(#sash-${uid})`}
      />
        {/* Arms */}
        {wave ? (
          <>
            {/* left folded */}
            <path
              d="M70 178 Q100 168 130 178 Q128 188 100 184 Q72 188 70 178 Z"
              fill={p.sleeve}
            />
            {/* right waving */}
            <g
              transform={`rotate(${waveAngle} 130 170)`}
            >
              <path
                d="M124 172 Q140 150 152 130 Q160 128 162 134 Q156 156 138 180 Z"
                fill={p.sleeve}
              />
              <circle cx="160" cy="130" r="7" fill={p.skin} />
            </g>
          </>
        ) : reflect ? (
          <>
            {/* left folded across */}
            <path
              d="M70 184 Q100 174 130 184 Q128 192 100 188 Q72 192 70 184 Z"
              fill={p.sleeve}
            />
            {/* right hand to chin */}
            <path
              d="M118 178 Q126 158 120 142 Q116 138 112 142 Q108 158 110 178 Z"
              fill={p.sleeve}
            />
            <circle cx="115" cy="140" r="6" fill={p.skin} />
          </>
        ) : meditate ? (
          <>
            {/* hands resting in lap, palms up */}
            <path
              d="M68 196 Q100 184 132 196 Q130 206 100 204 Q70 206 68 196 Z"
              fill={p.sleeve}
            />
            <circle cx="86" cy="200" r="5" fill={p.skin} />
            <circle cx="114" cy="200" r="5" fill={p.skin} />
          </>
        ) : (
          <g transform={`translate(0 ${armWiggle})`}>
            <path
              d="M70 178 Q100 168 130 178 Q128 188 100 184 Q72 188 70 178 Z"
              fill={p.sleeve}
            />
          </g>
        )}

      {/* Neck */}
      <rect x="93" y="138" width="14" height="14" rx="4" fill={p.skinShadow} />

      {/* Head */}
      <ellipse cx="100" cy="116" rx="30" ry="32" fill={`url(#skin-${uid})`} />
      <ellipse cx="96" cy="96" rx="14" ry="6" fill="#fff" opacity="0.22" />

      {/* AR visor */}
      <rect
        x="74"
        y="104"
        width="52"
        height="4"
        rx="2"
        fill={p.visor}
        opacity="0.9"
      />
        <circle cx="124" cy="106" r="1.6" fill={p.visorLed}>
          <animate
            attributeName="opacity"
            values="0.3;1;0.3"
            dur={dance ? "0.6s" : "1.6s"}
            repeatCount="indefinite"
          />
        </circle>

      {/* Brows */}
      <path
        d="M80 112 Q86 110 92 112"
        stroke="#1a1a1a"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M108 112 Q114 110 120 112"
        stroke="#1a1a1a"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />

        {/* Eyes */}
        {eyeShape(86, false)}
        {eyeShape(118, true)}

        {/* Cheek tint */}
        <circle cx="80" cy="126" r="4" fill="#e88a8a" opacity={dance ? 0.55 : 0.3} />
        <circle cx="120" cy="126" r="4" fill="#e88a8a" opacity={dance ? 0.55 : 0.3} />

      {/* Mouth */}
      <path
        d={mouth}
        stroke="#1a1a1a"
        strokeWidth="2.2"
        fill={mood === "wow" ? "#5a2b2b" : "none"}
        strokeLinecap="round"
      />

      {/* Ear studs */}
      <circle cx="70" cy="122" r="1.8" fill={p.bead} />
      <circle cx="130" cy="122" r="1.8" fill={p.bead} />

      {/* Floating bead */}
      <g
        transform={`translate(100 ${210 + Math.sin(breath * Math.PI * 2) * 2})`}
      >
          <circle r="6" fill={p.bead} opacity="0.95" />
          <circle r="2.5" fill="#fff" opacity="0.7" />
        </g>
      </svg>


      {/* Overlays per activity */}
      {dance && <DanceNotes color={p.bead} t={t} />}
      {sleep && <SleepZs color={p.visor} t={t} />}
      {reflect && <ReflectDots color={p.visor} t={t} />}
      {meditate && <MeditateMotes color={p.aura} t={t} />}
    </div>
  );
}

type ModernMonkProps = {
  variant?: MonkVariant;
  mood?: MonkMood;
  activity?: MonkActivity;
  size?: number;
  message?: string;
  isTyping?: boolean;
  onInteraction?: () => void;
};


export default function ModernMonk({
  variant = "current",
  mood = "smile",
  activity = "idle",
  size = 260,
  message = "Hello! I'm Kenji, and I'm here to help you discover your flow and find your Ikigai.",
  isTyping = false,
  onInteraction
}: ModernMonkProps) {
  const [isActive, setIsActive] = useState(false);

  const handleClick = () => {
    setIsActive(!isActive);
    onInteraction?.();
  };

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Monk Character */}
      <div
        className={`cursor-pointer transition-transform duration-300 ${
          isActive ? 'scale-105' : 'hover:scale-102'
        }`}
        onClick={handleClick}
      >
        <Monk variant={variant} mood={mood} activity={activity} size={size} isTyping={isTyping} />
      </div>

      {/* Speech bubble - ultra compact version */}
      {message && (
        <div className={`relative max-w-xs transition-all duration-500 ${
          isActive ? 'opacity-100 translate-y-0 scale-105' : 'opacity-80 translate-y-1 scale-100'
        }`}>
          <div className="bg-surface border border-slate-200 rounded-lg p-2 shadow-sm transition-all duration-300 hover:shadow-md">
            <p className="text-xs text-text text-center transition-all duration-300 leading-snug" data-testid="monk-message">{message}</p>
            {/* Speech bubble tail - pointing up to Kenji */}
            <div className="absolute -top-1.5 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[5px] border-b-surface"></div>
            <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-b-[3px] border-b-slate-200"></div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Overlay effects ─── */

function DanceNotes({ color, t }: { color: string; t: number }) {
  const notes = [0, 1, 2];
  return (
    <div className="pointer-events-none absolute inset-0">
      {notes.map((i) => {
        const phase = (t * 0.6 + i * 0.4) % 1;
        const x = 20 + i * 30 + Math.sin(t * 2 + i) * 10;
        const y = 100 - phase * 90;
        const op = 1 - phase;
        return (
          <div
            key={i}
            className="absolute text-xl"
            style={{
              left: `${x}%`,
              top: `${y}px`,
              opacity: op,
              color,
              fontWeight: 700,
            }}
          >
            {i % 2 ? "♪" : "♫"}
          </div>
        );
      })}
    </div>
  );
}

function SleepZs({ color, t }: { color: string; t: number }) {
  const zs = [0, 1, 2];
  return (
    <div className="pointer-events-none absolute inset-0">
      {zs.map((i) => {
        const phase = (t * 0.4 + i * 0.45) % 1;
        const y = 80 - phase * 70;
        const x = 60 + phase * 30;
        const op = 1 - phase;
        return (
          <div
            key={i}
            className="absolute font-bold"
            style={{
              left: `${x}%`,
              top: `${y}px`,
              opacity: op * 0.7,
              color,
              fontSize: 14 + phase * 10,
            }}
          >
            z
          </div>
        );
      })}
    </div>
  );
}

function ReflectDots({ color, t }: { color: string; t: number }) {
  const dots = [0, 1, 2];
  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: "62%", top: "30%" }}
    >
      <div
        className="flex items-center gap-1 rounded-full border bg-white/85 px-2 py-1 shadow-sm"
        style={{ borderColor: "rgba(0,0,0,0.08)" }}
      >
        {dots.map((i) => {
          const op = 0.25 + ((Math.sin(t * 3 + i * 1.2) + 1) / 2) * 0.75;
          return (
            <div
              key={i}
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: color, opacity: op }}
            />
          );
        })}
      </div>
    </div>
  );
}

function MeditateMotes({ color, t }: { color: string; t: number }) {
  const motes = [0, 1, 2, 3, 4, 5];
  return (
    <div className="pointer-events-none absolute inset-0">
      {motes.map((i) => {
        const phase = (t * 0.25 + i * 0.18) % 1;
        const angle = i * (Math.PI / 3) + t * 0.4;
        const r = 80 + Math.sin(t + i) * 8;
        const x = 50 + (Math.cos(angle) * r) / 6;
        const y = 50 + (Math.sin(angle) * r) / 6 - phase * 30;
        const op = Math.sin(phase * Math.PI) * 0.7;
        return (
          <div
            key={i}
            className="absolute h-2 w-2 rounded-full blur-[1px]"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              background: color,
              opacity: op,
            }}
          />
        );
      })}
    </div>
  );
}
