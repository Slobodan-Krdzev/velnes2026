# Phase C — persisted favourites

The plan, decided 2026-09-20, before any of it is built. Nothing in this
document is implemented yet.

Today the heart on a salon card is `useState(false)`: it fills in, and
forgets the moment you navigate away. Phase C makes it real customer
data — the client's own, on the client's own account, across every
salon.

---

## 1. What already exists

Reused rather than reinvented, and listed because the shape of Phase C
is mostly determined by things that are already here.

| Thing | Where | What it gives us |
| --- | --- | --- |
| The prototype's design | `reference/client-prototype` | A finished Favourites section: `{id:'favs', t:'Favourites', sub:'Salons, pros & services'}`, third in the account menu, `.acc-card` groups of `.acc-row`s, a heart that removes, an empty state |
| The table pattern | `client_notifications` | `client_user_id` FK `ON DELETE CASCADE`, RLS on `app.client_id`, an HQ policy |
| Cross-tenant label reads | `myAppointments` | Resolving a tenant row's name for a client, through `withTenant` — no new capability needed |
| The ranking seam | `rank.ts`, `search.service.ts` | `favouriteServiceIds` / `favouriteBusinessIds` and a `favourited` weight of 0.90 already exist; `viewerHistory()` fills them with `[]` |
| The signed-out gate | `MyVelnes.tsx` | `.acc-empty` with a sign-in call to action |

**Two words that already mean something else.** `customers.service.ts`
has `favoriteService`: a *derived per-tenant insight* — the service this
customer books most — not a thing anybody chose. And
`client_customer_links` powers "My salons", which is *salons you have
booked at*, not salons you like. Neither is what Phase C means by a
favourite, and the UI must not blur either of them into it. This is the
same hazard as `ranking.ts` (the employee leaderboard) against
`search.ts`, and it is worth naming twice.

---

## 2. Decisions

Settled by Alex, 2026-09-20, with what was rejected.

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | What can be favourited | **Salons, services and pros** | The prototype's own subtitle is "Salons, pros & services". Building two of three now would mean reopening the section later |
| 2 | Signed out | **Heart shown; tapping prompts sign-in; the intent is applied once afterwards** | Discoverable, and a reason to sign up. Rejected: hiding it (hides the reason, and forks the card markup), and local-then-merge (a second source of truth, per device, that can conflict) |
| 3 | Can a salon see who favourited it | **No** | RLS on `app.client_id` only, no tenant policy. Favouriting stays private, consistent with §5's line that personalisation reveals nothing to any salon. An aggregate count, or named disclosure to linked customers, would each be a new tenant-facing surface and a thing we would have to say out loud |
| 4 | Can HQ read them | **Yes, read-only** | Matches `client_notifications`, which already carries an HQ policy. Support answering "my favourites vanished" should not require database access |

---

## 3. The model

**One table, one door.**

```
client_favourites
  id              uuid primary key
  client_user_id  uuid not null → client_users(id) on delete cascade
  kind            text not null check (kind in ('salon','service','pro'))
  tenant_id       uuid not null          -- the salon it belongs to
  ref_id          uuid not null          -- business / service / employee id
  created_at      timestamptz not null
  unique (client_user_id, kind, ref_id)
```

Two choices that are not obvious:

**`tenant_id` on every row, salon favourites included.** A service or a
pro is only resolvable inside its salon's context, so the row carries
the context needed to read it back. Without it every read would begin
with a lookup to find out where to look.

**No foreign key to `services`, `employees` or `businesses` — only to
`client_users`.** Those are tenant rows on their own lifecycle, and a
hard key would put a person's favourites inside the blast radius of a
salon's housekeeping. Phase B taught this the expensive way: an FK from
`search_config` to `hq_users` meant the demo seed's
`TRUNCATE ... hq_users CASCADE` silently deleted the ranking config, and
a seeded world came up with nothing in force. So: resolve on read, and
drop from the list anything that has gone or stopped being public. The
cost is orphan rows, which a later sweep can clear; the benefit is that
a favourite is the client's, and only the client's, to lose.

### The doors

- `GET /client/me/favourites` — the rows, **with resolved labels**.
- `PUT /client/me/favourites/:kind/:id` — idempotent add.
- `DELETE /client/me/favourites/:kind/:id` — idempotent remove.

