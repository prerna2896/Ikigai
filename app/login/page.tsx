'use client';

// Force runtime rendering. The Supabase client this page instantiates
// needs NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY,
// which aren't guaranteed to be present in the build environment
// (Vercel builds without the runtime env vars until deploy time).
// Static prerender would then explode with "@supabase/ssr: Your
// project's URL and API key are required" during Export.
export const dynamic = 'force-dynamic';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { createClient } from '../../lib/supabase/client';

// A single unified form. One email input, one 6-digit code input, two
// clearly-labelled buttons:
//   Email me a code  — triggers signInWithOtp; user gets an email
//                       containing the 6-digit code (and a link as a
//                       secondary option).
//   Sign in with code — verifies the entered 6-digit code against the
//                       entered email; enabled only when both are set.
//
// Copy leads with the code path because that's the only flow that
// works cleanly for iOS PWA users: magic-link taps open in Safari,
// whose session cookies don't reach the PWA context, so users tap
// the link → sign in in Safari → return to the PWA → still signed
// out. Typing the code inside the PWA sets the session in the PWA
// context. Cross-device (read email on phone, type on iPad) also
// works with the code.

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; email: string; resending: boolean; justResent: boolean }
  | { kind: 'verifying' }
  | { kind: 'error'; message: string };

function LoginForm() {
  // createClient() is called lazily inside handlers, not at render-time,
  // because it reads env vars synchronously and would blow up during
  // build-time static evaluation if those vars are absent.
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = params.get('next') || '/';
  const urlError = params.get('error');

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<Status>(
    urlError ? { kind: 'error', message: urlError } : { kind: 'idle' },
  );

  const emailIsSet = email.trim().length > 3;
  const codeIsSet = code.trim().replace(/\s/g, '').length === 6;
  const busy = status.kind === 'sending' || status.kind === 'verifying';

  const sendMagicLink = async (
    address: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> => {
    // The emailed link points at /auth/confirm?token_hash=…&type=…&next=…
    // (see supabase/templates/*.html). emailRedirectTo isn't consulted
    // by our custom templates, but Supabase requires *some* value for
    // the redirect allowlist check.
    const emailRedirectTo = new URL(
      `/auth/confirm?next=${encodeURIComponent(nextPath)}`,
      window.location.origin,
    ).toString();

    const { error } = await createClient().auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo },
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  };

  const handleSendLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!emailIsSet || busy) return;
    const trimmed = email.trim().toLowerCase();
    setStatus({ kind: 'sending' });
    const result = await sendMagicLink(trimmed);
    if (!result.ok) {
      setStatus({ kind: 'error', message: result.message });
      return;
    }
    setStatus({
      kind: 'sent',
      email: trimmed,
      resending: false,
      justResent: false,
    });
  };

  const handleResend = async () => {
    if (status.kind !== 'sent' || status.resending) return;
    setStatus({ ...status, resending: true, justResent: false });
    const result = await sendMagicLink(status.email);
    if (!result.ok) {
      setStatus({ kind: 'error', message: result.message });
      return;
    }
    setStatus({
      kind: 'sent',
      email: status.email,
      resending: false,
      justResent: true,
    });
  };

  const handleVerifyCode = async () => {
    if (!emailIsSet || !codeIsSet || busy) return;
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedCode = code.trim().replace(/\s/g, '');
    setStatus({ kind: 'verifying' });

    // verifyOtp with type='email' consumes the 6-digit token that
    // ships in every magic-link/signup email as {{ .Token }}. Works
    // cross-device: user reads the code on their phone, types it on
    // the iPad.
    const { error } = await createClient().auth.verifyOtp({
      email: trimmedEmail,
      token: trimmedCode,
      type: 'email',
    });

    if (error) {
      setStatus({ kind: 'error', message: error.message });
      return;
    }
    // Session cookie is set client-side by the Supabase JS SDK; the
    // middleware picks it up on the next request.
    const dest = nextPath.startsWith('/') ? nextPath : '/';
    router.push(dest);
    router.refresh();
  };

  return (
    <main
      data-testid="login-page"
      className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12"
    >
      <header className="space-y-2 text-center">
        <h1 className="font-serif text-4xl font-semibold tracking-tight text-text">
          Sign in
        </h1>
        <p className="text-sm text-mutedText">
          We&apos;ll email you a 6-digit code. Enter it here to sign in.
          (There&apos;s also a link in the email if you prefer.)
        </p>
      </header>

      <form onSubmit={handleSendLink} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-mutedText">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
            data-testid="login-email"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-text outline-none focus:border-accent"
            placeholder="you@example.com"
          />
        </label>

        <button
          type="submit"
          disabled={!emailIsSet || busy || status.kind === 'sent'}
          data-testid="login-send-link"
          className="inline-flex w-full items-center justify-center rounded-xl bg-accent px-4 py-3 text-base font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {status.kind === 'sending' ? 'Sending…' : 'Email me a code'}
        </button>

        <div className="flex items-center gap-3 pt-2 text-[11px] uppercase tracking-widest text-mutedText/70">
          <span className="h-px flex-1 bg-slate-200" aria-hidden />
          Enter your code
          <span className="h-px flex-1 bg-slate-200" aria-hidden />
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-mutedText">
            6-digit code
          </span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
            }
            disabled={busy}
            data-testid="login-code-token"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-2xl tracking-[0.5em] text-text outline-none focus:border-accent"
            placeholder="000000"
          />
        </label>

        <button
          type="button"
          disabled={!emailIsSet || !codeIsSet || busy}
          data-testid="login-verify-code"
          onClick={handleVerifyCode}
          className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-medium text-text transition-colors hover:bg-slate-50 disabled:opacity-60"
        >
          {status.kind === 'verifying' ? 'Verifying…' : 'Sign in with code'}
        </button>
      </form>

      {status.kind === 'sent' ? (
        <div
          role="status"
          data-testid="login-sent"
          className="rounded-2xl border border-slate-200 bg-surface p-4 text-sm text-text"
        >
          <p className="font-medium">Check your email.</p>
          <p className="mt-1 text-mutedText">
            We sent a 6-digit code to <strong>{status.email}</strong>. Type it
            above to sign in — this works on any device, including apps saved
            to your home screen. The email also contains a link if you&apos;d
            rather click.
          </p>
          {status.justResent ? (
            <p className="mt-2 text-xs text-emerald-700">
              Sent another one — check your inbox.
            </p>
          ) : null}
          <div className="mt-3 flex items-center gap-4 text-xs">
            <button
              type="button"
              data-testid="login-resend"
              disabled={status.resending}
              onClick={handleResend}
              className="text-mutedText underline-offset-2 hover:underline hover:text-text disabled:opacity-60"
            >
              {status.resending ? 'Sending…' : 'Resend'}
            </button>
            <span className="text-mutedText/60" aria-hidden>·</span>
            <button
              type="button"
              className="text-mutedText underline-offset-2 hover:underline hover:text-text"
              onClick={() => {
                setStatus({ kind: 'idle' });
                setCode('');
                router.refresh();
              }}
            >
              Use a different email
            </button>
          </div>
        </div>
      ) : null}

      {status.kind === 'error' ? (
        <p
          role="alert"
          data-testid="login-error"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
        >
          {status.message}
        </p>
      ) : null}

      <p className="text-center text-xs text-mutedText">
        <Link href="/" className="hover:underline">
          ← Back home
        </Link>
      </p>
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary in App Router.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
