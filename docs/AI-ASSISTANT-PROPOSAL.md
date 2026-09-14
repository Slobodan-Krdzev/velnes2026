# Velnes AI Assistant — Architecture Proposal

Status: **proposal for review — no implementation started.**
Grounded in an inspection of the current codebase (permissions, doors, audit,
transactions, the existing Claude-provider pattern, and both app shells).

---

## 0. Verdict — is it doable?

**Yes, and the codebase is unusually well-shaped for it.** The single hardest
precondition for a safe "AI action assistant" is already the law of this repo:

- **One door per business rule** — every rule is one service function behind one
  endpoint with one zod contract in `@velnes/contracts`. The Assistant reuses
  these doors verbatim; it never becomes a second write path.
- **Permissions enforced server-side, at the door** — `permsFor(trx, claims)` +
  `can(perms, key)` inside each handler. The Assistant calls the *same* two
  functions; it cannot widen a user's reach.
- **RLS-scoped transactions** — `withTenant` / `withSupplier` set
  `app.tenant_id` / `app.supplier_id` transaction-locally; one transaction can do
  many atomic writes. Tenant isolation is enforced by the database, not by trust.
- **An audit trail** — `logAudit(trx, tenantId, …)` with `source` and `reason`
  columns already present, purpose-built to attribute a change.
- **A proven, honest LLM boundary** — `extract.provider.ts` already calls Claude
  by raw `fetch` with forced `tool_choice` structured output, zod-validates the
  result, and **degrades to null (never fakes) when there is no key**. The
  Assistant's planner reuses this exact anatomy.

The central rule — **AI plans, Velnes executes** — maps one-to-one onto the
existing architecture. The LLM's job shrinks to *"pick a registered action and
fill its typed arguments"*; permission, validation, entity resolution, execution,
concurrency and audit stay entirely in Velnes code where they already live.

Two things are **genuinely net-new** (called out honestly throughout):

1. **Optimistic concurrency** — there is *none* today; every update is
   last-write-wins, no version/`updatedAt` compare anywhere. The stale-overwrite
   guard (§16) is new work.
2. **Structured change data** — audit `before/after` are free-text prose, not
   jsonb. The Assistant needs structured `ChangeSet` objects for previews and
   diffs; these are built fresh (§15) and can *also* feed a richer audit later.

Everything else reuses what exists.

---

## PART A — What we build on (verified facts)

| Concern | What exists today |
|---|---|
| API surface | `API_PREFIX = /api/v1`; `fastify-type-provider-zod` validates request bodies **and** zod-serializes responses. |
| Auth principals | Three token shapes that reject each other: tenant employee (`app.authenticate` → `req.claims` = `{sub,ten,acc,rol,locs}`), HQ (`app.authenticateHq`), supplier (`app.authenticateSupplier` → `req.supplierClaims` = `{sup,sub,name,rol}`). |
| RLS modes | `app.tenant_id` / `app.hq` / `app.supplier_id` / `app.auth` / `app.public` / `app.reg_token`, set transaction-local in `withTenant`/`withHq`/`withSupplier` (`db/index.ts`). |
| Permissions | `PERM_KEYS` (28 keys, 7 groups) in `contracts/src/permissions.ts`; `PermMap` = key→`Scope` (`none/own/assigned/location/locations/business/platform`); `scopeChoices(key)` is the ladder. Server: `permsFor` + `can` + `scopeOf` **inline in each handler** (no central middleware). Refusal = `403 {error:'FORBIDDEN', message:'Missing permission: <key>'}`. Scope constrains *rows* in-handler. |
| Audit | `logAudit(trx, tenantId, {actorEmployeeId, actorName, roleName?, businessName?, locationName?, action, object, before?, after?, source?, reason?})`; `audit_log` is **append-only** (SELECT+INSERT RLS only); `before/after` are **free-text**. |
| Transactions | One `withTenant` trx can do many writes + in-trx `logAudit`, all-or-nothing. `approveRegistration` even switches RLS context mid-trx. |
| Concurrency | **None.** No version column, no `If-Match`, no `updatedAt` compare. Last-write-wins everywhere. |
| LLM provider | `extract.provider.ts` (reference) & `insights.provider.ts`: raw `fetch` to `api.anthropic.com/v1/messages`, `tools`+`tool_choice`, zod `safeParse` of `tool_use.input`, `AbortController` timeout, env-gated (`*Provider`, `anthropicApiKey`, `*Model`), **no-key → null → degrade, never fake**, model sees only aggregated/public data. No streaming anywhere; live UI uses polling. |
| Client | `useSession()` → `{me, can, …}`; `me` = `MeResponse` (`id,name,access,roleId,locationIds,email,tenantId,lang,perms,roleName`); `can(key)=perms[key]!=='none'`; `api()` attaches Bearer, refreshes once on 401, zod-parses every response. Supplier portal has a **separate** auth (`velnes.portal` token, no refresh). |
| Shells | Workspace `Shell.tsx` renders fixed overlays as siblings after `.shell` (precedent: the WhatsApp button bottom-left + popup bottom-right). Supplier `Portal.tsx` has **no router** (tab state) and a `Panel` drawer via `createPortal`. Bottom-right is free. |
| i18n | `en/mk/sq` flat dot-keys, `en` is source of truth, `completeness.test.ts` enforces parity + placeholder match. |

