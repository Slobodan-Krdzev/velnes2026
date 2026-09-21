# Data Model & API Integration

The backend is a **separate system with its own data shapes**. Do not let those shapes
leak into components. The prototype's state objects below are the **UI view models** —
the exact fields the screens consume. Build one thin **adapter layer** that maps API
DTOs → these view models (and UI intents → API calls), so backend changes never touch
components:

```
src/lib/api/client.ts      // fetch wrapper, auth header, VITE_API_BASE_URL
src/lib/api/mappers/*.ts   // DTO -> view model per entity (the ONLY place shapes meet)
src/features/*/queries.ts  // TanStack Query hooks returning view models
```

Rule of thumb: if a component imports anything from `mappers/`, the layering is wrong.

## View models (as consumed by the UI)

Labels marked `*Lbl` are **display strings** in the prototype. Prefer sending raw values
(ISO dates, minor-unit amounts, minutes) from the API and formatting in the adapter.

### CustomerProfile
| Field | Example | Notes |
|---|---|---|
| first, last | Ana, Petrova | |
| email, emailVerified | ana.petrova@gmail.com, true | Email is the sign-in identity — **not editable** in-app |
| phones[] | `{id, cc:'+389', num:'70 445 128', verified, primary}` | Multiple; primary not removable; add/change requires SMS code |
| dob | `14 Mar 1992` | UI uses a calendar picker |
| lang | English \| Македонски \| Shqip | App-wide language (i18n later) |
| avatar | data-URL or '' | Production: uploaded image URL |
| initials | AP | Derivable |

### Appointment
| Field | Example |
|---|---|
| id, ref | a1, VL-29483 |
| service, durationLbl | Haircut, 45 min (cart bookings: `Haircut + Coloring · 105 min · 1 product`) |
| salonId → Salon | s3 |
| professionalName | Maria Petrova (optional) |
| dateLbl, timeLbl | Fri 18 Sep, 14:30 – 15:15 |
| priceLbl | 1.200 MKD |
| status | CONFIRMED \| COMPLETED \| CANCELLED |
| payment | PAID (+method label) \| PAY AT SALON \| REFUNDED |
| points | 180 (pending for upcoming, earned for completed) |
| reviewId | optional link to Review |

### Salon (registry) & Professional (registry)
`{id, name, area, photo, rating, ratingCount}` · `{id, name, role, salonId}` —
the account UI resolves everything through these; discovery/search has its own
`CATEGORIES` dataset (6 categories, each with a best match + 4 alternatives:
`{name, photo, km, rating, count, availability, reason, price, when, perk?}`).

### Payment
`{ref: PAY-9483, date, seller, item, amountLbl, status: PAID|REFUNDED, methodLbl, appointmentId}`

### PaymentMethod
`{id, brand, last4, exp, isDefault}` — tokenized only; never full PAN/CVV.

### Loyalty
`{balance: 2450, ledger: [{date, title, delta, appointmentId?}], bazaar: [{name, points}]}`
**Earn rule (single source of truth):** 1 point per 10 MKD, ×1.5 while Premium — every
seeded number obeys it. Redemptions are negative ledger entries.

### Offer
`{id, type: 'JUST FOR YOU'|'PREMIUM LAST-MINUTE', service, salonId, restriction, wasLbl,
nowLbl, untilLbl, status: ACTIVE|BOOKED|EXPIRED}`

### Premium
`{status: ACTIVE | CANCELS_AT_PERIOD_END | NONE, since, renews}` — benefits list is static
copy; `NONE` renders the Join flow.

### Favourites
`{salonIds[], professionalIds[], services: [{name, salonId}]}`

### Notification
`{id, category, message, whenLbl, read, link: {type: appt|offers|loyalty|general|premium, id?}}`

### ActivityEvent (analytics, not rendered)
`{type, ref, date}` — types used: SALON_VIEWED, OFFER_VIEWED/BOOKED, BOOKING_STARTED/
COMPLETED/CANCELLED, FAVOURITED/UNFAVOURITED, REVIEW_LEFT, PROFILE_UPDATED,
CONTACT_UPDATED/REMOVED, CARD_ADDED, BAZAAR_REDEEMED, PASSWORD_CHANGED, ACCOUNT_CREATED.

## Mutation map (UI intent → state effects → suggested call)

| UI action | Effects the UI expects back | Suggested endpoint |
|---|---|---|
| Book (any path, signed in) | new Appointment (CONFIRMED, ref, pending points) + notification | `POST /bookings` |
| Cancel appointment | status→CANCELLED; if paid: payment REFUNDED + refund Payment row + notification | `POST /appointments/{id}/cancel` |
| Book again / reschedule | prefill booking context (service, professional) | client-side + `POST /bookings` |
| Leave review (completed only) | Review created, linked on appointment | `POST /appointments/{id}/review` |
| Toggle favourite | membership change | `PUT/DELETE /me/favourites/...` |
| Book offer | offer→BOOKED (+instant appointment for last-minute) | `POST /offers/{id}/book` |
| Redeem bazaar item | balance −points, ledger entry, notification | `POST /loyalty/redeem` |
| Read notification / mark all | read flags; badges recompute | `POST /notifications/read` |
| Edit info (+avatar) | profile fields, avatar | `PATCH /me`, `POST /me/avatar` |
| Add/change phone | SMS code step → verified phone entry + notification | `POST /me/phones`, `POST /me/phones/{id}/verify` |
| Change password | validated current/new | `POST /me/password` |
| Card add/default/remove | tokenized method list changes | `POST/PATCH/DELETE /me/payment-methods` |
| Premium join/cancel/resume | status transitions + notification | `POST /me/premium/...` |
| Register | email code verify → account created, welcome notification, empty collections | `POST /auth/register`, `/auth/verify-email` |
| Login | session + full account payload | `POST /auth/login`, `GET /me` |

The endpoint column is **illustrative** — keep your real contract, map it in the adapter.

## Cross-reference invariant (non-negotiable)

One event, many surfaces: a booking must reconcile across Appointment, Payment, Loyalty
ledger, Notification, and (if reviewed) Review — same amounts, ids and refs everywhere.
The seed demonstrates this; the API should return ids that let the adapter preserve it.

## Business rules encoded in the prototype

- Points: `round(amountMKD / 10 × (premium ? 1.5 : 1))`.
- Cancellation policy copy: free up to 2 h before; later may be charged 50%.
- A booking requires ≥1 service; products are optional add-ons on the same booking.
- Email immutable in-app; phones verified via code; primary phone not removable.
- Registration requires email verification (SMTP: development task; SMS likewise).
- Currency: unify on the API side (expected MKD) — the prototype's €/MKD split is a
  known seam, not a spec.
