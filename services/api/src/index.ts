import { startMailLoop } from './modules/mail/mail.sender.js';
import { startReviewReminderLoop } from './modules/reviews/reviews.service.js';
import { startRefundLoop } from './modules/payments/refunds.service.js';
import { startLoyaltyLoop } from './modules/loyalty/loyalty.service.js';
import { buildServer } from './server.js';

const app = await buildServer();
// Mail: deliver what is queued, retry what the provider refused.
startMailLoop();
// Reviews: the one "how was your visit?" a day after a completed visit.
startReviewReminderLoop();
// Refunds: the intents a cancellation left behind, and the provider's
// refusals, tried again until they clear or give up.
startRefundLoop();
// Velnes Loyalty: settle completed visits, reverse undone ones, repair
// what a door missed — every award idempotent by its source.
startLoyaltyLoop();

const port = Number(process.env.PORT ?? 3001);
// Production sits behind a reverse proxy on the same box: bind to
// loopback unless HOST says otherwise, so the API is never reachable
// on the public address directly. Dev keeps 0.0.0.0 for phones on the LAN.
const host = process.env.HOST ?? (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
