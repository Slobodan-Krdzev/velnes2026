-- Avatar photos. Employees carry one (shown in the workspace menu, team
-- lists, and the future client app); suppliers carry one (shown as the
-- avatar on the salon workspace's suppliers screen). Data URLs, downscaled
-- client-side, stored inline like the salon gallery/category media — honest
-- emptiness until an asset host is decided. Nullable: an avatar is optional.

-- migrate:up
ALTER TABLE employees ADD COLUMN avatar text;
ALTER TABLE suppliers ADD COLUMN avatar text;

-- migrate:down
ALTER TABLE suppliers DROP COLUMN avatar;
ALTER TABLE employees DROP COLUMN avatar;
