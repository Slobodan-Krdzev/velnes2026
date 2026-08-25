# Booking page & widget (Phase 7)

The public surface: how a visitor who has never heard of Velnes books
an appointment that lands, priced and refused by the same doors the
till and the calendar use.

## The public surface (`/api/v1/public/*`)

One Fastify plugin scope, no authentication — the **publishable key**
is the only pass. It resolves the widget, and with it the tenant;
everything after that runs inside `withTenant` under RLS like any
other request.

| Endpoint | What it does |
| --- | --- |
| `GET /widget?key=pk_…` | Widget config by publishable key (embed) |
| `GET /booking-page/:slug` | Same payload resolved by the salon's slug (hosted page) |
| `GET /services?key&locationId` | Online-bookable services with variants, modifiers, professionals |
| `GET /availability?key&locationId&serviceId&date[&employeeId][&variantId][&holdKey]` | The real load — cached ~30 s in-process, invalidated per location on booking |
| `POST /holds` | 10-minute hold on a slot (`HOLD_SECONDS = 600`) |
| `POST /book` | Confirm — idempotent by key, priced at the door |

Pre-tenant lookups (`widgets` by key, `businesses` by slug) go through
explicit `app.public = '1'` RLS policies — the same pattern as the
login door, never a SECURITY DEFINER function.

Guard rails, all on the plugin scope:

- **Rate limit** 120/min keyed by publishable key (falls back to IP).
- **CORS per widget**: only `localhost`, `*.velnes.mk`, and the
  widget's registered domains get an `access-control-allow-origin`
  answer. A foreign origin gets 403 and a `DOMAIN_NOT_ALLOWED` row in
  `integration_events`, with a fix hint the owner will see in
  Settings.
- **Honest emptiness in events**: asking availability for a ghost
  service logs `SERVICE_NOT_FOUND` instead of failing silently.
- Only **live** locations and **active, online, staffed** services
  exist to the outside world. A service nobody at the location
  performs is not offered (prototype rule).

Refusals travel as structured codes: `409 { code, params, message }`.
The booking app renders `t('refusal.CODE', params)` in the widget's
language; the English message is only the fallback.

## The booking app (`apps/booking`)

The prototype's `viewBook` flow, markup-exact
(`bookwrap/bookcard/bookhead/bsteps/bookbody/bpick/chips/bdays/bslots/
hold/checkrow/kv/note/rb-check` — all verbatim from
`packages/ui/src/prototype.css`):

1. **Location** — skipped automatically when the widget has one.
2. **Service** — grouped by category, "from" pricing for variants.
3. **Time** — length variants, modifier chips, professional picker
   (`any` or a named employee), 14 open days, 15-minute slots straight
   from `availableSlots`. Required modifier groups gate the Continue
   button ("Choose Oil").
4. **Details** — name/phone/email + cancellation-policy consent. The
   Continue from Time places the hold and starts the countdown; when
   it dies the visitor lands back on Time with "The time was
   released".
5. **Payment** — honest: no provider is wired, so every widget behaves
   as `deposit: 'none'` — "No payment up front. You settle everything
   in the salon." The card fields from the prototype's deposit modes
   arrive with the payment provider decision.
6. **Done** — the door's answer echoed back: reference (last 8 of the
   appointment id), service, time range, location, professional,
   price.

Routes: `/book/:slug` (hosted page) and `/w?pk=…` (embed target). The
widget's `lang` drives i18n for the whole page — all copy exists in
en/mk/sq (`book.*` keys, completeness-tested). The accent color comes
from the widget config as inline styles, exactly as the prototype does
it.

`public/embed.js` is the loader a salon pastes into its own site:

```html
<script src="https://book.velnes.mk/embed.js"
        data-velnes-key="pk_live_…" async></script>
```

It drops an iframe pointing at `/w?pk=…`; a `{velnes:'close'}`
postMessage from the flow collapses it.

## Settings › Online booking (`apps/workspace`)

The prototype's `setBooking()` and `widgetEditor()`, backed by the
widgets module (`/api/v1/widgets`, `/api/v1/integration-events`). Two
permissions split it the way the prototype does: `widget.manage` for
the widget itself (list, create, edit — and the Settings section's
visibility), `integrations.manage` for keys and the event feed.

- **Overview**: the three-ways explainer, the hosted booking link
  (copy/open), the widget rowcards (locations · language · theme ·
  key, live/draft, domain lock state, real booking counts), and the
  Integration health table fed by `integration_events` — every
  `DOMAIN_NOT_ALLOWED` and `SERVICE_NOT_FOUND` with its fix hint.
- **Editor**: name, locations, first step, language (en/mk/sq),
  service categories, cancellation policy, deposit mode; appearance
  (theme, accent presets + free colour, button style, corners) with a
  **live preview** rendered from the location's real catalog and real
  availability — not a picture; allowed-websites editor (the CORS
  allowlist); install card with the real `embed.js` snippet, and
  key regeneration (audited as `Online booking / Regenerate widget
  key` — the old key dies the same second).
- A **draft** widget's key is invisible to the public surface; the
  live toggle is audited both ways.
- Bookings are attributed to their widget (`appointments.widget_id`,
  migration 0012), which feeds the honest stats card: bookings +
  0 ден commission. There is no made-up conversion percentage.

## Deliberate deviations from the prototype

- **No coupon field** on Details yet — the public surface has no
  coupon door; it lands with Personal Offers (Phase 9) so validation
  happens server-side, never as client arithmetic.
- **No waiting list** button — there is no waiting-list table yet; a
  dead button would be dishonest. Backlogged.
- **No "Back to the salon workspace"** on Done — that button only
  made sense inside the single-page prototype demo.
- **Deposit modes `percent`/`full`** render as pay-in-salon until a
  payment provider is decided (reserved fields already exist).

## Tests

- `services/api/src/public/public.test.ts` — key/slug resolution,
  live-locations-only, CORS + `DOMAIN_NOT_ALLOWED` event, services
  shape, `SERVICE_NOT_FOUND` event, hold → book idempotency with
  door-side pricing.
- `apps/booking/src/App.test.tsx` — the full mocked-API journey,
  localized refusal rendering, widget-language switching.
- `services/api/src/modules/widgets/widgets.test.ts` — permission
  gates (owner vs staff), audited create/live/regenerate, draft keys
  invisible publicly, old keys dead after regeneration.
- `apps/workspace/src/pages/settings/BookingSection.test.tsx` — the
  overview cards and health feed, domain/status edits through the
  PATCH door, key regeneration reflected immediately.
- `e2e/booking.spec.ts` — a real visitor journey against the seeded
  stack: slug → services → slot → hold countdown → book → reference.

## Booking API (partner keys)

Deferred honestly: the prototype's "Booking API" card (hashed partner
keys, scopes, webhooks) is a separate feature. The overview explains
the three ways and marks the API as "coming later"; nothing pretends
to issue keys.
