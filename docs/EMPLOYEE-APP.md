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

## Personal sign-in links (2026-09-23)

**How a team member gets into the app at all.** Until now an invited
employee had no password and no door to get one: the invite mail was
prose, nothing accepted it. Now the owner opens Settings › Team ›
**Sign-in link** on any team member: the panel explains how signing in
works (open the link on the phone, choose a password once, then "tap
your name" at the app's address) and mints the link on demand — shown
as a URL to copy and as a QR to scan. `POST /employees/:id/sign-in-link`
(your own id: any role — the account menu's **Employee app** opens the
same panel for a plain Employee; someone else's: `users.manage`) stores
only a sha256 of a 256-bit token in
`employee_sign_in_links`, revokes the member's earlier unused link, and
audits "Sign-in link created"; the same link rides in the invite mail
from `POST /employees` and from registration approval. The employee app
answers `/join/<token>`: `POST /auth/sign-in-link` looks the link up
under the login-mode policy (the same narrow door email login uses),
refuses a used, revoked or unknown link (`INVALID_LINK`) or one past
`SIGN_IN_LINK_DAYS` = 7 (`LINK_EXPIRED`), marks it used, activates the
person, signs them in with the ordinary access + rotating refresh
tokens, and says whether a password is still to be chosen and which
salon they are in. The device is bound to that salon (the roster is
rewritten; a phone that belonged to another salon is told so). The
first time, the join screen asks for a password — `POST /auth/password`
(free the first time, the current one required after that) — so email
login and tap-your-name work from then on. The tenant is always the
link's: nobody chooses a salon, so nobody can land in the wrong one.
`EMPLOYEE_APP_URL` is the base of every link. Pinned by
`modules/auth/sign-in-link.test.ts`.
