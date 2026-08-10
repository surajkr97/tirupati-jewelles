/**
 * Neutralises `server-only` for a plain Node script. See ./server-only.mjs for why.
 * Created by Phase 8 (specs/08-billing-whatsapp.md).
 *
 * Two interceptions, because there are two module systems in play. `tsx` compiles the
 * repository's `.ts` files to CommonJS (there is no `"type": "module"` in package.json), so
 * `import 'server-only'` becomes a `require()` — and a `require()` never passes through an
 * ESM resolve hook. The `Module._load` patch is therefore the one that actually fires here;
 * the ESM hook covers the case where a future toolchain change makes these files ESM.
 */
import Module from 'node:module';
import { register } from 'node:module';

const originalLoad = Module._load;

/**
 * Matches the bare specifier AND an already-resolved path to the package.
 *
 * Phase 8 only needed the bare form. `scripts/worker.mts` (§9.3) pulls in `bullmq`, which is
 * ESM-only, and a mixed ESM/CJS graph reaches `Module._load` with `server-only` ALREADY
 * resolved to its absolute `index.js` — so an equality check on the specifier missed it and
 * the package threw its "cannot be imported from a Client Component" guard inside a plain
 * Node process. Broadened rather than special-cased: any request that resolves into the
 * package is the package.
 */
function isServerOnly(request) {
  if (request === 'server-only') return true;
  return typeof request === 'string' && /[\\/]server-only[\\/]/.test(request);
}

Module._load = function patchedLoad(request, ...rest) {
  // `server-only` exports nothing. An empty object is exactly what Next substitutes.
  if (isServerOnly(request)) return {};
  return originalLoad.call(this, request, ...rest);
};

register('./server-only.mjs', import.meta.url);
