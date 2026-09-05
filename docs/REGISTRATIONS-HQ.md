# Registrations & Revelapps HQ (Phase 8)

Every salon and every location on the platform passes Revelapps HQ —
no auto-approval, ever. This phase builds both sides of that gate.

## The registration machine

`registrations` is a **platform-level** table (no tenant): the status
machine `pending_review → under_review → changes_required →
resubmitted → active / declined`, the whole wizard draft retained as
jsonb, and an append-only `log`.

Doors:

| Door | Who | What |
| --- | --- | --- |
| `POST /registrations` | anonymous, rate-limited | the whole draft, validated by `RegistrationDraftSchema` |
| `GET /registrations/:id?token=` | the applicant | status + draft (never the password back out) |
| `POST /registrations/:id/resubmit?token=` | the applicant | new draft, only from `changes_required` |
| `POST /hq/registrations/:id/{approve,request-changes,decline}` | HQ reviewers | the three decisions |

The applicant's key back in is the **resubmit token**, matched by an
RLS policy (`resubmit_token = current_setting('app.reg_token')`) —
row-level, not an if-statement. Email verification and team
invitations mint their tokens now and wait for SMTP, honestly.

**Approval provisions the tenant world in one transaction**: the
business, a locked Owner role at the widest legal scopes, the owner
account with the wizard's own password (sign-in works the same
minute), the legal entity **verified** (the compound decision), the
location at `APPROVED` — activation stays with the owner, behind the
readiness gate — and the picked starter services
(`REG_SERVICE_TEMPLATES`, business-level, online off). Idempotent:
approving twice returns the same world.

## Revelapps HQ (apps/hq)

Separate principals (`hq_users`: hq_super / hq_onboard / hq_support /
hq_tech / hq_audit), separate 8-hour tokens — the HQ and tenant claim
shapes reject each other by construction, so neither token opens the
other side's doors. Cross-tenant reads go through explicit `app.hq`
RLS policies (SELECT only); every write into a tenant's world still
runs through the tenant doors under `withTenant`.

The Customers pane is the prototype's intake table: the
**New locations** queue (SUBMITTED / UNDER_REVIEW / RESUBMITTED
across all tenants), the **New registrations** queue with
Verify & activate / Request changes (reason mandatory) / Decline,
and the businesses table. The location review card shows the legal
entity and flags a **compound review** when the entity is still
pending — approving verifies both in one decision, via
`locTransition` with an HQ actor (`HQ · <name>` in the lifecycle log
and audit trail). Platform log = cross-tenant `audit_log`.
Suppliers and HQ team tabs are honest empty states until their
phases. Intake decisions need hq_super or hq_onboard.

## The New-location wizard (workspace)

Settings › Locations › Add location — five steps (four from scratch):
start (scratch / snapshot copy), location details (a foreign country
flags the holiday-calendar + fiscal follow-ups), legal entity
(attach existing or create pending for the compound review), the copy
checklist, review & submit.

`copyLocationSetup` is the prototype's copy engine verbatim: a
one-time snapshot, never a link. The checklist decides what travels
(services & flags, prices incl. variant overrides, durations with
prep/reset, product configuration, hours, policies, payments);
**stock always starts at 0**; staff, customers, history and payment
credentials never travel; no source reference is stored, so syncing
later is impossible by construction. Whatever is not part of the copy
starts **off** — never a silent fallback to the business-wide
default.

## The registration wizard (workspace, public /register)

The prototype's eight steps, trilingual, validated per step. The
demo-map pin derives lat/lng until real geocoding lands. The resubmit
token is kept client-side (`velnes.reg`); a returning applicant sees
where the machine stands — including HQ's reason, with the whole
draft reopened for correction (only the password is re-entered; it
never travels back). AI-assisted onboarding waits for a real import
service.

## Tests

- `registrations.test.ts` — the anonymous door, the RLS token door,
  email-taken refusal, token-shape separation, the full machine,
  provisioning (new owner signs in, RLS isolation, starter services,
  verified entity), the compound location review with the HQ actor in
  the audit trail, and the cross-tenant platform views.
- `locations.create.test.ts` — snapshot copy semantics, stock at 0,
  owner-only access grants, everything-off from scratch, pending
  entity + submit in one act, permission gate.
- `apps/hq/src/App.test.tsx` — sign-in, intake table, decisions,
  reason-mandatory guard.
- `apps/workspace/src/pages/Register.test.tsx` — per-step validation
  and the whole draft POSTed.
