'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { getLocalRepository } from '@ikigai/storage';
import { LocalToCloudMigrator, type MigrationResult } from '@ikigai/cloud-storage';
import { createClient as createSupabaseClient } from '../lib/supabase/client';
import { errorMessage } from '../lib/errors';

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
// Placement: mount at layout level, alongside other providers.

type State =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: MigrationResult }
  | { kind: 'error'; message: string };

export function CloudMigrationRunner(): ReactNode {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [userId, setUserId] = useState<string | null>(null);

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

  // When userId becomes non-null, check the marker and (if needed)
  // run the migration.
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
        if (!cancelled) {
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
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

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
