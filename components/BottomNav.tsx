'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const iconClass = 'h-5 w-5';

const PlanIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={iconClass}
    aria-hidden
  >
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const LogIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={iconClass}
    aria-hidden
  >
    <rect x="6" y="4" width="12" height="18" rx="2" />
    <path d="M9 4V2h6v2" />
    <path d="m9 14 2 2 4-4" />
  </svg>
);

const ReflectIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={iconClass}
    aria-hidden
  >
    <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const OverviewIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={iconClass}
    aria-hidden
  >
    <line x1="6" y1="20" x2="6" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="18" y1="20" x2="18" y2="14" />
  </svg>
);

const tabs: ReadonlyArray<{
  label: string;
  href: string;
  testId: string;
  icon: () => ReactNode;
}> = [
  { label: 'Plan', href: '/week/plan', testId: 'bottom-tab-plan', icon: PlanIcon },
  { label: 'Log', href: '/log', testId: 'bottom-tab-log', icon: LogIcon },
  { label: 'Reflect', href: '/reflect', testId: 'bottom-tab-reflect', icon: ReflectIcon },
  { label: 'Overview', href: '/history', testId: 'bottom-tab-overview', icon: OverviewIcon },
];

export default function BottomNav() {
  const pathname = usePathname();

  if (pathname.startsWith('/onboarding')) {
    return null;
  }

  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <nav
      aria-label="Primary"
      data-testid="bottom-nav"
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-themed bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/85 md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-stretch">
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              data-testid={tab.testId}
              className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${
                active ? 'text-accent' : 'text-mutedText'
              }`}
            >
              <Icon />
              <span className="text-[10px] font-medium tracking-wide">
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
