// Tiny sessionStorage wrapper for preserving in-progress form input
// across a re-auth cycle. Motivation: session expires while a user is
// mid-typing → they get bounced to /login → they come back → their
// input should still be there.
//
// sessionStorage (not localStorage) because:
//   - It survives page reloads and navigations within the same tab.
//   - It's wiped when the tab closes, matching user expectation of
//     "in-progress work is per-session."
//   - It's origin-scoped, same as the auth cookie.
//
// Keys are namespaced under `ikigai:formStash:` so they're easy to
// find in DevTools and won't collide with app-level storage keys.
// Values are JSON-serialized — callers pass any structured-clonable
// thing.

const NAMESPACE = 'ikigai:formStash:';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export function stashForm(key: string, value: unknown): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.setItem(NAMESPACE + key, JSON.stringify(value));
  } catch {
    // sessionStorage can throw on quota-exceeded or private-mode
    // Safari. Silent no-op is fine — worst case the user loses one
    // form's draft, same as before this helper existed.
  }
}

export function retrieveForm<T = unknown>(key: string): T | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.sessionStorage.getItem(NAMESPACE + key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function clearForm(key: string): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.removeItem(NAMESPACE + key);
  } catch {
    // See stashForm — silent no-op.
  }
}
