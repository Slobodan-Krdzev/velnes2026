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
