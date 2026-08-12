// Does this error indicate the user's session has expired / is no longer
// valid? Callers use this to decide whether to prompt for re-auth
// instead of surfacing a generic "something went wrong."
//
// Supabase surfaces auth expiry in several shapes depending on which
// SDK layer failed:
//   - PostgREST 401 → PostgrestError with `code: 'PGRST301'` (JWT
//     expired) or `code: 'PGRST302'` (JWT invalid). Message often
//     contains "JWT expired" or "not authenticated".
//   - Direct auth API 401 → AuthApiError with `status: 401` and
//     `__isAuthError: true`.
//   - Wrapped fetch response → `status: 401` on the response envelope.
// We check all three shapes so any layer surfacing a real auth failure
// funnels into the same UX.
export function isAuthExpiredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
    __isAuthError?: unknown;
  };
  if (anyErr.__isAuthError === true) return true;
  if (anyErr.status === 401) return true;
  if (typeof anyErr.code === 'string' && /^PGRST30[12]$/.test(anyErr.code)) {
    return true;
  }
  if (typeof anyErr.message === 'string') {
    const m = anyErr.message.toLowerCase();
    if (m.includes('jwt expired')) return true;
    if (m.includes('invalid jwt')) return true;
    // "not authenticated" appears in PostgREST 401 details.
    if (m.includes('not authenticated')) return true;
  }
  return false;
}

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
