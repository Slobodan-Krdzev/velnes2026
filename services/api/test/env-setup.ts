// Runs before every suite: point the API at the test database.
// Assign unconditionally — the globalSetup process loads the repo
// .env (dev URLs) and workers inherit that environment.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'velnes-test-secret';
process.env.API_DATABASE_URL =
  process.env.TEST_API_DATABASE_URL ??
  'postgres://velnes_api:velnes_api@localhost:5432/velnes_test';
