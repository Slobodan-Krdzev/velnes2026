-- The new `reviews.view` permission (Alex, 2026-09-30) for the roles
-- that already run the business: every role holding `users.manage` at
-- business scope — the standard Owner, and any custom role shaped like
-- it — sees reviews. The standard Employee role does not, as
-- employeePermMap() says. New roles get it from the vocabulary.

-- migrate:up

UPDATE roles
   SET perms = perms || '{"reviews.view": "business"}'::jsonb
 WHERE perms->>'users.manage' = 'business'
   AND perms->>'reviews.view' IS NULL;

-- migrate:down

UPDATE roles SET perms = perms - 'reviews.view';
