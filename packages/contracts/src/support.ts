import { z } from 'zod';

/**
 * Support tickets — a salon (tenant) or a supplier opens a thread to
 * Revelapps HQ. One door on each side; HQ reads and answers them all.
 * The conversation is a thread of messages carried on the ticket.
 */

export const SUPPORT_CATEGORIES = [
  'booking',
  'billing',
  'catalog',
  'technical',
  'account',
  'other',
] as const;
export const SupportCategorySchema = z.enum(SUPPORT_CATEGORIES);
export type SupportCategory = z.infer<typeof SupportCategorySchema>;

export const SupportStatusSchema = z.enum(['open', 'in_progress', 'resolved', 'closed']);
export type SupportStatus = z.infer<typeof SupportStatusSchema>;

export const SupportMessageSchema = z.object({
  authorKind: z.enum(['tenant', 'supplier', 'hq']),
  authorName: z.string(),
  body: z.string(),
  at: z.string(),
});
export type SupportMessage = z.infer<typeof SupportMessageSchema>;

export const SupportTicketSchema = z.object({
  id: z.uuid(),
  origin: z.enum(['tenant', 'supplier']),
  originName: z.string().default(''),
  subject: z.string(),
  category: SupportCategorySchema,
  status: SupportStatusSchema,
  createdBy: z.string(),
  lastActor: z.enum(['origin', 'hq']),
  messages: z.array(SupportMessageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SupportTicket = z.infer<typeof SupportTicketSchema>;
export const SupportTicketListSchema = z.object({ tickets: z.array(SupportTicketSchema) });

/** What either side sends to open a ticket. */
export const SupportTicketCreateSchema = z.object({
  subject: z.string().min(3).max(160),
  category: SupportCategorySchema.default('other'),
  body: z.string().min(1).max(4000),
});
export type SupportTicketCreate = z.infer<typeof SupportTicketCreateSchema>;

/** A reply into an existing thread. HQ may also move the status. */
export const SupportTicketReplySchema = z.object({
  body: z.string().min(1).max(4000),
  status: SupportStatusSchema.optional(),
});
export type SupportTicketReply = z.infer<typeof SupportTicketReplySchema>;

/** HQ moving a ticket's lifecycle without adding a message. */
export const SupportTicketStatusSchema = z.object({ status: SupportStatusSchema });
