# Phase 6 — Employee App (PWA)

The prototype's phone app (`viewMobile`), full-viewport on a real
device (the desktop `.phone` frame is a demo artifact; the inner
anatomy — mo-head/mo-body/mo-tabs — is identical).

- **Sign-in:** real credentials through `@velnes/client` (the
  prototype's tap-your-name list is a demo affordance, not auth).
- **Agenda:** only the signed-in employee's appointments, grouped by
  day. Each card runs the treatment flow — Start treatment → Running
  → Finish treatment. Those two taps are the timing engine's only
  inputs; they post to the appointment-events door and trigger the
  pair's recompute. Check out rings the appointment onto the till.
- **Till:** catalog tiles for the employee's location, basket,
  TOTAL bar → Cash/Card → the one `/sales` door; the invoice number
  comes back in the toast.
- **Ranking:** the rank-row board from paid invoices — the owner
  sees the same board.
- **PWA:** installable (manifest + Velnes mark), autoUpdate service
  worker, NetworkFirst caching for agenda/location reads so a dead
  spot still shows the last known day; writes stay online-only and
  carry idempotency keys.

## Tap-your-name sign-in and the ranking board (2026-09-05)

**Sign-in now follows the prototype's `moLogin`.** The first person on a
device signs in with email + password (as before); that binds the
device to the salon and caches its staff roster locally
(`velnes.emp.roster`). From then on the app opens straight to "tap your
name": the roster of active staff (avatar, name, role), and tapping one
asks only for that person's password. That password step authenticates
by employee id — `POST /auth/login-id` (`loginById`), the same argon2
verification and constant-time burn as email sign-in, resolving the
tenant from the id. Two escapes: "not you" returns to the name list,
"not this salon" clears the binding back to email sign-in. The binding
survives sign-out, so a shared salon phone opens to the roster every
shift. (Chosen over a salon-code entry: no code to hand out, and the
roster comes from the authenticated `/employees` read during the prior
session — nothing new is exposed.)

**The ranking board honours the owner's standards.** Settings › Ranking
(built earlier, the prototype's `setRanking`) lets the owner tick the
criteria that count. The employee board — and the identical owner view —
now reads `GET /ranking`, which scores each person for the current week
(Monday reset) from those criteria: turnover, appointments, upsell count,
upsell turnover and upsell % all come from real invoices, lines and
appointments; **reviews are honestly `notMeasured`** until a reviews
surface exists. The board is sorted by that score, so a therapist with
higher raw turnover but no upsells can sit below one the owner's criteria
reward — the standard, not the till total, decides the order. The
weighting is equal-weight over the computable criteria today; the same
swappable seam as the flightdeck lets a model weigh them later without
the board or the app changing (the prototype's "an AI model weighs the
criteria you tick"). The mobile header wears the person's role, and the
till (catalog tiles → basket with ± → TOTAL → Take payment) and agenda
cards match the prototype on a phone viewport.
