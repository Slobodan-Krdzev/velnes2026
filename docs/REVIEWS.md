# Verified reviews

Built 2026-09-30 (Alex). A review hangs on **one completed
appointment**, is written by **the client who booked it**, and an
appointment carries **at most one**. Everything a review says about
where and with whom comes from the appointment, never from the form.
This is the closed loop: book → attend → complete → review → the
salon's and the professional's reputation → better discovery.

## What "completed" means

The platform has no `completed` status and nothing marks completion
(the employee app's "Finish" writes a history line; the till marks
paid). The one definition, already used by history, insights and
"Most chosen", is: `kind = appointment`, `status IN (booked, confirmed)`,
and the end (`date + start_min + duration_min`, in the location's `tz`)
has passed. `isCompleted()` in `services/api/src/modules/reviews` is
that definition in one place; the client appointments door answers
`completed` and `canReview` from it so the app never re-derives it
from a browser clock. No `completed_at` was added: it would stay
empty. There is no review window — any completed visit can be reviewed.

## Data

`db/migrations/20260930100000_reviews.sql`:

- **`reviews`** — `tenant_id`, `location_id`, `appointment_id`
  (**UNIQUE**), `client_user_id`, snapshots `customer_id`, `service_id`,
  `employee_id`, `appointment_date`; four `smallint` stars checked
  1–5 (`service_rating`, `timing_rating`, `cleanliness_rating`,
  `professional_rating`); `body` (trimmed, null when empty, ≤ 800);
  `body_status` `published|hidden` and `rating_status` `valid|void`
  — the words and the numbers are moderated separately, so an unfit
  sentence can go while the verified rating stays. FKs never cascade:
  a professional who leaves or a renamed service changes nothing.
- RLS: the salon **reads** (`tenant_read`, SELECT only — no salon
  principal can write, hide or delete a review, and there is no door
  that tries); the reviewer reads and inserts their own
  (`app.client_id`); the marketplace reads under `app.public`; HQ has
  everything (the only future moderator).
- **`review_reminders`** — `appointment_id` PRIMARY KEY, the one-time
  gate of the 24-hour reminder.
- **`platform_features`** — `('review_reminders', since)`, written by
  the migration: the rollout cutoff, so nothing that ended before the
  feature went live is ever reminded. Not a date in code.
- `hq_read` on `appointments`, for the reminder scan.

## Doors

- `POST /client/me/appointments/:id/review` — body `{service, timing,
  cleanliness, professional, body?}` (`ReviewSubmitSchema`). Re-checks
  ownership (the client's own context), completion (the location's
  clock), and lets the UNIQUE answer duplicates: `404 NOT_FOUND`,
  `409 NOT_COMPLETED`, `409 ALREADY_REVIEWED`. Rings the salon's bell
  (`platform_notices` kind `review`, no score in the text).
- `GET /client/me/appointments` now carries `completed`, `canReview`,
  `review`, and the `serviceId`/`employeeId`/`locationId` ids.
- `GET /public/discovery/salons/:slug` carries `reviews` (avg, count,
  service, timing, cleanliness, distribution) and each team member's
  `rating`; cards (`DiscoverySalonCardSchema`, the service card's
  `salon`) carry `rating: {avg, count} | null`. All null when the salon
  has none or hides them (`marketplace.showReviews`, honoured at last).
- `GET /public/discovery/salons/:slug/reviews?offset&limit` — newest
  first, five a page: stars, the words only when `published`, the
  reviewer as "Ana D.", the visit's month, `verified: true`. Never an
  email, phone, note or id.
- `GET /reviews/summary`, `GET /reviews?locationId&employeeId&stars&offset&limit`
  — the salon's own, gated on the new `reviews.view` permission
  (Customers group; owners have it, the standard employee role does
  not). Read-only.

## The numbers (Option B)

Salon score of one review = mean of service, timing, cleanliness. Salon
rating = mean of those over `valid` reviews; the dimension averages
likewise; the distribution counts each review's rounded salon score.
The **professional's** rating = mean of `professional_rating` over
their reviews — theirs alone, never in the salon's. One decimal for
display, half up (`round1`); counts are integers; no 0.0 anywhere — a
salon with none shows nothing. Aggregates are computed from the
reviews (never stored): one grouped query for every salon per results
request, memoised for 60 s (`ratingsForBusinesses`, reset on submit).
Service-level attribution is unambiguous because a row is one service;
it is recorded (`service_id`) and not yet displayed.

## Multi-service visits

A multi-treatment visit is a chain of sibling rows, one service and at
most one professional each, with no visit id. So: one review per
appointment row, each attributing cleanly. The reminder treats one day
at one salon as one visit: the last leg is reminded, the others are
skipped because their day already was.

## The reminder

`sendDueReviewReminders(now)` runs every five minutes in-process (like
the mail loop): one scan under HQ for completed, unreviewed,
client-owned appointments whose location-zoned end is ≥ 24 h ago and ≥
the feature cutoff, `DISTINCT ON (client, salon, day)`; then, per
appointment, one transaction that inserts the `review_reminders` row
**only if no review exists** (`INSERT … SELECT … WHERE NOT EXISTS … ON
CONFLICT DO NOTHING RETURNING`) and, only when that returned a row,
writes the in-app notification (`client_notifications` kind `review`,
`refType appointment`) and queues the mail (`review_reminder`, in the
client's language, CTA `/account/appointments/:id?review=1`). A
restarted, doubled or overlapping worker sends nothing twice; a review
submitted between the scan and the gate stops it.

## Guests

There is no secure way to connect a guest booking to an account
(`client_user_id` is null and nothing claims it later), so guest
reminders, guest mails and any claim flow are **not built**. A guest
never sees My Velnes, so no CTA misleads them. When a claim mechanism
exists (a verified-email adoption at registration, say), the reminder
scan needs one more branch and nothing else changes.

## Apps

- **Consumer**: past visits show "Write a review" or the stars given;
  the detail opens the form (`?review=1` from a mail or a notification
  opens it directly; opened signed out, the path is remembered and
  followed after sign-in — `rememberReturnTo`, the pending-favourite
  pattern). The salon page has a Reviews card (score, count, parts,
  spread, five newest, "Show more"); result cards, recommendation cards
  and team rows show "★ 4.8 (127)" through one `Stars`/`RatingChip`
  component; the star input is a radio group.
- **Workspace**: `/reviews` is a sidebar destination (permission
  `reviews.view`, icon sparkle, in the navigation search); the page
  shows the score, the parts, per-professional and per-location
  scores, and the filterable list; the team table shows each
  professional's line; the bell's `review` notice opens the review.
  Nothing edits.

## Not in this version

Editing a review (submit once); salon replies; helpful votes;
reporting; photos; translation of review text (stored and shown as
written); rating as a ranking or personalisation signal (`quality` in
the search config stays inert); "Top rated" badges; guest reviews;
HQ moderation UI (the two status fields exist; changing them is a
direct data operation until a screen lands).
