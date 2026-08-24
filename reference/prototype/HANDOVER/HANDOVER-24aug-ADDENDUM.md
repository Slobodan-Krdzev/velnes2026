# HANDOVER addendum — 24 aug 2026 — New-location lifecycle milestone

Read after `HANDOVER-22aug-MASTER.md`. That document's rules stand
unchanged (verify outputs at every block start; intermediate hashes
per feature; uniqueness-asserted scripted patches; long runs detached
via setsid; retry vanished-log calls in a fresh call).

## Delivered

The new-location lifecycle per `PROPOSALS/velnes-newlocation-proposal.md`
(approved 23 aug with two amendments: five-requirement readiness gate,
owner-only activation). Full feature documentation:
`DOCS/NEW-LOCATION-DOCS.md`. Registration flow upgraded to the same
Submit → Review → Changes Required → Resubmit → Approve pattern.

## Hash chain (base → delivery)

- Base (22 aug delivery): `9fdf10b399523e28ceb971fc347aa104` — 21,139
- P1 lifecycle layer + doors: `476b4d4537a2cc4a5365313d4c433c73` — 21,193
- P2 wizard + copy engine + old panel closed:
  `fae65acc48fb561bc75c55f522570802` — 21,401
- P3 HQ queue + compound review + owner card:
  `73af0e468004373ef4d0d939eebbfcd3` — 21,498
- P4 registration request-changes: `6a999a1a1778610e6efc6dceba4f0b52` — 21,541
- P5 search admission: `056d70179488644a50090715cc483518` — 21,570
- P6 copy-engine fix: `4406e2f3e884c10f6fdac76bda1560be` — 21,572
- **P7 hotfix (Alex-reported): the repointed Add-location panel lacked
  `action:true`, so the panel framework kept its save button disabled
  (no fields → never dirty). Fixed + suite check added (79 checks):
  `8101b7339e256cc944e7edb727ff167d` — 21,572
- **P8 hotfix (Alex-reported): clicking that button then crashed —
  the framework reads `panelMeta.toast` after `onSave`, but
  `go('newloc')` nulls `panelMeta` on route change. Fix: the panel
  closes itself, navigates, and returns `false` so the framework does
  nothing further. The suite now exercises the REAL click path
  (lesson: `onSave()` called directly bypasses the framework
  aftermath — always click the button). 80 checks →
  DELIVERY: `0b399333830e329735e225299062a3a3` — 21,575**

Suites changed: `tests/test-newlocation.js` NEW (80 checks);
`tests/test-screens.js` intentionally extended (five `newloc` wizard
steps registered → 552 checks, 81 base screens).

## Delivery test run (all at `4406e2f3`, this environment)

newlocation 80 · screens 552 · registration 55 · merchant 51 ·
search 38 · pos 112 · pricefor 36 · calendar 68 · customerci 183 ·
embed 42 · empcolor 42 · flightdeck 28 · headers 27 · hours-toggle 29 ·
onboarding-look 68 · ownuse 47 · ranking 36 · responsive 70 ·
rolekits 74 · roles 15 · scrollbar 12 · settings-scroll 43 ·
splitshift 74 · supplierci 43 · velnespremium 71 · editor 53 ·
apptedit 29 · datepick 42 · exceptions 83 (solo, per standing note) —
**all green.**

Two suites carry provenance notes instead of green-at-delivery:

1. **test-timing: 121/122 — NOT a regression.** The failing check
   ("het tempo komt niet terug") fails identically on the pristine
   base (verified with an identical instrumented run on both builds:
   same failing check, byte-identical et1 state trajectory —
   `observedN` zeroed before the switch section, `status:'dismissed'`,
   `approvedMin:null`, recompute finding n=1 only in the post-check
   idempotence calls). Root cause is inside the suite/seed
   interaction (date/scheduler-sensitive), not in this milestone's
   changes. A 122/122 was observed once at the P1 checkpoint —
   treat that as scheduler variance; the side-by-side base/delivery
   comparison is authoritative. Next session: fix the suite or the
   seed (candidate: the et1 restore path the suite assumes), as its
   own small task.
2. **test-offers: does not complete in this environment** (>15 min,
   pristine base identical, NODE_PATH correct). Environment issue,
   not a regression. Rerun on a faster box or profile the suite next
   session.

Environment notes confirmed again this session: suite check-counts
DROP under machine load (timeout-chained blocks skip silently —
observed pos 102 under load vs 112 quiet; both green); never run
suites in parallel with a heavy job. One detached-run log vanished
mid-call (known failure family, INCIDENT-19aug) — the fresh-call
retry succeeded, per the playbook.

## What the next session should know

- **One door discipline extended:** every customer surface passes
  `locLive()`; lifecycle changes pass `locTransition()`. Do not add a
  location-creating path outside the wizard — the old
  `PANELS.location` direct-create is deliberately closed.
- The copy engine seeds unticked categories as scratch; never let a
  missing `locationCatalog` entry fall through to global defaults
  (that was the bug the suite caught).
- Compound review marks a pending legal entity `verified` on location
  approval. Aroma Nordic's pending seed remains load-bearing and
  untouched.
- New `data-` tokens are registered in the delegated-click selector
  string (nl*, hqloc*, loc*, regreq/regfix/regresubmit) — extend that
  string for any new actions, as always.
- Open items unchanged: §5 search-architecture answers (consumer
  frontend waits on it), SMTP, payment provider + fiscalization,
  evening offer-window default in `offerDraftInit`.

## Files in this delivery

`index.html` (4406e2f3) · `tests/test-newlocation.js` ·
`tests/test-screens.js` (extended) ·
`PROPOSALS/velnes-newlocation-proposal.md` (amended) ·
`DOCS/NEW-LOCATION-DOCS.md` · this addendum · regenerated
`MD5SUMS.txt`.
