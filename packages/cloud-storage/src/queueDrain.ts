import type { LocalRepository, PendingMutation } from '@ikigai/storage';
import type {
  Profile,
  Settings,
  WeekLogEntry,
  WeekNote,
  WeekPlan,
} from '@ikigai/core';
import type { CloudRepository } from './cloudRepository';

// Drain worker — periodically replays queued Dexie mutations against
// Supabase and prunes them on success. Not a full sync engine, just the
// counterpart to OfflineAwareCloudRepository.
//
// Trigger points:
//   - `online` window event — reconnect drain, the common case.
//   - 30s poll while online — safety net in case the `online` event
//     fires while we're not mounted (Safari background tab, etc).
//   - Immediate tick on start so a page reload after regaining network
//     drains without waiting.
//
// Ordering: mutations are replayed FIFO by createdAt. Dependent writes
// (e.g. saveWeekPlan → saveWeekLog referencing that plan's tasks)
// therefore replay in the order the user made them.
//
// Failure policy: if a single replay throws, we STOP draining that
// tick. Continuing would blast through a broken queue and mis-report
// downstream failures as "unrelated" errors. The failing entry gets
// its retries counter bumped and lastError stored so the UI (or a
// future support tool) can surface it. Beyond MAX_RETRIES the entry
// stays put with lastError set — it needs human/admin attention.

const POLL_INTERVAL_MS = 30_000;
const MAX_RETRIES = 5;

async function replayOne(
  cloud: CloudRepository,
  entry: PendingMutation,
): Promise<void> {
  // The args are stored as-is (deep-cloned by IndexedDB's structured
  // clone). Cast at the boundary since we validated shape on enqueue
  // by virtue of already-having-called-through the same repo methods.
  const args = entry.args as unknown[];
  switch (entry.op) {
    case 'saveProfile':
      await cloud.saveProfile(args[0] as Profile);
      return;
    case 'deleteProfile':
      await cloud.deleteProfile(args[0] as string);
      return;
    case 'saveSettings':
      await cloud.saveSettings(args[0] as Settings);
      return;
    case 'saveWeekPlan':
      await cloud.saveWeekPlan(args[0] as WeekPlan);
      return;
    case 'deleteWeekPlan':
      await cloud.deleteWeekPlan(args[0] as string);
      return;
    case 'saveWeekLog':
      await cloud.saveWeekLog(args[0] as WeekLogEntry);
      return;
    case 'retractWeekLog':
      await cloud.retractWeekLog(args[0] as WeekLogEntry);
      return;
    case 'saveWeekNote':
      await cloud.saveWeekNote(args[0] as WeekNote);
      return;
    default:
      // An op we don't recognize means the queue was written by a
      // newer client version. Rather than silently drop, mark it as
      // errored so it's visible.
      throw new Error(`Unknown queued op: ${entry.op}`);
  }
}

export function startQueueDrainer(
  cloud: CloudRepository,
  local: LocalRepository,
  userId: string,
): () => void {
  let cancelled = false;
  let draining = false;

  const tick = async () => {
    if (cancelled || draining) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      // No point trying if the browser knows we're offline.
      return;
    }
    draining = true;
    try {
      const pending = await local.listPendingMutations(userId);
      for (const entry of pending) {
        if (cancelled) return;
        if (entry.retries >= MAX_RETRIES) {
          // Leave it for support — but don't let a poisoned entry
          // block the entries behind it. This is a rare enough case
          // that skipping (vs stopping) is the pragmatic call.
          continue;
        }
        try {
          await replayOne(cloud, entry);
          await local.removePendingMutation(entry.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await local.updatePendingMutationError(entry.id, message);
          // Stop draining on the first failure — protects the queue's
          // invariant of ordered replay and avoids error-log floods.
          return;
        }
      }
    } finally {
      draining = false;
    }
  };

  // Fire once immediately so a reload right after regaining network
  // doesn't have to wait for the poll or the online event.
  void tick();

  const onOnline = () => {
    void tick();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
  }

  const interval =
    typeof window !== 'undefined'
      ? window.setInterval(() => void tick(), POLL_INTERVAL_MS)
      : null;

  return () => {
    cancelled = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline);
    }
    if (interval !== null) {
      window.clearInterval(interval);
    }
  };
}
