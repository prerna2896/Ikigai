import type {
  Profile,
  Settings,
  WeekLogEntry,
  WeekNote,
  WeekPlan,
} from '@ikigai/core';
import type {
  ProfileRepository,
  SettingsRepository,
  WeekPlanRepository,
  WeekLogRepository,
  WeekNoteRepository,
  LocalRepository,
} from '@ikigai/storage';
import type { CloudRepository } from './cloudRepository';

// OfflineAwareCloudRepository — the third leg of the sync story.
//
// RepositoryProvider today swaps LocalRepository (signed-out) for
// CloudRepository (signed-in). That leaves a gap: a signed-in user
// with no network hits a raw fetch error and loses the write.
//
// This wrapper closes that gap without introducing a full sync engine:
//   - Reads pass through to cloud unchanged. (If cloud is unreachable
//     the caller sees the error today — same behavior as before.
//     Read-through fallback to Dexie is a natural stretch but is
//     out of scope for this milestone.)
//   - Writes attempt the cloud call first. On a *network-shaped*
//     failure (Failed to fetch / NetworkError / navigator.onLine
//     false) we:
//       1. Mirror the write to Dexie so the UI reflects it
//          immediately — the CloudSyncProvider will re-render via its
//          usual version bump once the drainer finishes replaying it.
//       2. Enqueue a pending_mutations row so queueDrain.ts can
//          replay it when we come back online.
//     On any OTHER error (RLS, validation, 5xx from Supabase) we
//     re-throw — those are real bugs and silently queueing them would
//     hide them from users and from Sentry.
//
// The wrapper implements the same 5 repository interfaces the raw
// CloudRepository does, so RepositoryProvider consumers don't need
// to know which one they got.

function isNetworkError(err: unknown): boolean {
  // Two clues, either sufficient:
  //   1. The browser has flipped offline. Trust it — cheap and definitive.
  //   2. The error looks like a fetch/network failure. `TypeError:
  //      Failed to fetch` is what browsers throw on fetch-level
  //      network trouble; `NetworkError` is Firefox's shape; the
  //      Supabase JS client wraps these but keeps the message.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }
  if (!err) return false;
  const message = err instanceof Error ? err.message : String(err);
  if (/Failed to fetch/i.test(message)) return true;
  if (/NetworkError/i.test(message)) return true;
  if (/network request failed/i.test(message)) return true;
  // Supabase's PostgrestError wraps status codes; if there is NO
  // status/code and only a message that reads like a fetch failure,
  // fall through above. Otherwise this is a real API-level failure and
  // must not be queued.
  return false;
}

export class OfflineAwareCloudRepository
  implements
    ProfileRepository,
    SettingsRepository,
    WeekPlanRepository,
    WeekLogRepository,
    WeekNoteRepository
{
  constructor(
    private readonly cloud: CloudRepository,
    private readonly local: LocalRepository,
    private readonly userId: string,
  ) {}

  // ─── Reads (pass-through) ──────────────────────────────────────────────

  getProfile(): Promise<Profile | null> {
    return this.cloud.getProfile();
  }

  getSettings(): Promise<Settings> {
    return this.cloud.getSettings();
  }

  getWeekPlan(weekStartISO: string): Promise<WeekPlan | null> {
    return this.cloud.getWeekPlan(weekStartISO);
  }

  listWeekPlans(): Promise<WeekPlan[]> {
    return this.cloud.listWeekPlans();
  }

  getWeekLogs(weekId: string): Promise<WeekLogEntry[]> {
    return this.cloud.getWeekLogs(weekId);
  }

  getWeekNote(weekId: string): Promise<WeekNote | null> {
    return this.cloud.getWeekNote(weekId);
  }

  listWeekNotes(weekId: string): Promise<WeekNote[]> {
    return this.cloud.listWeekNotes(weekId);
  }

  // ─── Writes (offline-aware) ────────────────────────────────────────────

  // Wrap a cloud write with the try-cloud-then-mirror-and-enqueue
  // pattern. Kept as a single method so each write below is a
  // one-liner and the retry/enqueue policy lives in one place.
  private async runOrQueue<T>(
    op: string,
    args: unknown[],
    cloudCall: () => Promise<T>,
    localMirror: () => Promise<void>,
  ): Promise<T | void> {
    try {
      const result = await cloudCall();
      // Even on success we mirror to Dexie so a later offline read
      // fallback (stretch) has fresh data. Non-blocking — best-effort.
      localMirror().catch(() => {});
      return result;
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      // Mirror BEFORE enqueue so a UI refetch right after this call
      // sees the write. If the mirror itself fails we still enqueue —
      // the cloud replay is the source of truth.
      await localMirror().catch(() => {});
      await this.local.enqueueMutation({ userId: this.userId, op, args });
      return;
    }
  }

  async saveProfile(profile: Profile): Promise<void> {
    await this.runOrQueue(
      'saveProfile',
      [profile],
      () => this.cloud.saveProfile(profile),
      () => this.local.saveProfile(profile),
    );
  }

  async deleteProfile(profileId: string): Promise<void> {
    await this.runOrQueue(
      'deleteProfile',
      [profileId],
      () => this.cloud.deleteProfile(profileId),
      () => this.local.deleteProfile(profileId),
    );
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.runOrQueue(
      'saveSettings',
      [settings],
      () => this.cloud.saveSettings(settings),
      () => this.local.saveSettings(settings),
    );
  }

  async saveWeekPlan(plan: WeekPlan): Promise<void> {
    await this.runOrQueue(
      'saveWeekPlan',
      [plan],
      () => this.cloud.saveWeekPlan(plan),
      () => this.local.saveWeekPlan(plan),
    );
  }

  async deleteWeekPlan(weekId: string): Promise<void> {
    await this.runOrQueue(
      'deleteWeekPlan',
      [weekId],
      () => this.cloud.deleteWeekPlan(weekId),
      () => this.local.deleteWeekPlan(weekId),
    );
  }

  async saveWeekLog(entry: WeekLogEntry): Promise<void> {
    await this.runOrQueue(
      'saveWeekLog',
      [entry],
      () => this.cloud.saveWeekLog(entry),
      () => this.local.saveWeekLog(entry),
    );
  }

  async saveWeekNote(note: WeekNote): Promise<void> {
    await this.runOrQueue(
      'saveWeekNote',
      [note],
      () => this.cloud.saveWeekNote(note),
      () => this.local.saveWeekNote(note),
    );
  }
}
