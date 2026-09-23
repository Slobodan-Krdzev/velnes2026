#!/usr/bin/env node
/**
 * Writes apps/<app>/vercel.json for all six web apps (deploy/DEPLOY.md).
 *
 * Every app calls the API by the relative path `/api/v1/...` (the Vite
 * dev proxy does the same), so on Vercel each project needs a rewrite
 * that proxies `/api/*` server-side to the API's public origin — same
 * origin for the browser, no CORS, no per-app API URL. The second
 * rewrite is the single-page fallback.
 *
 *   node deploy/vercel-rewrites.mjs https://api.velnes.mk
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const origin = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https:\/\/[^/]+$/.test(origin)) {
  console.error('Usage: node deploy/vercel-rewrites.mjs https://api.<your-domain>');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPS = ['workspace', 'employee', 'booking', 'supplier', 'hq', 'consumer'];
const config = {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  framework: 'vite',
  rewrites: [
    { source: '/api/(.*)', destination: `${origin}/api/$1` },
    { source: '/(.*)', destination: '/index.html' },
  ],
};
for (const app of APPS) {
  writeFileSync(join(root, 'apps', app, 'vercel.json'), JSON.stringify(config, null, 2) + '\n');
  console.log(`apps/${app}/vercel.json → ${origin}`);
}
