# HANDOVER — Velnes Business prototype · 22 aug 2026 (master)
**Read this first in the next session. The zip this file travels in is
the complete working set.**

## The very first minute of the next session (non-negotiable)

1. Upload the zip, extract to `/home/claude/velnes/`.
2. `md5sum index.html` → must be **`9fdf10b399523e28ceb971fc347aa104`**
   (21,139 lines). Verify everything against `MD5SUMS.txt`.
3. Any mismatch → **stop, do not build, tell Alex.** See the incident
   section below: this environment has now also **rolled back a
   verified delivery after the fact** (22 aug). The hash chain is the
   only trust anchor, and the per-feature intermediate hashes are the
   recovery mechanism — a full rollback was restored byte-exactly by
   replaying the scripted patches against their checkpoints.
4. md5sum + `wc -l` before every patch and after every delivery;
   scripted uniqueness-asserted replacements only; suites run with cwd
   `/home/claude/velnes` (jsdom in `/home/claude/node_modules`;
   `tests/index.html → ../index.html` symlink required; long runs
   detached: `setsid nohup bash -c '…' > log & sleep N`).
5. **Copy to outputs immediately after every green delivery — and
   re-verify outputs at the START of the next working block.**
   Delivery-time verification no longer guarantees persistence.

## Standing rules (unchanged)

No Netlify deploy. Never adopt, reference, or replay anything from the
quarantine folders. Herkomstbesluit + environment investigation remain
open. Proposal → Alex's approval → build, per feature.

## md5 chain — this session (20–22 aug), complete

Start `dbc8c7c15643acd2dede2026589c2d8d` (19,756, the 20-aug delivery).
- Embed install (snippet door, key regenerate, domain allowlist):
  → **`e884b2cc`** (19,870)
- Brand color picker (input-time light path):
  → **`51074cf6`** (19,899)
- **priceFor milestone** (personal+member kinds, tillReprice,
  settle-at-pay, booking through the door, override relabel):
  `aa300aab` → **`6ff79ccd`** (19,982)
- Receipt line fix (service bold / customer undertone, break-word,
  panel metrics): → **`711e8625`** (19,984)
- Flightdeck Premium card → knocker (count+value+one button):
  → **`37dc0901`** (19,984)
- data-gotab via state: → `595da857` (19,988)
- data-gotab via the address system (applyHash — the robust fix):
  → **`f071e71d`** (19,999)
- **Multi-merchant domain** (legalEntities, paymentAccounts, taxRules,
  routeCheckout, checkout spine in finishSale, three surfaces):
  `f424a73c` → `3caffdb1` (20,185)
- Drawer fix (panel-body flex:0 0 auto — the squeeze bug) + merchant
  identity to the top: → **`b8da0887`** (20,190)
- **Supplier Intelligence** (seeded PO history, platformOrders,
  supStats, HQ supplier page, honest Portal dashboard):
  `09de3b62` → `35672472` → `f8a0559b`(+page/portal) →
  `2515424b` (20,433)
- Row simplification (Open only; Review+Suspend to the page):
  → **`11dc36a7`** (20,433)
- **Registration + login** (two shell-less routes, 7-step wizard, HQ
  gate): `fe15b658` → `2c9135a9` → `cca07323` → `8c1362e2` →
  `09997e48` → **`30dd50a1`** (20,729)
  ← this exact sub-chain was replayed after the 22-aug rollback.
- Registration corrections (full-width button, centered links, real
  catalog + search, e-mail invites, split shifts, gallery in wizard +
  Settings): `7ca799c5` → `0758e68c` → `c4291e45` →
  `1d9c58c6` (20,824)
