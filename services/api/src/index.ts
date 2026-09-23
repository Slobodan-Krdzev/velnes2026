import { startMailLoop } from './modules/mail/mail.sender.js';
import { buildServer } from './server.js';

const app = await buildServer();
// Mail: deliver what is queued, retry what the provider refused.
startMailLoop();

const port = Number(process.env.PORT ?? 3001);
// Production sits behind a reverse proxy on the same box: bind to
// loopback unless HOST says otherwise, so the API is never reachable
// on the public address directly. Dev keeps 0.0.0.0 for phones on the LAN.
const host = process.env.HOST ?? (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
