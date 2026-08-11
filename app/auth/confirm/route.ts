// Cross-browser magic-link + signup confirmation.
//
// Our custom email templates (supabase/templates/*.html) emit links of
// the shape:
//
//   {SiteURL}/auth/confirm?token_hash=<hash>&type=<magiclink|signup>&next=/
//
// verifyOtp with a token_hash is self-contained — it does NOT need the
// PKCE code_verifier that would have been stored in the initiating
// browser. So the user can click the link on their phone / another
// browser / an incognito window and still land signed in.
//
// This route replaces the legacy /auth/callback (which used
// exchangeCodeForSession and required same-browser PKCE state).

import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '../../../lib/supabase/server';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const nextRaw = url.searchParams.get('next') || '/';
  // Refuse open-redirects — only same-origin, path-only destinations.
  const next = nextRaw.startsWith('/') ? nextRaw : '/';

  if (!tokenHash || !type) {
    return NextResponse.redirect(
      new URL('/login?error=invalid_link', url.origin),
    );
  }

  const supabase = createClient();
  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });
  if (error) {
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent(error.message)}`,
        url.origin,
      ),
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
