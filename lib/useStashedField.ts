'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { clearForm, retrieveForm, stashForm } from './formStash';

// useStashedField — higher-level convenience over lib/formStash.
//
// The low-level primitive silently auto-restored on mount, which
// surprised users ("did I write that?"). This hook keeps the stash
// but exposes any pending draft as pendingRestore instead — parent
// renders <StashRestoreBanner> and lets the user accept or discard.
//
// Semantics (in the spec):
//   - Mount: if stash has a value AND it differs from initialValue,
//     expose it as pendingRestore. Otherwise pendingRestore = null.
//     value always starts at initialValue — we NEVER auto-apply.
//   - Key change: re-derive pendingRestore against the new key. This
//     is what makes the reflect-page-per-category flow work: switch
//     activeCategoryId → hook re-runs derivation → new pending draft.
//   - setValue: updates value AND stashes it. This preserves the
//     original primitive's behavior (stash-on-change) so subsequent
//     re-auth cycles still work.
//   - restore(): apply pendingRestore to value, clear pending.
//   - discard(): clear stash + pending. value stays at whatever the
//     caller passed as initialValue.
//   - clear(): call on successful save — removes the stash so stale
//     content doesn't linger after the value is safely persisted.
//
// Equality: JSON.stringify. Good enough for the string / small-object
// values these forms hold; structured-clonable is what the primitive
// already assumed.

function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export type UseStashedFieldResult<T> = {
  value: T;
  setValue: (next: T | ((prev: T) => T)) => void;
  pendingRestore: T | null;
  restore: () => void;
  discard: () => void;
  clear: () => void;
};

export function useStashedField<T>(
  key: string,
  initialValue: T,
): UseStashedFieldResult<T> {
  const [value, setValueState] = useState<T>(initialValue);
  const [pendingRestore, setPendingRestore] = useState<T | null>(null);

  // Track the last key we derived against so we only re-run the
  // "is there a stashed draft to offer?" check when it actually
  // changes — not on every render. Also lets us skip the initial
  // derivation from stashing over itself.
  const lastKeyRef = useRef<string | null>(null);
  // Snapshot of the initialValue at the time we derived pendingRestore.
  // Used so setValue-driven stash writes don't accidentally trip the
  // "differs from initialValue" check on the same render pass.
  const initialValueRef = useRef<T>(initialValue);

  useEffect(() => {
    // Re-derive on mount and any time the key changes. Reset value
    // to the new initialValue so a category-scoped hook doesn't leak
    // the previous category's typed content.
    initialValueRef.current = initialValue;
    lastKeyRef.current = key;
    const stashed = retrieveForm<T>(key);
    setValueState(initialValue);
    if (stashed !== null && !shallowEqual(stashed, initialValue)) {
      setPendingRestore(stashed);
    } else {
      setPendingRestore(null);
    }
    // We intentionally exclude initialValue from deps: the parent
    // typically re-derives it on every render (e.g. `?? ''`), and we
    // only want to re-key on the stash key itself. If a parent needs
    // to reset, it should change the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValueState((prev) => {
        const resolved =
          typeof next === 'function'
            ? (next as (p: T) => T)(prev)
            : next;
        // Stash on change — same behavior the raw primitive had. If
        // the resolved value happens to match initialValue we still
        // stash it; the mount-time derivation is what decides whether
        // to offer a restore banner, not what's in sessionStorage.
        stashForm(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  const restore = useCallback(() => {
    setPendingRestore((pending) => {
      if (pending === null) return null;
      setValueState(pending);
      // Persist the just-accepted value so a subsequent reload keeps
      // it in place until the user actually saves.
      stashForm(key, pending);
      return null;
    });
  }, [key]);

  const discard = useCallback(() => {
    clearForm(key);
    setPendingRestore(null);
    // Deliberately DO NOT reset value here — the input keeps whatever
    // the parent initialized with (usually empty). Discard means
    // "throw away the old draft," not "wipe what I'm looking at."
  }, [key]);

  const clear = useCallback(() => {
    clearForm(key);
    setPendingRestore(null);
  }, [key]);

  return { value, setValue, pendingRestore, restore, discard, clear };
}