### Doors the Assistant can reuse today (V1-relevant)

| Action | Door | Contract | Validation | Audits? |
|---|---|---|---|---|
| Create employee | `POST /employees` | `EmployeeInviteSchema` | `checkEmployeeState`, perm `users.manage` | ✅ "User invited" (+ invite mail) |
| Update employee | `PATCH /employees/:id` | `EmployeePatchSchema` | `checkEmployeeState`, last-owner guard | ⚠️ only on role change |
| Create/Update service | `POST /services`, `PUT /services/:id` | `ServiceWriteSchema` | perm `catalog.edit`; category must exist | ✅ price only |
| Location price override | `PATCH /locations/:id/catalog/services/:sid` | `ServiceOverridePatchSchema` | `catalog.edit` | ✅ price |
| Employee week hours | `PATCH /employees/:id` (`.hours`) | `EmployeePatchSchema` | `checkEmployeeState` | ⚠️ role only |
| Location hours | `PATCH /locations/:id` (`.hours`) | `LocationPatchSchema` | perm `locations.manage` | ✅ "Working hours changed" |
| Close a day / exception | `POST /locations/:id/exceptions` | `ExceptionWriteSchema` | perm `locations.manage` | ❌ none |
| Create/Update product | `POST /products`, `PUT /products/:id` | `ProductWriteSchema` | — | ✅ price only |
| Stock movement | `POST /stock/movements` | `StockMoveRequestSchema` | `inventory.adjust/transfer` | ledger *is* the audit |
| Reads | `GET /employees`, `/locations/:id/catalog`, `/categories`, `/flightdeck`, `/locations`, `/customers`, `/price` | typed | perm-gated | n/a |
| Supplier product | `POST/PATCH/DELETE /portal/catalog`, `/portal/catalog/bulk` | `PortalProduct*Schema` | perm `po.catalog` | ❌ (supplier side has no audit) |
| Supplier promo | `POST /portal/promotions` | `PortalPromotionCreateSchema` | `po.promotions` | ❌ |

**Gaps found (net-new doors needed if these actions ship):**
- **Supplier profile update does not exist** — `/portal/company` is GET-only; the
  `suppliers` table is never written from the portal. "Update supplier profile"
  would be a *new* door (contract + endpoint + audit), not a reuse.
- **Employee create/update logic is inline in `team.routes.ts`** (no shared
  service). To honour one-door, that logic must be **extracted into a service
  function** both the route and the Assistant call.

---

## PART B — Core architecture

### B.1 The boundary: AI plans, Velnes executes

