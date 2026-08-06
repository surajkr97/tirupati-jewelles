/**
 * Shared plumbing for admin server actions.
 * Created by Phase 7 (specs/07-admin-panel.md §7.1, §7 SECURITY).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  Every admin mutation goes through `adminAction`. It does four things that §7 SECURITY
 *  requires on every single one, and doing them in one place is the only way they stay
 *  true as screens are added:
 *
 *    1. Re-checks the ADMIN role. `proxy.ts` is not a boundary (§3.6).
 *    2. Rejects a cross-origin request — CSRF, per the Phase 7 design review.
 *    3. Writes an `AuditLog` with actor and IP.
 *    4. Never leaks an internal error to the browser.
 *
 *  §7 SECURITY: "All admin mutations write an `AuditLog` with actor and IP." A helper that
 *  makes the audited path the *easy* path is worth more than a rule people must remember.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Server Actions rather than route handlers for the admin CRUD: they are same-origin by
 * construction, need no client fetch wrapper, and Next validates their own origin — but the
 * explicit check stays, because relying on a framework's internal behaviour for a security
 * control is how it disappears in a minor upgrade.
 */
import 'server-only';

import { headers } from 'next/headers';

import { requireAdmin, UnauthorisedError, type PublicUser } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { checkSameOrigin } from '@/lib/http';
import { log } from '@/lib/log';

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string; field?: string };

export interface AuditEntry {
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

interface AdminContext {
  admin: PublicUser;
  ip: string;
  /** Record what changed. Call once per mutation; several calls are fine for a batch. */
  audit: (entry: AuditEntry) => Promise<void>;
}

/** Best-effort client IP. See lib/http.ts for the `x-forwarded-for` caveat (DEBT-009). */
async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || h.get('x-real-ip') || '0.0.0.0';
}

/**
 * Same-origin check for a Server Action.
 *
 * ── SEC-028: this used to be a second implementation, and it had drifted ──
 * The check was duplicated here because `lib/http.ts` returns a `NextResponse`, which an
 * action cannot return. SEC-017 then tightened the route-handler copy to reject a
 * downgraded `http://` origin in production — and did not touch this one. Since every admin
 * mutation is a Server Action (D-024), the control SEC-017 believed it had fixed was still
 * missing everywhere it mattered most.
 *
 * Now both shapes call one decision in `lib/http.ts`. `absent` means no `Origin` header at
 * all, which is a server-to-server caller rather than a CSRF scenario; the reasoning is
 * recorded there.
 */
async function isSameOrigin(): Promise<boolean> {
  const verdict = await checkSameOrigin();
  return verdict === 'ok' || verdict === 'absent';
}

/**
 * Run an admin mutation with the role check, CSRF check, audit trail and error handling
 * already applied.
 *
 * The failure message is deliberately the same for "not an admin" and "not signed in": a
 * Server Action cannot return a 404, so the next best thing is to say nothing that
 * distinguishes them.
 */
export async function adminAction<T>(
  run: (context: AdminContext) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  let admin: PublicUser;

  try {
    admin = await requireAdmin();
  } catch (err) {
    if (err instanceof UnauthorisedError) {
      return { ok: false, error: 'Not found.' };
    }
    throw err;
  }

  if (!(await isSameOrigin())) {
    return { ok: false, error: 'Bad request.' };
  }

  const ip = await clientIp();

  const audit = async (entry: AuditEntry) => {
    await db.auditLog.create({
      data: {
        actorId: admin.id,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        // Prisma's Json columns reject `undefined` but accept `null`.
        before: (entry.before ?? null) as never,
        after: (entry.after ?? null) as never,
        ip,
      },
    });
  };

  try {
    return await run({ admin, ip, audit });
  } catch (err) {
    log.error('admin action failed', { actorId: admin.id, err });
    return {
      ok: false,
      error:
        env.NODE_ENV === 'production'
          ? 'Something went wrong. Please try again.'
          : err instanceof Error
            ? err.message
            : String(err),
    };
  }
}

/**
 * A URL-safe slug from a name.
 *
 * Shared by products and categories so the two cannot generate different slugs for the same
 * name, which would be invisible until someone noticed two different URLs for one piece.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
