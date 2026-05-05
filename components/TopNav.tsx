'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getLocalRepository } from '@ikigai/storage';

const tabs = [
  { label: 'Plan', href: '/week/plan', testId: 'home-tab-planning' },
  { label: 'Log', href: '/log', testId: 'home-tab-log' },
  { label: 'Reflect', href: '/reflect', testId: 'home-tab-reflect' },
  { label: 'History', href: '/history', testId: 'home-tab-history' },
] as const;

const getInitials = (name: string | null | undefined) => {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '·';
  const parts = trimmed.split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase() || '·';
};

export default function TopNav() {
  const pathname = usePathname();
  const isOnboarding = pathname.startsWith('/onboarding');
  const [initials, setInitials] = useState('·');

  useEffect(() => {
    try {
      const repo = getLocalRepository();
      repo
        .getProfile()
        .then((profile) => setInitials(getInitials(profile?.name)))
        .catch(() => setInitials('·'));
    } catch {
      setInitials('·');
    }
  }, [pathname]);

  const isActive = (href: string) => {
    const path = href.split('?')[0];
    if (path === '/') return pathname === '/' && !href.includes('?');
    return pathname.startsWith(path);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/60 bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-8 sm:py-4">
        <Link
          href="/"
          data-testid="top-nav-home"
          className="flex items-center gap-2 text-sm font-medium tracking-tight text-text"
          aria-label="Ikigai home"
        >
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-full bg-accent"
          />
          <span className="text-base">ikigai</span>
        </Link>
        {isOnboarding ? null : (
          <nav
            aria-label="Primary"
            data-testid="home-tabs"
            className="hidden items-center gap-1 rounded-full md:flex"
          >
            {tabs.map((tab) => {
              const active = isActive(tab.href);
              return (
                <Link
                  key={tab.label}
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  data-testid={tab.testId}
                  className={`rounded-full px-3 py-2 text-sm transition-colors ${
                    active
                      ? 'bg-accent text-white shadow-sm'
                      : 'text-mutedText hover:bg-slate-100 hover:text-text'
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        )}
        <Link
          href="/profile"
          aria-label="Profile"
          data-testid="home-tab-profile"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-xs font-semibold tracking-wide text-white shadow-sm transition-opacity hover:opacity-90"
        >
          {initials}
        </Link>
      </div>
    </header>
  );
}
