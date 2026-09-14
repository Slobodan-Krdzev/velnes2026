import {
  AssistantExecuteRequestSchema,
  AssistantExecuteResponseSchema,
  AssistantMessageRequestSchema,
  AssistantMessageResponseSchema,
  AssistantResumeResponseSchema,
} from '@velnes/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { CatalogError } from '../catalog/catalog.service.js';
import { cancelDraft, executeDraft, handleMessage, resumeDraft } from './assistant.service.js';

const Err = z.object({ error: z.string(), message: z.string() });

/**
 * The AI Assistant surface for the workspace app. Three doors:
 *   POST /assistant/message  — one conversational turn (never mutates)
 *   POST /assistant/execute  — the ONLY mutation path (explicit approval)
 *   GET  /assistant/draft    — resume an open draft after reopening
 *   DELETE /assistant/draft/:id — explicit Cancel
 * All tenant-scoped via app.authenticate → withTenant.
 */
export function assistantRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'POST',
    url: '/assistant/message',
    preHandler: [app.authenticate],
    schema: { body: AssistantMessageRequestSchema, response: { 200: AssistantMessageResponseSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, (trx) => handleMessage(trx, req.claims, 'workspace', req.body)),
  });

  r.route({
    method: 'POST',
    url: '/assistant/execute',
    preHandler: [app.authenticate],
    schema: { body: AssistantExecuteRequestSchema, response: { 200: AssistantExecuteResponseSchema } },
    handler: async (req) => {
      try {
        return await withTenant(req.claims.ten, (trx) =>
          executeDraft(trx, req.claims, 'workspace', req.body.draftId),
        );
      } catch (e) {
        // A domain door refused: the transaction rolled back, the draft is
        // untouched. Surface the reason instead of a 500 — the honest result.
        if (e instanceof CatalogError)
          return { status: 'FAILED' as const, message: e.message, conflict: null };
        throw e;
      }
    },
  });

  r.route({
    method: 'GET',
    url: '/assistant/draft',
    preHandler: [app.authenticate],
    schema: { response: { 200: AssistantResumeResponseSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => ({ draft: await resumeDraft(trx, req.claims) })),
  });

  r.route({
    method: 'DELETE',
    url: '/assistant/draft/:id',
    preHandler: [app.authenticate],
    schema: { params: z.object({ id: z.uuid() }), response: { 200: z.object({ ok: z.boolean() }), 404: Err } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        await cancelDraft(trx, req.params.id);
        return { ok: true };
      }),
  });
}
