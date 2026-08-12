/**
 * Stage 5F — every audited action has wording, and the log never invents a change.
 *
 * Two different risks, one file:
 *
 *   1. `AUDIT_ACTION_LABEL` is a hand-written table against a free-string column. A new
 *      `adminAction` caller compiles fine, writes fine, and shows up in the log as a raw
 *      constant — which is the state Stage 5F was fixing. So the table is checked against
 *      the repository rather than against memory.
 *
 *   2. `auditChanges` is what stops §16's "do not dump raw JSON everywhere". It has to drop
 *      what did not move and keep what did; a diff that reports unchanged fields buries the
 *      one that matters, and a diff that drops a real change is worse than no diff at all.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  auditActionLabel,
  auditChanges,
  AUDIT_ACTION_LABEL,
} from '@/lib/admin/audit-labels';

const ROOT = resolve(__dirname, '../..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;

    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
      continue;
    }
    if (!['.ts', '.tsx'].includes(extname(entry))) continue;
    if (entry.includes('.test.')) continue;
    out.push(full);
  }
  return out;
}

/**
 * Every `action: 'SOMETHING'` an audit writer passes, read off disk.
 *
 * A flat scan rather than one scoped to an `audit({ … })` block. The scoped version was
 * written first and quietly missed five actions — `RATE_SET`, `PRODUCT_EDIT`, `ORDER_CREATE`,
 * `ORDER_CLAIM` and `SETTINGS_UPDATE` — because those payloads carry large `before`/`after`
 * objects and ran past the window the block matcher allowed. Balancing braces with a regex to
 * fix that would be worse than the problem.
 *
 * The flat pattern is precise enough here for a specific reason: SCREAMING_SNAKE_CASE string
 * literals assigned to a property called `action` exist nowhere else in this repository. If
 * that ever stops being true the failure is loud — an extra name appears in the orphan check
 * below and someone has to look — rather than silent, which is the failure mode that matters.
 */
function auditedActions(): string[] {
  const found = new Set<string>();

  for (const file of ['app', 'lib'].flatMap((dir) => sourceFiles(join(ROOT, dir)))) {
    for (const hit of readFileSync(file, 'utf8').matchAll(
      /\baction:\s*'([A-Z][A-Z0-9_]*)'/g,
    )) {
      found.add(hit[1]!);
    }
  }

  return [...found].sort();
}

describe('every audited action has a label', () => {
  const actions = auditedActions();

  it('finds the writers at all', () => {
    // A positive control: if the scan silently matched nothing, the assertion below would
    // pass over an empty list and this file would prove nothing.
    expect(actions.length).toBeGreaterThan(15);
    expect(actions).toContain('RATE_SET');
    expect(actions).toContain('SETTINGS_UPDATE');
  });

  it.each(auditedActions())('%s reads as a sentence, not a constant', (action) => {
    expect(
      AUDIT_ACTION_LABEL[action],
      `${action} is written to the audit log with no label in lib/admin/audit-labels.ts`,
    ).toBeTruthy();
    expect(auditActionLabel(action)).not.toBe(action);
  });

  it('falls back to the raw token rather than hiding an unknown action', () => {
    expect(auditActionLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('has no label for an action nothing writes', () => {
    // Keeps the table honest in the other direction: a label with no writer is dead copy.
    const orphans = Object.keys(AUDIT_ACTION_LABEL).filter(
      (action) => !actions.includes(action),
    );
    expect(orphans, `these labels have no writer: ${orphans.join(', ')}`).toEqual([]);
  });
});

describe('auditChanges', () => {
  it('reports only what moved', () => {
    const changes = auditChanges(
      { shopName: 'Tirupati', gstin: '29ABCDE1234F1Z5', billSequence: 41 },
      { shopName: 'Tirupati', gstin: '29ABCDE1234F1Z5', billSequence: 42 },
    );

    expect(changes).toEqual([
      { key: 'next invoice number', from: '41', to: '42' },
    ]);
  });

  it('treats a create as all-new rather than as nothing', () => {
    const changes = auditChanges(null, { name: 'Rings', isActive: true });

    expect(changes).toEqual([
      { key: 'name', from: null, to: 'Rings' },
      { key: 'visible', from: null, to: 'yes' },
    ]);
  });

  it('treats a delete as a removal', () => {
    expect(auditChanges({ name: 'Rings' }, null)).toEqual([
      { key: 'name', from: 'Rings', to: null },
    ]);
  });

  it('summarises an array rather than printing it', () => {
    // `PRODUCT_BULK` records an id list and `CATEGORY_REORDER` an order. Neither is
    // something anybody scans, and both are long enough to push a row off a phone.
    const changes = auditChanges(null, { order: ['a', 'b', 'c'] });
    expect(changes).toEqual([{ key: 'order', from: null, to: '3 items' }]);
  });

  it('clips a long value instead of letting it set the row height', () => {
    const long = 'x'.repeat(200);
    const [change] = auditChanges(null, { note: long });

    expect(change!.to!.length).toBeLessThan(70);
    expect(change!.to!.endsWith('…')).toBe(true);
  });

  it('reads booleans as words, because "true" is not what an owner calls it', () => {
    expect(auditChanges({ isActive: true }, { isActive: false })).toEqual([
      { key: 'visible', from: 'yes', to: 'no' },
    ]);
  });

  it('is empty when nothing differs, so the row shows no diff at all', () => {
    expect(auditChanges({ a: 1 }, { a: 1 })).toEqual([]);
    expect(auditChanges(null, null)).toEqual([]);
  });
});
