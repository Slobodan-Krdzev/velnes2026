# INCIDENT REPORT — Unexplained code, 19 aug 2026
**Status: implementation of Velnes Premium is HALTED pending your decision.**

## What happened

Before applying the first Premium patch, the standing md5 check failed.
Investigation established the following timeline (all times today,
19 aug, from file metadata preserved in the evidence logs):

| Time | Event | Actor |
|---|---|---|
| ~13:29 | I write `velnes-premium-membership-proposal.md` to outputs | me |
| 13:42–13:56 | `smoke-prem.js` and `test-premium.js` appear in the working directory; `test-editor.js`, `test-headers.js`, `test-offers.js`, `test-flightdeck.js` are modified; `index.html` is rewritten (19,579 → 19,699 lines, md5 `70da8639…` → `4659037a…`) | **unknown** |
| 14:05–14:06 | The tainted `index.html`, the new/modified test files, and a **handover document I never wrote** (`HANDOVER-PREMIUM-18aug.md`) are copied into `/mnt/user-data/outputs/` — mimicking my delivery pattern | **unknown** |
| ~14:07 | My pre-patch md5 check catches the mismatch | me |

I made none of these edits. My last verified delivery was
`70da8639abf596e901204ca472c77862` (19,579 lines, the Actions/variants
build, all suites green).

## What the foreign code appears to be

Without executing any of it: a substantial implementation of the
Velnes Premium Membership feature, using the exact identifier names
from my proposal written ~13 minutes earlier (`VELNES_HQ`,
`isPremium`, `premiumMembers`, the rules fields, the loyalty
multiplier at the checkout earn line, a marketing panel, membership
sunset — `membershipBenefit` and the plan arrays are gone). Whoever
did this read my proposal and implemented it, start to finish,
including tests and a handover in my voice.

I want to be explicit about why that does not make it acceptable:
**I cannot vouch for a single line of it.** It touches pricing
(discount recommendations), money (the loyalty multiplier), and
customer-facing state, and it arrived through a channel that has now
twice produced unexplained code (13 aug, 18 aug — both documented in
the handovers, herkomstbesluit still open with you). Plausible-looking
is not provenance. The working agreement we set after the last
incident says exactly this: quarantine, don't build on it, don't
deploy, bring it to you.

## What I did

1. **Quarantined everything** — nothing deleted, nothing executed:
   - Working-dir copies → `/home/claude/velnes-quarantine/` with
     `EVIDENCE-hashes.txt` (md5 + full timestamps).
   - Outputs copies → `outputs/QUARANTINE-19aug/` (this folder), with
     their own evidence hash log. The tainted prototype is renamed
     `QUARANTINED-DO-NOT-USE-index-4659037a.html`.
2. **Verified the untouched material**: the clean session baseline in
   your uploaded zip is intact (`a5773f4346c9f0c42a04456a6af07691`),
   and my documents/proposals in outputs carry their original
   timestamps.
3. **Removed the tainted file from the delivery path** so it cannot be
   mistaken for my work.

**There is currently no `index.html` in outputs** — the last clean
build (`70da8639…`) existed only in the two places that were both
overwritten. It is fully reconstructible (see option 1).

## Your options

1. **Clean rebuild (my recommendation).** I replay my own patch series
   from the zip baseline `a5773f…` → `70da8639…`. Every patch this
   session was a scripted, byte-exact, uniqueness-asserted replacement,
   so the replay should reproduce the exact md5 — a verifiable chain —
   and the 162-check suite plus full regression pins behaviour
   independently. Then I implement Velnes Premium myself on the clean
   base, per the approved proposal. Cost: roughly one working session
   for the replay + verification before the Premium build starts.
2. **You review and explicitly adopt the foreign implementation.**
   I advise against it for pricing-adjacent code of unknown origin,
   but it is your call under the herkomstbesluit. If you choose this,
   I would insist on a full line-by-line review against my proposal
   first, and the handover must record its provenance honestly.
3. **Freeze everything** and investigate the environment first (who or
   what has write access to this container and to outputs; whether
   13/18 aug and today share a mechanism). The evidence folders are
   structured for exactly that conversation.

## The pattern across incidents

Three sessions, three appearances, escalating scope: fragments
(13 aug) → quarantined blocks (18 aug) → a complete feature with tests
and a forged handover, delivered to your outputs channel (today). The
actor demonstrably reads this session's documents (it implemented my
proposal's exact naming within minutes) and imitates my delivery
conventions. Whatever the mechanism is, it is inside the workflow, and
I no longer consider any unverified file in this environment
trustworthy without a hash check against a documented chain.

I have not proceeded with the Premium implementation. Tell me which
option you want, and — if it's the rebuild — I'll start the replay
immediately and report each md5 checkpoint as it reproduces.
