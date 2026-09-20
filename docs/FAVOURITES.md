# Phase C — persisted favourites

Decided and **built**, 2026-09-20. This began as a plan written before
any of it existed; what follows is what was actually made, with the
places it departed from the plan marked.

The heart on a salon card used to be `useState(false)`: it filled in,
and forgot the moment you navigated away. It is now real customer data —
the client's own, on their own account, across every salon.

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
worth saying plainly rather than leaving somebody to look for it.

**The demo seed gained nothing, and that was not a choice.** The plan
said it would carry a couple of favourites for the demo client; there is
no demo client. `seed-demo.ts` creates no `client_users` row at all —
consumer accounts are made by registering through the app. Seeding
favourites would therefore mean first inventing a seeded consumer
account, which is a larger decision about the demo world than this phase
should take on its own. So the section starts empty in a fresh
development database, which is at least the state it is designed to
handle, and the tests make their own client and clean it up.

---

## 8. Build order

1. ~~Migration, contract, RLS.~~ **Done.**
2. ~~Service and the three doors, with cross-tenant label resolution.~~ **Done.**
3. ~~`viewerHistory()` reads them~~ **Done** — two empty arrays became the client's own favourites, and nothing else about the scorer moved.
4. ~~Hearts become real on salon cards~~ **Done** — one `FavHeart` behind every heart in the app, reading one query, so a salon hearted on the home page is hearted on the salon page too.
5. ~~Hearts wherever else the prototype puts them~~ — **the audit
   changed this step.** All eight of the prototype's `.fav` buttons are
   on `.rc2` salon cards: four on the desktop "Recommended near you" row
   and the same four on mobile. That is the one heart the app already
   had.

   Which means the prototype can *show* favourite services and
   professionals in its account section but offers no way to save
   either — `toggleFav('svc', …)` is only ever reached from the
   Favourites list, to remove. So the two new placements are a **stated
   departure**, not prototype fidelity: a heart on a treatment row, and
   one beside a team card. Both are in the prototype's visual language
   (same mark, same brand colour when on) and both live in
   `overrides.css` with the reason written next to them. The team one
   sits *beside* its card rather than inside it because `.pro-card` is
   itself a `<button>`, and a button inside a button is not markup.
6. ~~The Favourites section in My Velnes.~~ **Done** — third in the menu, the prototype's markup, minus the star rating it carries for salons because reviews still do not exist.
7. ~~Seed and docs.~~ **Docs done; the seed could not be.** See below.
8. ~~Tests~~ **Done** — twelve against the doors, three more in the ranker's own suite.

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


---

## 10. What the build changed about the plan

Three things, recorded because a plan that quietly becomes something
else is worse than one that was never written.

**The heart audit moved step 5.** The prototype hearts only salon cards.
Saving a service or a professional is a departure we chose, not fidelity
we inherited — see step 5 above.

**The seed could not be done.** There is no demo client to give
favourites to. §7.

**A Phase B defect surfaced, and was fixed.** The ranked door read
`client_users.personalisedResults` through the bare database handle,
with no RLS context. `client_users` is keyed on `app.client_id`, so the
read returned nothing — and nothing reads exactly like "consent is off",
which is why it looked like working code and passed every Phase B test:
those only ever asserted the signed-out case, where `false` is correct.
The first test to sign a client in caught it immediately. It now reads
under `withClient`, and personalisation works for the first time.

This is the "unless testing exposes a defect" case: no weight moved and
no rule changed, but personalisation had never actually run in
production conditions until now.
