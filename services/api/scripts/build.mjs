#!/usr/bin/env node
/**
 * The production build of the API (deploy/DEPLOY.md).
 *
 * What comes out of `dist/`:
 *   index.js           the API, with the workspace packages
 *                      (@velnes/contracts …) bundled in
 *   create-hq-user.js  the first-HQ-user bootstrap, same shape
 *   package.json       the npm runtime dependencies, exact versions
 *   package-lock.json  so `npm ci --omit=dev` on the server is exact
 *
 * Why the npm dependencies stay OUTSIDE the bundle: argon2 is a native
 * addon (its .node binary is found relative to its own package dir) and
 * pino spawns a worker from a file next to itself — both reference
 * __dirname, which does not exist in an ES-module bundle. A truly
 * single-file bundle crashes on start (verified 2026-09-23), so the
 * server installs these twelve packages and the bundle imports them.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// The runtime dependencies: everything in package.json that is not a
// workspace package, pinned to the exact version installed here
// (node_modules/<name> is pnpm's symlink into its store).
const runtime = {};
for (const name of Object.keys(pkg.dependencies)) {
  if (name.startsWith('@velnes/')) continue;
  const version = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
  runtime[name] = version;
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: { index: join(root, 'src/index.ts'), 'create-hq-user': join(root, 'src/db/create-hq-user.ts') },
  outdir: dist,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: [...Object.keys(runtime), 'pg-native'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
});

writeFileSync(
  join(dist, 'package.json'),
  JSON.stringify(
    {
      name: 'velnes-api',
      version: pkg.version ?? '0.0.0',
      private: true,
      type: 'module',
      engines: { node: '>=22' },
      scripts: { start: 'node --env-file=.env index.js', 'hq:create': 'node --env-file=.env create-hq-user.js' },
      dependencies: runtime,
    },
    null,
    2,
  ) + '\n',
);

// The lockfile `npm ci` insists on. Resolved against the registry,
// nothing installed here (--package-lock-only).
try {
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: dist,
    stdio: 'inherit',
  });
} catch {
  console.error('\nCould not write dist/package-lock.json (registry unreachable?). The bundle is built; on the server use `npm install --omit=dev` instead of `npm ci` for this release.');
  process.exitCode = 1;
}
console.log(`\nAPI built into dist/: index.js, create-hq-user.js, package.json (${Object.keys(runtime).length} runtime deps), package-lock.json`);
