import { API_PREFIX, RankingBoardSchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { buildServer } from '../../server.js';

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
let token = '';
const BIZ = '10000000-0000-4000-8000-000000000001';

describe('ranking board — the owner\'s standards, one score per person', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/auth/login`,
      payload: { email: 'maria@velnes.mk', password: 'velnes-demo' },
    });
    token = (res.json() as { accessToken: string }).accessToken;
  });
  afterAll(async () => {
    // Restore the seeded criteria.
    await admin.query(
      `UPDATE businesses SET settings = jsonb_set(settings, '{ranking,criteria}', '["rank_reviews","rank_upsellcount"]') WHERE id=$1`,
      [BIZ],
    );
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('honours the ticked criteria and flags what it cannot measure', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/ranking`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const board = RankingBoardSchema.parse(res.json());
    expect(board.provider).toBe('rules');
    // The seed ticks reviews (no source yet) + upsell count.
    expect(board.notMeasured).toContain('rank_reviews');
    expect(board.rows.length).toBeGreaterThan(0);
    // Sorted by score, descending.
    for (let i = 1; i < board.rows.length; i++)
      expect(board.rows[i - 1]!.score).toBeGreaterThanOrEqual(board.rows[i]!.score);
  });

  it('re-scores when the owner changes the standard to total turnover', async () => {
    await admin.query(
      `UPDATE businesses SET settings = jsonb_set(settings, '{ranking,criteria}', '["rank_turnover"]') WHERE id=$1`,
      [BIZ],
    );
    const res = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/ranking`,
      headers: { authorization: `Bearer ${token}` },
    });
    const board = RankingBoardSchema.parse(res.json());
    expect(board.criteria).toEqual(['rank_turnover']);
    expect(board.notMeasured).toHaveLength(0);
    // By turnover, the top row has the most turnover of the board.
    const maxTurnover = Math.max(...board.rows.map((r) => r.turnover));
    expect(board.rows[0]!.turnover).toBe(maxTurnover);
  });
});
