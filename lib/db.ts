/**
 * Prisma singleton.
 * Created by Phase 1 (specs/01-cleanup-scaffold.md §1.5).
 *
 * Guarded against hot-reload duplication: `next dev` re-evaluates modules on every edit,
 * and a fresh PrismaClient per reload exhausts the Postgres connection pool within a few
 * minutes of normal work. Stashing it on globalThis keeps exactly one.
 */
import { PrismaClient } from '@prisma/client';

import { env } from '@/lib/env';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
