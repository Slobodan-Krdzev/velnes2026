import { RankingBoardSchema } from '@velnes/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { withTenant } from '../../db/index.js';
import { rankingBoard } from './ranking.service.js';

/** The ranking board — the employee app and the owner read the same
 *  door. It honours the criteria set in Settings › Ranking. Any signed
 *  in employee may see where the team stands. */
export function rankingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/ranking',
    preHandler: [app.authenticate],
    schema: { response: { 200: RankingBoardSchema } },
    handler: async (req) => withTenant(req.claims.ten, (trx) => rankingBoard(trx, req.claims.ten)),
  });
}