```
User text ──► /assistant/message (server)
                 │  1. build prompt from the app's Action Registry (tool schemas)
                 │  2. call Claude (planner.provider) → structured plan (tool_use)
                 │  3. server RESOLVES entities (names→IDs) via existing read doors
                 │  4. server VALIDATES args (zod + the door's own validators)
                 │  5. server CHECKS permission (permsFor + can) — fail fast
                 │  6. server builds/updates the ActionDraft + ChangeSet preview
                 └► returns ActionDraft (COLLECTING | READY_FOR_REVIEW) — NO mutation

User clicks [Approve] ──► /assistant/execute (server)
                 │  7. reload draft (RLS-scoped), re-check permission
                 │  8. re-validate + concurrency check (fingerprint, §16)
                 │  9. run the Action(s) execute() inside ONE withTenant/withSupplier trx
                 │ 10. logAudit(source='ai_assistant', reason='approved by …') in the trx
                 └► returns real domain result (COMPLETED | FAILED) — the ONLY mutation path
```

The LLM is called **only** on the server, **only** at step 2, and its output is
**never trusted** — it is untyped input that steps 3–6 re-derive and re-check.
The model cannot emit SQL, cannot pick an unregistered action, and cannot fill an
argument that fails zod. Approval is an explicit UI button hitting a distinct
endpoint — never a chat "yes."

### B.2 The Action Registry (answer 2)

A server-side registry, one entry per capability, **registered per app surface**
(workspace vs supplier — never mixed, §20). Conceptual shape:

```ts
interface ActionDef<Args> {
  id: string;                 // 'create_employee'
  app: 'workspace' | 'supplier';
  kind: 'read' | 'write';
  title: string;              // i18n key
  description: string;        // for the planner prompt (short, natural)
  risk: 'low' | 'medium' | 'high';
  permission: PermKey | null; // reused with permsFor + can
  argsSchema: z.ZodType<Args>;// reuse the domain contract where possible
  // turn human references into IDs, using existing read doors + RLS:
  resolvers?: Resolver[];     // roleName→roleId, locationName→locationId, …
  validate?: (trx, ctx, args) => ValidationError[];   // reuse checkEmployeeState etc.
  preview: (trx, ctx, args) => ChangeSet;             // structured before/after
  execute: (trx, ctx, args) => Promise<ExecResult>;   // calls the EXACT existing door fn
  audit: (trx, ctx, result) => void;                  // logAudit, source='ai_assistant'
}
```

Key rule: `execute` **calls the same service function the HTTP route calls**, and
receives the shared `trx` (so multi-action sets are atomic, §17). Where a route's
logic is inline (employees), we extract it into a service function first (§31).
The registry is data-driven, so **new capabilities register without touching the
Assistant** (answer 23/33).

### B.3 ActionDraft & ChangeSet (answer 3) — the source of truth

The **transcript is context, not truth.** The pending mutation lives in a
structured draft:

```ts
type DraftStatus =
  | 'COLLECTING' | 'READY_FOR_REVIEW' | 'AWAITING_APPROVAL'
  | 'EXECUTING'  | 'COMPLETED' | 'FAILED' | 'CANCELLED';

interface ActionDraft {
  id: string;               // server-issued; execute() addresses this
  app: 'workspace' | 'supplier';
  actionId: string;
  intent: string;           // the model's paraphrase, for the user to confirm
  status: DraftStatus;
  args: Record<string, unknown>;   // collected + resolved to IDs
  missing: string[];               // fields still required
  errors: { field: string; code: string; message: string }[];
  preview: ChangeSet | null;
  baseline: EntityFingerprint[];   // §16 concurrency
}

interface ChangeSet { ops: ChangeOp[] }              // 1..n, atomic on execute
interface ChangeOp {
  kind: 'create' | 'update' | 'delete';
  entity: { type: string; id?: string; label: string };
  before?: Record<string, unknown>;  // for update/delete
  after?: Record<string, unknown>;   // for create/update
  impact?: string;                    // e.g. "no longer bookable at Gevgelija"
}
```

