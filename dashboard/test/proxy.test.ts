import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { test } from 'node:test';
import { createDashboardApp } from '../server/app.ts';
import { previousUtcMonth } from '../shared/contract.ts';
import { claimText, duration, timeline, transitions } from '../src/model.ts';
import { reportFixture, statusFixture } from './fixtures.ts';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

test('the proxy authorizes, validates, and scopes upstream requests and responses', async t => {
  const key = 'mock-server-only-key';
  let calls = 0;
  const gateway = createServer(async (req, res) => {
    calls++;
    assert.equal(req.headers['x-sla-key'], key);
    let text = '';
    for await (const chunk of req) text += chunk;
    const request = JSON.parse(text);
    res.setHeader('Content-Type', 'application/json');
    if (request.action === 'get_report' && request.month === '1970-01') {
      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, code: 'REPORT_NOT_FOUND', error: `Gateway error ${key}` }));
      return;
    }
    if (request.action === 'report' && request.month === '1970-01') {
      res.statusCode = 409;
      res.end(JSON.stringify({ ok: false, code: 'STALE_REPORT', error: `Gateway error ${key}` }));
      return;
    }
    const snapshot = statusFixture(request.dataset === 'demo' ? 'demo' : 'live', 'down');
    snapshot.service = { ...snapshot.service, target_url: 'https://user:pass@example.test/health?key=private#secret' };
    const result = request.action === 'status' ? snapshot
      : request.action === 'check' ? { check: snapshot.latest_check, duplicate: false, transition: 'outage_started' }
        : reportFixture(request.dataset, request.month);
    res.end(JSON.stringify({ ok: true, execution_id: 'fixture-gateway', action: request.action, result }));
  });
  t.after(() => gateway.close());
  const url = await listen(gateway);
  const dashboard = createServer(createDashboardApp({ webhookUrl: url, key }));
  t.after(() => dashboard.close());
  const base = await listen(dashboard);
  const post = (body: object, headers: Record<string, string> = {}) => fetch(`${base}/api/sla`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });

  assert.equal((await post({ action: 'check', dataset: 'demo' })).status, 400);
  assert.equal((await post({ action: 'status', key })).status, 400);
  assert.equal((await post({ action: 'get_report', month: '9999-12' })).status, 400);
  assert.equal((await post({ action: 'status' }, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal(calls, 0);

  const status = await post({ action: 'status', dataset: 'demo' });
  assert.equal(status.status, 200);
  assert.equal(status.headers.get('Cache-Control'), 'no-store');
  const observed = await status.json();
  assert.equal(observed.result.current_status, 'down');
  assert.equal(observed.result.dataset, 'demo');
  assert.equal(observed.result.service.target_url, 'https://example.test/health');

  const down = await post({ action: 'check' });
  assert.equal(down.status, 200);
  assert.equal((await down.json()).result.check.is_up, false);

  const valid = await post({ action: 'get_report', dataset: 'demo', month: previousUtcMonth() });
  assert.equal(valid.status, 200);
  assert.match((await valid.json()).result.claim_draft, /^SLA GUARD CLAIM DRAFT/);
  for (const [action, status, code] of [['report', 409, 'STALE_REPORT'], ['get_report', 404, 'REPORT_NOT_FOUND']] as const) {
    const response = await post({ action, month: '1970-01', dataset: 'live' });
    assert.equal(response.status, status);
    const body = await response.text();
    assert.ok(!body.includes(key));
    assert.equal(JSON.parse(body).code, code);
  }
});

test('the evidence model keeps monitoring gaps and draft eligibility distinct', () => {
  const status = statusFixture('live', 'down');
  const graph = timeline(status, 'all', Date.now());
  assert.equal(graph?.points.length, 3);
  assert.equal(graph?.gaps.length, 1);
  assert.equal(transitions(status.recent_checks, 90).get(3), 'Outage began');
  assert.equal(duration(7200), '2h');
  assert.equal(duration(.2), '< 1s');
  assert.equal(claimText(reportFixture('live')), null);
  assert.ok(claimText(reportFixture('demo')));
  const pending = reportFixture('demo');
  pending.report.unknown_seconds = 1;
  assert.equal(claimText(pending), null);
});
