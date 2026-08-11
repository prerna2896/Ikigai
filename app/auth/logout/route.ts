// POST /auth/logout — signs the user out and sends them home.
//
// POST-only so a stray link or prefetch can't sign someone out.
// The TopNav triggers it via a small <form method="post">.

import { NextResponse } from 'next/server';
import { createClient } from '../../../lib/supabase/server';

export async function POST(request: Request) {
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/', request.url), { status: 303 });
}
