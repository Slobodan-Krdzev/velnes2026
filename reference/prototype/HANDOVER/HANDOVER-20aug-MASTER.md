# HANDOVER — Velnes Business prototype · 20 aug 2026 (master)
**Read this first in the next session. The zip this file travels in is
the complete working set.**

## The very first minute of the next session (non-negotiable)

1. Upload the zip, extract to `/home/claude/velnes/`.
2. `md5sum index.html` → must be **`dbc8c7c15643acd2dede2026589c2d8d`**
   (19,756 lines). Verify the suites against `MD5SUMS.txt`.
3. Any mismatch → **stop, do not build, tell Alex**. This environment
   has produced foreign code three times (13 aug, 18 aug, 19 aug —
   see `HANDOVER/INCIDENT-19aug-provenance.md`); the hash chain is the
   only trust anchor. The herkomstbesluit and the environment
   investigation are still open. Standing rule: **no Netlify deploy**;
   never adopt, reference, or replay anything from the quarantine
   folders (`/home/claude/velnes-quarantine/`,
   `outputs/QUARANTINE-19aug/` in the old session — they stay where
   they are, untouched).
4. md5sum + `wc -l` **before every patch and after every delivery**,
   scripted uniqueness-asserted replacements only, suites run with cwd
   `/home/claude/velnes` (jsdom resolves from `/home/claude/node_modules`;
   long runs detached: `setsid nohup bash -c '…' > log & sleep N`).

## What this build is

Single-file salon-management prototype (`index.html`), everything
in-memory, doors-not-screens architecture (`custStats`, `priceFor`,
`scheduleFor`, `isPremium`, `activityLog` — screens never compute).
Current feature set on top of the 18-aug baseline:

- **Customer Intelligence** — seeded deterministic history, stats/
  trends/suggestions engine, profile analytics + AI panel, list sort,
  paged history. → `DOCS/CUSTOMER-INTELLIGENCE-DOCS.md`
- **Personal Offers** — owner-initiated service-level promise, empty-
  price rule, Actions dropdown, Marketing list, activity log, Activity
  tab, `marketing.personal_offers` permission.
  → `DOCS/PERSONAL-OFFERS-DOCS.md`
- **Customer list** — search bar (name/email/phone, space-insensitive),
  retention tags (Returning / At-risk, evidence-gated via
  `custRetention`) and the two-dimension filter (Group × Status).
- **Velnes Premium** — platform-owned membership replacing the
  hard-sunset salon plans: `VELNES_HQ` read-only rules, `isPremium`
  door, ×1.5 loyalty at the till, transparent matching (`MATCH`,
  at-risk as soft signal), recommendation → Approve/Decline → staged
  member window with the honest "Advance stage · demo" control,
  product testing (description, file-attached photo, targeted-member
  dropdown: own premium customers first, then
  `VELNES_PLATFORM_MEMBERS`), flightdeck rec card, PREMIUM_MEMBERS
  offer audience. → `DOCS/VELNES-PREMIUM-DOCS.md`

## md5 chain (this session, complete)

Restoration replay (byte-exact from the zip baseline after the 19-aug
incident): `a5773f43` (18,773) → `0e99c334` → `03de685e` → `a4556ead`
→ `074f3050` → `c3263ac0` → `eb7c325c` → `a57124cd` → `1e7760c5` →
`a2130d44` → `ba57e887` → `1adc2757` → `25e1c7ba` → **`70da8639`**
(19,579, verified restored build).
Then: search `74bd8143` (19,589) → tags `88d685c0` (19,609) → status
filter `e5a61d2c` (19,613) → Premium P1 `f59b445f` → `5073fc23` →
`b0f54f7f` → P2 `dd51750d` → `931c7d6c` → `921f8281` → `61ba3724`
(19,692) → testing upgrade `09b92338` (19,733) →
**DELIVERED `dbc8c7c15643acd2dede2026589c2d8d` (19,756)**.
Per-patch detail: the three handover addenda in `HANDOVER/`.

## Test suites (all green at delivery, ~1,670 checks)

customerci **183** · velnespremium **67** · screens **516** (75
screens, 77 overlays) · pos 112 · timing 122 · offers 46 · flightdeck
28 · editor 53 · headers 27 · rolekits 74 · splitshift 74 · exceptions
83 · hours-toggle 29 · apptedit 29 · calendar 68 · roles 15 ·
responsive 70 · ranking 36 · ownuse 47 · datepick 42 · empcolor 42 ·
onboarding-look 68 · scrollbar 12 · settings-scroll 43.
`test-exceptions` is flaky when batched — rerun solo before believing
a failure. Never use the quarantined `test-premium.js` name or file.

## Standing pitfalls (the ones that bite; full lists in the docs)

1. Grep before declaring top-level identifiers — `poSeq`, `recSeq`
   taken (this codebase uses `perOfferSeq`, `recSeq2`, `pmoSeq`,
   `tpSeq`); jsdom fails the whole page on a duplicate `let`.
2. New `data-…` click attributes MUST be added to the delegated-click
   registry selector string, or clicks silently do nothing.
3. `data-pof` / `data-set` selects and the test-file input fire on the
   **change** listener; tests dispatch `change`, not `input`.
4. Variants carry `label` not `name`; all variant/price resolution
   through `svcChoice(sv,loc,vid)`.
5. `body.textContent` includes script source — scope absence checks to
   `#view`.
6. Address-bearing tab keys (profile, marketing) are enumerated in
   `test-screens` — register new tabs/panels in the same patch.
7. Shared-component changes (e.g. `filterPop`) trigger the suites that
   encode their *design decisions* (rolekits), not just screen suites
   — run them (learned the hard way this session).
8. The flightdeck can render two `.fd-hero` cards; probe the capacity
   hero with `:not([data-fdrec])`.
9. `saleCustomer` resolves via appointment lines — till tests put a
   real appointment id in the basket.
10. `memberRecScan` is memoised; tests push recs explicitly.
11. Accents in anchors verbatim (Dutch comments); patch scripts are
    python heredocs with `assert count==1` per replacement.

## Open items

- **Next milestone: kassa + widget through `priceFor()`** — personal
  offers (specialPrice) and member-offer stages both plug in there;
  the rows carry everything needed; manual "Mark as redeemed" and
  "Advance stage · demo" then retire to admin overrides.
- Future notification service: subscribes to `offer_created` /
  `member_offer_sent` / `test_invited`; standardized copy from the
  rows; i18n by app-account language; writes the reserved events.
- Dormant: customer `birthday` field (future birthday-benefit intent).
- Cleanup pass candidates: dead `customerEditBody`, internal
  `vipPct/vipFrom/vipUntil` field names on slot offers.
- **Provenance**: herkomstbesluit + environment investigation open;
  quarantine untouched; no deploy.

## Zip contents

`index.html` — the app (`dbc8c7c1…`) · `DOCS/` — three feature docs ·
`HANDOVER/` — CI/PO/VP addenda + incident report + this file ·
`PROPOSALS/` — four approved/superseded proposals · `tests/` — all 24
suites · `MD5SUMS.txt` — hash of every file in the zip.
