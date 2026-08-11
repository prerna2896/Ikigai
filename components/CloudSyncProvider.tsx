'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createClient as createSupabaseClient } from '../lib/supabase/client';

// M2.4 sync engine — Realtime layer.
//
// Subscribes to Supabase postgres_changes for every user-scoped table
// while a session exists. Each event bumps a monotonic `version`
// counter exposed via context. Consumer components add
// `useCloudSyncVersion()` to their data-loading useEffect deps so they
// refetch when *something* changed for this user — anywhere.
//
// This is the minimal viable sync engine:
//   - Cross-device propagation without manual refresh.
//   - RLS applies to Realtime too (Supabase Realtime honors row-level
//     filters via the caller's JWT), so a user only receives events
//     for their own rows.
//   - Coarse invalidation — one event bumps everything. Fine for our
//     current wipe-and-insert saves and small per-user data set.
//     Fine-grained cache invalidation is M2.4b territory (TanStack
//     Query with typed query keys).
//
// Not included (deferred to later sub-milestones):
//   - TanStack Query cache
//   - Optimistic UI updates
//   - Dexie pending_mutations offline queue with reconnect drain
//   - Version-based conflict rejection (needs finer-grained saves)

const USER_SCOPED_TABLES = [
  'profiles',
  'profile_reflections',
  'profile_goals',
  'settings',
  'domains',
  'week_plans',
  'week_domains',
  'week_tasks',
  'week_goals',
  'hours_logged',
  'week_notes',
] as const;

type CloudSyncContextValue = {
  version: number;
};

const CloudSyncContext = createContext<CloudSyncContextValue>({ version: 0 });

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);

  // Track the signed-in user's id — Realtime filters need it.
  useEffect(() => {
    const supabase = createSupabaseClient();
    let cancelled = false;

    supabase.auth.getUser().then(({ data }: { data: { user: { id?: string } | null } }) => {
      if (!cancelled) setUserId(data.user?.id ?? null);
    }).catch(() => {
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

  // Subscribe to postgres_changes on all user-scoped tables filtered by
  // this user_id. Re-subscribes when userId changes (sign-in / sign-out
  // / user swap).
  useEffect(() => {
    if (!userId) return;
    const supabase = createSupabaseClient();

    // One channel per user session. Include all table subscriptions on
    // it so we only pay one WebSocket connection.
    const channel = supabase.channel(`user:${userId}`);

    for (const table of USER_SCOPED_TABLES) {
      // Any change on any user-scoped table → bump. Consumers refetch
      // via their useEffect deps. Coarse but correct.
      channel.on(
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'public',
          table,
          filter: `user_id=eq.${userId}`,
        } as never,
        (payload: unknown) => {
          // eslint-disable-next-line no-console
          console.debug('[cloud-sync] change', { table, payload });
          setVersion((v) => v + 1);
        },
      );
    }

    channel.subscribe((status: string, err?: Error) => {
      // eslint-disable-next-line no-console
      console.debug('[cloud-sync] subscribe status', status, err?.message);
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const value = useMemo<CloudSyncContextValue>(
    () => ({ version }),
    [version],
  );

  return (
    <CloudSyncContext.Provider value={value}>
      {children}
    </CloudSyncContext.Provider>
  );
}

/**
 * Consumer hook — returns a version counter that increments whenever
 * any cloud table row for the current user changes. Add it to your
 * data-loading useEffect deps to refetch on remote change.
 *
 * Example:
 *   const cloudVersion = useCloudSyncVersion();
 *   useEffect(() => {
 *     if (!repo) return;
 *     repo.get().then(setState);
 *   }, [repo, cloudVersion]);   // <-- refetch on remote change
 */
export function useCloudSyncVersion(): number {
  return useContext(CloudSyncContext).version;
}
