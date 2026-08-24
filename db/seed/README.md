# Demo seed

The seed implementation lives with the API (it shares the contracts
and the argon2 dependency): `services/api/src/db/seed-demo.ts`.

Run it with:

    pnpm --filter @velnes/api seed

It mirrors the prototype's demo world exactly (see
`docs/FOUNDATIONS.md`) and refuses to run in production.
