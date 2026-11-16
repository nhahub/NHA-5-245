import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createDashboardApp } from './app.ts';

const development = process.argv.includes('--dev');
const port = Number(process.env.DASHBOARD_PORT ?? 8083);
const bind = process.env.DASHBOARD_BIND ?? '127.0.0.1';
const upstream = new URL(process.env.SLA_WEBHOOK_URL ?? 'http://localhost:8080/webhook/sla-guard');
if (!['https:', 'http:'].includes(upstream.protocol) || upstream.username || upstream.password) {
  throw new Error('SLA_WEBHOOK_URL must be an HTTP(S) URL without embedded credentials.');
}
const app = createDashboardApp({ webhookUrl: upstream.href, key: process.env.SLA_WEBHOOK_KEY?.trim() ?? '' });
const server = createServer(app);

if (development) {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({
    appType: 'spa', server: { middlewareMode: true, ws: { server } },
  });
  app.use(vite.middlewares);
} else {
  app.use((_req, res, next) => {
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    next();
  });
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  app.use('/assets', express.static(dist + 'assets', { immutable: true, maxAge: '1y', index: false }));
  app.use('/assets', (_req, res) => res.sendStatus(404));
  app.use(express.static(dist, { index: false }));
  app.get('/{*route}', (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(dist + 'index.html'));
}

server.listen(port, bind, () => console.log(`SLA Guard dashboard listening on port ${port}`));