- `e2e/platform.spec.ts` — the two full loops across three apps:
  register → HQ activate → owner signs into their own world;
  owner submits a copy location with a new entity → HQ approves the
  compound → owner activates behind the readiness gate.

## HQ chrome (2026-09-03)

The HQ app wears the prototype's own shell now, pixel for pixel: the
fixed icon sidebar (HQ_NAV — Customers, Categories, Suppliers, HQ
team, Search lab, Platform log; Categories is ours, the shelfkeeper
for the Velnes taxonomy and its request intake), the foot tile "Back
to the salon workspace" (VITE_WORKSPACE_URL, :5173 in dev), the
topbar with the fixed "Revelapps HQ" title, and the avatar menu
top-right (signed-in block, language rows, sign out) — `body.env-hq`
set like the prototype does. Suppliers, HQ team and Search lab stay
honest empty states (Search waits for §5).

The Categories tab's add-form became a top-right accent Add button
opening a small modal (name + item type, Enter books it); the note
copy now tells the truth about guarded delete. The HQ topbar carries
the same notices bell as the workspace (GET `/hq/notices`, unseen dot
via a per-browser seen timestamp), so HQ sees the platform notices it
writes.

Notices carry an audience now (migration 20260903200024: 'salons' |
'hq'; a tenant may insert only audience='hq' rows — it can ring HQ's
bell and nothing else). A salon's category request writes an
audience='hq' notice ("Category request: X · from <salon>") so HQ's
bell rings the moment the ask lands; approval keeps writing the
salons-audience notice. Both feeds filter by audience, and notice
rows are buttons: category notices land on the Categories tab (HQ)
or Catalog → Categories (workspace).

A decline answers the asker: migration 20260903210025 gives notices a
target tenant (null = broadcast; reads RLS-scoped so a salon sees
broadcasts and its own mail, never another salon's; HQ sees all).
Declining a category request — reason mandatory at the door — writes
an audience='salons' notice targeted at the requesting tenant, title
"Category request declined: X", body = the reason; the salon's bell
carries it and clicking lands on Catalog → Categories where the
request row shows the same reason.

## HQ team, Supplier Intelligence, the mail outbox (2026-09-03)

The two empty tabs are real now. **HQ team**: the people list with
role badges, super-only invite (modal), per-row role change and
removal — the last active hq_super can never be demoted, removed, or
remove themselves; invited members carry an unusable hash and the
login door refuses NOT_ACTIVE until the invite flow completes
(status check widened to include 'invited'). **Supplier
Intelligence**: GET `/hq/suppliers` reads the whole chain cross-
tenant (new hq_read policies on supplier_connections/purchase_orders/
purchase_order_lines, hq_write on suppliers) — products, connected +
pending salons, order count and value per supplier; super-only create
(starts unverified) and verify/unverify.

**The mail outbox** models SMTP honestly until the provider is
decided (likely Resend): every mail the platform would send goes
through `queueMail` into `mail_outbox`; the mock transport stamps
rows `mock_sent` and nothing leaves the building. Wired senders:
salon employee invites, customer email-verification on change, HQ
team invites. HQ sees the whole outbox on the team tab (GET
`/hq/outbox`); a real Resend adapter later flips queued → sent with
no schema change.

## Full prototype parity for the two tabs (2026-09-03, second pass)

**Suppliers** wears the prototype's hqSuppliers now: the Add+ pop
(Supplier / Brand kinds), the suppliers TABLE — supplier + contact,
type, brands carried, the Merchant column (legal entity + MID +
Active/Missing-config from the real payment_accounts rows, seeded
owner_id links), catalog counts with salons/orders underneath, and
Verified/Under-review status — plus the missing-config chip filter
and the "Brand, supplier and distributor" tri-minicard ("three
different things, on purpose"): migration 20260903240028 adds
platform `brands` + `supplier_brands` (seeded with the prototype's
four brands and BeautyPro/Aroma carriage), doors GET/POST
`/hq/brands`.

**HQ team** wears hqTeam: the Add+ pop (Team member / Role), the
role-kit card over a real `hq_roles` table — the prototype's six
standard roles (hq_super locked; hq_finance and hq_audit join the
vocabulary, the check constraint replaced by an FK) with
customer-access badges, per-role user-count popups listing the
people, View, and custom-role create-from-base / guarded delete
(GET/POST/DELETE `/hq/roles`) — and the People table (name, role
name, two-factor Required, last active honest '—'/Invite sent) with
the prototype's member edit panel (name, email, the
what-each-role-may-reach picker, remove inside). Honest omission:
the prototype's "Work as this role" switcher waits for the
customer-environment support surface.

## The customers dashboard takes the prototype's shape (2026-09-04)

**Customers** now wears hqCustomers in full: the toolbar (Businesses ·
n accounts, the signed-in badge, the Add button for hq_super/
hq_onboard), the four stat blocks and the complete accounts table —
plan, onboarding progress bar, last support access, Live/Invited/
Onboarding badge, and Open into the prototype's hqBusiness detail
page (onboarding checklist, integrations, commercial, support cards).
Everything on it is DERIVED, never stored: status comes from the
owner's invite state and location lifecycles, the six ONBOARD_STEPS
from whether the rows actually exist (locations past DRAFT, catalog
items, ≥2 employees, an active payment account, a widget), MRR from
`PLAN_PRICES` in contracts (Starter 49 / Business 139 MKD,
subscriptions only, 0 while invited), and sync errors from
`integration_events` (migration 20260904100030 gives HQ read-only
windows on services/products/widgets/integration_events). Open
tickets and last support access are honest zeros/nulls from the same
door until the support-ticket surface is built — the UI never guesses.
The Add button is the prototype's hqNewBiz panel behind POST
`/hq/businesses`: one transaction provisions business + Owner role +
invited owner (no credentials — the owner sets their own password) +
optional APPROVED first location, queues the `owner_invite` through
the outbox, writes the audit line, and refuses duplicate owner emails
(409) and non-onboarding roles (403). "Send reminder" on the detail
page queues a real `onboarding_reminder` mail. The seed now includes
the prototype's other three accounts (Vita Fizio mid-onboarding,
Lumen Beauty live without the widget, Spa Ohrid invited) built from
exactly the rows that derive those dashboard rows. Honest omissions:
"Open customer environment" stays a disabled door and per-step
"Offer help" is left out — both wait for support sessions.

