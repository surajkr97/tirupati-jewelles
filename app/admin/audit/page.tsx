/**
 * /admin/audit — the audit log.
 * Created by Phase 7 (specs/07-admin-panel.md §7.10), redesigned by Stage 5F.
 *
 * §7.10: "Filterable by actor, action, entity, date. Read-only, never editable."
 *
 * Read-only is enforced by there being no mutation on this page and no action that writes
 * to `AuditLog` outside `adminAction`. A log an admin can edit is not a log — so §17's rule
 * is met by the absence of a control, not by a disabled one.
 *
 * ── The filter options used to come from the filtered rows ──
 *
 * Phase 7 built both dropdowns with `[...new Set(entries.map(e => e.action))]` — over the 200
 * rows *currently displayed*. So filtering to `RATE_SET` left `RATE_SET` as the only option
 * in the action list, and there was no way back to another action except clearing the whole
 * query by hand. The filter narrowed its own vocabulary every time it was used.
 *
 * They now come from `groupBy` over the whole table, which is what "filterable by action"
 * meant. Two extra grouped reads on an index, on a page an owner opens rarely.
 *
 * ── And it showed nothing about what changed ──
 *
 * `before` and `after` have been written since Phase 7 and rendered nowhere, so the log
 * answered "who and when" and not "what" — the third of §13's three questions, and the
 * reason anybody opens this page. `auditChanges` reduces the pair to the fields that
 * actually moved; §16 forbids dumping the raw JSON, and the full record stays in the
 * database for anyone who needs it.
 */
import { ChevronLeft, ChevronRight, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';

import type { Metadata } from 'next';

import { Section } from '@/components/shell';
import { buttonClasses, Card, EmptyState, Input, Select } from '@/components/ui';
import {
  auditActionLabel,
  auditChanges,
  MAX_CHANGES_SHOWN,
} from '@/lib/admin/audit-labels';
import { formatShopDateTime } from '@/lib/datetime';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Audit log' };

/**
 * §18 — a bounded page, not the whole history.
 *
 * Phase 7 took 200 rows with no pager and no indication that it had stopped, so an owner
 * looking for last month's rate change saw the most recent 200 events and no sign there were
 * more. 50 is what fits a screen's worth of scanning; the pager is the same shape as the
 * bills list so the two behave alike.
 */
const PAGE_SIZE = 50;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (params: Record<string, string | string[] | undefined>, key: string) =>
  typeof params[key] === 'string' ? (params[key] as string) : undefined;

interface AuditFilters {
  action: string;
  entity: string;
  since: string;
  page: number;
}

function withPage(filters: AuditFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.action) params.set('action', filters.action);
  if (filters.entity) params.set('entity', filters.entity);
  if (filters.since) params.set('since', filters.since);
  if (page > 1) params.set('page', String(page));

  const query = params.toString();
  return query ? `/admin/audit?${query}` : '/admin/audit';
}

