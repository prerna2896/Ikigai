export type CrystalDomain = {
  id: string;
  name: string;
  target: number;
  completed: number;
};

export type CrystalVariant = 'current' | 'aurora' | 'sunset' | 'ocean';

export const CRYSTAL_PALETTES: Record<CrystalVariant, string[]> = {
  current: ['#7fb6a1', '#9ec48a', '#8aa8d6', '#d69b8a', '#e0c068', '#b89ad6', '#9ab8c6'],
  aurora: ['#5eead4', '#86efac', '#7dd3fc', '#f0abfc', '#fcd34d', '#a78bfa', '#fb7185'],
  sunset: ['#fb923c', '#f472b6', '#facc15', '#fb7185', '#c084fc', '#fdba74', '#f87171'],
  ocean: ['#0ea5e9', '#14b8a6', '#22d3ee', '#3b82f6', '#06b6d4', '#6366f1', '#0d9488'],
};
