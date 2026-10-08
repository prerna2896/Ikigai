// Resolves @ikigai/* bare specifiers to their package's src/index.ts (or
// a subpath), and appends .ts to extensionless relative imports — for
// Node's native `node --test` runner. The @ikigai/* packages only exist
// as tsconfig path aliases resolved by Next.js's bundler, not as real
// node_modules symlinks; and our source uses extensionless relative
// imports (`./traits`, TS/bundler style), which Node's ESM resolver
// doesn't guess at by default. Node 26+ strips TS types natively — this
// loader is the only piece actually missing to run our source directly.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = pathToFileURL(path.resolve(import.meta.dirname, '../..') + '/').href;

export async function resolve(specifier, context, nextResolve) {
  const pkgMatch = specifier.match(/^@ikigai\/([^/]+)(?:\/(.*))?$/);
  if (pkgMatch) {
    const [, pkg, subpath] = pkgMatch;
    const target = `${ROOT}packages/${pkg}/src/${subpath ?? 'index'}.ts`;
    return nextResolve(target, context);
  }
  if (/^\.\.?\//.test(specifier) && !path.extname(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // Fall through — e.g. it's actually a directory with an index.
    }
  }
  return nextResolve(specifier, context);
}
