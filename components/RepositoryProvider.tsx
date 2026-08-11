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
import { CloudRepository } from '@ikigai/cloud-storage';
import { createClient as createSupabaseClient } from '../lib/supabase/client';

// M2.3 scope: Profile + Settings + WeekPlan + WeekLog + WeekNote go to
// Cloud when signed in, Local when not. (Domain catalog remains
// Local-only — it's a separate cross-week concept the app doesn't yet
// use meaningfully.)
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
  profileRepo: ProfileRepository | null;
  settingsRepo: SettingsRepository | null;
  weekPlanRepo: WeekPlanRepository | null;
  weekLogRepo: WeekLogRepository | null;
  weekNoteRepo: WeekNoteRepository | null;
};

const RepositoryContext = createContext<RepoContextValue>({
  status: undefined,
  profileRepo: null,
  settingsRepo: null,
  weekPlanRepo: null,
  weekLogRepo: null,
  weekNoteRepo: null,
});

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SignedInStatus>(undefined);

  useEffect(() => {
    const supabase = createSupabaseClient();
    let cancelled = false;

    supabase.auth
      .getUser()
      .then(({ data }: { data: { user: unknown } }) => {
        if (!cancelled)
          setStatus(data.user ? 'signed-in' : 'signed-out');
      })
      .catch(() => {
        if (!cancelled) setStatus('signed-out');
      });

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: string, session: unknown) => {
        setStatus(session ? 'signed-in' : 'signed-out');
      },
    );

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<RepoContextValue>(() => {
    if (status === undefined) {
      return {
        status,
        profileRepo: null,
        settingsRepo: null,
        weekPlanRepo: null,
        weekLogRepo: null,
        weekNoteRepo: null,
      };
    }
    if (status === 'signed-in') {
      const supabase = createSupabaseClient();
      const cloud = new CloudRepository(supabase);
      return {
        status,
        profileRepo: cloud,
        settingsRepo: cloud,
        weekPlanRepo: cloud,
        weekLogRepo: cloud,
        weekNoteRepo: cloud,
      };
    }
    // signed-out
    const local = getLocalRepository();
    return {
      status,
      profileRepo: local,
      settingsRepo: local,
      weekPlanRepo: local,
      weekLogRepo: local,
      weekNoteRepo: local,
    };
  }, [status]);

  return (
    <RepositoryContext.Provider value={value}>
      {children}
    </RepositoryContext.Provider>
  );
}

export function useRepository(): RepoContextValue {
  return useContext(RepositoryContext);
}
