# Phase 3 — Scheduling

**One question, one answer.** `scheduleFor(location, date)` says
whether a location is open and between which times: an exception on
that date overlays the weekly pattern (`CLOSED` or `CUSTOM_HOURS`),
never edits it. Periods are always a list — a lunch-break day is not a
special case. Exceptions are one-per-date (overlaps refused, 409);
public holidays come from platform-level per-country calendars (MK
2026/2027 seeded; the country flows from the business — nothing
hardcodes "MK") and *applying* one creates a `PUBLIC_HOLIDAY` CLOSED
exception idempotently, with `open|applied|covered` states in the
listing.

**One gate to the calendar.** `bookingCheck` answers front desk,
widget, till and API alike with the prototype's exact refusal
sentences: closed days and exceptions (with the reason), the day
window, employee not at that location / not bookable / invite not
accepted / day off, fits-in-one-working-period (never across a split
shift, with a distinct "no room for the set-up and clean-up" message),
skills, blacklisted customers, block-vs-block clashes (prep/reset live
inside the block — no extra buffer), foreign holds, and room capacity.
The widget can never be more lenient than the front desk.

**Availability.** `GET /availability` is `availableSlots`: only
`locLive` locations exist; 30-minute grid 08:00–19:00; prep is
clipped at the period start (09:00 works, the room was ready — 08:30
does not); with "no preference" the *offered* duration is the
catalog's and every candidate must fit their own pace-adjusted
duration. Holds block everyone but their own key (600 s TTL via
`POST /holds`).

**Booking.** `POST /appointments` is the prototype's
`confirmReservation`: idempotent (same key → the same appointment,
enforced by a unique index), any-employee resolved at confirm time,
the price asked at the door again (`priceFor` + the modifier delta —
the client's screen decides nothing), the customer matched by
phone/email or created, prep/reset **frozen** on the appointment (a
later catalog change never rewrites it), the promise (`quoted`)
stored for the timing engine, hold consumed, audited. `PATCH` moves
run through the same gate ignoring themselves; cancelling keeps
history but frees the time.

**Timing engine.** Two taps from the employee app — `Treatment
started` / `Treatment finished` on `POST /appointments/:id/events` —
are the only measurements. `effTreatment` resolves what the calendar
uses: variant-approved → service-approved (other variants inherit by
ratio via round5) → pace (median of measured/promised over ≥12
observations, 180-day window, IQR-trimmed, ratios outside 0.4–2.5
discarded as errors) → catalog. Pace never changes the price.
Proposals compare against what applies *now* (approved values keep
learning), skip differences under 5 min or 10 %, and a dismissed one
returns only after the sample grows 25 %. Owner approval
(`POST /timings/:id/approve`, audited with before/after) is the only
writer of working durations — Velnes never changes one on its own.

**Seed.** Demo appointments this week, the et1/et2/et3 timing
showcase (Maria's pace suggestion, Elena's approved 40-minute
massage, Ana's beginner-60-now-49 relearn case), six customers
(Bojan Ilievski blacklisted after 3 no-shows), the MK holiday
calendar.

**Engineering note.** Postgres DATE columns arrive as local-midnight
`Date` objects; formatting them with `toISOString()` shifts a day in
UTC+ zones. All date formatting goes through `localIso()` — the same
trap the prototype documents around `new Date('YYYY-MM-DD')`.
