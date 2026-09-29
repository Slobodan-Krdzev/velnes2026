# Phase 1 — Foundations

**Tenancy & RLS.** One schema, tenant root `businesses`. Every tenant
table carries `tenant_id`, indexes start with it, and RLS policies
(`tenant_id = app.current_tenant()`) ship in the same migration as the
table — with `FORCE ROW LEVEL SECURITY`, so not even the table owner
skips them. The API connects as the restricted `velnes_api` role and
reaches tenant data only through `withTenant()`, which sets
`app.tenant_id` per transaction. Supplier-owned legal entities and
payment accounts are platform-level (`tenant_id IS NULL`): readable by
every tenant (checkout routing needs the seller), writable by none.
The RLS test suite proves isolation with deliberately unfiltered SQL.

**Auth.** Login by email + argon2id password → 15-minute JWT (claims:
employee, tenant, access level, role, location ids) + opaque 30-day
refresh token, stored hashed. Refresh rotates; reusing a rotated token
revokes its whole family. The pre-tenant login lookup runs under an
explicit `SET LOCAL app.auth = 'login'` policy — the one deliberate,
visible door through tenant isolation. Invited employees cannot sign
in until active. 2FA is a reserved flag (honest emptiness).

**Authorization.** The prototype's permission vocabulary (7 groups,
32 keys, scope ladder none→own→assigned→location→locations→business→
platform) lives in `@velnes/contracts`; roles store a validated perm
map (jsonb); `scopeOf`/`can` is the one authz door.

**Two standard roles (2026-09-22).** Every tenant is born with exactly
two: **Owner** (locked, every key at its widest scope) and **Employee**
— Alex's basic kit: their own appointments, create/edit/cancel
appointments at their location, take payments; every other key
`none`, so the workspace shows them Calendar, Cash register and
Support and nothing else — the Flightdeck too is behind
`reports.view_location`/`reports.view_business` now (API 403, the
home route sends them to the calendar). The kits are `STANDARD_ROLES` in
`@velnes/contracts`, written by one helper (`standardRoles()`) from
registration approval, HQ's create-business door and both seeds;
migration `20260922120000_employee_role` gave every earlier tenant
its Employee role and reset existing standard Employee roles to the
kit (custom roles untouched). An invite that names no role gets the
Employee role, never nothing. The Employee role is unlocked: an owner
who wants more for their staff edits it or adds a role.

**Location lifecycle.** `locTransition` is the only lifecycle writer:
legal edges per the prototype's `LOC_EDGES`, readiness gate on
APPROVED→ACTIVE (five requirements; the service/staff checks read the
catalog and honestly report not-ready until Phase 2), owner-only
activation, lifecycle log + audit entry in the same transaction.
`locLive` is the liveness predicate every customer surface will ask.
Search-market admission on ACTIVE is deferred with §5.

**Audit.** One `logAudit` door, one `audit_log` table (actor, before,
after, source, reason). No UPDATE/DELETE policies exist — audit rows
are immutable for the API role.

**Seed.** `pnpm --filter @velnes/api seed` builds the prototype's demo
world: Velnes Fizio Centar (Centar + Aerodrom, both ACTIVE), the five
employees (Maria owner … Bojan bookkeeper), four standard role kits +
custom Bookkeeping, the three legal entities — Aroma Nordic
deliberately pending — and payment accounts. Demo password
`velnes-demo`; the seeder refuses `NODE_ENV=production` and needs an
RLS-exempt connection (`SEED_DATABASE_URL`).

