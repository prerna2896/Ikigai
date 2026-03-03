import { NextResponse } from 'next/server';
import { resetForTests } from '@ikigai/storage';

export const dynamic = 'force-dynamic';

export async function POST() {
  if (process.env.PLAYWRIGHT !== '1') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await resetForTests();
  return NextResponse.json({ ok: true });
}