- **Search & recommendation engine** (eight doors, seeded market,
  consent both modes, chain dedup, exposure decay, trend widening, HQ
  Search lab; Alex's four §5 decisions built in):
  `3039e1b7` → **`9fdf10b399523e28ceb971fc347aa104`** (21,139) —
  DELIVERED. Suite test-search 38. screens now 522 (hq/search tab
  registered intentionally). DOCS/SEARCH-ENGINE-DOCS.md is the
  handoff brief for the consumer-frontend sprint.

## Test suites (all green at delivery, 30 files, ~1,960 checks)

New this session: **pricefor 36** · **merchant 51** · **supplierci 43**
· **registration 55** · embed 42. Updated intentionally:
velnespremium **71** (dashboard-knocker redesign + clock pinned in the
offers section), test-pos untouched (0 changes — offers are
test-constructed, pitfall-10 pattern).
Full list: customerci 183 · velnespremium 71 · screens 516 (75
screens, 78 overlays — `wregen` added) · pos 112 · timing 122 ·
offers 46 · flightdeck 28 · editor 53 · headers 27 · rolekits 74 ·
splitshift 74 · exceptions 83 (still flaky batched — rerun solo) ·
hours-toggle 29 · apptedit 29 · calendar 68 · roles 15 · responsive 70
· ranking 36 · ownuse 47 · datepick 42 · empcolor 42 ·
onboarding-look 68 · scrollbar 12 · settings-scroll 43 · embed 42 ·
pricefor 36 · merchant 51 · supplierci 43 · registration 55.
Never use the quarantined `test-premium.js` name.

## ⚠ Incident report addendum — 22 aug (read with INCIDENT-19aug)

Four environment events this session, escalating:
1. `/tmp` and detached processes lost mid-session (20 aug) — known
   family.
2. A tool call lost its working directory *mid-call* (`md5sum: No such
   file`) while the files existed — twice more later; retry in a fresh
   call always succeeded.
3. **The serious one:** after the registration milestone was delivered
   and hash-verified in `/mnt/user-data/outputs`, the environment
   silently **rolled `index.html` back** (both working tree and
   outputs) to the pre-milestone build; the suite + docs files in
   outputs survived. Detected only because Alex tested and the feature
   was gone.
4. Recovery: the scripted patch series was replayed against the
   rolled-back base with **every intermediate hash enforced as a
   checkpoint** — final hash matched the original delivery byte-exactly.
Consequences (now standing rules): keep intermediate hashes per
feature in the addendum (they are the recovery mechanism); verify
outputs at the start of every working block and before telling Alex to
test; treat "it worked when I delivered it" as insufficient.

## Standing pitfalls (new ones first; older list still applies)

1. `.panel-body` children now carry `flex:0 0 auto` — a scrolling
   drawer scrolls, it never squeezes its cards. Don't remove.
2. After `finishSale` the till sits on the rebook screen; suites must
   null `state.sale` before reopening the register (bit two suites).
3. `money()` formats with a non-breaking space — normalize both sides
   when comparing rendered text to `money()` output.
4. Native pickers/dialogs must not be re-rendered mid-interaction: the
   color picker, the map pin, and catalog search all use an
   *input-time light path* (update the target DOM in place; full
   render on commit). Reuse the pattern, don't fight it.
5. `data-gohash` is the generic navigate-by-address button (runs
   through `applyHash` — screen and tab arrive together). Reuse it;
   `data-goparam2` was dead code and is gone.
6. New `data-…` click attributes go into the registries: most new ones
   live in the second big selector string; `data-hqsup` sits in the
   env/hq string next to `data-hqbiz`.
7. Seeded supplier PO refs count *down* from CEN-0040/AER-0030;
   `poSeq` untouched; generator excludes `buy:0` items.
8. Aroma Nordic's incomplete config is load-bearing (tests + demos) —
   don't "fix" the seed.
9. `offerDraftInit` defaults invert the vip window in the evening
   (open item below); the velnespremium suite pins the window.
10. Older list (grep-before-declaring identifiers, delegated-click
    registry, change-channel for data-set/data-pof/data-regf, variants
    carry `label`, scope absence checks to `#view`, register new
    tabs/panels in test-screens, run design-decision suites on shared
    components, two fd-hero cards, saleCustomer via appointment lines,
    memoised memberRecScan, accents verbatim, python-heredoc patches
    with `assert count==1`) — all still true.

## Feature docs in DOCS/

CUSTOMER-INTELLIGENCE · PERSONAL-OFFERS · VELNES-PREMIUM (note: the
flightdeck card is now a knocker — count+value+one button; approve on
the Premium screen) · **MULTI-MERCHANT** · **SUPPLIER-CI** ·
**REGISTRATION** (SMTP reserved seats; HQ verifies every salon — the
rule). PROPOSALS/ holds the four approved proposals of this session
plus the **search-architecture proposal (awaiting Alex's answers to
its §5)**.

## Open items

- **SMTP** (per Alex: later): wires into existing reserved seats —
  registration `emailToken/emailSentAt/emailVerifiedAt`, team invites
  `inviteToken/sentAt`, future notification service events.
- **Payment provider + fiscalization** (per Alex: after legal/provider
  requirements): consume `routeCheckout` groups → fill `providerRef`;
  legal documents → fill `legalDocRef`. Basket-level discount
  apportioning across merchant groups belongs to that milestone.
- Search engine: platform-side pieces (batch availability contract,
  profile privacy rule, event funnel, searchConfig) can start now;
  engine itself lives in the consumer prototype. Awaiting Alex on the
  proposal's §5 questions.
- Evening offer-window default (`offerDraftInit`) — small UX fix.
- Supplier registration — deliberately deferred; HQ manages suppliers.
- Dormant: customer `birthday`; cleanup: dead `customerEditBody`,
  `vipPct/vipFrom/vipUntil` naming on slot offers; HQ deep-link
  addressing pass (hqBiz + hqSup together).

## Zip contents

`index.html` (`1d9c58c6…`) · `DOCS/` (six feature docs) · `HANDOVER/`
(this file + prior addenda + both incident reports) · `PROPOSALS/`
(five) · `tests/` (30 suites + test-search = 31) · `MD5SUMS.txt` (every file).
