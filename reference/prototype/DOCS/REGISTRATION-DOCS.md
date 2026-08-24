# Registration & login — domain docs · 21 aug 2026

**Build:** `30dd50a14fb2843b173722b3e299a2f3` (20,729). Suite:
`test-registration.js`, 37 checks.

## Principle

Two front doors — the AI onboarding (premium) and the classic wizard —
one intake table (`registrations`). **Every salon is verified by
Revelapps HQ before activation. No exceptions.** That is the rule, not
a demo convenience: the status flow is
`pending_review → active | declined`, and only HQ moves it.

## SMTP e-mail verification — reserved, not wired (per Alex)

The mail server is not configured yet and will be taken care of later.
The data is already shaped for it, same reserved-seat discipline as
`providerRef`/`legalDocRef`:
- every registration row carries `emailToken` (minted at submit),
  `emailSentAt: null`, `emailVerifiedAt: null`;
- the confirmation screen and the HQ queue say so honestly
  ("mail service not wired yet" / "Awaiting SMTP" badge);
- when SMTP lands: send on submit, a `#verify/<token>` route stamps
  `emailVerifiedAt`, and the HQ badge flips to Verified. Nothing else
  moves. Production order: e-mail check first, HQ review second — the
  confirmation screen already states this order.

## Routes (shell-less, like book/onboarding)

`#login` and `#registersalon` (`auth-mode` body class hides
sidebar/topbar). **Boot is untouched** — the demo still opens straight
into the app; asserted by test, and the 24 pre-existing suites depend
on it. Entrances: address, **Sign out** in the desktop user menu →
login, "Create your salon" / "Try the AI onboarding" on the login
card, and "Prefer the classic form?" on the AI onboarding's source
screen (the two doors know about each other).

Login is honest prototype auth: any active employee e-mail, password
`demo` (listed on the card); success = that user's session. No real
auth claims.

## The wizard (`state.reg`, `regNew/regSet/regGet/regValid/regSubmit`)

Seven steps: Account → Salon → **Company & legal** (the LegalEntity
intake — legal name, tax id, VAT, currency; this is why registration
sits after multi-merchant) → **Location** (address fields are truth;
the pin refines — honest stub map, click-to-place, coordinates derived
Skopje-ish from pin percentages; the *light path* `regPinLight`
moves the pin and readout without re-render, the color-picker lesson) →
Services (three starter sets, ticks) → Team & hours → Review (per-
section Edit links jump back; submit validates all).

Fields write on `data-regf="path.to.field"` via the change channel
(deep path setter, incl. numeric team indices); no re-render per
keystroke. Per-step refusals carry the reason in plain language;
duplicate e-mail points to sign-in.

## HQ gate

HQ › Customers renders a **New registrations** card above the accounts
when the queue is non-empty: salon, owner, city, legal entity + tax id,
e-mail status badge, **Verify & activate** / **Decline** — both
audit-logged with reviewer + date. Empty queue = no card.

## Prototype boundary (one line, as always)

In production, activation provisions a tenant; here it flips the row's
status and logs — the demo world stays single-tenant. Deviation from
the proposal, honest: the map pin is click-to-place, not drag —
dragging a stub map in jsdom would be fidelity theater; real dragging
comes with real tiles and geocoding.

## Pitfalls

- New click attributes live in the second registry string
  (`data-gohash, data-loginsubmit, data-regstep/back/next/submit,
  data-regcatset, data-regteamadd/del, data-regmap, data-regact/dec`).
- `data-gohash` is the generic "navigate by address" button — reuse it
  instead of inventing new navigation handlers.
- Wizard fields are on the **change** channel (pitfall 3 applies).
- `SCREENS.registersalon.parts` exposes the step in the address;
  `apply` clamps to 1–7.