**Storage (answer 23):** a lightweight, **tenant-scoped, short-TTL server table**
`assistant_drafts` (jsonb, RLS on `tenant_id`/`supplier_id`). Rationale: the draft
holds resolved IDs and the exact planned mutation — the execute step must trust it,
so it must not be client-tamperable. The client holds only a draft `id` + the
rendered preview. Transcript is kept in a short rolling window client-side for the
model's context; **full transcripts are not persisted** (PII).

### B.4 The LLM boundary / provider abstraction (answers 21, 22)

A thin `planner.provider.ts` copying `extract.provider` exactly:

```ts
async function claudePlan(input: PlanInput): Promise<Plan | null> {
  if (!env.anthropicApiKey) return null;   // honest fallback
  // fetch api.anthropic.com/v1/messages, tools = registry tool schemas + ask_user,
  // tool_choice: 'auto' (model may ask OR propose), AbortController timeout,
  // zod safeParse the tool_use.input, else null.
}
```

- **Provider-agnostic:** the interface is `plan(input) → Plan | null`; today Claude
  via raw `fetch` (no SDK lock-in). Swapping model/provider = one adapter. Env:
  `ASSISTANT_PROVIDER`, `ASSISTANT_MODEL`, reusing `ANTHROPIC_API_KEY`.
- **.NET/MSSQL portability (answer 21):** the Registry, ActionDraft, ChangeSet,
  audit shape and the two wire contracts (`assistant.ts`) are **stack-neutral**.
  Port = C# action classes calling .NET domain services; RLS → MSSQL row-level
  security or app-level tenant filters; the LLM boundary stays plain HTTP. Only
  the `fetch`/Kysely plumbing is Node-specific; the *concepts and wire format* are
  the contract both stacks honour.

---

## PART C — Answers to the 33 questions

Grouped; the numbers map to your list.

**(1) Reusable doors** — see Part A table. Employees, services/prices, working
hours, exceptions, products, stock, and all reads are reusable as-is. Supplier
product/promo/bulk reusable; supplier-profile update and shared employee-service
extraction are the only prerequisites.

**(2) Action Registry** — B.2. Data-driven, per-app, each entry wires
permission + argsSchema + resolvers + validate + preview + execute + audit.

**(3) ActionDraft / ChangeSet** — B.3. Structured, server-stored, TTL'd; transcript
is not the truth.

**(4) Intent → action mapping** — the planner is given the app's action list as
Claude *tools* (id + description + arg schema). `tool_choice:'auto'` lets the model
either call `ask_user` (clarify) or call one action tool with extracted args. A
**confidence gate**: low confidence or multiple plausible actions → clarify before
collecting (answer 26).

**(5) Required/missing fields** — derived from the Action's `argsSchema` (the same
zod contract the door validates). `missing = requiredKeys(argsSchema) − keys(args)`.
No hand-maintained field lists.

**(6) Slot-filling** — each turn: model extracts whatever it can from the user's
text into `args`; server resolves + validates; `missing`/`errors` drive the next
question. The model may ask several related fields at once (better UX) or one at a
time. It **never asks for what `args` already has** (answer 6). The draft — not the
chat — decides what is still needed.

**(7) Validating AI arguments** — three layers, all server-side: (a) zod
`argsSchema`; (b) the door's own validator (`checkEmployeeState`, category-exists,
etc.) run *before* execute; (c) the real door on execute is the final arbiter
(answer 20 on failure). The model's output is untrusted input.

**(8) Entity resolution** — resolvers run *server-side* against existing read doors
under RLS: role name → `roles` row, location name → `locations` row, service name →
`services` row. IDs come from the DB, never from the model. This also scopes to the
tenant automatically.

**(9) Ambiguity** — if a resolver returns 0 matches → "I couldn't find that role;
existing roles are …". If ≥2 matches → present the options and ask which. The
Assistant **never guesses** when a wrong guess could produce a wrong mutation.

**(10) Permissions** — reuse `permsFor(trx, claims)` + `can(perms, key)` +
`scopeOf`. Checked **early** (fail before collecting sensitive fields) and **again
at execute**. Scope constrains resolution (a location-scoped user only resolves
their locations). The Assistant can never exceed the user's UI reach.

