/**
 * GET /admin/bills/export — the accountant's CSV.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.5: "Export CSV for the accountant").
 *
 * A route handler, not a page, so it lives under `/admin` but gets NO layout — which means
 * `requireAdminPage()` never runs for it. §3.6 is explicit that `proxy.ts` is not the
 * boundary, and here the point is sharp: the proxy only sees whether a session cookie
 * exists, so without the check below a signed-in CUSTOMER could download the shop's entire
 * sales ledger. The role is re-checked here, and a non-admin gets 404 rather than 403.
 */
import { requireAdmin, UnauthorisedError } from '@/lib/auth/guard';
import { exportBillsCsv, parseBillFilters } from '@/lib/bills/query';
import { serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof UnauthorisedError) {
      return new Response('Not found', { status: 404 });
    }
    throw err;
  }

  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    // The same parser the screen uses, so "Export CSV" always means "what I am looking at".
    // Unrecognised values fall back rather than erroring — a hand-edited URL cannot 500.
    const csv = await exportBillsCsv(parseBillFilters(params));

    const stamp = new Date().toISOString().slice(0, 10);

    /**
     * A UTF-8 BOM.
     *
     * Excel on Windows reads a `.csv` as the system code page unless one is present, so a
     * customer named `Ravi Deshmukh–Patil` arrives as mojibake and the accountant reports
     * the export as corrupt. Added at delivery rather than inside `toCsv`, which stays
     * byte-exact for the tests.
     */
    return new Response(`﻿${csv}`, {
      status: 200,
      headers: {
        // `charset=utf-8` plus the BOM below: without it Excel on Windows renders a name
        // with an accent as mojibake, and the accountant reports the export as corrupt.
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="bills-${stamp}.csv"`,
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch (err) {
    return serverError(err, 'admin/bills/export');
  }
}
