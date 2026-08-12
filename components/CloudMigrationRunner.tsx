'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { getLocalRepository } from '@ikigai/storage';
import { LocalToCloudMigrator, type MigrationResult } from '@ikigai/cloud-storage';
import { createClient as createSupabaseClient } from '../lib/supabase/client';
import { errorMessage, isAuthExpiredError } from '../lib/errors';
import { emitSessionExpired } from '../lib/authEvents';

// M4 — runs LocalToCloudMigrator once per user, per browser.
//
// Fires when a signed-in session is detected. Checks the Dexie
// migration marker for this user's id. If not yet marked, runs the
// migration (idempotent — the marker + insert-not-upsert pattern
// makes accidental re-runs safe). Marks and stops.
//
// Invisible when done. Shows a small "Syncing your data" banner
// while running (rare — under a second locally, single-digit
// seconds against remote Supabase).
//
// Failure modes and how each is surfaced:
//   - Network-shaped failure mid-migration: yellow "reconnecting" pill
//     instead of a scary red error. Auto-retries on `online` events
//     and via a safety poll every 30s. No marker is set (the migrator
//     only marks on success) so re-attempts pick up where they left
//     off, and cloud-wins skips whatever already landed.
//   - Auth-expired: routes through the global session-expired handler
//     so the same modal fires as everywhere else.
//   - Any other error (RLS, validation, FK): red banner with the raw
//     message — those are real bugs we need to see.
//
// Placement: mount at layout level, alongside other providers.

// Local network-error classifier. Duplicated from
// packages/cloud-storage/src/offlineAwareCloudRepository.ts to avoid
// dragging the whole repo wrapper into this file just for one check.
function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }
  if (!err) return false;
  // Supabase wraps thrown errors in plain PostgrestError-like objects
  // that aren't `instanceof Error`, so `err.message` needs to be read
  // off any object shape — not just native Error instances.
  let message = '';
  if (err instanceof Error) {
    message = err.message;
  } else if (typeof err === 'object') {
    const anyErr = err as { message?: unknown; details?: unknown };
    if (typeof anyErr.message === 'string') message = anyErr.message;
    else if (typeof anyErr.details === 'string') message = anyErr.details;
  } else {
    message = String(err);
  }
  if (/Failed to fetch/i.test(message)) return true;
  if (/NetworkError/i.test(message)) return true;
  if (/network request failed/i.test(message)) return true;
  return false;
}

type State =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'network-waiting' }
  | { kind: 'done'; result: MigrationResult }
  | { kind: 'error'; message: string };

export function CloudMigrationRunner(): ReactNode {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [userId, setUserId] = useState<string | null>(null);
  // Bumping this counter re-triggers the migration effect below —
  // used for `online`-event retries and the safety poll without
  // needing a second useEffect that duplicates all the migrator
  // setup.
  const [retryTick, setRetryTick] = useState(0);

  // Track the current session's user id. Re-fires migration check
  // whenever the session appears (initial load OR a sign-in later).
  useEffect(() => {
    const supabase = createSupabaseClient();
    let cancelled = false;
    supabase.auth
      .getUser()
      .then(({ data }: { data: { user: { id?: string } | null } }) => {
        if (!cancelled) setUserId(data.user?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setUserId(null);
      });
    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: string, session: { user?: { id?: string } } | null) => {
        setUserId(session?.user?.id ?? null);
      },
    );
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // When we're in network-waiting, listen for the browser flipping
  // back online AND run a low-cost safety poll every 30s. Either
  // triggers a retry by bumping retryTick, which re-enters the
  // migration effect below with clean state.
  useEffect(() => {
    if (state.kind !== 'network-waiting') return;
    const bumpRetry = () => setRetryTick((tick) => tick + 1);
    window.addEventListener('online', bumpRetry);
    const pollId = window.setInterval(bumpRetry, 30_000);
    return () => {
      window.removeEventListener('online', bumpRetry);
      window.clearInterval(pollId);
    };
  }, [state.kind]);

  // When userId becomes non-null OR retryTick advances, check the
  // marker and (if needed) run the migration.
  useEffect(() => {
    if (!userId) return;
    const supabase = createSupabaseClient();
    let cancelled = false;

    (async () => {
      let local;
      try {
        local = getLocalRepository();
      } catch {
        console.debug('[m4] no LocalRepository (SSR?); skipping');
        return;
      }

      const migrator = new LocalToCloudMigrator(local, supabase, userId);
      if (await migrator.isAlreadyMigrated()) {
        console.debug('[m4] already migrated for user', userId);
        if (!cancelled) {
          setState({
            kind: 'done',
            result: {
              ranAt: new Date().toISOString(),
              migratedProfile: false,
              migratedSettings: false,
              migratedWeekPlans: 0,
              migratedWeekLogs: 0,
              migratedWeekNotes: 0,
              skippedReason: 'already-migrated',
            },
          });
        }
        return;
      }

      console.debug('[m4] running migration for user', userId);
      setState({ kind: 'running' });
      try {
        const result = await migrator.run();
        console.debug('[m4] migration done', result);
        if (!cancelled) setState({ kind: 'done', result });
      } catch (err) {
        console.error('[m4] migration failed', err);
        if (cancelled) return;

        // Auth expired: route through the global session-expired
        // handler for the modal. Falls through to the red-banner
        // branch below on purpose — the banner is redundant with the
        // modal but harmless, and preserves the exact behavior from
        // PR #18. If it turns out to be visually noisy in prod we can
        // return here.
        if (isAuthExpiredError(err)) {
          emitSessionExpired();
        }

        // Network-shaped failure: friendly "reconnecting" pill, will
        // auto-retry via the network-waiting effect above. Don't set
        // the migrator marker (that only happens on run() success),
        // so the retry re-executes from the top and cloud-wins skips
        // whatever already landed.
        if (isNetworkError(err)) {
          console.debug('[m4] network failure, will retry when online');
          setState({ kind: 'network-waiting' });
          return;
        }

        const raw = errorMessage(err);
        // FK violation on auth.users usually means the JWT is
        // pointing at a user that no longer exists in auth.users
        // (dev DB was reset, account was deleted, etc.). Turn the
        // opaque Postgres message into something actionable.
        const isStaleSession =
          raw.includes('profiles_user_id_users_id_fk') ||
          raw.includes('users_id_fk');
        setState({
          kind: 'error',
          message: isStaleSession
            ? 'Your session is out of date. Please sign out and sign in again.'
            : raw,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, retryTick]);

  if (state.kind === 'idle') return null;
  if (state.kind === 'running') {
    return (
      <div
        role="status"
        data-testid="cloud-migration-running"
        className="fixed bottom-4 right-4 z-50 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs text-mutedText shadow-sm"
      >
        Syncing your data…
      </div>
    );
  }
  if (state.kind === 'network-waiting') {
    return (
      <div
        role="status"
        data-testid="cloud-migration-network-waiting"
        className="fixed bottom-4 right-4 z-50 max-w-xs rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 shadow-sm"
      >
        Sync paused — reconnecting when your network is back.
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div
        role="alert"
        data-testid="cloud-migration-error"
        className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700 shadow-sm"
      >
        Couldn&apos;t sync your local data: {state.message}
      </div>
    );
  }
  // Done — announce briefly for the test hook, but visually hidden.
  return (
    <span
      data-testid="cloud-migration-done"
      data-migrated-profile={state.result.migratedProfile}
      data-migrated-settings={state.result.migratedSettings}
      data-migrated-week-plans={state.result.migratedWeekPlans}
      className="sr-only"
    >
      Sync complete
    </span>
  );
}