**(11) Tenant boundaries** — the Assistant runs under the caller's token +
`withTenant`/`withSupplier` RLS. All reads/resolutions/executions are RLS-scoped.
The model is handed **no cross-tenant data**; the server enforces, never the LLM.

**(12) Which actions need approval** — every `kind:'write'` action requires the
ChangeSet preview + explicit `[Approve]`. `kind:'read'` returns answers directly
(still permission-checked + RLS-scoped), no approval.

**(13) Prohibited from AI execution in V1** — legal-entity changes, payment
settings/accounts, roles/permissions edits, creating/deleting an owner, deleting
or deactivating records, and anything affecting financial routing. Legal/payments
are *already* not tenant-writable (HQ-managed, read-only). For these the Assistant
**explains and navigates** to the correct screen rather than executing.

**(14) Risk levels** — `low` (create catalog item, edit description) executes with
approval; `medium` (price change, schedule change, offer) executes with approval;
`high` (delete/deactivate, payments, legal, roles, owner) is **navigate-only or
forbidden in V1**. Risk is a field on each Action and gates the execute policy.

**(15) Preview/diff** — a reusable `<ChangePreview>` renders `ChangeSet.ops`
(create/update/delete with before→after and impact). It is generated from
**structured ops the server built**, never from free-form model text.

**(16) Stale-data (net-new)** — because there is no versioning, each Action that
updates captures an `EntityFingerprint` (the specific before-values it touches, or
their hash) when the preview is built. At execute, the server re-reads and compares;
on mismatch → `STALE` conflict, show old vs current vs proposed, require renewed
approval. Action-level and pragmatic; a platform-wide version-column layer is a
possible later upgrade (a real decision, §Decisions).

