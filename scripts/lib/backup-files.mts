/**
 * The backup file naming convention, in one place. Phase 9 §9.5.
 *
 * Shared by `scripts/backup.mts` (which writes and prunes them) and
 * `scripts/verify-restore.mts` (which picks the newest one to prove). A separate module
 * rather than an import between the two scripts, because both are top-level-await entry
 * points — importing one from the other would RUN it.
 */
import { readdirSync } from 'node:fs';

/** `tirupati-2026-08-10T18-42-07.dump` — ISO order is lexicographic, so newest sorts last. */
export const FILE_PREFIX = 'tirupati-';
export const FILE_SUFFIX = '.dump';

export function backupFileName(at: Date = new Date()): string {
  const stamp = at
    .toISOString()
    .replace(/\.\d+Z$/, '')
    .replaceAll(':', '-');
  return `${FILE_PREFIX}${stamp}${FILE_SUFFIX}`;
}

/** Every backup in `directory`, oldest first. Missing directory reads as empty. */
export function backupFiles(directory: string): string[] {
  try {
    return readdirSync(directory)
      .filter((name) => name.startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX))
      .sort();
  } catch {
    return [];
  }
}
