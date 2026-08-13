'use client';

// StashRestoreBanner — the "you had a draft here" surface for the
// form-stash primitive (lib/formStash.ts + lib/useStashedField.ts).
//
// Why this exists as its own component (vs. silent auto-fill, which
// is what shipped originally):
//   - Silent restore surprised users — "did I write that?"
//   - Restoring is a user decision, not a system one. This asks.
//   - Amber (matches CloudMigrationRunner + offline-queue pill) is the
//     project's existing "attention, non-destructive" palette. Reusing
//     it means one visual language for all "we saved something for you"
//     UX, not a bespoke color for each.
//
// Kept intentionally dumb — parent owns state (via useStashedField)
// and just calls onRestore / onDiscard. This component does no
// sessionStorage work of its own.

type StashRestoreBannerProps = {
  message?: string;
  onRestore: () => void;
  onDiscard: () => void;
};

const DEFAULT_MESSAGE = 'We saved a draft from earlier.';

export function StashRestoreBanner({
  message = DEFAULT_MESSAGE,
  onRestore,
  onDiscard,
}: StashRestoreBannerProps) {
  return (
    <div
      role="status"
      data-testid="stash-restore-banner"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
    >
      <span className="min-w-0 flex-1">{message}</span>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onRestore}
          data-testid="stash-restore-accept"
          className="rounded-full bg-amber-600 px-3 py-1 text-[11px] font-medium text-white shadow-sm hover:bg-amber-700"
        >
          Restore
        </button>
        <button
          type="button"
          onClick={onDiscard}
          data-testid="stash-restore-discard"
          className="rounded-full border border-amber-300 px-3 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