**(17) Multi-action transactions** — the atomic primitive exists: one
`withTenant` trx doing many writes. `/assistant/execute` runs all `ChangeSet.ops`
against **one shared trx**, calling each Action's `execute(trx,…)`; any failure
rolls back the whole set (all-or-nothing), with per-op `logAudit` in the same trx.
V1 recommendation: ship single-action + the simple same-domain set (e.g. "close Mon
and Tue"); defer cross-domain sets while keeping the model that supports them.

**(18) Audit** — reuse `logAudit` with `source='ai_assistant'`,
`reason='approved by <user> at <ts> via Assistant'`, `actorEmployeeId` = the
approver. **The user who approved is the accountable actor, not the AI.** Because
some doors don't audit today (scheduling, product create, stock), the Assistant's
execute layer writes its own audit row for every AI mutation, filling the gap.
`before/after` are formatted from the ChangeSet (free-text today; a structured jsonb
audit path is an optional later addition).

**(19) Page/entity context** — the client passes a **structured** `context`
(`{screen, entityId}`) to `/assistant/message`. The server resolves "this"/"him"
against it **only when unambiguous**, validates the entity belongs to the tenant,
and lets **explicit user intent override** context. Context is IDs, not free text.

**(20) Workspace vs Supplier** — one framework, two registries. The workspace
endpoint (`app.authenticate`) loads only workspace actions; the supplier endpoint
(`app.authenticateSupplier`) loads only supplier actions. Principal + RLS enforce
separation; workspace tools are never exposed in the portal.

**(21) .NET/MSSQL** — B.4. Stack-neutral core; only plumbing re-implements.

**(22) LLM boundary** — B.4. Thin provider interface, raw HTTP, env-selected,
no SDK lock-in.

**(23) Conversation state** — server-stored `ActionDraft` is truth; transcript is a
short client-held window for context; full transcripts not persisted (PII).

**(24) Never sent to the model** — password hashes/credentials, tokens/API keys,
payment/merchant/legal account numbers, bulk customer PII, other tenants' data,
raw sensitive audit values. The model receives: the user's own text, the action
tool schemas, the draft's collected fields, and *enumerated resolution options*
(role/location names). Minimal and scoped.

**(25) Prompt injection** — customer/product/supplier free-text is untrusted. The
defense is structural, not prompt-based: (a) the model's output is **constrained to
registered action tools with typed args** — it cannot invent "delete everything";
(b) any stored text handed to the model is delimited as *data*; (c) the execute
path re-validates and re-checks permissions server-side — the model's proposal is
untrusted; (d) high-risk/destructive actions are excluded from AI execution; (e)
IDs come from server queries, not the model. Worst case, a successful injection can
only surface a registered, permission-checked, preview-and-approval-gated
proposal the user must explicitly approve.

**(26) Model misunderstanding** — low confidence → clarify before acting; a wrong
action mapping is caught by the preview (the user sees exactly what will change and
Cancels/Edits). The server, not the model, decides validity.

**(27) Provider unavailable** — honest degrade (matching the codebase): the panel
shows "Assistant temporarily unavailable" and offers **deterministic quick-action
buttons** that open the normal forms without the LLM. No faked answers; the normal
UI is untouched.

**(28) Deterministic testing** — the planner is a mockable raw `fetch` (like the
`extract.provider` tests). Test the registry, resolvers, validators, permission
checks, ChangeSet builder, concurrency guard, and execute path with a **stubbed
planner returning canned plans** — the whole flow is deterministic without a live
model. Plus permission-matrix tests (an unauthorized user's Assistant request 403s
at the same door).

**(29) Telemetry** — per turn (redacted, no PII): proposed action, confidence,
resolution hits/ambiguities, validation failures, permission denials, approvals vs
cancels, execute success/failure, latency, token usage. KPIs: task-completion rate,
abandonment, error rate, action mix. A small `assistant_events` table.

**(30) V1 capabilities** — see Part E.

**(31) Existing code to modify** — (a) extract inline employee create/update logic
from `team.routes.ts` into a shared service function; (b) capture entity
fingerprints on update actions (concurrency); (c) let the Assistant execute layer
write an audit row for doors that don't audit; (d) add `source`/`reason` on relevant
`logAudit` calls (already supported); (e) if supplier-profile update is in scope,
build that missing door. No changes to permission, RLS or existing door behavior.

**(32) Genuinely new components** — `contracts/src/assistant.ts` (wire schemas);
`modules/assistant/{registry,planner.provider,draft.service,assistant.routes}.ts`
(one route registration per app surface); the per-domain Action definitions;
`packages/ui` `<AssistantButton>`, `<AssistantPanel>`, `<ChangePreview>`;
`assistant_drafts` (+ optional `assistant_events`) tables; `assistant.*` i18n keys.

**(33) Out of scope for V1** — cross-domain multi-action sets, high-risk/destructive
execution (navigate-only), streaming, apps beyond workspace+supplier, complex
workflows ("open a new location", "win back customers"), voice, proactive
suggestions. The architecture *allows* all of these; V1 simply doesn't ship them.

---

## PART D — Example conversations

**1. Successful create**
> **User:** Add John Smith as a hairdresser at Gevgelija, email john@x.mk.
> **Assistant:** Got John Smith, Hairdresser, Gevgelija, john@x.mk. Which services can he do, and what are his hours?
> **User:** Men's and Women's Haircut, Mon–Fri 9–5.
> **Assistant:** *(READY_FOR_REVIEW — preview card)* **Create employee — John Smith** · Role: Hairdresser · Location: Gevgelija · Services: Men's Haircut, Women's Haircut · Hours: Mon–Fri 09:00–17:00 · Permissions: standard Employee role. **[Approve & Create] [Edit] [Cancel]**
> **User:** *(Approve)* → executes `POST /employees` door → **"Created John Smith. An invite will email once the mail service is live."**

**2. Successful update**
> **User:** Increase the Massage price to 1,800.
> **Assistant:** **Update price — Massage** · 1,500 MKD → **1,800 MKD**. **[Approve] [Edit] [Cancel]**
> **User:** *(Approve)* → `PUT /services/:id` → **"Massage is now 1,800 MKD."** (audited: price 1,500 → 1,800, source ai_assistant).

**3. Missing information**
> **User:** Add a new team member.
> **Assistant:** Sure — what's their name and email?
> **User:** Maria Petrova, maria@x.mk.
> **Assistant:** What role should Maria have, and at which location(s)? *(keeps asking only for `missing`)*

**4. Ambiguous entity**
> **User:** Put him at the Downtown location.
> **Assistant:** You have two matching locations — **Downtown Skopje** and **Downtown Bitola**. Which one?

**5. Permission denied**
> **User:** Change our payment settings to route to a new account.
> **Assistant:** You don't have permission to change payment settings, and they're managed by Revelapps HQ rather than here. I can't do that from the Assistant — contact support to update them. *(checked `payments.manage` + HQ-managed read-only; no fields collected)*

**6. Validation failure (post-approval)**
> **User:** *(Approve create John, john@x.mk)*
> **Assistant:** I couldn't create John — **that email already belongs to an existing user**. Want to use a different email? *(door returned EMAIL_TAKEN; draft returns to COLLECTING; no fake success)*

**7. Stale-data conflict**
> **User:** *(Approve: Massage 1,500 → 1,800)*
> **Assistant:** The Massage price changed while we were preparing this — it's now **1,700 MKD** (was 1,500), and you proposed 1,800. Please review. **[Approve 1,800 over 1,700] [Edit] [Cancel]** *(fingerprint mismatch at execute → renewed approval)*

**8. Multi-action request**
> **User:** We're closed next Monday and Tuesday, and move Maria's Wednesday shift to 12:00–20:00.
> **Assistant:** **Proposed changes (all-or-nothing)** — 1) Close Mon 15 Sep 2) Close Tue 16 Sep 3) Maria Petrova Wed: 09:00–17:00 → **12:00–20:00**. **[Approve all] [Edit] [Cancel]** *(one transaction; if any fails, none apply)*

