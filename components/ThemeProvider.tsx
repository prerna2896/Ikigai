'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemeId = 'current' | 'aurora' | 'sunset' | 'ocean';

export const THEMES: Array<{
  id: ThemeId;
  label: string;
  description: string;
}> = [
  { id: 'current', label: 'Current', description: 'Calm cream + sage' },
  { id: 'aurora', label: 'Aurora', description: 'Dark navy + neon' },
  { id: 'sunset', label: 'Sunset', description: 'Warm cream + clay' },
  { id: 'ocean', label: 'Ocean', description: 'Cool sky + teal' },
];

const STORAGE_KEY = 'ikigai-theme';
const DEFAULT_THEME: ThemeId = 'current';

type ThemeContextValue = {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
});

const isThemeId = (value: string | null): value is ThemeId =>
  value === 'current' ||
  value === 'aurora' ||
  value === 'sunset' ||
  value === 'ocean';

const applyThemeAttribute = (theme: ThemeId) => {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(DEFAULT_THEME);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const next = isThemeId(stored) ? stored : DEFAULT_THEME;
      setThemeState(next);
      applyThemeAttribute(next);
    } catch {
      applyThemeAttribute(DEFAULT_THEME);
    }
  }, []);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    applyThemeAttribute(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore — theme just won't persist
    }
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
