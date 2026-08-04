/**
 * Password hashing — Argon2id at the OWASP-recommended parameters.
 * Created by Phase 1 (specs/01-cleanup-scaffold.md §1.6, for the seeded admin).
 * Phase 3 (specs/03-auth.md §3.1) builds signup and login on top of these exports.
 *
 * SECURITY reviews these parameters every phase (AGENTS.md). Do not lower them for speed —
 * the cost is the point.
 */
import { hash as argonHash, verify as argonVerify, type Options } from '@node-rs/argon2';

/**
 * `Algorithm.Argon2id` is 2.
 *
 * The enum is declared `export declare const enum Algorithm`, and an ambient const enum
 * cannot be read as a value under `isolatedModules` (TS2748) — which Next.js requires.
 * The numeric literal is the only way to reference it; `Options` still type-checks the
 * object, so a typo here is a compile error rather than a silently weaker hash.
 */
const ARGON2ID = 2;

/** OWASP-recommended: memoryCost 19456 KiB (19 MiB), timeCost 2, parallelism 1. */
export const ARGON2_OPTIONS: Options = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON2_OPTIONS);
}

/**
 * Constant-time verification (specs/03-auth.md §3.1) — argon2's own comparison is
 * constant-time; never compare digests with `===`.
 *
 * Returns false on a malformed or unrecognised digest rather than throwing, so a corrupt
 * row cannot 500 the login route.
 */
export async function verifyPassword(digest: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(digest, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}
