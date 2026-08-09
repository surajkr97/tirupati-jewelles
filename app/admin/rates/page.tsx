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
      <div className="flex flex-col gap-6">
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
            />
          ))}
        </div>

        <Card className="flex flex-col gap-4">
          <h2 className="text-h3 font-semibold text-ink">Recent changes</h2>

          {history.length === 0 ? (
            <p className="text-body text-muted">No rate changes recorded yet.</p>
          ) : (
            <ul className="flex flex-col gap-4">
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
                    className="flex flex-col gap-1 border-b border-line pb-2 last:border-0 last:pb-0"
                  >
                    <p className="text-body text-ink">
                      <span className="font-medium">{face?.label ?? entry.entityId}</span>{' '}
                      {before !== null && face ? (
                        <>
                          {formatINR(toDisplayUnit(face.metal, before))} →{' '}
                          <strong>
                            {formatINR(toDisplayUnit(face.metal, after ?? 0n))}
                          </strong>
                        </>
                      ) : (
                        face &&
                        after !== null && (
                          <>
                            set to{' '}
                            <strong>{formatINR(toDisplayUnit(face.metal, after))}</strong>
                          </>
                        )
                      )}
                    </p>
                    <p className="text-small text-muted">
                      {actorById.get(entry.actorId) ?? 'Unknown'} ·{' '}
                      <time dateTime={entry.createdAt.toISOString()}>
                        {formatShopDateTime(entry.createdAt)}
                      </time>
                      {entry.ip && ` · ${entry.ip}`}
                    </p>
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
