# Velnes VPS deployment (no Docker)

Everything runs natively on one Linux VPS (Debian/Ubuntu assumed):
native PostgreSQL 16, native Caddy, and the API as a single bundled
Node file under systemd.

## One-time server setup

1. **Node 24** — via nodesource or `nvm`; `node` on PATH at /usr/bin/node
   (adjust `ExecStart` in the unit if elsewhere).
2. **PostgreSQL 16** — `apt install postgresql-16`. Create role + db:
   `createuser velnes && createdb -O velnes velnes`; set a strong
   password; keep `listen_addresses = 'localhost'`.
3. **Caddy** — `apt install caddy` (runs as a systemd service already).
   Copy the repo `Caddyfile` to `/etc/caddy/Caddyfile`; point DNS at
   the VPS; Caddy handles TLS automatically.
4. **API user + dirs** — `useradd -r velnes`; `mkdir -p /srv/velnes/api`
   and `/srv/velnes/{workspace,employee,booking,supplier,hq}` for the
   built SPAs.
5. **systemd unit** — copy `deploy/velnes-api.service` to
   `/etc/systemd/system/`, `systemctl enable --now velnes-api`.

## Each release

1. Build locally or in CI: `pnpm build`.
2. Upload `services/api/dist/index.js` → `/srv/velnes/api/dist/`,
   and each `apps/*/dist/*` → `/srv/velnes/<app>/`.
3. `/srv/velnes/api/.env` (never in git) holds `NODE_ENV=production`,
   `PORT=3001`, `API_DATABASE_URL`, `DATABASE_URL` (dbmate), `JWT_SECRET`,
   the app URLs (`CONSUMER_APP_URL`, `EMPLOYEE_APP_URL`, `WORKSPACE_APP_URL`,
   `HQ_APP_URL`, `SUPPLIER_APP_URL`) and mail: `MAIL_TRANSPORT=smtp`,
   `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`,
   `MAIL_FROM` — see `.env.example`. Point `MAIL_FROM` at a domain whose
   SPF/DKIM the provider has verified, or mail lands in spam.
4. Run migrations: `dbmate up` against the server DATABASE_URL.
5. `systemctl restart velnes-api`.

The API is one self-contained bundle (no node_modules on the server).
Scale path per docs §2: split the widget/API onto a second process or
box before any other optimization.
