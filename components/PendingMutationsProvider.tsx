'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getLocalRepository, type PendingMutation } from '@ikigai/storage';
import { useRepository } from './RepositoryProvider';
import { useCloudSyncVersion } from './CloudSyncProvider';

// Tiny provider that surfaces how many offline mutations are still
// waiting to be replayed. The count drives the "N unsynced" badge in
// TopNav. `poisonedCount` (retries >= MAX_RETRIES) drives the amber →
// red tint switch and the /dev/sync-status callout.
//
// Refresh triggers:
//   - Whenever `useCloudSyncVersion` bumps (Realtime saw a change,
//     which usually means the drainer just succeeded and pruned a
//     row — cheap way to react to drains without a second event bus).
//   - On window `online`/`offline` events.
//   - A slow 3s poll while a userId is known — catches enqueue-side
//     changes that happen without a Realtime bump (offline case).

// Kept in sync with queueDrain.ts MAX_RETRIES. Duplicated (rather
// than imported) because pulling cloud-storage into this component
// only for a numeric constant would drag its Supabase deps into any
// bundle that renders TopNav. If the drainer's limit ever changes,
// update both.
const MAX_RETRIES = 5;

type PendingMutationsContextValue = {
  count: number;
  poisonedCount: number;
  list: () => Promise<PendingMutation[]>;
};

const PendingMutationsContext = createContext<PendingMutationsContextValue>({
  count: 0,
  poisonedCount: 0,
  list: async () => [],
});

const POLL_MS = 3_000;

export function PendingMutationsProvider({ children }: { children: ReactNode }) {
  const { status, userId } = useRepository();
  const cloudVersion = useCloudSyncVersion();
  const [count, setCount] = useState(0);
  const [poisonedCount, setPoisonedCount] = useState(0);

  useEffect(() => {
    if (status !== 'signed-in' || !userId) {
      setCount(0);
      setPoisonedCount(0);
      return;
    }
    const local = getLocalRepository();
    let cancelled = false;

    const refresh = async () => {
      try {
        // Pull the full list once — cheap (queue is small) and lets us
        // compute both totals off the same snapshot so the UI never
        // shows an inconsistent (count=0, poisonedCount=1) pair.
        const rows = await local.listPendingMutations(userId);
        if (cancelled) return;
        setCount(rows.length);
        setPoisonedCount(rows.filter((r) => r.retries >= MAX_RETRIES).length);
      } catch {
        // Dexie can throw during rare open/upgrade races; a stale
        // count is fine — next tick will reconcile.
      }
    };
    void refresh();

    const onOnlineOffline = () => void refresh();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnlineOffline);
      window.addEventListener('offline', onOnlineOffline);
    }
    const interval =
      typeof window !== 'undefined'
        ? window.setInterval(() => void refresh(), POLL_MS)
        : null;

    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnlineOffline);
        window.removeEventListener('offline', onOnlineOffline);
      }
      if (interval !== null) window.clearInterval(interval);
    };
  }, [status, userId, cloudVersion]);

  // Stable `list()` for the inspector page. Returns [] when there's
  // no signed-in user so consumers don't have to guard on status
  // themselves — the inspector page is diagnostic and should still
  // load, just empty, for signed-out users.
  const list = useCallback(async (): Promise<PendingMutation[]> => {
    if (status !== 'signed-in' || !userId) return [];
    try {
      const local = getLocalRepository();
      return await local.listPendingMutations(userId);
    } catch {
      return [];
    }
  }, [status, userId]);

  const value = useMemo(
    () => ({ count, poisonedCount, list }),
    [count, poisonedCount, list],
  );

  return (
    <PendingMutationsContext.Provider value={value}>
      {children}
    </PendingMutationsContext.Provider>
  );
}

export function usePendingMutationsCount(): number {
  return useContext(PendingMutationsContext).count;
}

export function usePendingMutationsPoisonedCount(): number {
  return useContext(PendingMutationsContext).poisonedCount;
}

// Full context — for the inspector page which needs `list()` alongside
// the counts. Keeping the two count-only hooks above lets TopNav
// subscribe without pulling in the list callback identity.
export function usePendingMutations(): PendingMutationsContextValue {
  return useContext(PendingMutationsContext);
}
