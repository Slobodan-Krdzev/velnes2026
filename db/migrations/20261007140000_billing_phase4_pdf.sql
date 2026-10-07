-- Invoicing phase 4 (Alex, 2026-10-07) — docs/INVOICING-PLAN.md J.4,
-- docs/INVOICING.md "Phase 4".
--
-- The document's language. One invoice is rendered in ONE language,
-- chosen while it is a draft (explicit choice → the buyer's Velnes
-- account language → the salon's country → Macedonian) and frozen with
-- the rest at issue — the frozen-row trigger is a whitelist, so the
-- new column is frozen by construction. Documents that exist already
-- (drafts and the issued dev invoices) take the deterministic fallback,
-- Macedonian, rather than deriving a language forever.
--
-- The canonical PDF's hash lives in the existing mutable column
-- `pdf_sha256` (written once, when NULL; never overwritten).

-- migrate:up

ALTER TABLE billing_invoices
  ADD COLUMN lang text NOT NULL DEFAULT 'mk' CHECK (lang IN ('mk','sq','en'));

-- migrate:down

ALTER TABLE billing_invoices DROP COLUMN lang;
