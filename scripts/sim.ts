/**
 * Research simulations (spec §8): `npm run sim -- --exp <name> [--games N] [--particles N]`.
 * Each experiment writes JSON to public/research/ for the Research page.
 */
import { experiments } from './experiments';
import { arg } from './lib/io';

const name = arg('exp');
const run = name ? experiments[name] : undefined;
if (!run) {
  console.error(`Usage: npm run sim -- --exp <${Object.keys(experiments).join('|')}>`);
  process.exit(1);
}
const t0 = Date.now();
await run();
console.log(`${name} finished in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
