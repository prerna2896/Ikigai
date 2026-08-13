'use client';

// Diagnostic page for the M4 cloud-migration flow. Purely informational:
// reads Dexie's `meta` store, shows every `cloudMigratedAt:<userId>`
// marker present in this browser, shows the current Supabase session's
// user id, and offers a per-row Delete button so a user can surgically
// clear a stale marker without wiping their whole Dexie DB.
//
// M4.2 extension: also shows the offline write queue
// (`pending_mutations`) with per-row Retry / Discard actions. This is
// the escape hatch for entries that crossed MAX_RETRIES in the queue
// drainer — without it a poisoned row would live in Dexie forever
// with `lastError` populated but no way for the user to act on it.
//
// This is intentionally reachable in production. It exposes nothing
// beyond what a user could already see in DevTools → Application →
// IndexedDB — just makes it doable from a phone without desktop tooling.

import { useCallback, useEffect, useState } from 'react';
import {
  getLocalRepository,
  type PendingMutation,
} from '@ikigai/storage';
import { createClient } from '../../../lib/supabase/client';
import { usePendingMutations } from '../../../components/PendingMutationsProvider';

// Kept in sync with queueDrain.ts MAX_RETRIES. See the same constant
// in PendingMutationsProvider for the reasoning on duplication.
const MAX_RETRIES = 5;

type MarkerRow = { key: string; value: string; isCurrentUser: boolean };

type State =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      userId: string | null;
      markers: MarkerRow[];
      profileName: string | null;
      weekPlans: number;
    }
  | { kind: 'error'; message: string };

