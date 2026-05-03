'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { label: 'Home', icon: '🏠', href: '/' },
  { label: 'Plan', icon: '📋', href: '/week/plan' },
  { label: 'Log', icon: '✏️', href: '/' },
  { label: 'History', icon: '📊', href: '/history' },
] as const;

export default function BottomNav() {
  const pathname = usePathname();

  if (pathname.startsWith('/onboarding')) {
    return null;
  }

  return (
    <nav
      className="bottom-nav fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-stretch">
        {tabs.map((tab) => {
          const isActive =
            tab.href === '/'
              ? pathname === '/'
              : pathname.startsWith(tab.href);
          return (
            <Link
              key={`${tab.label}-${tab.href}`}
              href={tab.href}
              className={`flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5 ${
                isActive ? 'text-[#5f7f7b]' : 'text-[#6b7280]'
              }`}
            >
              <span className="text-xl leading-none">{tab.icon}</span>
              <span className="text-[10px] uppercase tracking-wide font-medium">
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
