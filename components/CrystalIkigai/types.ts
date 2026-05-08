export type CrystalDomain = {
  id: string;
  name: string;
  target: number;
  completed: number;
};

export type CrystalVariant = 'current' | 'aurora' | 'sunset' | 'ocean';

export type CrystalTheme = {
  id: CrystalVariant;
  isDark: boolean;
  palette: string[];
  // Background dotted rings.
  ringColor: string;
  // Center hub.
  centerFill: string;
  centerStroke: string;
  glowOpacity: number;
  // Wedge styling — outer (target) ring vs inner (filled) wedge.
  outerFillOpacity: number;
  outerStrokeOpacity: number;
  wedgeShadowOpacity: number;
  wedgeOverlayOpacity: number;
  innerGradientStart: number;
  innerGradientEnd: number;
};

export const CRYSTAL_THEMES: Record<CrystalVariant, CrystalTheme> = {
  current: {
    id: 'current',
    isDark: false,
    // Pastel palette — washed-out outer ring + saturated inner fill,
    // matching the reference screenshot.
    palette: ['#7fb6a1', '#9ec48a', '#8aa8d6', '#d69b8a', '#e0c068', '#b89ad6', '#9ab8c6'],
    ringColor: 'rgba(0,0,0,0.06)',
    centerFill: '#ffffff',
    centerStroke: 'rgba(15,23,42,0.22)',
    glowOpacity: 0.6,
    // Outer-ring "ghost" border styling per prototype: fill 0.18,
    // stroke 0.5 on light / 0.7 on dark.
    outerFillOpacity: 0.18,
    outerStrokeOpacity: 0.5,
    wedgeShadowOpacity: 0.08,
    wedgeOverlayOpacity: 0.12,
    innerGradientStart: 0.85,
    innerGradientEnd: 0.65,
  },
  aurora: {
    id: 'aurora',
    isDark: true,
    // Aurora *is* the neon variant — bright cyan / lime / pink /
    // amber / coral / violet glow palette on the dark canvas.
    palette: ['#22d3ee', '#a3e635', '#f472b6', '#facc15', '#fb7185', '#c084fc', '#5eead4'],
    ringColor: 'rgba(255,255,255,0.08)',
    // Use a dim slate for the hub so it doesn't glare against the dark canvas.
    centerFill: '#1e293b',
    centerStroke: 'rgba(148,163,184,0.45)',
    // Soften the radial glow on dark backgrounds — full white halos read as harsh.
    glowOpacity: 0.08,
    outerFillOpacity: 0.18,
    outerStrokeOpacity: 0.7,
    wedgeShadowOpacity: 0.25,
    // Keep the white sheen on each wedge subtle so it doesn't flatten the colour.
    wedgeOverlayOpacity: 0.05,
    innerGradientStart: 0.95,
    innerGradientEnd: 0.7,
  },
  sunset: {
    id: 'sunset',
    isDark: false,
    palette: ['#fb923c', '#f472b6', '#facc15', '#fb7185', '#c084fc', '#fdba74', '#f87171'],
    ringColor: 'rgba(0,0,0,0.06)',
    centerFill: '#ffffff',
    centerStroke: 'rgba(15,23,42,0.22)',
    glowOpacity: 0.6,
    outerFillOpacity: 0.18,
    outerStrokeOpacity: 0.5,
    wedgeShadowOpacity: 0.08,
    wedgeOverlayOpacity: 0.12,
    innerGradientStart: 0.85,
    innerGradientEnd: 0.65,
  },
  ocean: {
    id: 'ocean',
    isDark: false,
    palette: ['#0ea5e9', '#14b8a6', '#22d3ee', '#3b82f6', '#06b6d4', '#6366f1', '#0d9488'],
    ringColor: 'rgba(0,0,0,0.06)',
    centerFill: '#ffffff',
    centerStroke: 'rgba(15,23,42,0.22)',
    glowOpacity: 0.6,
    outerFillOpacity: 0.18,
    outerStrokeOpacity: 0.5,
    wedgeShadowOpacity: 0.08,
    wedgeOverlayOpacity: 0.12,
    innerGradientStart: 0.85,
    innerGradientEnd: 0.65,
  },
};

// Back-compat re-export so any older importers (and the existing
// barrel) continue to work. New code should read from CRYSTAL_THEMES.
export const CRYSTAL_PALETTES: Record<CrystalVariant, string[]> =
  Object.fromEntries(
    (Object.keys(CRYSTAL_THEMES) as CrystalVariant[]).map((id) => [
      id,
      CRYSTAL_THEMES[id].palette,
    ]),
  ) as Record<CrystalVariant, string[]>;
