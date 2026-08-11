'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getLocalRepository } from '@ikigai/storage';
import type {
  ProfileRepository,
  SettingsRepository,
  WeekPlanRepository,
  WeekLogRepository,
  WeekNoteRepository,
} from '@ikigai/storage';
import {
  CloudRepository,
  OfflineAwareCloudRepository,
  startQueueDrainer,
} from '@ikigai/cloud-storage';
import { createClient as createSupabaseClient } from '../lib/supabase/client';

// M2.3 scope: Profile + Settings + WeekPlan + WeekLog + WeekNote go to
// Cloud when signed in, Local when not. (Domain catalog remains
// Local-only — it's a separate cross-week concept the app doesn't yet
// use meaningfully.)
//
// Offline queue (M4.1): while signed in, the cloud repository is
// wrapped in OfflineAwareCloudRepository so writes that fail with a
// network-shaped error are mirrored to Dexie and enqueued for later
// replay. startQueueDrainer takes care of that replay on the `online`
// event and via a slow poll.
//
// signedInStatus:
//   undefined: not yet resolved (first render, before Supabase responds)
//   'signed-in': cloud repos active
//   'signed-out': local repos active
//
// Consumers that need to render before auth is known should treat
// `undefined` as loading and hold off on repo access.

type SignedInStatus = 'signed-in' | 'signed-out' | undefined;

type RepoContextValue = {
  status: SignedInStatus;
  userId: string | null;
  profileRepo: ProfileRepository | null;
  settingsRepo: SettingsRepository | null;
  weekPlanRepo: WeekPlanRepository | null;
  weekLogRepo: WeekLogRepository | null;
  weekNoteRepo: WeekNoteRepository | null;
};

const RepositoryContext = createContext<RepoContextValue>({
  status: undefined,
  userId: null,
  profileRepo: null,
  settingsRepo: null,
  weekPlanRepo: null,
  weekLogRepo: null,
  weekNoteRepo: null,
});

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SignedInStatus>(undefined);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseClient();
    let cancelled = false;

    supabase.auth
      .getUser()
      .then(({ data }: { data: { user: { id?: string } | null } }) => {
        if (cancelled) return;
        setStatus(data.user ? 'signed-in' : 'signed-out');
        setUserId(data.user?.id ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('signed-out');
        setUserId(null);
      });

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: string, session: { user?: { id?: string } } | null) => {
        setStatus(session ? 'signed-in' : 'signed-out');
        setUserId(session?.user?.id ?? null);
      },
    );

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Kick off the drain worker whenever we have a signed-in user id.
  // Tearing it down on sign-out (or user swap) is important —
  // otherwise a stale drainer could replay one user's queue against
  // another user's session.
  useEffect(() => {
    if (status !== 'signed-in' || !userId) return;
    const supabase = createSupabaseClient();
    const cloud = new CloudRepository(supabase);
    const local = getLocalRepository();
    const stop = startQueueDrainer(cloud, local, userId);
    return () => stop();
  }, [status, userId]);

  const value = useMemo<RepoContextValue>(() => {
    if (status === undefined) {
      return {
        status,
        userId,
        profileRepo: null,
        settingsRepo: null,
        weekPlanRepo: null,
        weekLogRepo: null,
        weekNoteRepo: null,
      };
    }
    if (status === 'signed-in' && userId) {
      const supabase = createSupabaseClient();
      const cloud = new CloudRepository(supabase);
      const local = getLocalRepository();
      // Wrap so offline writes fall back to the Dexie queue instead
      // of surfacing as fetch errors to the UI.
      const wrapped = new OfflineAwareCloudRepository(cloud, local, userId);
      return {
        status,
        userId,
        profileRepo: wrapped,
        settingsRepo: wrapped,
        weekPlanRepo: wrapped,
        weekLogRepo: wrapped,
        weekNoteRepo: wrapped,
      };
    }
    // signed-out (or signed-in but userId not yet resolved) — use local.
    const local = getLocalRepository();
    return {
      status,
      userId,
      profileRepo: local,
      settingsRepo: local,
      weekPlanRepo: local,
      weekLogRepo: local,
      weekNoteRepo: local,
    };
  }, [status, userId]);

  return (
    <RepositoryContext.Provider value={value}>
      {children}
    </RepositoryContext.Provider>
  );
}

export function useRepository(): RepoContextValue {
  return useContext(RepositoryContext);
}
