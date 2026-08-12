/**
 * /admin/rates — set today's rates.
 * Created by Phase 7 (specs/07-admin-panel.md §7.3).
 *
 * The most frequent daily action in the whole application. Three cards, the current figure
 * large, and an inline editor on each — no navigation between reading a rate and changing
 * it, because the owner does this standing behind a counter.
 */
import type { Metadata } from 'next';

import { RateEditor } from '@/components/admin/rate-editor';
import { Section } from '@/components/shell';
import { Card } from '@/components/ui';
import { isRateStale } from '@/lib/admin/rate-freshness';
import { formatShopDateTime } from '@/lib/datetime';
import { db } from '@/lib/db';
import { formatINR } from '@/lib/money';
import { getCurrentRates, RATE_FACES, toDisplayUnit } from '@/lib/rates';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Rates' };

export default async function AdminRatesPage() {
  const rates = await getCurrentRates();

  /**
   * §7.3: "Change history with actor and timestamp."
   *
   * Read from `AuditLog` rather than `MetalRate`, because the rate table records what the
   * value became and the audit log records who made it become that. §7.10 shows the same
   * data unfiltered; this is the slice an admin wants while looking at rates.
   */
  const history = await db.auditLog.findMany({
    where: { action: 'RATE_SET' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      entityId: true,
      before: true,
      after: true,
      ip: true,
      createdAt: true,
      actorId: true,
    },
  });

  const actors = await db.user.findMany({
    where: { id: { in: [...new Set(history.map((h) => h.actorId))] } },
    select: { id: true, name: true, email: true },
  });
  const actorById = new Map(actors.map((a) => [a.id, a.name ?? a.email ?? a.id]));

  return (
    <Section className="pt-6 pb-0">
      {/*
        §16 — an editing column, not a form stretched across a 1440px screen. Three numeric
        fields do not get wider or easier to read at 1200px; they get further from their
        labels. `max-w-2xl` keeps the whole task in one comfortable measure and leaves the
        history below it on the same axis.
      */}
      <div className="flex max-w-2xl flex-col gap-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 font-semibold tracking-tight text-ink">Rates</h1>
          <p className="text-body text-muted">
            Enter the rate the way you quote it — per 10 grams for gold, per kilogram for
            silver.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {RATE_FACES.map((face) => (
            <RateEditor
              key={face.key}
              metal={face.metal}
              purity={face.purity}
              label={face.label}
              unit={face.unit}
              currentDisplay={rates[face.key].display.toString()}
              effectiveAt={rates[face.key].effectiveAt}
              stale={isRateStale(rates[face.key].effectiveAt)}
            />
          ))}
        </div>

        {/*
          §7.3: "Change history with actor and timestamp."

          Read from `AuditLog` rather than `MetalRate`: the rate table records what the value
          became, the audit log records who made it become that.

          A row per CHANGE, not a table of date × metal (§13's column list). Rates are set one
          metal at a time — the audit entry is per metal — so a grid would be mostly empty
          cells, and the question this answers is "what changed, when, by whom", which reads
          better as a line than as a lookup.
        */}
        <Card className="flex flex-col gap-4">
          <h2 className="text-h3 font-semibold text-ink">Recent changes</h2>

          {history.length === 0 ? (
            <p className="text-body text-muted">
              No rate changes recorded yet. Every change you make above is listed here with
              who made it.
            </p>
          ) : (
            <ul className="flex flex-col">
              {history.map((entry) => {
                const before = readRate(entry.before);
                const after = readRate(entry.after);
                const [metal, purity] = entry.entityId.split(':');
                const face = RATE_FACES.find(
                  (f) => f.metal === metal && f.purity === purity,
                );

                return (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-4 first:pt-0 last:border-0 last:pb-0"
                  >
                    <div className="flex min-w-0 flex-col">
                      <p className="text-body text-ink">
                        <span className="font-medium">
                          {face?.label ?? entry.entityId}
                        </span>{' '}
                        {before !== null && face ? (
                          <span className="num">
                            {formatINR(toDisplayUnit(face.metal, before))} →{' '}
                            <strong className="font-semibold">
                              {formatINR(toDisplayUnit(face.metal, after ?? 0n))}
                            </strong>
                          </span>
                        ) : (
                          face &&
                          after !== null && (
                            <span className="num">
                              set to{' '}
                              <strong className="font-semibold">
                                {formatINR(toDisplayUnit(face.metal, after))}
                              </strong>
                            </span>
                          )
                        )}
                      </p>
                      <p className="text-small text-muted">
                        {actorById.get(entry.actorId) ?? 'Unknown'}
                        {entry.ip && <span className="num"> · {entry.ip}</span>}
                      </p>
                    </div>

                    <time
                      dateTime={entry.createdAt.toISOString()}
                      className="shrink-0 text-small text-muted"
                    >
                      {formatShopDateTime(entry.createdAt)}
                    </time>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

      </div>
    </Section>
  );
}

/** `AuditLog.before`/`after` hold `{ ratePerGram: "1184200" }` as JSON. */
function readRate(value: unknown): bigint | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = (value as { ratePerGram?: unknown }).ratePerGram;
  return typeof raw === 'string' && /^\d+$/.test(raw) ? BigInt(raw) : null;
}
