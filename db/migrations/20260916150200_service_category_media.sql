-- Service categories are the global Velnes taxonomy (Haircuts, Massage,
-- Nails, …). The client-facing discovery app (built soon) browses them as
-- cards, so HQ provides a card image and an icon per category. Stored as
-- data URLs (like the salon gallery/logo) until an asset host is decided —
-- honest emptiness, no fake CDN. Nullable at the DB level: HQ is required
-- to supply them for NEW categories at the door, while the pre-existing
-- taxonomy rows carry null until HQ edits them in.

-- migrate:up
ALTER TABLE service_categories ADD COLUMN card_image text;
ALTER TABLE service_categories ADD COLUMN icon text;

-- migrate:down
ALTER TABLE service_categories DROP COLUMN icon;
ALTER TABLE service_categories DROP COLUMN card_image;
