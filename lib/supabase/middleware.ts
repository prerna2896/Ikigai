// Session refresh + auth gate for the Next.js middleware.
//
// Called on every request via ../../middleware.ts. Refreshes the
// session cookie AND returns the resolved user so the caller can
// route-protect. Without the refresh call, session tokens expire and
// the user silently signs out mid-navigation.

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';

export type SessionResult = {
  response: NextResponse;
  user: User | null;
};

export async function updateSession(
  request: NextRequest,
): Promise<SessionResult> {
  let response = NextResponse.next({ request: { headers: request.headers } });

  // Degrade gracefully when Supabase env vars aren't configured on the
  // running deployment (e.g. a Vercel preview built before env vars
  // were added, or a self-hoster who hasn't wired up auth yet).
  // Without this guard, `createServerClient` throws on *every* request
  // and the entire app 500s, including the anonymous-first routes that
  // shouldn't need auth at all. Treat missing-env as "no session" so
  // the app still serves the Dexie-local experience.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return { response, user: null };
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    },
  );

  // Calling getUser() forces the session refresh. Don't remove.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { response, user };
}
