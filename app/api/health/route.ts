/**
 * Health check — DB and Redis reachability.
 * Created by Phase 1 (specs/01-cleanup-scaffold.md §1.7). Monitored in Phase 9 §9.4.
 *
 * Redis being down is reported but does NOT make the service unhealthy: per MASTER-SPEC §7
 * the site is expected to run without it, just slower. Postgres being down does.
 */
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { redisHealthy } from '@/lib/redis';

export const dynamic = 'force-dynamic';

async function dbHealthy(): Promise<boolean> {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const [database, cache] = await Promise.all([dbHealthy(), redisHealthy()]);

  return NextResponse.json(
    {
      status: database ? 'ok' : 'degraded',
      database: database ? 'ok' : 'down',
      redis: cache ? 'ok' : 'down',
      timestamp: new Date().toISOString(),
    },
    {
      status: database ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
