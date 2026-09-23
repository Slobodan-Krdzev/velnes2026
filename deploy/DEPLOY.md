# Velnes production deployment

Written for the real target (2026-09-23): a Contabo VPS on Ubuntu 22.04
that already runs six Node applications under PM2, Nginx on 80/443, and
MongoDB on 127.0.0.1:27017. Velnes is **added next to** all of that and
touches none of it. The six web apps are hosted on Vercel.

```
Internet → api.<domain> → Nginx :443 → 127.0.0.1:6000 → PM2 "velnes-api" (fork, 1 instance)
                                                       → 127.0.0.1:5432 PostgreSQL 16
Vercel: consumer · workspace · employee · booking · supplier · hq  (each rewrites /api/* → api.<domain>)
```

## What the API needs, verified

- **Node 22 is enough.** `.nvmrc` says 24 as a preference; the API and its
  whole test suite run on 22, and the production bundle was started
  under Node 22 with health and an argon2 login answering 200. Do not
  change the VPS's global Node (22.18).
- **PostgreSQL 16** (PGDG). Ubuntu 22.04's own 14 cannot run the
  migrations (`UNIQUE NULLS NOT DISTINCT`, a 15+ feature). The migrations
  create the extensions `pgcrypto`, `pg_trgm`, `unaccent` — all trusted,
  all in the `postgresql-16` package, no superuser needed.
- **Two database roles.** `velnes` owns the database and runs migrations;
  `velnes_api` is the login the API uses, and every table has
  `FORCE ROW LEVEL SECURITY`. Create `velnes_api` yourself with a strong
  password before migrating: the first migration would otherwise create
  it with the password `velnes_api`.
- **The build is a bundle plus twelve npm packages, not a single file.**
  argon2 is a native addon and pino spawns a worker from a file next to
  itself; both reference `__dirname`, which an ES-module bundle does not
  have. `pnpm --filter @velnes/api build` (`scripts/build.mjs`) therefore
  bundles the workspace packages and keeps the npm dependencies external,
  and writes `dist/package.json` + `dist/package-lock.json` with exact
  versions so `npm ci --omit=dev` on the server is reproducible.
- **Port and bind address are `PORT` and `HOST`.** In production `HOST`
  defaults to 127.0.0.1 so the API is never reachable on the public IP.
- **Proxy trust.** Fastify trusts `X-Forwarded-*` from `TRUST_PROXY`
  (default 127.0.0.1), so the public and login rate limits key on the
  visitor's address, not on Nginx's.
- **PM2 in fork mode with one instance** — never cluster: the rate
  limiter is in-memory per process and the mail sender is serialised
  per process.
- **Resources:** the API sits at 120–200 MB RSS like the other apps;
  PostgreSQL 16 idles near 150 MB.

## One-time setup on the VPS

Do not touch: the global Node/npm/PM2, the existing PM2 process list,
`/etc/nginx/nginx.conf` and existing server blocks, MongoDB, the ports
3001/4000/4400/5001/5026/5555, existing certbot certificates.

### Read-only checks

```bash
node -v && pm2 -v && nginx -v && pm2 list
ss -tulpn | grep -E ':6000|:5432'      # both empty
ls /etc/nginx/sites-enabled/
which certbot && sudo certbot certificates
free -h && df -h /
```

### Install PostgreSQL 16 and dbmate

```bash
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt jammy-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt update && sudo apt install -y postgresql-16 postgresql-client-16
ss -tulpn | grep 5432                   # 127.0.0.1:5432 only (package default)
sudo curl -fsSL -o /usr/local/bin/dbmate https://github.com/amacneil/dbmate/releases/download/v2.35.0/dbmate-linux-amd64
sudo chmod +x /usr/local/bin/dbmate
```

### Database

```bash
sudo -u postgres psql
```
```sql
CREATE ROLE velnes     LOGIN BYPASSRLS PASSWORD '<strong 1>';
CREATE ROLE velnes_api LOGIN PASSWORD '<strong 2>';
CREATE DATABASE velnes OWNER velnes;
```

`BYPASSRLS` on the owner is required: several migrations insert the
platform taxonomy (service categories, search terms) into tables that
have `FORCE ROW LEVEL SECURITY`, and `FORCE` applies to the owner too.
On dev and CI the migration role is a superuser, which hid this. The
API role `velnes_api` never bypasses RLS. Use hex passwords
(`openssl rand -hex 24`) so the connection URLs need no escaping.

