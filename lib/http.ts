/**
 * Route handler helpers — validation, errors, client IP.
 * Created by Phase 3 (specs/03-auth.md §3.4).
 *
 * SECURITY, every phase: "Every route body/query parsed through a Zod schema. Reject,
 * don't coerce." Phase 9 §9.1 adds a test that enumerates route files and fails if one
 * lacks a schema import — so this helper is the single place that behaviour is defined.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import type { z } from 'zod';

import { env } from '@/lib/env';

/** Route handlers must never be cached (MASTER-SPEC §6). */
export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function json<T>(body: T, status = 200, headersInit?: HeadersInit): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE, ...headersInit },
  });
}

export function errorJson(
  message: string,
  status: number,
  extra?: Record<string, unknown>,
) {
  return json({ error: message, ...extra }, status);
}

/**
 * Generic failure for anything auth-related.
 *
 * SECURITY §3: unknown-user and wrong-password must be "identical in body, status, and
 * timing". One shared constant is how the bodies stay identical as the code changes.
 */
export const GENERIC_AUTH_ERROR = 'Those details did not match. Please try again.';

export type ParseResult<T> =
  { ok: true; data: T } | { ok: false; response: NextResponse };

/**
 * Parse and validate a JSON body.
 *
 * Field-level messages are returned because they are needed for usable forms — but callers
 * on auth paths must collapse them to `GENERIC_AUTH_ERROR` rather than revealing which
 * identifier exists.
 */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<ParseResult<z.infer<S>>> {
  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: errorJson('Expected a JSON body.', 400) };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    return {
      ok: false,
      response: errorJson('Check the highlighted fields.', 400, { fields }),
    };
  }

  return { ok: true, data: parsed.data };
}

/** Parse and validate query parameters. */
export function parseQuery<S extends z.ZodType>(
  request: Request,
  schema: S,
): ParseResult<z.infer<S>> {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = schema.safeParse(params);

  if (!parsed.success) {
    return { ok: false, response: errorJson('Invalid query parameters.', 400) };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Best-effort client IP for rate limiting.
 *
 * `x-forwarded-for` is client-controlled unless a trusted proxy overwrites it. Vercel and
 * most managed platforms do. Behind anything else, verify before trusting it — a spoofable
 * IP makes the per-IP limits decorative. Flagged for Phase 9 §9.1.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return h.get('x-real-ip') ?? '0.0.0.0';
}

/**
 * Equalise response time on paths that branch on whether an account exists.
 *
 * SECURITY §3 requires the unknown-user path to take as long as the wrong-password path.
 * The real defence is the dummy Argon2 verification in the login handler; this pads the
 * remainder so the *total* is flat.
 */
export async function padTo(startedAt: number, targetMs = 300): Promise<void> {
  const elapsed = Date.now() - startedAt;
  if (elapsed < targetMs) {
    await new Promise((resolve) => setTimeout(resolve, targetMs - elapsed));
  }
}

/** Never leak a stack trace in production (Phase 9 §9.1). */
export function serverError(err: unknown, context: string): NextResponse {
  console.error(`[${context}]`, err);
  return errorJson(
    env.NODE_ENV === 'production'
      ? 'Something went wrong. Please try again.'
      : `${context}: ${err instanceof Error ? err.message : String(err)}`,
    500,
  );
}
