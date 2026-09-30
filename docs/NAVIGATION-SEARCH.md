# Navigation search — "take me where I need to go"

Built 2026-09-30 (Alex). The search icon in the top bar of the Salon
Workspace, Revelapps HQ and the Supplier Portal opens a command-style
search over each app's **destinations**: pages, sections of pages, and
the actions people ask for by what they want to do ("change amenities",
"add worker", "salon photos"). It is not a record search and never
calls the API: a small local index, ranked deterministically, in under
a millisecond. ⌘K / Ctrl+K opens the same surface.

## One engine, three registries

`packages/navsearch` (`@velnes/navsearch`) is the engine and the UI:

- `types.ts` — a `NavEntry`: stable untranslated `id`, `title` and
  `crumbs` as **i18n keys** (resolved in the viewer's language at render
  time), an `I.*` icon, search-only `aliases` per language (`en`, `mk`
  in Cyrillic, `sq`), optional `terms` (i18n keys whose values in every
  language are aliases too — the amenity names under Amenities),
  `visible(ctx)`, `quick`, and `go`: a target or a function of the
  app's context (the location-dependent settings).
- `normalize.ts` — `canon()`: lowercase → accents folded (ë→e, ç→c) →
  Macedonian Cyrillic transliterated → the digraphs people skip on a
  Latin keyboard collapsed (ќ/kj→k, ш/sh→s, ч/ch→c, ж/zh→z, ѓ/gj→g,
  џ,ѕ/dz→z, љ/lj→l, њ/nj→n) → punctuation to spaces. So `погодности`,
  `pogodnosti` and `Pogodnosti!` are one token, and `плаќања`,
  `plakjanja`, `plakanja` are one token. Lossy on purpose (it applies
  to every script, so "change" indexes as "cange" on both sides): a
  navigation index has no pair of words a digraph tells apart. This is
  **not** the platform's search normaliser, which lives in Postgres and
  keeps Cyrillic — that one finds salons, this one finds screens.
  Stop words (en/mk/sq) and intent verbs (change/смени/ndrysho, add/
  додади/shto, …) are dropped from the query unless nothing would be
  left. Typos: an optimal-string-alignment distance with a budget of 0
  under five letters, 1 to seven, 2 from eight.
- `rank.ts` — `buildIndex(entries, labels)` once per app;
  `search(index, query, ctx)` scores each visible entry: whole query
  equals an alias with its verb (95) · title equals (100) · title
  prefix (85) · all tokens in the title (75) · alias equals (90) ·
  alias prefix (70) · all tokens among alias tokens (62) · all tokens
  among title+alias tokens (58) · most tokens with prefixes/typos (up
  to 52, ×0.85 when a typo was used) · breadcrumb (30/20) · +3 when the
  query's verb is one the entry lists. Floor 25, at most 8, ties by
  shorter title then registry order. Under two characters nothing is
  searched; `quickLinks()` are the `quick` entries the viewer may see.
- `NavSearch.tsx` — the dialog (`role="dialog"`, a `combobox` over a
  `listbox`, `aria-activedescendant`), ↑↓ Enter Escape, focus into the
  field on open and back to the trigger on close, quick links before
  typing, a localized empty state; `useNavSearchHotkey()` for ⌘K.
  Styled from the apps' own tokens; full-width under 700px.

The registries: `apps/workspace/src/shell/navsearch.ts` (40 entries,
`WsCtx = { can, locations }`), `apps/hq/src/navsearch.ts` (16, `{ role }`),
`apps/supplier/src/navsearch.ts` (15, `{ role }`). Titles reuse the
labels the screens already have; the few titles that had none
(`navs.ws.*`, `navs.hq.*`, `navs.po.*`) were added in en/mk/sq. Adding
a destination is one entry: id, title key, crumbs, icon, aliases,
visibility, target. Nothing else changes.

## Permission-aware

Visibility is the same predicate that hides the sidebar tiles and the
settings sections: `can(perm)` in the workspace, the role checks the
HQ and portal screens apply (`hq_super` for the team, `hq_super`/
`hq_onboard` for approvals; `sr_owner` for settings, owner/catalog for
adding products, owner/account for promotions). Hidden means not
offered by any spelling, alias or quick link. The UI is not the
security boundary — routes and the API still authorize.

## Deep links

The workspace's sections used to be React state seeded once from
`location.state` (not reloadable). The pages now also read the URL:
`/settings?tab=<section>`, plus `&edit=<locationId>&focus=amenities|cancel`
(Locations opens the panel and scrolls to the block), `&focus=gallery|socials`
(Company), `&loc=&sub=exceptions` (Opening hours), `&open=invite|app|add`
(Team invite, Employee-app sign-in, Add location); `/catalog?tab=`,
`/marketing?tab=` (which also honours the flightdeck's route state it
used to ignore), `/suppliers?tab=`, `/reports?tab=`, `/till?type=`. A
**location-dependent** setting (amenities, cancellation window) goes
straight into the panel when the viewer has one location and to the
Locations list when there are several — never a guessed location. HQ
and the portal keep their tab in `?tab=` (read on boot, written on a
chosen result) and scroll to the card by id (`hq-registrations`,
`po-company`, …); the portal opens the add-product / bulk-price /
add-promotion panels when the search asked for them.

## Not in this version

Record results (an employee, a customer, an order) — the entry type is
`navigation` only; recent destinations; analytics events (none of the
three apps has an analytics layer). Queries never leave the browser.