Migrations run from `deploy/release.sh` as `velnes` (below). Never run
the demo seed on production; it refuses under `NODE_ENV=production`.

### The API directory and its env

```bash
sudo mkdir -p /srv/velnes/api && sudo chown "$USER" /srv/velnes/api
```

Copy `deploy/env.production.example` to `/srv/velnes/api/.env`, fill
it in, `chmod 600`. `JWT_SECRET` = `openssl rand -hex 32`. The `*_APP_URL`
values are the Vercel origins; `RESEND_API_KEY` and a verified
`MAIL_FROM` domain turn mail on.

### First release

From the development machine:

```bash
deploy/release.sh deploy@<vps>
```

It builds, uploads `dist/` (`index.js`, `create-hq-user.js`,
`package.json`, `package-lock.json`), the migrations and the PM2
ecosystem file, runs `npm ci --omit=dev`, `dbmate up` as `velnes`,
starts or restarts `velnes-api` under PM2, `pm2 save`s (the dump then
holds all seven apps; the existing startup hook is untouched) and curls
health on 127.0.0.1:6000.

### The first HQ user

HQ users are otherwise only created by another HQ user's invite. Once:

```bash
cd /srv/velnes/api
HQ_BOOTSTRAP_PASSWORD='<strong>' node --env-file=.env create-hq-user.js "Ivana Petrova" ivana@revelapps.com hq_super
```

### Nginx

```bash
sudo cp deploy/nginx/velnes-api.conf /etc/nginx/sites-available/velnes-api   # set server_name
sudo ln -s /etc/nginx/sites-available/velnes-api /etc/nginx/sites-enabled/velnes-api
sudo nginx -t && sudo systemctl reload nginx      # reload, never restart
```

### Domain and TLS

An `A` record `api.<domain>` → the VPS. Then, if certbot manages the
other sites already: `sudo certbot --nginx -d api.<domain>` — it edits
this block only and joins the existing renewal timer. HTTPS is required:
browsers grant the consumer app geolocation only over https.

### Verify

```bash
curl -s https://api.<domain>/api/v1/health
pm2 list && pm2 logs velnes-api --lines 50
```

Then register a client in the consumer app (the verification mail
arrives via Resend), sign in to HQ with the bootstrap user, approve a
salon, open one employee sign-in link on a phone. Confirm the six
existing apps still answer.

### Rollback

```bash
pm2 delete velnes-api && pm2 save
sudo rm /etc/nginx/sites-enabled/velnes-api && sudo nginx -t && sudo systemctl reload nginx
```

PostgreSQL may stay installed and idle; `sudo apt remove postgresql-16`
removes it without involving MongoDB.

## The web apps on Vercel

One Vercel project per app, all from this repository:

| Setting | Value |
|---|---|
| Root Directory | `apps/<app>` (enable "Include source files outside of the Root Directory") |
| Framework | Vite |
| Install Command | `pnpm install --frozen-lockfile` (run from the repo root) |
| Build Command | `pnpm --filter @velnes/<app> build` |
| Output Directory | `dist` |
| Node.js Version | 22.x |

Each app calls the API by the relative path `/api/v1/…`, so each project
carries `apps/<app>/vercel.json` with a server-side rewrite of `/api/*`
to the API origin plus the single-page fallback. Regenerate all six for
the real API hostname:

```bash
node deploy/vercel-rewrites.mjs https://api.<domain>
```

No environment variables are required on Vercel. The HQ app finds the
workspace, and the workspace finds the employee app, from their own
hostname (`workspace.<domain>` ↔ `employee.<domain>`, `siblingAppUrl` in
`@velnes/ui`); `VITE_WORKSPACE_URL` / `VITE_EMPLOYEE_URL` are optional
overrides only. The workspace shows a WhatsApp support button only when
`VITE_SUPPORT_WHATSAPP` is set to a number at build time.

## Each release

```bash
deploy/release.sh deploy@<vps>
```

Build → upload → `npm ci --omit=dev` → `dbmate up` → `pm2 restart
velnes-api` → health. Vercel deploys the apps from `main` on push.

## Still open, honestly

Payments are a mock provider (keep "pay at venue" until one is chosen).
Bounce/complaint webhooks from Resend are not wired (a `sent` row means
the provider accepted the mail). Nightly `pg_dump` off the box is the
only backup plan and is not automated here.
