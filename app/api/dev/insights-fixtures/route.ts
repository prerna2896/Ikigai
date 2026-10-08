import { NextResponse } from 'next/server';
import { INSIGHT_FIXTURES } from '@ikigai/insights';

// Serves the golden-dataset fixtures (packages/insights/src/fixtures.ts)
// as JSON so scripts/eval-insights.mjs — a plain Node script with no TS
// build step — can consume them without duplicating the data. Harmless
// to expose: synthetic test data only, no real user data, no cost to
// call (unlike /api/insights/weekly, which this is NOT).
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ fixtures: INSIGHT_FIXTURES });
}