**Fixture salons (2026-09-28).** `pnpm --filter @velnes/api fixtures add
--batch <name> [--count 12]` adds a batch of complete test salons and
`fixtures remove --batch <name>` takes them away again without a trace;
`fixtures list` says what is there; `fixtures amenities --batch <name>` gives a batch made before amenities existed its realistic sets (2026-09-29), idempotently. They are made through the front
door — a registration draft filed and approved exactly as HQ approves,
so business, roles, owner, verified entity, ACTIVE location with a map
pin, services online, products and gallery come from the same code a
sign-up runs through — plus two or three *active, bookable* colleagues
with skills and passwords (a sign-up's team is only invited), a pitch
and a description for the consumer card. Every account's password is
`velnes-fixture`; owner and staff addresses end in
`@fixture.velnes.test`. What tells them apart is one column,
`businesses.fixture_batch` (NULL for real salons); removal deletes every
tenant-scoped table's rows for the batch's businesses in foreign-key
order — both the table list and the order are read from the schema at
run time, so a tenant table added later cannot be forgotten — then the
registrations, then the businesses, in one transaction; nothing outside
the batch is touched, by construction. Mail is forced to the mock
transport for the run (the doors queue verification and approval mails;
none may leave for addresses that do not exist), and categories are
snapped to names the target taxonomy already has, never created. The
CLI needs both connections: `API_DATABASE_URL` for the doors and
`DATABASE_URL` (the owner role) for tagging and removal, which cross
tenants. It ships in the production bundle as `fixtures.js` (see
`deploy/DEPLOY.md`). Deferral: HQ does not yet badge a fixture salon in
its lists; the appointment book of a fixture salon starts empty.

## Mail delivery (2026-09-23)

**Every mail really goes out, in the Velnes look.** Alex, before
hosting: "every verification, confirmation, decline, deletion, payment
— everything we connected through email has to work." The one door is
unchanged — `queueMail(trx, {to, subject, body, kind, refId, cta?,
code?})` writes the row into `mail_outbox` inside the caller's
transaction — and what happens next is the transport's:

- **`MAIL_TRANSPORT=smtp`** — `modules/mail/mail.sender.ts` drains the
  outbox: `sendPending()` takes the due `queued` rows, renders them and
  hands each to nodemailer over SMTP (`SMTP_HOST`, `SMTP_PORT` 587 or
  465 with `SMTP_SECURE=true`, `SMTP_USER`/`SMTP_PASS`, `MAIL_FROM`,
  optional `MAIL_REPLY_TO`). **Resend is the provider** (Alex,
  2026-09-23): `RESEND_API_KEY` alone switches the transport on with
  Resend's SMTP settings, and `pnpm --filter @velnes/api mail:test
  <address>` sends one real mail in the layout to prove a setup. The
  SMTP_* variables still override, so any provider that speaks SMTP works —
  Resend (`smtp.resend.com`, user `resend`, password = API key), Brevo,
  Mailgun, Postmark, a Google Workspace app password, the host's relay.
  A row reads `sent` only once the provider accepted it (`message_id`
  kept); a refused send records `error` and `attempts` and retries
  after 1, 5, 15 and 60 minutes; the fifth refusal marks it `failed`.
  `queueMail` nudges the sender 400 ms after queueing (the caller's
  transaction has committed by then) and the API process runs a 30 s
  heartbeat (`startMailLoop()` in `index.ts`) for the retries. The
  sender reads under the HQ policy — it is the platform's own worker,
  not a tenant.
- **`MAIL_TRANSPORT=mock`** (dev, tests, the default) — rows are
  stamped `mock_sent` and nothing leaves the building, exactly as
  before.

**The layout** (`mail.render.ts`) is the consumer app's palette on
mail-client HTML — tables, inline styles, web-safe fallbacks: the
"Velnes" wordmark in coral on warm white, the subject as an ink-brown
display heading, the door's prose as paragraphs with bare links made
live, a one-time `code` set large and letter-spaced, a `cta` as the
coral button with the URL written under it for clients that strip
buttons, and a footer saying whom the mail speaks for ("Sent by Velnes
for Velnes Fizio Centar."). Everything a person typed is escaped; a
plain-text alternative rides along. Every mail with somewhere to go
now carries a button: booking confirmed/accepted → the appointment or
payment screen, declined → the app, payment received → the account,
booking request → the salon's calendar, owner/HQ/supplier invites and
the onboarding reminder → their app (`WORKSPACE_APP_URL`, `HQ_APP_URL`,
`SUPPLIER_APP_URL`), order placed → the supplier's orders, support
tickets → HQ, employee invites → the personal sign-in link, the
verification code → set large.

**Pinned** by `mail.render.test.ts` (layout, code, button, escaping)
and `mail.smtp.test.ts`, which boots a real SMTP server inside the
test, registers a client and invites an employee through the real
doors, drains the outbox, inspects the messages the server received
(subject, From, coral, the code, the button, the salon footer), then
closes the server and watches the sender retry with backoff and give
up as `failed` with the reason.

**Still deferred, honestly:** a hosted logo image (mail clients strip
inline SVG, so the wordmark is text); per-tenant From names and reply
addresses; bounce and complaint webhooks from the provider (a `sent`
row means accepted by the provider, not delivered to the inbox);
mails in the customer's language (bodies are English prose today).