One read door, not two. The hearts scattered across discovery need to
know what is already favourited, and the obvious shortcut is a second,
leaner "just the ids" endpoint — which is exactly how a concept grows a
second door that later disagrees with the first. The app derives its
heart states from the same response the Favourites section renders. If
that ever costs too much, a lean variant is a change to one door rather
than an argument between two.

---

## 4. Privacy and tenant boundaries

- Favourites are client-owned. RLS on `app.client_id`, plus an HQ read
  policy. **No tenant policy at all** — unlike `client_notifications`,
  which salons legitimately write to, nothing a salon does should touch
  this table.
- Resolving labels crosses into tenant data through `withTenant`, which
  is what `myAppointments` already does. Reading a service's name is not
  the same as telling that service's salon who asked.
- A salon is never told who favourited it, and no count is exposed.
- Only public-facing rows resolve: a service that is no longer `active`
  and `online`, or a pro at a salon that has cleared `showTeam`, drops
  out of the list rather than leaking through it.

---

## 5. Ranking: fills the seam, changes nothing

Phase B is closed. Phase C adds no ranking rule and touches no weight.
`viewerHistory()` stops returning two empty arrays and returns the
client's favourites instead. That is the whole integration.

**Double counting is already impossible**, by a decision made in §2.2
before favourites existed: affinity combines its sub-signals with `max`,
not `sum`. Favouriting a treatment you have also booked scores
`max(1.00, 0.90) = 1.00`, not 1.90. The nesting argument that chose
`max` — booking a service implies booking at the salon implies booking
in the category — turns out to cover a chosen favourite too.

Two properties worth restating because they are easy to break later:

- **Favourites carry no recency decay.** A booking is an event and fades;
  a favourite is a standing statement and does not. The ranker applies
  `recency` to bookings only, and that is deliberate.
- **Consent already covers them.** With personalisation switched off,
  `history` is `null`, so favourites reorder nothing. No new switch, no
  new consent surface.

**Pros will not feed ranking**, honestly and for now: results are
treatments at salons, and there is no pro seam in the scorer to fill.
Favouriting a professional is a bookmark, not a signal.

If 0.90 ever looks like the wrong number, it is a slider in the HQ
Search lab, not a code change.

---

## 6. Behaviour

**The hearts.** Optimistic: fill on tap, roll back and say so if the
write fails. Signed out, the heart still draws; tapping sends the person
to sign-in and the one intended favourite is applied when they come
back, once, and then forgotten.

**The section.** My Velnes gains `Favourites`, third in the menu as the
prototype has it, with the prototype's markup: a group per kind, each
row a photo or initials, a name, a quiet second line, a heart that
removes it, and a call to action. Rows show only what is honestly known
— the prototype's salon row carries a star rating, and reviews do not
exist, so that comes out rather than being invented.

**States.** Loading is quiet, not a spinner per card. Empty is the
prototype's own words — "No favourites yet. Save salons and
professionals you love so they're easy to find again." — with the
Explore button. An error on toggle rolls the heart back and says one
plain sentence.

---

## 7. Migration and backfill

A new table, and **nothing to backfill**. The heart was never persisted
anywhere, in any environment, so there is no prior state to carry over —
worth saying plainly rather than leaving somebody to look for it. The
demo seed gains a couple of favourites for the demo client, so the
section is not empty in development.

---

## 8. Build order

1. Migration, contract, RLS.
2. Service and the three doors, with cross-tenant label resolution.
3. `viewerHistory()` reads them — the ranking seam closes itself.
4. Hearts become real on salon cards: optimistic, with rollback.
5. Hearts wherever else the prototype puts them — it has eight `.fav`
   buttons and the app has one, so this step begins with an audit.
6. The Favourites section in My Velnes.
7. Seed and docs.
8. Tests, throughout rather than at the end.

## 9. What the tests have to prove

- **Cross-client isolation**, proven against the restricted `velnes_api`
  role. The admin role carries `BYPASSRLS` and would prove nothing —
  this cost a wrong conclusion once already in Phase B.
- Add and remove are idempotent; favouriting twice is not two rows.
- A service that stops being sellable drops out of the list.
- A salon cannot read the table under any tenant context.
- Favouriting changes rank order, through the existing seam.
- **Booked and favourited scores 1.00, not 1.90** — the double-count
  guard, asserted rather than assumed.
- With personalisation off, favourites reorder nothing.
- The write doors refuse a signed-out caller.
