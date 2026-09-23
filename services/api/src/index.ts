import { startMailLoop } from './modules/mail/mail.sender.js';
import { buildServer } from './server.js';

const app = await buildServer();
// Mail: deliver what is queued, retry what the provider refused.
startMailLoop();

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