**9. Destructive request refused**
> **User:** Delete all old products.
> **Assistant:** I won't bulk-delete anything automatically. I found **12 products** with no sales in 12 months — I can show them, but deletion isn't something the Assistant performs in this version. **[Show the 12] [Open Catalog to review]** *(navigate-only; no execution)*

**10. Supplier Portal**
> **Supplier user:** Add our new argan oil, 100 ml, 8.50 buy / 14.90 RRP.
> **Assistant:** **Create product — Argan Oil 100 ml** · Buy: 8.50 · RRP: 14.90 · Category: (pick one). Which category and distribution? *(reuses `po.catalog`; only supplier actions available in the portal)*

---

## PART E — Recommended V1 scope

**Salon Workspace (execute + read):**
- `create_employee`, `update_employee` *(needs shared-service extraction)*
- `create_service`, `update_service`, `update_price` (incl. location override)
- `change_working_hours` (employee + location), `create_exception` ("close a day")
- **Read-only questions:** appointments tomorrow, low-stock items, busiest employee
  this week, most-popular services (all from existing read doors + flightdeck).

**Supplier Portal (execute + read):**
- `create_product`, `update_product`, `bulk_price`
- Read/analytics questions (dashboard, orders, low-stock attention list).
- *Exclude* `update_supplier_profile` unless you want us to build that door.

**Explicitly deferred:** high-risk/destructive execution (navigate-only),
cross-domain change sets, complex workflows, streaming, other apps.

**Suggested build order:** (1) contracts + registry + planner boundary + draft
service + one read action end-to-end; (2) `<AssistantButton>/<AssistantPanel>/
<ChangePreview>` in workspace; (3) first write action (`update_price` — simplest,
already audited) with approval + concurrency; (4) employee actions (after the
service extraction); (5) supplier surface. Each is one reviewable slice.

---

## PART F — Decisions (APPROVED 2026-09-14)

1. **Draft storage** — ✅ server-side, tenant/supplier-scoped, short-TTL
   `assistant_drafts` (jsonb, RLS). The client holds only the draft id + rendered
   preview.
2. **Concurrency** — ✅ Action-level *fingerprint* guard for V1. **No platform-wide
   version columns** introduced solely for the Assistant.