// Render a rough "3 minutes ago" without pulling in a formatter dep.
// Precision doesn't matter here — the UI just needs to convey "old"
// vs "recent" so users know whether a stuck row has been sitting.
function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const deltaSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const min = Math.round(deltaSec / 60);
  if (min < 60) return `${min} min${min === 1 ? '' : 's'} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr${hr === 1 ? '' : 's'} ago`;
  const days = Math.round(hr / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export default function SyncStatusPage() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);

  // Pending-mutations queue lives in its own bit of state so it can
  // refresh independently of the (heavier) markers/profile snapshot.
  const { list: listPending } = usePendingMutations();
  const [pending, setPending] = useState<PendingMutation[]>([]);
  const [pendingBusyId, setPendingBusyId] = useState<number | null>(null);

  const refreshPending = useCallback(async () => {
    const rows = await listPending();
    setPending(rows);
  }, [listPending]);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id ?? null;

      const local = getLocalRepository();
      const keys = await local.listMetaKeys('cloudMigratedAt:');
      const markers: MarkerRow[] = await Promise.all(
        keys.map(async (key) => {
          const value = (await local.getMeta(key)) ?? '';
          const markerUserId = key.slice('cloudMigratedAt:'.length);
          return { key, value, isCurrentUser: markerUserId === userId };
        }),
      );

      // Also pull a quick snapshot of Dexie state so the user can see
      // what data they'd expect migration to lift.
      const profile = await local.getProfile();
      const plans = await local.listWeekPlans();

      setState({
        kind: 'ready',
        userId,
        markers,
        profileName: profile?.name ?? null,
        weekPlans: plans.length,
      });
      await refreshPending();
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [refreshPending]);

  useEffect(() => {
    load();
  }, [load]);

  const deleteMarker = async (key: string) => {
    if (!confirm(`Delete marker for ${key}? Migration will re-attempt on next sign-in / reload.`)) return;
    setBusy(true);
    try {
      const local = getLocalRepository();
      // No dedicated deleteMeta on the repo — set to null-ish then delete via raw Dexie is overkill.
      // Direct IDB delete on the `meta` store keeps this a client-only surgical op.
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('ikigai');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('meta', 'readwrite');
          tx.objectStore('meta').delete(key);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
        req.onerror = () => reject(req.error);
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const retryPending = async (id: number) => {
    setPendingBusyId(id);
    try {
      const local = getLocalRepository();
      await local.retryPendingMutation(id);
      // Kick the drainer so a click-through-Retry replays without
      // waiting for the 30s poll. `online` is the drainer's public
      // trigger — no need for a bespoke event.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('online'));
      }
      await refreshPending();
    } finally {
      setPendingBusyId(null);
    }
  };

  const discardPending = async (id: number, op: string) => {
    if (!confirm(`Discard queued ${op}? The local mirror stays; the cloud write will never happen.`)) return;
    setPendingBusyId(id);
    try {
      const local = getLocalRepository();
      await local.deletePendingMutation(id);
      await refreshPending();
    } finally {
      setPendingBusyId(null);
    }
  };

  const poisoned = pending.filter((row) => row.retries >= MAX_RETRIES);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-mutedText">Diagnostic</p>
        <h1 className="font-serif text-3xl font-semibold">Cloud sync status</h1>
        <p className="text-sm text-mutedText">
          Shows migration markers in this browser&rsquo;s IndexedDB and the currently
          signed-in user. A stale marker for a different user will silently
          skip cloud migration on sign-in (shared-phone guard).
        </p>
      </header>

      {state.kind === 'loading' && <p className="text-sm text-mutedText">Loading…</p>}

      {state.kind === 'error' && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <p className="font-medium">Error</p>
          <p className="mt-1">{state.message}</p>
        </div>
      )}

      {state.kind === 'ready' && (
        <>
          <section className="rounded-2xl border border-slate-200 bg-surface p-5">
            <h2 className="text-sm font-semibold text-text">Session</h2>
            <p className="mt-2 text-sm">
              Signed-in user id:{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                {state.userId ?? '(none — signed out)'}
              </code>
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-surface p-5">
            <h2 className="text-sm font-semibold text-text">Local (Dexie) snapshot</h2>
            <p className="mt-2 text-sm">
              Profile name:{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                {state.profileName ?? '(none)'}
              </code>
            </p>
            <p className="mt-1 text-sm">
              Week plans in Dexie: <strong>{state.weekPlans}</strong>
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-surface p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-text">Pending mutations</h2>
              {pending.length === 0 ? null : poisoned.length > 0 ? (
                <span
                  data-testid="poisoned-mutations-header"
                  className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800"
                >
                  {poisoned.length} poisoned — need your attention
                </span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  {pending.length} pending
                </span>
              )}
            </div>
            {pending.length === 0 ? (
              <p className="mt-2 text-sm text-mutedText">
                No queued writes. Everything is synced.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {pending.map((row) => {
                  const isPoisoned = row.retries >= MAX_RETRIES;
                  const disabled = pendingBusyId === row.id;
                  return (
                    <li
                      key={row.id}
                      data-testid="pending-mutation-row"
                      data-poisoned={isPoisoned ? 'true' : 'false'}
                      className={`rounded-lg border p-3 ${
                        isPoisoned
                          ? 'border-rose-300 bg-rose-50'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p className="font-mono text-xs font-semibold text-text">
                          {row.op}
                        </p>
                        <p className="text-xs text-mutedText">
                          {relativeTime(row.createdAt)}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-mutedText">
                        Retries: <strong>{row.retries}</strong> / {MAX_RETRIES}
                      </p>
                      {row.lastError ? (
                        <p
                          data-testid="pending-mutation-error"
                          className="mt-2 break-words rounded bg-slate-100 px-2 py-1 font-mono text-[11px] text-rose-800"
                        >
                          {row.lastError}
                        </p>
                      ) : null}
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          data-testid="pending-mutation-retry"
                          onClick={() => retryPending(row.id)}
                          disabled={disabled}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-text hover:bg-slate-50 disabled:opacity-50"
                        >
                          Retry
                        </button>
                        <button
                          type="button"
                          data-testid="pending-mutation-discard"
                          onClick={() => discardPending(row.id, row.op)}
                          disabled={disabled}
                          className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                        >
                          Discard
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-surface p-5">
            <h2 className="text-sm font-semibold text-text">Migration markers</h2>
            {state.markers.length === 0 ? (
              <p className="mt-2 text-sm text-mutedText">
                No <code>cloudMigratedAt:*</code> markers in Dexie. Migration will run
                fresh on the next sign-in.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {state.markers.map((row) => (
                  <li
                    key={row.key}
                    className={`rounded-lg border p-3 ${
                      row.isCurrentUser ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50'
                    }`}
                  >
                    <p className="break-all text-xs font-mono">{row.key}</p>
                    <p className="mt-1 text-xs text-mutedText">Marked at: {row.value}</p>
                    <p className="mt-1 text-xs">
                      {row.isCurrentUser ? (
                        <span className="text-emerald-700">✓ Belongs to current user</span>
                      ) : (
                        <span className="text-amber-800">
                          ⚠ Belongs to a DIFFERENT user — this is what&rsquo;s blocking migration
                          for the current session
                        </span>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => deleteMarker(row.key)}
                      disabled={busy}
                      className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-text hover:bg-slate-50 disabled:opacity-50"
                    >
                      Delete this marker
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <button
            type="button"
            onClick={load}
            disabled={busy}
            className="rounded-full border border-slate-300 px-4 py-2 text-xs text-mutedText hover:text-text disabled:opacity-50"
          >
            Refresh
          </button>

          <p className="text-xs text-mutedText">
            After deleting a stale marker, reload the app (or navigate to <code>/</code>) and
            sign in again — the M4 migration will re-attempt and either lift the Dexie data
            into cloud or surface a visible error we can act on.
          </p>
        </>
      )}
    </main>
  );
}
