'use client';

// One-time disclosure shown before first use of the Kenji companion
// chat — not a therapist, AI not a person. Shell copied from
// SessionExpiredHandler.tsx (the one existing modal pattern in this
// codebase); differs in what the two actions do: "Continue" persists
// acknowledgment and unlocks the chat, "Not now" navigates back to
// /insights rather than just dismissing in place — there's nothing
// useful to look at behind this modal until it's acknowledged.

import Link from 'next/link';
import { COMPANION_DISCLOSURE_TEXT } from '@ikigai/companion';

export function CompanionDisclosureModal({
  onAcknowledge,
  saving = false,
}: {
  onAcknowledge: () => void;
  saving?: boolean;
}) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="companion-disclosure-title"
      data-testid="companion-disclosure-modal"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-lg">
        <h2 id="companion-disclosure-title" className="text-lg font-semibold text-text">
          Before you talk with Kenji
        </h2>
        <p className="mt-2 text-sm text-mutedText">{COMPANION_DISCLOSURE_TEXT}</p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Link
            href="/insights"
            data-testid="companion-disclosure-decline"
            className="rounded-full border border-slate-200 px-4 py-2 text-xs text-mutedText hover:text-text"
          >
            Not now
          </Link>
          <button
            type="button"
            data-testid="companion-disclosure-accept"
            onClick={onAcknowledge}
            disabled={saving}
            className="rounded-full bg-accent px-4 py-2 text-xs font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
