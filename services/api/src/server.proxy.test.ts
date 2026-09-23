import { API_PREFIX } from '@velnes/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from './db/index.js';
import { buildServer } from './server.js';

/**
 * Behind Nginx on the same box every request arrives from 127.0.0.1;
 * the visitor's address is in X-Forwarded-For. The rate limiters key on
 * `req.ip`, so the API must trust that header from the loopback proxy
 * — and only from there.
 */
const app = await buildServer();
app.get('/__ip', async (req) => ({ ip: req.ip, protocol: req.protocol }));

describe('proxy trust', () => {
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('takes the visitor address and scheme from the loopback proxy headers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/__ip',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.9', 'x-forwarded-proto': 'https' },
    });
    expect(res.json()).toEqual({ ip: '203.0.113.9', protocol: 'https' });
  });

  it('ignores forwarded headers that do not come from the loopback proxy', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/__ip',
      remoteAddress: '198.51.100.7',
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    expect(res.json().ip).toBe('198.51.100.7');
  });

  it('still serves health', async () => {
    const res = await app.inject({ method: 'GET', url: `${API_PREFIX}/health` });
    expect(res.statusCode).toBe(200);
  });
});
