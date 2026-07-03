'use client';

import { useEffect, useState } from 'react';
import type { MonkVariant } from '../components/ModernMonk';

export function useTheme() {
  const [theme, setTheme] = useState<string>('current');

  useEffect(() => {
    // Get initial theme from HTML data-theme attribute
    const updateTheme = () => {
      const htmlElement = document.documentElement;
      const currentTheme = htmlElement.getAttribute('data-theme') || 'current';
      setTheme(currentTheme);
    };

    updateTheme();

    // Watch for theme changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          updateTheme();
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });

    return () => observer.disconnect();
  }, []);

  return theme;
}

// Map app themes to monk variants
export function getMonkVariantForTheme(theme: string): MonkVariant {
  switch (theme) {
    case 'sunset':
      return 'sunset';
    case 'aurora':
      return 'aurora';
    case 'ocean':
      return 'ocean';
    default:
      return 'current';
  }
}