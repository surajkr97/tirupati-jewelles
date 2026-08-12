/**
 * How old a rate has to be before the admin should be told about it.
 * Created by the UI redesign, Stage 5C.
 *
 * §7.2 names the threshold — "rates not updated in 48h" — and Phase 7 encoded it as a
 * `STALE_RATE_MS` constant private to the dashboard. Stage 5C needs the same judgement on
 * `/admin/rates`, which is the page an admin opens *because* something is stale, so the two
 * would otherwise each carry their own idea of the word.
 *
 * This is presentation, not rate logic: nothing here reads, writes or converts a rate. It
 * answers one question about a timestamp, in one place, so the dashboard and the rates page
 * cannot disagree about which rows need attention.
 */

/** §7.2: "rates not updated in 48h". */
export const STALE_RATE_MS = 48 * 60 * 60 * 1000;

/**
 * Is this rate old enough to flag?
 *
 * A missing or unparseable timestamp counts as stale. A shop that has never set a rate has
 * the most urgent version of this problem, and treating an absent date as "fine" would hide
 * exactly the case worth surfacing — which is why `0` and `NaN` are handled explicitly
 * rather than falling through a comparison that would quietly return `false`.
 */
export function isRateStale(effectiveAt: string, now: Date = new Date()): boolean {
  const at = new Date(effectiveAt).getTime();
  if (!Number.isFinite(at) || at === 0) return true;
  return now.getTime() - at > STALE_RATE_MS;
}
