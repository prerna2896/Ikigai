'use client';

// SessionExpiredHandler — one modal, mounted once at layout level,
// listens for two triggers and shows a re-auth prompt.
//
// Triggers:
//   1. The `ikigai:session-expired` global event, published by any
//      repo wrapper (OfflineAwareCloudRepository) or background job
//      (CloudMigrationRunner) that catches a 401 / JWT-expired error.
//   2. Supabase's own onAuthStateChange firing SIGNED_OUT while the
//      user is on a signed-in-ish route. This covers cases where the
//      SDK proactively invalidates the session (e.g. refresh token
//      revoked server-side, admin deleted the user).
//
// The modal itself is deliberately minimal:
//   - Says the session expired and their work-in-progress is preserved.
//   - Has ONE CTA: "Sign in" — links to /login?next=<current-path>
//     so the existing middleware redirect-back logic kicks in.
//   - Provides a "Dismiss" secondary that just closes the modal; some
//     users may want to keep reading local data before signing back in.
//     (Offline-aware reads will still serve from Dexie mirror.)
//
// What this DOES NOT do:
//   - It doesn't sign the user out on its own. The Supabase SDK's
//     internal state does that. This just surfaces it.
//   - It doesn't clear local Dexie data. Those are the user's — they
//     survive across accounts on this browser only until a NEW user
//     signs in (see shared-phone leak guard in the M4 migrator).
//   - It doesn't stash forms. Callers wire lib/formStash into
//     individual forms; the modal just makes sure the user comes back.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { onSessionExpired } from '../lib/authEvents';
import { createClient } from '../lib/supabase/client';

export function SessionExpiredHandler() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Trigger 1: the app-side event bus.
  useEffect(() => {
    return onSessionExpired(() => setOpen(true));
  }, []);

  // Trigger 2: Supabase-side SIGNED_OUT events. We DON'T show the modal
  // for user-initiated sign-outs (they clicked Sign Out) — those land on
  // routes that don't need auth (`/`) and would create a confusing UX.
  // Heuristic: skip if pathname is `/`, `/login`, or `/auth/*`.
  useEffect(() => {
    const skipRoutes =
      pathname === '/' ||
      pathname.startsWith('/login') ||
      pathname.startsWith('/auth');
    if (skipRoutes) return;

    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange(
      (event: string) => {
        if (event === 'SIGNED_OUT') setOpen(true);
      },
    );
    return () => sub.subscription.unsubscribe();
  }, [pathname]);

  if (!open) return null;

  const nextParam =
    pathname && pathname !== '/' && pathname !== '/login'
      ? `?next=${encodeURIComponent(pathname)}`
      : '';

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
      data-testid="session-expired-modal"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-lg">
        <h2
          id="session-expired-title"
          className="text-lg font-semibold text-text"
        >
          Your session has expired
        </h2>
        <p className="mt-2 text-sm text-mutedText">
          Sign in again to save your changes. Anything you were typing is
          preserved and will be restored when you come back.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            data-testid="session-expired-dismiss"
            onClick={() => setOpen(false)}
            className="rounded-full border border-slate-200 px-4 py-2 text-xs text-mutedText hover:text-text"
          >
            Not now
          </button>
          <Link
            href={`/login${nextParam}`}
            data-testid="session-expired-signin"
            onClick={() => setOpen(false)}
            className="rounded-full bg-accent px-4 py-2 text-xs font-medium text-white shadow-sm hover:opacity-90"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
