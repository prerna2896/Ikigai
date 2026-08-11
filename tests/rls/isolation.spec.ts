/**
 * RLS isolation — end-to-end through Supabase.
 *
 * Creates two throwaway auth users via the Admin API, signs each in to
 * obtain a real JWT, then makes writes/reads/updates/deletes through the
 * regular authenticated client and asserts one user cannot see or touch
 * another user's rows.
 *
 * This is the closest we can get to "the app tries to leak data" without
 * the app itself having auth wired up. Once app auth lands, an additional
 * spec in tests/e2e/ can drive the same scenarios through the UI.
 *
 * Run: pnpm test:rls
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error(
    'RLS tests require NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY',
  );
}

// Admin client (service role) — for user CRUD only. NEVER for regular
// data ops; service role bypasses RLS.
const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Per-user authenticated client. Sets Authorization: Bearer <jwt>, so
// PostgREST evaluates policies against auth.uid() = user_id.
function clientFor(jwt: string): SupabaseClient {
  return createClient(url!, anonKey!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function createUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'rls-throwaway-password-1234',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  return data.user.id;
}

async function signIn(email: string): Promise<string> {
  const anon = createClient(url!, anonKey!);
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password: 'rls-throwaway-password-1234',
  });
  if (error || !data.session)
    throw new Error(`signIn ${email}: ${error?.message}`);
  return data.session.access_token;
}

async function deleteUser(id: string) {
  await admin.auth.admin.deleteUser(id).catch(() => {});
}

test.describe('RLS isolation between two authenticated users', () => {
  let userAId = '';
  let userBId = '';
  let userAJwt = '';
  let userBJwt = '';
  const emailA = `rls-a-${Date.now()}-${process.pid}@ikigai.test`;
  const emailB = `rls-b-${Date.now()}-${process.pid}@ikigai.test`;

  test.beforeAll(async () => {
    userAId = await createUser(emailA);
    userBId = await createUser(emailB);
    userAJwt = await signIn(emailA);
    userBJwt = await signIn(emailB);
  });

  test.afterAll(async () => {
    await deleteUser(userAId);
    await deleteUser(userBId);
  });

  test('user A can insert and read their own row', async () => {
    const clientA = clientFor(userAJwt);
    const id = randomUUID();
    const { error } = await clientA.from('week_plans').insert({
      id,
      user_id: userAId,
      week_start_iso: '2026-02-02',
      week_end_iso: '2026-02-08',
      week_start_day: 'monday',
      week_time_zone: 'UTC',
    });
    expect(error).toBeNull();

    const { data, error: readErr } = await clientA
      .from('week_plans')
      .select('id,user_id')
      .eq('id', id)
      .single();
    expect(readErr).toBeNull();
    expect(data?.id).toBe(id);
    expect(data?.user_id).toBe(userAId);
  });

  test("user B cannot see user A's row by id", async () => {
    const clientA = clientFor(userAJwt);
    const clientB = clientFor(userBJwt);
    const id = randomUUID();
    await clientA.from('week_plans').insert({
      id,
      user_id: userAId,
      week_start_iso: '2026-02-09',
      week_end_iso: '2026-02-15',
      week_start_day: 'monday',
      week_time_zone: 'UTC',
    });

    // Query for A's plan as B: RLS filters silently → empty result, no error.
    const { data, error } = await clientB
      .from('week_plans')
      .select('id')
      .eq('id', id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  test("user B's list never includes user A's rows", async () => {
    const clientA = clientFor(userAJwt);
    const clientB = clientFor(userBJwt);
    // Seed A with several rows.
    for (let i = 0; i < 3; i += 1) {
      await clientA.from('week_plans').insert({
        id: randomUUID(),
        user_id: userAId,
        week_start_iso: `2026-03-${String(i * 7 + 2).padStart(2, '0')}`,
        week_end_iso: `2026-03-${String(i * 7 + 8).padStart(2, '0')}`,
        week_start_day: 'monday',
        week_time_zone: 'UTC',
      });
    }

    const { data, error } = await clientB.from('week_plans').select('user_id');
    expect(error).toBeNull();
    for (const row of data ?? []) {
      expect(row.user_id).toBe(userBId);
    }
  });

  test('user B cannot INSERT a row claiming user A ownership', async () => {
    const clientB = clientFor(userBJwt);
    const { error } = await clientB.from('week_plans').insert({
      id: randomUUID(),
      user_id: userAId, // <- lying about ownership
      week_start_iso: '2026-04-06',
      week_end_iso: '2026-04-12',
      week_start_day: 'monday',
      week_time_zone: 'UTC',
    });
    // WITH CHECK on the INSERT policy rejects.
    expect(error).not.toBeNull();
    // Postgres RLS violation → PostgREST returns 403 (mapped to code
    // '42501' in the message). Assert we got a policy rejection.
    expect(error?.code).toBe('42501');
  });

  test("user B UPDATE targeting user A row affects 0 rows", async () => {
    const clientA = clientFor(userAJwt);
    const clientB = clientFor(userBJwt);
    const id = randomUUID();
    await clientA.from('week_plans').insert({
      id,
      user_id: userAId,
      week_start_iso: '2026-05-04',
      week_end_iso: '2026-05-10',
      week_start_day: 'monday',
      week_time_zone: 'UTC',
    });

    const { data, error } = await clientB
      .from('week_plans')
      .update({ week_time_zone: 'America/Los_Angeles' })
      .eq('id', id)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);

    // Verify from A's side that the row is unchanged.
    const { data: after } = await clientA
      .from('week_plans')
      .select('week_time_zone')
      .eq('id', id)
      .single();
    expect(after?.week_time_zone).toBe('UTC');
  });

  test('user B DELETE targeting user A row affects 0 rows', async () => {
    const clientA = clientFor(userAJwt);
    const clientB = clientFor(userBJwt);
    const id = randomUUID();
    await clientA.from('week_plans').insert({
      id,
      user_id: userAId,
      week_start_iso: '2026-06-01',
      week_end_iso: '2026-06-07',
      week_start_day: 'monday',
      week_time_zone: 'UTC',
    });

    const { data, error } = await clientB
      .from('week_plans')
      .delete()
      .eq('id', id)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: after } = await clientA
      .from('week_plans')
      .select('id')
      .eq('id', id);
    expect(after?.length).toBe(1);
  });
});

test.describe('Auth boundary probes', () => {
  test('anon client sees no rows on a user-scoped table', async () => {
    const anon = createClient(url!, anonKey!);
    const { data, error } = await anon.from('week_plans').select('id');
    // anon has no GRANT + no policy; PostgREST returns empty or 401/403
    // depending on config. Accept either "no error + empty" or an error.
    if (error) {
      expect(error.code).toMatch(/42501|PGRST/);
    } else {
      expect(data).toEqual([]);
    }
  });

  test('missing JWT rejects on write to a user-scoped table', async () => {
    const anon = createClient(url!, anonKey!);
    const { error } = await anon.from('week_plans').insert({
      id: randomUUID(),
      user_id: '00000000-0000-0000-0000-000000000000',
      week_start_iso: '2026-07-06',
      week_end_iso: '2026-07-12',
      week_start_day: 'monday',
      week_time_zone: 'UTC',
    });
    expect(error).not.toBeNull();
  });

  test('malformed JWT is rejected before reaching RLS', async () => {
    const badClient = createClient(url!, anonKey!, {
      global: { headers: { Authorization: 'Bearer not.a.jwt' } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await badClient.from('week_plans').select('id');
    expect(error).not.toBeNull();
  });
});
