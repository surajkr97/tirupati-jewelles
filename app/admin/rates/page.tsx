/**
 * /admin/rates — set today's rates.
 * Created by Phase 7 (specs/07-admin-panel.md §7.3).
 *
 * The most frequent daily action in the whole application. Two cards — gold and silver —
 * the current figure large, and an inline editor on each, so there is no navigation between
 * reading a rate and changing it, because the owner does this standing behind a counter.
 *
 * Gold is ONE field, not two. See the comment on the gold editor below.
 */
import { Metal } from '@prisma/client';
import type { Metadata } from 'next';

import { RateEditor } from '@/components/admin/rate-editor';
import { Section } from '@/components/shell';
import { Card } from '@/components/ui';
import { isRateStale } from '@/lib/admin/rate-freshness';
import { formatShopDateTime } from '@/lib/datetime';
import { db } from '@/lib/db';
import { formatINR } from '@/lib/money';
import {
  getCurrentRates,
  GOLD_PURITY_LABELS,
  quotedPureRate,
  RATE_FACES,
  toDisplayUnit,
  unitLabel,
} from '@/lib/rates';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Rates' };

export default async function AdminRatesPage() {
  const rates = await getCurrentRates();

  /**
   * One field, so one badge — but it answers for both rows.
   *
   * A 916 row set this morning and a 750 row left from last week is precisely the drift the
   * single field removes, and until the next save that state can still exist in the table.
   * Taking the older of the two means the card says "needs update" while either half is
   * stale, rather than looking fresh because the purity it happens to display was touched.
   */
  const goldStale =
    isRateStale(rates.gold22.effectiveAt) || isRateStale(rates.gold18.effectiveAt);

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
        §16 — an editing column, not a form stretched across a 1440px screen. Two numeric
        fields do not get wider or easier to read at 1200px; they get further from their
        labels. `max-w-2xl` keeps the whole task in one comfortable measure and leaves the
        history below it on the same axis.
      */}
      <div className="flex max-w-2xl flex-col gap-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 font-semibold tracking-tight text-ink">Rates</h1>
          <p className="text-body text-muted">
            Enter the rate the way you quote it — 24K per 10 grams for gold, per kilogram
            for silver. 916 and 750 are worked out from the 24K figure.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {/*
            ── Two fields, three stored rates ──

            Gold used to be two cards, and the owner typed the 916 and 750 rates separately
            every morning off one number on the dealer's board. That is one arithmetic step
            done twice by hand, daily, on the figure that prices the entire catalogue — and
            nothing in the app could tell a deliberate margin from a slip of the thumb,
            because two independent fields make an inconsistent pair a legal state.

            Now the market number is typed once and `lib/gold-purity.ts` applies the
            fineness. Storage is unchanged: `setGoldRates` still writes a `MetalRate` row per
            purity, in one transaction, because bills snapshot per purity and §4.1's history
            is an audit trail.
          */}
          <RateEditor
            target="GOLD_24K"
            label="Gold 24K (pure)"
            unit={unitLabel(Metal.GOLD)}
            /*
              No 24K row exists to read — the `Purity` enum has only what the shop sells, and
              adding a K24 member would let a product be created at a purity it cannot be
              hallmarked as. So the field shows back the pure rate IMPLIED by the live 916
              row, which is the number that was typed to produce it.
            */
            currentDisplay={quotedPureRate(rates.gold22.display, 'K22_916').toString()}
            effectiveAt={rates.gold22.effectiveAt}
            stale={goldStale}
            derived={[
              {
                purity: 'K22_916',
                label: GOLD_PURITY_LABELS.K22_916,
                currentDisplay: rates.gold22.display.toString(),
              },
              {
                purity: 'K18_750',
                label: GOLD_PURITY_LABELS.K18_750,
                currentDisplay: rates.gold18.display.toString(),
              },
            ]}
          />

          <RateEditor
            target="SILVER_999"
            label="Silver 999"
            unit={unitLabel(Metal.SILVER)}
            currentDisplay={rates.silver999.display.toString()}
            effectiveAt={rates.silver999.effectiveAt}
            stale={isRateStale(rates.silver999.effectiveAt)}
          />
        </div>

        {/*
          §7.3: "Change history with actor and timestamp."

          Read from `AuditLog` rather than `MetalRate`: the rate table records what the value
          became, the audit log records who made it become that.

          A row per CHANGE, not a table of date × metal (§13's column list). The audit entry
          is per PURITY — one gold save writes a 916 line and a 750 line, because that is what
          a bill is priced from — so a grid would be mostly empty cells, and the question this
          answers is "what changed, when, by whom", which reads better as a line than as a
          lookup.
        */}
        <Card className="flex flex-col gap-4">
          <h2 className="text-h3 font-semibold text-ink">Recent changes</h2>

          {history.length === 0 ? (
            <p className="text-body text-muted">
              No rate changes recorded yet. Every change you make above is listed here
              with who made it.
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
