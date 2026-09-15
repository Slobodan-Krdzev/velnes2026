// Runs before every suite: point the API at the test database.
// Assign unconditionally — the globalSetup process loads the repo
// .env (dev URLs) and workers inherit that environment.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'velnes-test-secret';
// Tests must be deterministic and offline: force the stub planner and
// blank any key inherited from the repo .env, so no suite ever calls the
// live model. Assistant behaviour is proven against the stub.
process.env.ASSISTANT_PROVIDER = 'stub';
process.env.ANTHROPIC_API_KEY = '';
process.env.API_DATABASE_URL =
  process.env.TEST_API_DATABASE_URL ??
  'postgres://velnes_api:velnes_api@localhost:5432/velnes_test';
