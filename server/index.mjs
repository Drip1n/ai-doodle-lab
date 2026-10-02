import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { authorised, config, generate, HttpError, validateInput } from './generation.mjs';

export function createImageServer({ env = process.env, fetcher = fetch } = {}) {
  const settings = config(env);
  const origin = env.APP_ORIGIN || 'http://127.0.0.1:5173';
  const maxRequests = Number(env.IMAGE_REQUEST_LIMIT || 20);
  if (!Number.isInteger(maxRequests) || maxRequests < 1) throw Error('IMAGE_REQUEST_LIMIT must be a positive integer');
  let used = 0, running = false;
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers.origin && req.headers.origin !== origin) return reply(403, { error: 'This website is not allowed.' });
    if (req.headers.origin === origin) {
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Workshop-Code'); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    }
    if (req.url === '/api/health' && req.method === 'GET') return reply(200, { status: 'ok', configured: Boolean(settings.key && settings.model && settings.accessCode) });
    if (req.url !== '/api/generate-image') return reply(404, { error: 'Not found' });
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); return reply(405, { error: 'Use POST' }); }
    if (!settings.accessCode) return reply(503, { error: 'Picture making is not configured yet.' });
    if (!authorised(req.headers['x-workshop-code'], settings.accessCode)) return reply(401, { error: 'Ask your teacher for the workshop code.' });
    if (running) return reply(429, { code: 'busy', error: 'Another picture is still being made.' });
    if (used >= maxRequests) return reply(429, { code: 'limit', error: 'The workshop picture limit has been reached.' });
    if (!req.headers['content-type']?.startsWith('application/json')) return reply(415, { error: 'Use JSON' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', onClose);
    let claimed = false;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 3_000_000) throw new HttpError(413, 'Drawing examples are too large.');
        chunks.push(chunk);
      }
      let raw;
      try { raw = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new HttpError(400, 'Invalid request'); }
      const input = validateInput(raw);
      if (running) { reply(429, { code: 'busy' }); return; }
      if (used >= maxRequests) { reply(429, { code: 'limit' }); return; }
      if (!settings.key || !settings.model) throw new HttpError(503, 'Picture making is not configured yet.');
      running = true; claimed = true; used += 1;
      reply(200, await generate(input, settings, fetcher, controller.signal));
    } catch (error) {
      if (!res.destroyed) reply(error instanceof HttpError ? error.status : controller.signal.aborted ? 504 : 502, { error: error instanceof HttpError ? error.message : 'The picture could not be made. Please try again later.' });
    } finally { clearTimeout(timeout); res.off('close', onClose); if (claimed) running = false; }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createImageServer();
  server.requestTimeout = 100_000;
  server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => console.log('Image server ready (no secrets logged).'));
}
