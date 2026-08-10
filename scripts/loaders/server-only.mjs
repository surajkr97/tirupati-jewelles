/**
 * A module resolve hook that neutralises `server-only` for a plain Node script.
 * Created by Phase 8 (specs/08-billing-whatsapp.md).
 *
 * `server-only`'s default export throws on import — that guard is working as intended, and
 * `lib/bills/create.ts` carries it deliberately. But `scripts/verify-bill.mts` runs under
 * `tsx`, which has no React Server Component graph, so the package resolves its `default`
 * condition and refuses to load.
 *
 * The package ships an `empty.js` that Next swaps in for server bundles. Its `exports` map
 * only exposes that file under the `react-server` condition, and running Node with
 * `--conditions=react-server` is not an option here: it also switches React itself to the
 * server build, which lacks the reconciler `@react-pdf/renderer` needs — the PDF render
 * dies inside React with a minified error. Verified, not assumed.
 *
 * So the specifier is redirected to an empty module. The package's own `empty.js` cannot be
 * reached by path either — its `exports` map does not list it, nor `./package.json` — which
 * is the same wall `test/stubs/server-only.ts` documents, so this substitutes an equivalent
 * empty module instead. Exactly what `vitest.config.mts` does with an alias, by the
 * mechanism plain Node offers.
 *
 * Application code is unaffected: this hook exists only on the `verify:bill` command line.
 */

/** An inline empty ES module. Node resolves `data:` URLs natively, so no `load` hook. */
const EMPTY = 'data:text/javascript,export%20%7B%7D';

export function resolve(specifier, context, nextResolve) {
  // The bare specifier, and an already-resolved path into the package — see the matching
  // note in register-server-only.mjs for why the second form appears at all.
  if (specifier === 'server-only' || /[\\/]server-only[\\/]/.test(specifier)) {
    return { url: EMPTY, shortCircuit: true, format: 'module' };
  }
  return nextResolve(specifier, context);
}
