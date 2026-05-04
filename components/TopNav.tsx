'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { label: 'Home', href: '/', testId: 'home-tab-home' },
  { label: 'Get started', href: '/onboarding/context', testId: 'home-tab-get-started' },
  { label: 'Plan', href: '/week/plan', testId: 'home-tab-planning' },
  { label: 'Log', href: '/log', testId: 'home-tab-log' },
  { label: 'Reflect', href: '/reflect', testId: 'home-tab-reflect' },
  { label: 'Profile', href: '/profile', testId: 'home-tab-profile' },
  { label: 'History', href: '/history', testId: 'home-tab-history' },
] as const;

export default function TopNav() {
  const pathname = usePathname();

  if (pathname.startsWith('/onboarding')) {
    return null;
  }

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
          className="flex items-center gap-2 text-sm font-medium tracking-tight text-text"
          aria-label="Ikigai home"
        >
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-full bg-accent"
          />
          <span className="text-base">ikigai</span>
        </Link>
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
        <Link
          href="/settings"
          className="text-sm text-mutedText transition-colors hover:text-text"
        >
          Setup
        </Link>
      </div>
    </header>
  );
}
