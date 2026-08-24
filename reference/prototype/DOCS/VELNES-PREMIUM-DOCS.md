# Velnes Premium — Feature Documentation
**Velnes Business prototype · file version `dbc8c7c15643acd2dede2026589c2d8d` (19,756 lines) · 20 aug 2026**
**Companion to `CUSTOMER-INTELLIGENCE-DOCS.md` and `PERSONAL-OFFERS-DOCS.md` — the matching engine reads the CI doors, the activity log is shared with Personal Offers.**

Working document for maintaining and extending the feature through the
development phase: what was removed and why, every domain shape and
door, the opportunity loop, all DOM hooks, the demo-honesty seams, the
production path, and the recipes for likely changes.

---

## 0. The feature in one paragraph

Velnes Premium is a **platform-owned** membership: one status per
customer, rules set by Revelapps HQ and shown read-only in the salon,
three benefits — first access to member last-minute offers, product
testing invitations, and 1.5× loyalty points. The salon owner is the
**gate, not the author**: Velnes finds the opportunity (a real calendar
gap), matches members transparently, recommends a discount inside the
HQ ceiling, and nothing is ever sent without Approve. The old
salon-owned membership system (plans, included sessions, MRR) is
**hard-sunset** — removed, not dormant.

```
tomorrow's real gaps (offerDraftInit — same source as flightdeck)
        │ memberRecScan()
        ▼
memberRecs[] pending ──► flightdeck rec card + Marketing › Velnes Premium
        │ owner: Approve / Decline (rec_declined)
        ▼
premiumOffers[] staged window          Product testing: testOps[]
  stage 1  best member  · priorityMin    salon configures (product, desc,
  stage 2  member group · escalationMin  photo, spots, optional targeted
  stage 3  public       · publicFallback member) → Velnes matches & invites
  expired                                → accept/decline → filled
        │ every step → activityLog()          │ every step → activityLog()
        ▼                                     ▼
            custActivity[]  (the future measurement reads this)
```

---

## 1. Product rules (enforced structurally)

1. **Rules are Velnes's; operation is the owner's.** `VELNES_HQ` is a
   seeded constant rendered read-only (`data-premrules` has no editable
   controls — tested). The owner's only verbs: Approve, Decline,
   Advance (demo), create/respond product tests.
2. **Nothing sends without Approve.** A pending rec produces zero
   member-visible state; Decline is recorded (`rec_declined`), not
   discarded.
3. **The salon cannot grant or revoke membership.** There is no write
   path to `velnesPremium` anywhere in the UI; the edit drawer section
   and profile tab are read-only by construction.
4. **At-risk is a soft signal, never a requirement.** `MATCH.ATRISK`
   adds +15 with an honest why-line; a member without it scores
   normally on every other term (tested both ways).
5. **The discount ceiling is HQ config.** `recPct = min(35,
   rules.maxDiscountPct)` — retuning is config, never code.
6. **Time is honest.** The prototype has no clock; stage advancement is
   an explicitly labelled **"Advance stage · demo"** button
   (`pmoAdvance`). Production replaces it with a scheduler; the button
   becomes an admin override or is deleted.
7. **The pool is bigger than the salon.** `VELNES_PLATFORM_MEMBERS`
   (members of *other* salons: name + home salon only, no profile, no
   stats) exists so the platform-ownership principle is structural, not
   theoretical. The salon sees them only where the platform lends them
   (product-testing invitations).
8. **One eligibility door.** Every domain asks `isPremium(cid)`; nobody
   stores the answer. `VELNES_HQ.premium.enabled=false` switches the
   whole program off in one place (tested).

## 2. What the sunset removed (do not resurrect casually)