function without(filters: AuditFilters, drop: 'action' | 'entity' | 'since'): string {
  return withPage({ ...filters, [drop]: '', page: 1 }, 1);
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const rawPage = Number(one(params, 'page'));
  const filters: AuditFilters = {
    action: one(params, 'action') ?? '',
    entity: one(params, 'entity') ?? '',
    since: one(params, 'since') ?? '',
    page:
      Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 100_000 ? rawPage : 1,
  };

  // Every filter is an equality on an indexed column and is parameterised by Prisma. `since`
  // is parsed to a Date and dropped if it is not one, so a malformed value widens the view
  // rather than erroring.
  const sinceDate = filters.since ? new Date(filters.since) : null;
  const validSince = sinceDate && Number.isFinite(sinceDate.getTime()) ? sinceDate : null;

  const where = {
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.entity ? { entity: filters.entity } : {}),
    ...(validSince ? { createdAt: { gte: validSince } } : {}),
  };

  const [entries, total, actionGroups, entityGroups] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.auditLog.count({ where }),
    // The whole vocabulary, not the vocabulary of what is on screen.
    db.auditLog.groupBy({ by: ['action'], orderBy: { action: 'asc' } }),
    db.auditLog.groupBy({ by: ['entity'], orderBy: { entity: 'asc' } }),
  ]);

  const actors = await db.user.findMany({
    where: { id: { in: [...new Set(entries.map((e) => e.actorId))] } },
    select: { id: true, name: true, email: true },
  });
  const actorById = new Map(actors.map((a) => [a.id, a.name ?? a.email ?? a.id]));

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(filters.action || filters.entity || filters.since);

  return (
    <Section className="pt-6 pb-0">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 font-semibold tracking-tight text-ink">Audit log</h1>
          <p className="flex flex-wrap items-center gap-2 text-body text-muted">
            Every change, who made it and when.
            {/*
              §17 — the record is read-only, and the page says so rather than relying on the
              absence of buttons to imply it.
            */}
            <span className="inline-flex items-center gap-1 text-small text-muted">
              <ShieldCheck className="size-4" aria-hidden="true" />
              Read-only — entries cannot be edited or removed.
            </span>
          </p>
        </div>

        {/* A plain GET form: no JavaScript, and a filtered view is a shareable URL. */}
        <Card padded={false}>
          <form className="flex flex-col gap-4 p-4 md:p-6" action="/admin/audit">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
              <Select name="action" label="Action" defaultValue={filters.action}>
                <option value="">All actions</option>
                {actionGroups.map((group) => (
                  <option key={group.action} value={group.action}>
                    {/*
                      §14 — the sentence and the constant together. The label is what makes
                      the list readable; the token is what lets somebody match a row to the
                      code that wrote it, and renaming the event was never on the table.
                    */}
                    {auditActionLabel(group.action)} ({group.action})
                  </option>
                ))}
              </Select>

              <Select name="entity" label="Record type" defaultValue={filters.entity}>
                <option value="">All records</option>
                {entityGroups.map((group) => (
                  <option key={group.entity} value={group.entity}>
                    {group.entity}
                  </option>
                ))}
              </Select>

              <Input
                type="date"
                name="since"
                label="From"
                defaultValue={filters.since}
              />

              <button
                type="submit"
                className={buttonClasses({ variant: 'primary', size: 'md', full: true })}
              >
                Apply
              </button>
            </div>
          </form>
        </Card>

        {/*
          §15 — the active filter is stated in words and removable, so a short log never
          reads as "nothing happened" when it means "nothing matched".
        */}
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-small text-muted">
            <span className="num">{total}</span>{' '}
            {total === 1 ? 'entry' : 'entries'}
            {pages > 1 && (
              <>
                {' '}
                · page <span className="num">{filters.page}</span> of{' '}
                <span className="num">{pages}</span>
              </>
            )}
          </p>

          {filters.action && (
            <FilterPill
              label={auditActionLabel(filters.action)}
              href={without(filters, 'action')}
            />
          )}
          {filters.entity && (
            <FilterPill label={filters.entity} href={without(filters, 'entity')} />
          )}
          {filters.since && (
            <FilterPill
              label={`since ${filters.since}`}
              href={without(filters, 'since')}
            />
          )}
          {filtered && (
            <Link
              href="/admin/audit"
              className="flex h-tap items-center px-2 text-small font-semibold text-rose-deep hover:underline"
            >
              Clear all
            </Link>
          )}
        </div>

        {entries.length === 0 ? (
          <Card padded={false}>
            {filtered ? (
              <EmptyState
                title="Nothing matches those filters"
                description="Try a different action, record type or date."
                action={
                  <Link
                    href="/admin/audit"
                    className={buttonClasses({ variant: 'outline', size: 'md' })}
                  >
                    Clear filters
                  </Link>
                }
              />
            ) : (
              <EmptyState
                title="Nothing recorded yet"
                description="Every rate change, bill, product edit and settings change is written here as it happens."
              />
            )}
          </Card>
        ) : (
          /**
           * §19 — dense and scannable, not a card per event.
           *
           * The other two screens in this stage are card-based because they are things you
           * edit. This one is a ledger you read, and 50 shadowed cards is 50 shadows between
           * the reader and the answer. Hairline-separated rows inside one surface.
           */
          <Card padded={false}>
            <ul className="flex flex-col">
              {entries.map((entry) => {
                const changes = auditChanges(entry.before, entry.after);
                const shown = changes.slice(0, MAX_CHANGES_SHOWN);

                return (
                  <li
                    key={entry.id}
                    data-testid="audit-row"
                    className="flex flex-col gap-2 border-b border-line p-4 last:border-0 md:p-6"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-body font-medium text-ink">
                        {auditActionLabel(entry.action)}
                      </p>
                      <time
                        dateTime={entry.createdAt.toISOString()}
                        className="shrink-0 text-small text-muted num"
                      >
                        {formatShopDateTime(entry.createdAt)}
                      </time>
                    </div>

                    <p className="flex flex-wrap items-center gap-x-2 text-small text-muted">
                      <span className="text-ink">
                        {actorById.get(entry.actorId) ?? 'Unknown'}
                      </span>
                      <span aria-hidden="true">·</span>
                      {/*
                        §13's "affected entity" is the type AND the record. The id is a uuid
                        for most rows and something readable for a few — `CATEGORY_REORDER`
                        writes "all", `PRODUCT_BULK` writes "12 products" — so it is shown
                        quietly rather than dropped. Truncated because a uuid is 36
                        characters of noise on a 320px row, and the diff below usually
                        carries the name anyway.
                      */}
                      <span title={entry.entityId}>
                        {entry.entity}
                        <span className="num"> {shortId(entry.entityId)}</span>
                      </span>
                      {entry.ip && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="num">{entry.ip}</span>
                        </>
                      )}
                      {/* The raw event name, kept beside its label (§14). */}
                      <span className="rounded-pill bg-rose-tint px-2 text-small text-ink">
                        {entry.action}
                      </span>
                    </p>

                    {shown.length > 0 && (
                      <dl className="flex flex-col gap-1 text-small">
                        {shown.map((change) => (
                          <div
                            key={change.key}
                            className="flex flex-wrap items-baseline gap-x-2"
                          >
                            <dt className="text-muted">{change.key}</dt>
                            <dd className="wrap-break-word text-ink">
                              {change.from !== null && (
                                <>
                                  <span className="text-muted line-through num">
                                    {change.from}
                                  </span>{' '}
                                  <span aria-hidden="true" className="text-muted">
                                    →
                                  </span>{' '}
                                </>
                              )}
                              {change.to === null ? (
                                <span className="text-muted">removed</span>
                              ) : (
                                <span className="num">{change.to}</span>
                              )}
                            </dd>
                          </div>
                        ))}
                        {changes.length > shown.length && (
                          <p className="text-small text-muted">
                            and <span className="num">{changes.length - shown.length}</span>{' '}
                            more {changes.length - shown.length === 1 ? 'field' : 'fields'}
                          </p>
                        )}
                      </dl>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {pages > 1 && (
          <nav aria-label="Audit pages" className="flex items-center justify-between gap-4">
            {filters.page > 1 ? (
              <Link
                href={withPage(filters, filters.page - 1)}
                className={buttonClasses({ variant: 'outline', size: 'md' })}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                Newer
              </Link>
            ) : (
              <span />
            )}
            <p className="text-small text-muted">
              Page <span className="num">{filters.page}</span> of{' '}
              <span className="num">{pages}</span>
            </p>
            {filters.page < pages ? (
              <Link
                href={withPage(filters, filters.page + 1)}
                className={buttonClasses({ variant: 'outline', size: 'md' })}
              >
                Older
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    </Section>
  );
}

/**
 * A uuid reduced to its first block; anything else is left alone.
 *
 * `entityId` is a uuid for most rows and a phrase for a few. Truncating on shape rather than
 * on length keeps "all" and "12 products" readable while stopping a uuid from taking a whole
 * line on a phone. The full value is on the element's `title`.
 */
function shortId(entityId: string): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(entityId) ? entityId.slice(0, 8) : entityId;
}

/** One applied filter, removable on its own. A link, so it works with JavaScript off. */
function FilterPill({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-tap items-center gap-2 rounded-pill bg-rose-tint px-4 text-small font-medium text-ink transition-colors duration-fast ease-standard hover:bg-rose/15"
    >
      {label}
      <X className="size-4" aria-hidden="true" />
      <span className="sr-only">— remove this filter</span>
    </Link>
  );
}
