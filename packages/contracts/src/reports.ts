import { z } from 'zod';
import { MoneySchema } from './catalog.js';

/** Reports — one computed document per period, read from the same
 *  tables the till and the calendar write. Nothing here is stored;
 *  the report is always the truth at the moment it is asked for. */

export const ReportQuerySchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
});

export const ReportSchema = z.object({
  totals: z.object({
    revenue: MoneySchema,
    invoices: z.number().int(),
    appointments: z.number().int(),
    avgTicket: MoneySchema,
    noShows: z.number().int(),
    noShowPct: z.number(),
    prevRevenue: MoneySchema,
    prevAppointments: z.number().int(),
    prevAvgTicket: MoneySchema,
  }),
  daily: z.array(z.object({ date: z.iso.date(), revenue: MoneySchema })),
  services: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      category: z.string().nullable(),
      booked: z.number().int(),
      revenue: MoneySchema,
    }),
  ),
  products: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      sold: z.number().int(),
      stock: z.number().int(),
      revenue: MoneySchema,
    }),
  ),
  employees: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      roleTitle: z.string(),
      appointments: z.number().int(),
      revenue: MoneySchema,
      utilisationPct: z.number().int(),
    }),
  ),
  vat: z.array(
    z.object({
      rate: z.number().int(),
      net: MoneySchema,
      vat: MoneySchema,
      gross: MoneySchema,
    }),
  ),
  sources: z.array(
    z.object({
      source: z.string(),
      bookings: z.number().int(),
      revenue: MoneySchema,
      sharePct: z.number().int(),
      fee: MoneySchema,
    }),
  ),
  locations: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      revenue: MoneySchema,
      appointments: z.number().int(),
      ticket: MoneySchema,
      products: MoneySchema,
    }),
  ),
});
export type Report = z.infer<typeof ReportSchema>;