Gone: `membershipPlans`, `memberships`, `planById`, `membershipOf`,
`membershipBenefit`; the till's included-session consumption; the
`membership` option kind in `priceFor` (the engine literally no longer
knows the word — tested); profile tab *Memberships* (key is now
`premium`); Marketing tab *Memberships* (MRR/plans/members) → `premium`
(`mktPremium`); `PANELS.membershipNew`, `MODALS.planEdit`,
`planPanelBody`, `membershipPanelBody`, handlers
`data-planedit/planflag/msnew/mscancel` + registry + panel-name
entries; the `MEMBERSHIP_PLAN` phase audience; VIP-group early access
(`AUDIENCE_V1` is now `['PUBLIC','PREMIUM_MEMBERS','SPECIFIC_CUSTOMERS']`).
**Kept deliberately:** the customer group "VIP" (identity label, not a
benefit) and the internal draft field names `vipPct/vipFrom/vipUntil`
on slot offers (labels changed; renaming the fields was churn without
benefit — note for a future cleanup pass).

## 3. Where everything lives (search anchors)

| Piece | Search for |
|---|---|
| HQ config + audit shape | `const VELNES_HQ={premium:` |
| Eligibility door | `function isPremium(cid)` |
| Member list / seeds | `function premiumMembers()` / `set('c4',{status:'active'` |
| Platform pool | `const VELNES_PLATFORM_MEMBERS=[` |
| Loyalty ×1.5 seam | `const mult=isPremium(cust.id)` (inside `finishSale`) |
| Match weights | `const MATCH={SVC:30` |
| Scoring | `function memberScore(cid,slot)` |
| Recommendation scan | `function memberRecScan()` |
| Approve / Decline | `function recApprove(` / `function recDecline(` |
| Staged offers + labels | `const premiumOffers=[]` / `function pmoStageLabel(` |
| Demo clock | `function pmoAdvance(` |
| Product testing | `function tpCreate(` / `function tpRespond(` |
| Salon panel | `function mktPremium()` |
| Rules card | `data-premrules` |
| Rec rows / preview | `data-recrow` / `data-recpreview` |
| Member offers table | `data-pmorow` / `data-pmoadv` |
| Testing card + form | `data-testops` / `data-tpfile` / `data-tpimgclear` |
| Flightdeck rec card | `data-fdrec` (inside `viewFlightdeck`, before `const heroCard=`) |
| Profile tab body | `premium:(()=>{` (inside `viewProfile` panels) |
| Edit-drawer section | `function custPremiumBody(` |
| Service-editor note | `function svcMembershipBody(` (retired-plans note; `svcPlans` returns `[]`) |
| Offer phase audience | `audience:'PREMIUM_MEMBERS'` (in `saveOffer`) / branch in `phaseAllows` |
| Handlers | `if(d.recapp)` … `if(d.tpdecl)` / file: `const tpf=e.target.closest` |
| State fields | `tpName:'', tpSid:'', tpQty:1, tpDesc:''` |
| Tests | `test-velnespremium.js` (67 checks) |

## 4. Domain shapes

### 4.1 `VELNES_HQ.premium` — production: HQ config service
`{enabled, loyaltyMult:1.5, rules:{version, acceptedAt, maxDiscountPct:50,
minLeadMin:120, priorityMin:60, escalationMin:30, publicFallback:true,
eligibleServices:'all', eligibleLocations:'all'}, audit:[{at,by,field,from,to}]}`
Rules are **versioned**; `acceptedAt` models owner acceptance at
registration; the audit array is the Superadmin trail's shape.

### 4.2 Member status — production: platform subscription service
`customer.velnesPremium = {status:'active'|'expired'|'cancelled', since,
renews}` — **seed data only**; `isPremium()` is the sole reader. Seeds:
c4 active (−260d, renews +20), c1 active (−120, +8), c6 expired (−400,
−35) — the expired card renders honestly on the profile tab.

### 4.3 `memberRecs[]` (seq `recSeq2` — `recSeq` was taken)
`{id, locationId, date, start, end, sid, empId, normalPrice, recPct,
recPrice, candidates:[{cid,name,score,why[]}] (ranked), status:
'pending'|'approved'|'declined', offerId, createdAt}`
One rec, deterministic: first gap of tomorrow via
`offerDraftInit(loc, TODAY+1).caps[0]` — **the same capacity source as
the flightdeck and the offer drawer**, so there is never a second
truth about what is empty. Scan is idempotent (`if(memberRecs.length)return`).

