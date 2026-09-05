import { z } from 'zod';
import { RANK_KEYS } from './business.js';

/**
 * The ranking board — one score per person from the criteria the owner
 * ticked in Settings › Ranking. The employee app and the owner see the
 * same board. The weighting is deterministic today (equal-weight over
 * the computable criteria); the swappable seam lets a model weigh them
 * later, the same honest pattern as the flightdeck insights.
 */
export const RankingRowSchema = z.object({
  employeeId: z.string(),
  name: z.string(),
  appointments: z.number().int(),
  turnover: z.number().int(),
  /** 0–100, the order the board is sorted by. */
  score: z.number().int(),
});
export type RankingRow = z.infer<typeof RankingRowSchema>;

export const RankingBoardSchema = z.object({
  rows: z.array(RankingRowSchema),
  /** The criteria in force for this board (what the owner ticked). */
  criteria: z.array(z.enum(RANK_KEYS)),
  /** Ticked criteria with no data source yet (e.g. reviews) — named so
   *  the board is honest about what it could and could not weigh. */
  notMeasured: z.array(z.enum(RANK_KEYS)),
  /** Which engine produced the weighting — 'rules' or 'claude'. */
  provider: z.enum(['rules', 'claude']),
  /** ISO date of the Monday this board resets from. */
  weekStart: z.string(),
});
export type RankingBoard = z.infer<typeof RankingBoardSchema>;
