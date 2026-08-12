// Global event bus for auth-related signals. Kept tiny and
// dependency-free — this is fundamentally a fanout from "any place
// that noticed the session died" to "the one UI component that shows
// the re-auth modal."
//
// We use a module-scoped EventTarget rather than a React context so
// non-React code (repo wrappers, migration runner) can publish without
// wiring anything through the component tree. SessionExpiredHandler
// subscribes on mount.
//
// SSR guard: EventTarget doesn't exist server-side, so we lazily
// construct on first access on the client. Publishers running during
// SSR (there shouldn't be any) become no-ops.

const EVENT_NAME = 'ikigai:session-expired' as const;

let target: EventTarget | null = null;

function getTarget(): EventTarget | null {
  if (typeof window === 'undefined') return null;
  if (!target) target = new EventTarget();
  return target;
}

export function emitSessionExpired(): void {
  const t = getTarget();
  if (!t) return;
  t.dispatchEvent(new Event(EVENT_NAME));
}

export function onSessionExpired(listener: () => void): () => void {
  const t = getTarget();
  if (!t) return () => {};
  const wrapped = () => listener();
  t.addEventListener(EVENT_NAME, wrapped);
  return () => t.removeEventListener(EVENT_NAME, wrapped);
}
