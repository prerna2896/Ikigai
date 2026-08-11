import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';

// Anonymous-first model: every UX route is reachable without a session.
// The RepositoryProvider hands the app a local (Dexie) repo when
// signed-out, so onboarding + planner + log + reflect + history all
// work end-to-end offline. Signing in later triggers the M4 migrator
// which lifts the local data into cloud under the signed-in user_id.
//
// The only route that behaves specially is /login itself: if you're
// already signed in there's no reason to sit on the sign-in page, so
// bounce to the URL that sent you there (?next=) or the home page.
//
// Anything under /dev/* stays open too — those pages are Dexie
// inspection helpers and are already dev-only via a next.config check.
// If we ever want a strictly-signed-in area (e.g. billing), gate it
// in the page (via useRepository's status) rather than re-adding a
// broad middleware wall — that keeps the anonymous-first invariant
// obvious in one place.

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // Signed-in user on /login → send them where they were going, or /.
  if (user && pathname === '/login') {
    const next = request.nextUrl.searchParams.get('next') || '/';
    const dest = next.startsWith('/') ? next : '/';
    return NextResponse.redirect(new URL(dest, request.url));
  }

  return response;
}

// Skip: static assets, image optimizer, favicon, PWA icons.
// Everything else runs through the middleware so both session refresh
// and route protection stay consistent.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|brand|icons|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
