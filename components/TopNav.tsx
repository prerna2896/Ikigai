'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ThemePicker from './ThemePicker';
import { createClient as createSupabaseClient } from '../lib/supabase/client';
import { useRepository } from './RepositoryProvider';
import { useCloudSyncVersion } from './CloudSyncProvider';

const iconClass = 'h-4 w-4';

const OverviewIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClass} aria-hidden>
    <line x1="6" y1="20" x2="6" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="18" y1="20" x2="18" y2="14" />
  </svg>
);

const PlanIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClass} aria-hidden>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const LogIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClass} aria-hidden>
    <rect x="6" y="4" width="12" height="18" rx="2" />
    <path d="M9 4V2h6v2" />
    <path d="m9 14 2 2 4-4" />
  </svg>
);

const ReflectIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClass} aria-hidden>
    <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const tabs: ReadonlyArray<{
  label: string;
  href: string;
  testId: string;
  icon: () => ReactNode;
}> = [
  { label: 'Plan', href: '/week/plan', testId: 'home-tab-planning', icon: PlanIcon },
  { label: 'Log', href: '/log', testId: 'home-tab-log', icon: LogIcon },
  { label: 'Reflect', href: '/reflect', testId: 'home-tab-reflect', icon: ReflectIcon },
  { label: 'Overview', href: '/history', testId: 'home-tab-history', icon: OverviewIcon },
];

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
  const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/auth');
  const isHome = pathname === '/';
  const [initials, setInitials] = useState('·');
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const { profileRepo } = useRepository();
  const cloudVersion = useCloudSyncVersion();

  useEffect(() => {
    if (!profileRepo) {
      // Auth still resolving — leave state at defaults until we know.
      return;
    }
    let cancelled = false;
    profileRepo
      .getProfile()
      .then((profile) => {
        if (cancelled) return;
        setInitials(getInitials(profile?.name));
        setHasOnboarded(Boolean(profile?.name));
      })
      .catch(() => {
        if (cancelled) return;
        setInitials('·');
        setHasOnboarded(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, profileRepo, cloudVersion]);

  // Subscribe to Supabase auth state. Refreshes on pathname change AND on
  // any signIn/signOut event from another tab.
  useEffect(() => {
    const supabase = createSupabaseClient();
    let cancelled = false;
    supabase.auth
      .getUser()
      .then(({ data }: { data: { user: { email?: string } | null } }) => {
        if (!cancelled) setUserEmail(data.user?.email ?? null);
      })
      .catch(() => {
        if (!cancelled) setUserEmail(null);
      });
    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: string, session: { user?: { email?: string } } | null) => {
        setUserEmail(session?.user?.email ?? null);
      },
    );
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [pathname]);

  const isActive = (href: string) => {
    const path = href.split('?')[0];
    if (path === '/') return pathname === '/' && !href.includes('?');
    return pathname.startsWith(path);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/60 bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-8 sm:py-4">
        {isHome ? (
          <span aria-hidden />
        ) : (
          <Link
            href="/"
            data-testid="top-nav-home"
            className="flex items-center gap-2 text-text"
            aria-label="Ikigai home"
          >
            <Image
              src="/brand/mark-light.png"
              alt=""
              aria-hidden
              width={28}
              height={28}
              priority
              className="brand-mark-light h-7 w-7"
            />
            <Image
              src="/brand/mark-dark.png"
              alt=""
              aria-hidden
              width={28}
              height={28}
              priority
              className="brand-mark-dark h-7 w-7"
            />
            <span className="font-serif text-xl font-semibold tracking-tight">
              Ikigai
            </span>
          </Link>
        )}
        {isOnboarding || !hasOnboarded ? null : (
          <nav
            aria-label="Primary"
            data-testid="home-tabs"
            className="hidden items-center gap-1 rounded-full md:flex"
          >
            {tabs.map((tab) => {
              const active = isActive(tab.href);
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.label}
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  data-testid={tab.testId}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm transition-colors ${
                    active
                      ? 'bg-accent text-white shadow-sm'
                      : 'text-mutedText hover:bg-slate-100 hover:text-text'
                  }`}
                >
                  <Icon />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        )}
        <div className="flex items-center gap-2">
          <ThemePicker />
          {isAuthRoute ? null : userEmail ? (
            // Signed-in state: no visible email — that's on the profile
            // page. Just the Sign out affordance. title= gives a hover
            // hint on desktop for anyone who wants to double-check
            // which account they're in.
            <form action="/auth/logout" method="post" title={userEmail}>
              <button
                type="submit"
                data-testid="top-nav-logout"
                className="rounded-full border border-slate-200 px-3 py-1 text-xs text-mutedText hover:text-text"
              >
                Sign out
              </button>
            </form>
          ) : (
            <Link
              href={
                pathname === '/' || pathname === '/login'
                  ? '/login'
                  : `/login?next=${encodeURIComponent(pathname)}`
              }
              data-testid="top-nav-login"
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-mutedText hover:text-text"
            >
              Sign in
            </Link>
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
      </div>
    </header>
  );
}
