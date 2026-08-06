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

Module._load = function patchedLoad(request, ...rest) {
  // `server-only` exports nothing. An empty object is exactly what Next substitutes.
  if (request === 'server-only') return {};
  return originalLoad.call(this, request, ...rest);
};

register('./server-only.mjs', import.meta.url);