### 4.4 `premiumOffers[]` (seq `pmoSeq`)
`{id, recId, slot fields, normalPrice, pct, price, candidates, stage:1|2|3,
status:'live'|'expired', createdAt}` — the staged window. Stage
semantics live in `pmoStageLabel` (reads HQ rules for the minute
values). **V1 does not enforce the member price at booking/till** —
that joins the standing `priceFor()` milestone (the row carries
everything needed). Distinct from `personalOffers[]` (owner-initiated,
service-level, own doc).

### 4.5 `testOps[]` (seq `tpSeq`)
`{id, product, sid|null, qty, left, desc, img (data-URL), status:
'open'|'filled', invited:[{cid, name, home?, score|null, picked?,
status:'invited'|'accepted'|'declined'|'expired'}], createdAt}`
Basic level by scope decision: opportunity → matching → invitation →
respond. A **picked** member (own premium customer or platform member)
is guaranteed slot 0; affinity matching fills to `max(qty×2, 2)`; the
last accept sets `filled` and expires open invites.

### 4.6 Events (via the shared `activityLog` — sole writer)
V1 writers: `member_offer_sent`, `member_offer_escalated`,
`public_fallback`, `member_offer_expired`, `rec_declined`,
`test_invited`, `test_accepted`, `test_declined`.
Reserved (schema-ready, future writers): `member_offer_accepted`,
`offer_booked`, `test_completed`, notification-delivery events.
Every row carries actor/sid/product/amount — §31 of the brief ("does
this member respond to offers?") becomes a pure read once booking
events flow.

## 5. The matching engine — `memberScore(cid, slot)`

Transparent weighted sum; **all weights in `MATCH`** (TIMING/CI
discipline — retune there only):

| Term | Weight | Fires when | why-line |
|---|---|---|---|
| SVC | +30 | booked slot's service ≥ `SVC_MIN` (3) times | "booked X n×" |
| EMP | +15 | slot's employee is their ≥60% employee | "% of visits with …" |
| WD | +10 | slot's weekday = proven preferred weekday | shared CI helper |
| BAND | +10 | slot hour inside proven 3-h band | shared CI helper |
| ATRISK | +15 | `custRetention(cid)==='at_risk'` | "at-risk — a nudge may bring them back" — **soft signal by decree** |
| RELIABLE | +10 | ≥5 visits, zero no-shows | |
| FATIGUE | −12 | any offer/member event in last 14 days (`FATIGUE_DAYS`) in their activity | "already received n offers recently" |

Returns `{score, why[]}`; the why renders as a `<details>` on the rec
card and is what makes the recommendation auditable to the owner
(brief §10). The thresholds it leans on are the CI constants — matching
and trends can never disagree.

## 6. UI surfaces

- **Flightdeck**: when a pending rec exists, a `data-fdrec` hero
  renders **above** the capacity hero (both are `.fd-hero`; the
  capacity card keeps its own tests via `:not([data-fdrec])`).
  Approve/Decline work from here; "Open Velnes Premium" jumps to the
  panel. "Send member offer" replaced "Send VIP offer"; manual slot
  offers' phase 1 is now audience `PREMIUM_MEMBERS` with a read-only
  audience field in the drawer.
- **Marketing › Velnes Premium** (`mktPremium`, tab key `premium`):
  stats · read-only rules card · recommendation cards (why-details,
  member preview — the minimal customer-side view per decision F,
  Approve/Decline) · member-offers table (stage badge + label +
  "Advance stage · demo") · product testing (labelled `field()` grid
  form: Product*, Best fits, Spots, Invite a specific member
  (optgroups: own premium first, then platform members), Description
  textarea, **Product photo as file attachment** — FileReader →
  data-URL, preview + Replace + Remove, form resets after create) ·
  recent outcomes feed.
- **Profile**: `premium` tab (status card; expired members see their
  expired card, never-members the honest empty state), "Velnes
  Premium" accent badge on the identity card.
- **Edit drawer**: Group section retitled around the split ("Group is
  what someone is to you; Velnes Premium is what they subscribed to on
  the platform"), read-only `custPremiumBody`.
- **Service editor**: retired-plans note (`svcPlans()` returns `[]`,
  pill reads "Not in a plan").

## 7. State, handlers, DOM hooks

State: `tpName, tpSid, tpQty, tpDesc, tpImg (data-URL), tpImgName,
tpMember` — all via `data-set` (the generic change-listener), reset by
`tpCreate` on success.

| Attribute | Does |
|---|---|
| `data-recapp` / `data-recdec` | approve / decline a rec (also on the flightdeck card) |
| `data-pmoadv` | advance the staged window (demo clock) |
| `data-tpnew` | create test from state fields |
| `data-tpfile` | file input (change listener branch, FileReader → `tpImg`) |
| `data-tpimgclear` | remove attached photo |
| `data-tpacc="{tid}\|{cid}"` / `data-tpdecl` | member responds (demo) |
| `data-fdrec`, `data-premrules`, `data-recrow`, `data-recpreview`, `data-pmorow`, `data-testops`, `data-tprow`, `data-tpdesc` | markers for tests/styling |

All click attributes are in the delegated-click registry (standing
rule: forget it and clicks silently do nothing). The file input is
handled in the **change** listener, before the `data-pof` branch.

**Permissions**: acting (approve/decline/advance/create-test) =
existing `marketing.personal_offers`, double-gated (buttons hide +
doors `denied()`). Viewing rides the marketing screen's gate
(`customers.view_business`) — front desk sees nothing of the panel.

## 8. Production path (.NET / MSSQL / platform)

1. **Eligibility service**: `GET /platform/members/{customerId}` →
   `{active, since, renews}`; cached, invalidated on subscription
   events. `isPremium` becomes that call; the seed IIFE is deleted.
2. **Rules**: `PremiumRules(version, effectiveFrom, json)` +
   `OwnerRulesAcceptance(ownerId, version, acceptedAt)`; the panel
   renders the active version. HQ writes → audit rows (shape already
   in `VELNES_HQ.premium.audit`).
3. **Recommendation job**: server-side scan over open capacity
   (min-lead honored via `rules.minLeadMin` — the prototype's
   day-ahead scan trivially satisfies it; production checks it per
   slot), writes `MemberRecommendations`; Approve →
   `MemberOffers(stage, stageDeadline)` + **scheduler** advances stages
   (`pmoAdvance` retires to admin override). Booking race: atomic
   claim on the appointment row (`UPDATE … WHERE status='open'` /
   rowversion); first booking wins, open invitations flip in the same
   transaction, `member_offer_accepted` + `offer_booked` events.
4. **Price enforcement**: joins the standing `priceFor()` milestone —
   `priceFor(..., custId)` honors a live `MemberOffer` stage the
   customer is inside (stage 1: only the best member; stage 2: member
   group; stage 3: everyone). The audience resolution is exactly
   `phaseAllows` + the candidate list.
5. **Loyalty**: award = `round(total × rate × (isPremium ? HQ.loyaltyMult : 1))`
   at transaction time; finalized transactions never recalculated;
   cancellation reverses the stored amount.
6. **Product testing**: `TestOpportunities` + `TestInvitations`;
   member responses come from the customer app (the demo buttons
   retire); **photo upload endpoint** replaces the data-URL (the
   FileReader seam is one function body; the honest comment marks it).
7. **Notifications**: a delivery service subscribes to
   `member_offer_sent` / `test_invited` (same event-hook pattern as
   Personal Offers), builds standardized copy, i18n by the member's
   app language, writes the reserved delivery events. CI and this
   feature change by zero lines.
8. **Platform member directory**: the targeted-invite dropdown's
   second optgroup becomes a search against Velnes's member directory,
   governed by discoverability/consent rules — the own-first/platform-
   second boundary in the UI already assumes it.

## 9. Test coverage — `test-velnespremium.js` (67)

Sunset assertions (identifiers gone, priceFor clean) · eligibility door
+ HQ kill-switch · ×1.5 with named ledger line vs ×1 clean · profile
tab incl. expired card · read-only rules card (no editable controls) ·
rec determinism, ceiling, ranking, preview, why · soft at-risk both
ways · Approve → staged window → public fallback → closed, with events
and the demo label asserted verbatim · Decline recorded, no offer ·
product testing: labelled fields (anti-placeholder check), file input
`accept="image/*"`, attach/replace/filename, picked-member guarantee,
platform-member home salon + acceptance, matching fill, fill/expire,
form reset · flightdeck card + approve-from-home + VIP-language absence
· permission hide + door refusal · offer phases `PREMIUM_MEMBERS|PUBLIC`
+ `phaseAllows` in/out.

Suites updated for intentional changes (see `HANDOVER-VP-20aug.md`):
offers 46, screens 516, flightdeck 28, editor 53, headers 27,
rolekits 74.

## 10. Recipes for likely development steps

- **Retune matching** → `MATCH` only; update the score assertions.
- **New opportunity type** (e.g. birthday benefit — the dormant
  `birthday` field is the first ingredient): new scan producing recs
  with an `intent` field + a `MATCH` term if scoring differs; the
  Approve/Decline/stage machinery is reusable as-is.
- **More than one rec at a time** → make `memberRecScan` push per gap
  and de-dupe by slot; the panel and flightdeck already render lists.
- **Change stage windows / ceiling / fallback** → HQ rules values;
  `pmoStageLabel` and the scan read them live.
- **Automatic redemption** → §8.4; then delete the manual demo path.
- **Real photo upload** → replace the FileReader branch body with the
  upload call; `testOps[].img` becomes a URL; nothing else changes.
- **Member-offer notification copy** → build in the delivery service
  from the offer row; never add copy-editing UI to the salon (rule 1).
- **Re-enabling anything membership-plan-like** → don't. If salons
  ever need sellable packages again, that is a *new* feature
  (packages/prepaid bundles), not a resurrection of the sunset code —
  the pricing engine's membership branch was removed on purpose.

## 11. Pitfalls specific to this feature

1. **`recSeq` and `poSeq` are taken** (ranking, purchase orders) —
   this feature uses `recSeq2`, `pmoSeq`, `tpSeq`. Grep before
   declaring top-level identifiers; jsdom fails the whole page on a
   duplicate `let`.
2. **Two `.fd-hero` cards can coexist** — probe the capacity hero
   with `:not([data-fdrec])`.
3. **`memberRecScan` is memoised** on `memberRecs.length` — tests that
   need a fresh pending rec must push one explicitly (see the suite's
   recY pattern) rather than expecting a rescan.
4. **The file input lives in the change listener**, before `data-pof`;
   FileReader's onload calls `render()` asynchronously — UI tests
   should set `state.tpImg` directly instead of simulating file events.
5. **`saleCustomer` resolves via appointment lines** — till tests must
   put a real appointment id in the basket.
6. **`svcMembershipBody`/`svcPlans` kept their names** (section
   registry stability) but are premium-honest stubs — don't "fix" them
   back.
7. **Platform members have no local anything** — guard any new code
   path that assumes an invited cid exists in `customers[]`
   (`tpRespond` already doesn't).
8. Expired is **derived** for personal offers but **stored** for
   member offers (the demo clock writes it) — production unifies on
   scheduler-written status; don't copy one pattern onto the other
   blindly.

## 12. Working discipline (unchanged)

md5sum + `wc -l` before every patch and after every delivery; scripted
uniqueness-asserted replacements; suites run with cwd
`/home/claude/velnes`; `test-velnespremium.js` + affected suites +
full regression before handover. Current chain and the honest process
notes (latent rolekits failures, the shared-component lesson):
`HANDOVER-VP-20aug.md`. The quarantine folders remain untouched and
the herkomstbesluit remains open — never build from, or deliver,
anything that fails the hash chain.