## The team screen's Add flows take the prototype's shape (2026-09-04)

The Add+ pop's two doors stop being modals and wear the prototype's
drawers. **Team member** is hqUser/hqUserEdit: Full name, Email (with
the invite/moving-sign-in hints), the Role select over the live role
kit, the "What each role may reach" card, the prototype's guard
toasts (name first, incomplete email — duplicates refuse server-side
with 409), "Send invite"/"Save changes" in the panel head with the
saved/unsaved status pill, and the guarded remove kept inside the
drawer. **Role** is roleKitNew/roleKitEdit over a real perms column:
migration 20260904110031 adds `hq_roles.perms` seeded with the
prototype's seedHqRolePerms matrix, GET `/hq/roles` serves it in the
prototype's role order, create copies ANY base role's permissions
(no longer std-only), and the create drawer honestly ends with "the
permissions appear once it exists". The edit drawer delivers on
that: the HQ_PERM_GROUPS (now platform vocabulary in
`@velnes/contracts`) render as scope selects (none/read/write) that
apply one move at a time through PATCH `/hq/roles/:id` — merged
server-side, unknown keys refused, the locked keyholder refused,
super-only — with name/description saves through the same door.
Honest omission: role changes are not yet audited — the platform log
writes need a tenantless audit lane first, the same gap every HQ
team/role door already has.

## Support tickets — salon and supplier reach Revelapps HQ (2026-09-04)

Support tickets are now real, replacing the dashboard's honest
`openTickets: 0` placeholder. A salon (workspace **Support** page) or a
supplier (portal **Support** tab) opens a thread to Revelapps HQ; the
ticket carries the conversation as a JSONB thread on one row
(`support_tickets`, migration 20260904200040). Exactly one of
`tenant_id`/`supplier_id` is set, and RLS gives each side only its own
while HQ (`app.hq`) reads them all. HQ's new **Tickets** tab lists every
thread across both origins, answers them (`POST /hq/tickets/:id/reply`,
which mails the opener at the email captured when the ticket was opened)
and moves the lifecycle (`PATCH /hq/tickets/:id`: open → in_progress →
resolved/closed). Every inbound ticket and reply also queues mail
through the outbox — the thread exists in the apps and over SMTP (mock
until the provider). The dashboard's open-ticket stat now counts real
open + in-progress tickets across the platform, and each salon row shows
its own count. Honest note: HQ role changes on tickets are not yet in
the audit trail — the same deferral as the rest of the HQ role kit.
