/**
 * Phase 9 TEST — the design-system lint rule actually fires (DEBT-032).
 *
 * Phase 1 SECURITY established the standard this follows: "a probe file reading
 * `process.env` and declaring `any` was linted and errored on both rules. A rule that
 * silently fails to fire is worse than no rule." The same argument applies harder here,
 * because the failure this rule catches is itself silent — an off-scale class emits no CSS
 * and no warning, and a rule that missed it would restore exactly the status quo it exists
 * to end.
 *
 * ESLint is run for real rather than the rule's `create` being called directly, so the
 * config wiring in `eslint.config.mjs` is under test too. A rule that works but is not
 * registered protects nothing.
 */
import { rm, writeFile } from 'node:fs/promises';

import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RULE = 'design-system/no-off-scale-spacing';
const PROBE = 'eslint-rules/__probe.tsx';

/**
 * Lint a snippet through the project's real config.
 *
 * It goes to a real file rather than `lintText`, because the TypeScript config block uses
 * `projectService: true` and the project service refuses a path that is not on disk —
 * `lintText` returns a fatal parse error and NO rule messages, which would have made every
 * "catches" case below pass for the wrong reason if the assertions were written loosely.
 * The probe lives outside `app/` and `components/` so the dev server never compiles it, and
 * it is created once and rewritten rather than created and deleted per case: the project
 * service resolves paths against the tsconfig program, and a file that keeps appearing and
 * disappearing is the one input it has reason to be inconsistent about. One full-suite run
 * did fail here in a way six later runs would not reproduce, so the churn is removed rather
 * than explained away.
 */
async function lint(source: string): Promise<string[]> {
  await writeFile(PROBE, source);

  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintFiles([PROBE]);

  // A fatal parse error yields NO rule messages, so an "accepts" case would pass for
  // entirely the wrong reason. Fail loudly instead.
  const fatal = result?.messages.find((message) => message.fatal);
  if (fatal) throw new Error(`probe did not parse: ${fatal.message}`);

  return (result?.messages ?? [])
    .filter((message) => message.ruleId === RULE)
    .map((message) => message.message);
}

describe('design-system/no-off-scale-spacing', () => {
  beforeAll(() => writeFile(PROBE, 'export const Probe = () => null;\n'));
  afterAll(() => rm(PROBE, { force: true }));

  it('is registered in the project config, not merely written', async () => {
    // A rule that works and is not wired up protects nothing.
    const eslint = new ESLint({ cwd: process.cwd() });
    const config = await eslint.calculateConfigForFile('components/ui/card.tsx');

    expect(config.rules?.[RULE]).toBeDefined();
    expect(String(config.rules?.[RULE]?.[0] ?? config.rules?.[RULE])).toMatch(/error|2/);
  });
  it('catches an off-scale class in a plain className', async () => {
    const messages = await lint(`export const A = () => <div className="flex gap-3" />;`);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('`gap-3`');
    // The message must say what to do, not only what is wrong.
    expect(messages[0]).toContain('gap-2');
    expect(messages[0]).toContain('gap-4');
  });

  it('catches one inside cn(), which is where most of them lived', async () => {
    const messages = await lint(
      `import { cn } from '@/lib/utils/cn';
       export const A = ({ on }: { on: boolean }) =>
         <div className={cn('flex', on && 'px-3', { 'pl-5': on })} />;`,
    );

    expect(messages.map((m) => m.match(/`([\w-]+)`/)?.[1]).sort()).toEqual([
      'pl-5',
      'px-3',
    ]);
  });

  it('catches one behind a responsive or state variant', async () => {
    const messages = await lint(
      `export const A = () => <div className="md:gap-3 hover:px-3 lg:hover:mt-7" />;`,
    );

    expect(messages).toHaveLength(3);
  });

  it('accepts every value that is on the scale', async () => {
    const messages = await lint(
      `export const A = () => <div className="flex flex-col gap-4 p-6 mt-8 mb-12 size-16 px-0 py-2 gap-1" />;`,
    );

    expect(messages).toEqual([]);
  });

  it('accepts the named tokens, which are not numbers', async () => {
    const messages = await lint(
      `export const A = () => <div className="h-tap w-full pb-bottom-nav h-control-lg size-icon max-w-xs" />;`,
    );

    expect(messages).toEqual([]);
  });

  it('accepts an arbitrary value, because MASTER-SPEC §3 names two of them', async () => {
    // D-006 confines these to Container and Section; the rule's job is the silent form.
    const messages = await lint(
      `export const A = () => <div className="px-[20px] md:px-[40px] max-w-[1200px] h-[128px]" />;`,
    );

    expect(messages).toEqual([]);
  });

  it('does not flag a non-spacing utility that happens to end in a number', async () => {
    const messages = await lint(
      `export const A = () => <div className="grid grid-cols-2 z-30 rounded-2xl ring-1 opacity-50 duration-200 text-h3" />;`,
    );

    expect(messages).toEqual([]);
  });

  /**
   * The allowed set is parsed from `app/globals.css`, so this asserts the two cannot drift:
   * a value the stylesheet defines must pass, and one it does not must fail.
   */
  it('takes its scale from globals.css rather than a second copy', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('app/globals.css', 'utf8');

    expect(css).toContain('--spacing-6:');
    expect(css).not.toContain('--spacing-3:');

    expect(await lint(`export const A = () => <div className="gap-6" />;`)).toEqual([]);
    expect(await lint(`export const A = () => <div className="gap-3" />;`)).toHaveLength(
      1,
    );
  });
});