3. **V1 action set** — ✅ Part E as written.
4. **High-risk actions** — ✅ **navigate-only, not hidden.** The Assistant
   understands and explains legal-entity / payment / permission-role / owner /
   destructive requests, but **must not execute them** in V1 — it routes the user
   to the correct screen (or support) instead.
5. **Multi-action** — ✅ simple **same-domain** ChangeSets in V1 (e.g. close
   Monday + Tuesday). Cross-domain orchestration stays deferred.
6. **Supplier profile** — ✅ **excluded from V1.** Do not create a new business
   door solely for the Assistant.
7. **Model & entitlement** — ✅ start with **Sonnet**, provider/model configurable
   via the abstraction (§B.4). **Not hard-coded as a paid feature.** Architect an
   **entitlement/usage seam** now (see F.1) so inclusion / limits / plan-gating is
   a later config decision, not a rewrite.
8. **Audit** — ✅ **every AI-assisted mutation produces an audit record**, and
   because the `ChangeSet` is already structured we **preserve structured
   before/after/change metadata for AI actions now** rather than flattening it into
   prose — introduced **compatibly** (see F.2), with no migration of the historical
   free-text `audit_log`.
9. **Spike** — ✅ **build first.** Thin end-to-end spike with one READ
   (`read_service_price`) + one WRITE (`update_price`), **mocked/stubbed planner**,
   proving the whole path: intent → resolution → validation → draft → structured
   preview → explicit approval → concurrency check → canonical door → audit → real
   result. **Do not expand V1 scope while building the spike.**
10. **Deferred list** — ✅ confirmed (Part C-33).

### F.1 Entitlement / usage seam (decision 7)

The Assistant must not assume "always on and free." Introduce a single server-side
gate, `assistantEntitlement(ctx) → { allowed, reason?, limits? }`, consulted at the
top of `/assistant/message` and `/assistant/execute`. V1 returns `allowed:true`
whenever a model key is configured (matching onboarding's honest-fallback), but the
seam lets us later plug in plan-gating, per-tenant limits, or usage quotas **without
touching action code**. Every turn already emits a telemetry event (§29) carrying
token usage, so a quota can be enforced there later.

### F.2 Structured AI-change audit, introduced compatibly (decision 8)

The existing `audit_log` (append-only, free-text `before/after`) is **not migrated**.
For AI-assisted mutations the Assistant writes **both**:
- the normal `logAudit(trx, …, {source:'ai_assistant', reason:'approved by …'})`
  row (human-readable, keeps the one audit stream intact), **and**
- a companion **`assistant_actions`** row (jsonb) preserving the structured
  `ChangeSet` (per-op before/after/impact), the resolved actionId, the approver, the
  draft id, and the concurrency fingerprint — the machine-readable record.

This is additive: nothing in the current audit system changes, and later we can
back-fill a structured column onto `audit_log` if desired. "Who changed Maria's
hours?" is answerable from `audit_log`; "exactly what did the Assistant change, as a
diff?" is answerable from `assistant_actions`.

### F.3 Draft continuation (added requirement)

Closing the Assistant panel must **not** destroy an unfinished draft. While the
draft is within its TTL:
- Reopening the Assistant detects the open draft and offers to resume:
  *"Continue adding John Smith? 4 of 6 required details completed. [Continue]
  [Start over]"* — driven entirely by the structured `ActionDraft`
  (`actionId` + `args`/`missing` counts), **not** by a stored transcript.
- Explicit **Cancel** transitions the draft to `CANCELLED` (abandoned).
- TTL expiry silently drops the draft; the next open starts fresh.
- **No persistent PII transcript:** we store the structured draft (the user's own
  field values, already destined for the mutation) — never the rolling chat log.
  The panel reconstructs a minimal "here's what we have so far" summary from the
  draft's fields, not from saved conversation. At most one *active* draft per user
  per app surface at a time keeps the resume unambiguous.

*Implementation begins with the spike (F.9); V1 scope is not expanded during it.*
