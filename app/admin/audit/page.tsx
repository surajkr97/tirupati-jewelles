/**
 * /admin/audit — the audit log.
 * Created by Phase 7 (specs/07-admin-panel.md §7.10).
 *
 * §7.10: "Filterable by actor, action, entity, date. Read-only, never editable."
 *
 * Read-only is enforced by there being no mutation on this page and no action that writes
 * to `AuditLog` outside `adminAction`. A log an admin can edit is not a log.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { Section } from '@/components/shell';
import { Card } from '@/components/ui';
import { formatShopDateTime } from '@/lib/datetime';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Audit log' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (params: Record<string, string | string[] | undefined>, key: string) =>
  typeof params[key] === 'string' ? (params[key] as string) : undefined;

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const action = one(params, 'action');
  const entity = one(params, 'entity');
  const since = one(params, 'since');

  // Every filter is an equality on an indexed column and is parameterised by Prisma. `since`
  // is parsed to a Date and dropped if it is not one, so a malformed value widens the view
  // rather than erroring.
  const sinceDate = since ? new Date(since) : null;
  const validSince = sinceDate && Number.isFinite(sinceDate.getTime()) ? sinceDate : null;

  const entries = await db.auditLog.findMany({
    where: {
      ...(action ? { action } : {}),
      ...(entity ? { entity } : {}),
      ...(validSince ? { createdAt: { gte: validSince } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  const actors = await db.user.findMany({
    where: { id: { in: [...new Set(entries.map((e) => e.actorId))] } },
    select: { id: true, name: true, email: true },
  });
  const actorById = new Map(actors.map((a) => [a.id, a.name ?? a.email ?? a.id]));

  const actions = [...new Set(entries.map((e) => e.action))].sort();
  const entities = [...new Set(entries.map((e) => e.entity))].sort();

  return (
    <Section className="pt-6 pb-0">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Link href="/admin/media" className="text-small font-medium text-rose-deep">
            ← More
          </Link>
          <h1 className="text-h1 font-semibold tracking-tight text-ink">Audit log</h1>
          <p className="text-body text-muted">
            Every change, who made it and when. Read-only.
          </p>
        </div>

        <form className="flex flex-col gap-4" action="/admin/audit">
          <div className="flex gap-2">
            <select
              name="action"
              defaultValue={action ?? ''}
              aria-label="Action"
              className="h-control flex-1 rounded-field bg-white px-4 text-body text-ink ring-1 ring-line ring-inset"
            >
              <option value="">All actions</option>
              {actions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <select
              name="entity"
              defaultValue={entity ?? ''}
              aria-label="Entity"
              className="h-control flex-1 rounded-field bg-white px-4 text-body text-ink ring-1 ring-line ring-inset"
            >
              <option value="">All entities</option>
              {entities.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <input
            type="date"
            name="since"
            defaultValue={since ?? ''}
            aria-label="From date"
            className="h-control w-full rounded-field bg-white px-4 text-body text-ink ring-1 ring-line ring-inset"
          />
          <button
            type="submit"
            className="h-tap rounded-pill bg-ink px-4 text-small font-semibold text-white"
          >
            Apply
          </button>
        </form>

        {entries.length === 0 ? (
          <Card>
            <p className="text-body text-muted">Nothing recorded for those filters.</p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => (
              <li key={entry.id}>
                <Card className="flex flex-col gap-1">
                  <p className="text-body text-ink">
                    <span className="font-medium">{entry.action}</span> · {entry.entity}
                  </p>
                  <p className="text-small text-muted">{entry.entityId}</p>
                  <p className="text-small text-muted">
                    {actorById.get(entry.actorId) ?? entry.actorId} ·{' '}
                    <time dateTime={entry.createdAt.toISOString()}>
                      {formatShopDateTime(entry.createdAt)}
                    </time>
                    {entry.ip && ` · ${entry.ip}`}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
