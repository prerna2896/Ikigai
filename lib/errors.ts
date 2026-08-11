// Turn any thrown value into a user-readable string.
//
// Motivation: Supabase's PostgrestError is a plain object with a
// `message` (and `code`, `details`, `hint`) — no toString override — so
// `String(err)` produces the notorious "[object Object]". This helper
// pulls out the useful text without leaking internal shape.
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const anyErr = err as {
      message?: unknown;
      code?: unknown;
      details?: unknown;
    };
    if (typeof anyErr.message === 'string') return anyErr.message;
    if (typeof anyErr.details === 'string') return anyErr.details;
    if (typeof anyErr.code === 'string') return `error ${anyErr.code}`;
    try {
      return JSON.stringify(err);
    } catch {
      return 'Unknown error';
    }
  }
  return String(err);
}
