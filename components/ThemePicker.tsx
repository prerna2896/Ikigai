'use client';

import { useEffect, useRef, useState } from 'react';
import { THEMES, useTheme, type ThemeId } from './ThemeProvider';

const SWATCHES: Record<ThemeId, [string, string]> = {
  current: ['#f6f5f2', '#5f7f7b'],
  aurora: ['#0a0e1a', '#5eead4'],
  sunset: ['#fdf5ed', '#e07a3c'],
  ocean: ['#f1f7fb', '#1f7da6'],
};

export default function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  const swatch = SWATCHES[current.id];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Theme: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        data-testid="theme-picker-toggle"
        className="flex h-9 items-center gap-2 rounded-full border border-themed bg-surface px-3 text-xs text-mutedText transition-colors hover:border-themed-strong hover:text-text"
      >
        <span
          aria-hidden
          className="flex h-4 w-4 overflow-hidden rounded-full border border-themed"
        >
          <span style={{ backgroundColor: swatch[0] }} className="h-full w-1/2" />
          <span style={{ backgroundColor: swatch[1] }} className="h-full w-1/2" />
        </span>
        <span className="hidden text-text sm:inline">{current.label}</span>
      </button>
      {open ? (
        <ul
          role="menu"
          data-testid="theme-picker-menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-themed bg-surface text-sm shadow-lg"
        >
          {THEMES.map((option) => {
            const optionSwatch = SWATCHES[option.id];
            const selected = option.id === theme;
            return (
              <li key={option.id}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  data-testid={`theme-option-${option.id}`}
                  onClick={() => {
                    setTheme(option.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-bg/40 ${
                    selected ? 'bg-bg/60' : ''
                  }`}
                >
                  <span
                    aria-hidden
                    className="flex h-5 w-5 shrink-0 overflow-hidden rounded-full border border-themed"
                  >
                    <span
                      style={{ backgroundColor: optionSwatch[0] }}
                      className="h-full w-1/2"
                    />
                    <span
                      style={{ backgroundColor: optionSwatch[1] }}
                      className="h-full w-1/2"
                    />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-text">{option.label}</span>
                    <span className="text-[11px] text-mutedText">
                      {option.description}
                    </span>
                  </span>
                  {selected ? (
                    <span aria-hidden className="ml-auto text-accent">
                      ✓
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
