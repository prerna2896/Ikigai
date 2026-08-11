'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { getLocalRepository } from '@ikigai/storage';
import { useRepository } from './RepositoryProvider';
import { useCloudSyncVersion } from './CloudSyncProvider';

// Tiny provider that surfaces how many offline mutations are still
// waiting to be replayed. The count drives the "N unsynced" badge in
// TopNav.
//
// Refresh triggers:
//   - Whenever `useCloudSyncVersion` bumps (Realtime saw a change,
//     which usually means the drainer just succeeded and pruned a
//     row — cheap way to react to drains without a second event bus).
//   - On window `online`/`offline` events.
//   - A slow 3s poll while a userId is known — catches enqueue-side
//     changes that happen without a Realtime bump (offline case).

type PendingMutationsContextValue = {
  count: number;
};

const PendingMutationsContext = createContext<PendingMutationsContextValue>({
  count: 0,
});

const POLL_MS = 3_000;

export function PendingMutationsProvider({ children }: { children: ReactNode }) {
  const { status, userId } = useRepository();
  const cloudVersion = useCloudSyncVersion();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (status !== 'signed-in' || !userId) {
      setCount(0);
      return;
    }
    const local = getLocalRepository();
    let cancelled = false;

    const refresh = async () => {
      try {
        const n = await local.countPendingMutations(userId);
        if (!cancelled) setCount(n);
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

  return (
    <PendingMutationsContext.Provider value={{ count }}>
      {children}
    </PendingMutationsContext.Provider>
  );
}

export function usePendingMutationsCount(): number {
  return useContext(PendingMutationsContext).count;
}
