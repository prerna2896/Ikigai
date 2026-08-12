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
// with no network hits a raw fetch error and loses the write, or
// sees a broken screen because a read failed.
//
// This wrapper closes that gap without introducing a full sync engine:
//   - Reads try cloud first. On success we mirror the response into
//     Dexie fire-and-forget so a later offline read has something
//     fresh to serve. On a *network-shaped* failure we return the
//     Dexie mirror instead of throwing. On any OTHER error (RLS,
//     validation, 5xx) we re-throw — those are real bugs and hiding
//     them behind stale cached data would mask them from users.
//   - Writes attempt the cloud call first. On a *network-shaped*
//     failure (Failed to fetch / NetworkError / navigator.onLine
//     false) we:
//       1. Mirror the write to Dexie so the UI reflects it
//          immediately — the CloudSyncProvider will re-render via its
//          usual version bump once the drainer finishes replaying it.
//       2. Enqueue a pending_mutations row so queueDrain.ts can
//          replay it when we come back online.
//     On any OTHER error (RLS, validation, 5xx from Supabase) we
//     re-throw for the same reason as reads.
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

  // ─── Reads (with Dexie fallback on network failure) ────────────────────

  // Try cloud; on network failure serve from the Dexie mirror; on any
  // other failure re-throw. On cloud success we also opportunistically
  // update the mirror so a later offline read has current data.
  private async readOrMirror<T>(
    cloudCall: () => Promise<T>,
    mirrorRead: () => Promise<T>,
    mirrorWrite: (value: T) => Promise<void>,
  ): Promise<T> {
    try {
      const value = await cloudCall();
      // Fire-and-forget mirror update. If the mirror write fails
      // (validation, quota) it just means the next offline read has
      // stale-or-empty data; the current call still returns cloud-fresh.
      mirrorWrite(value).catch(() => {});
      return value;
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      return mirrorRead();
    }
  }

  getProfile(): Promise<Profile | null> {
    return this.readOrMirror(
      () => this.cloud.getProfile(),
      () => this.local.getProfile(),
      // Skip mirror write if cloud has nothing to store — otherwise
      // we'd overwrite the Dexie profile with null and blank the
      // user's local state after every sign-in read.
      async (value) => {
        if (value) await this.local.saveProfile(value);
      },
    );
  }

  getSettings(): Promise<Settings> {
    return this.readOrMirror(
      () => this.cloud.getSettings(),
      () => this.local.getSettings(),
      (value) => this.local.saveSettings(value),
    );
  }

  getWeekPlan(weekStartISO: string): Promise<WeekPlan | null> {
    return this.readOrMirror(
      () => this.cloud.getWeekPlan(weekStartISO),
      () => this.local.getWeekPlan(weekStartISO),
      async (value) => {
        if (value) await this.local.saveWeekPlan(value);
      },
    );
  }

  listWeekPlans(): Promise<WeekPlan[]> {
    return this.readOrMirror(
      () => this.cloud.listWeekPlans(),
      () => this.local.listWeekPlans(),
      // Mirror each plan individually; saveWeekPlan is an upsert so
      // this converges the local set to the cloud snapshot without
      // needing a bulk-replace primitive.
      async (plans) => {
        for (const plan of plans) {
          await this.local.saveWeekPlan(plan);
        }
      },
    );
  }

  getWeekLogs(weekId: string): Promise<WeekLogEntry[]> {
    return this.readOrMirror(
      () => this.cloud.getWeekLogs(weekId),
      () => this.local.getWeekLogs(weekId),
      async (entries) => {
        for (const entry of entries) {
          await this.local.saveWeekLog(entry);
        }
      },
    );
  }

  getWeekNote(weekId: string): Promise<WeekNote | null> {
    return this.readOrMirror(
      () => this.cloud.getWeekNote(weekId),
      () => this.local.getWeekNote(weekId),
      async (value) => {
        if (value) await this.local.saveWeekNote(value);
      },
    );
  }

  listWeekNotes(weekId: string): Promise<WeekNote[]> {
    return this.readOrMirror(
      () => this.cloud.listWeekNotes(weekId),
      () => this.local.listWeekNotes(weekId),
      async (notes) => {
        for (const note of notes) {
          await this.local.saveWeekNote(note);
        }
      },
    );
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
