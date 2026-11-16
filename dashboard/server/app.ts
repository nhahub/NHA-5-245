import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import { FailureEnvelope, GatewayRequest, SuccessEnvelope, results, previousUtcMonth } from '../shared/contract.ts';

type GatewayConfig = { webhookUrl: string; key: string; timeoutMs?: number };

const safeErrors: Record<string, { status: number; message: string }> = {
  INVALID_REQUEST: { status: 400, message: 'The gateway rejected the input. Check the dataset and billing month.' },
  REPORT_NOT_FOUND: { status: 404, message: 'There is no saved report for this month and dataset. Generate an assessment first.' },
  STALE_REPORT: { status: 409, message: 'The report revision changed. Load the saved report again to review the latest assessment.' },
  NOT_ELIGIBLE: { status: 409, message: 'The saved assessment does not qualify for a claim draft.' },
  DEPENDENCY_ERROR: { status: 502, message: 'SLA Guard could not read or save the evidence. Check n8n and its database connection.' },
};

function trustedRequest(req: Request) {
  const host = req.get('Host');
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) return false;
  if (req.get('Sec-Fetch-Site') === 'cross-site') return false;
  const origin = req.get('Origin');
  return !origin || origin === `http://${host}` || origin === `https://${host}`;
}

function failure(res: Response, status: number, code: string, error: string, executionId?: string) {
  return res.status(status).json({ ok: false, code, error, ...(executionId && { execution_id: executionId }) });
}

function publicTarget(rawUrl: string) {
  const url = new URL(rawUrl);
  return `${url.protocol}//${url.host}${url.pathname}`;
}

export function createDashboardApp({ webhookUrl, key, timeoutMs = 95_000 }: GatewayConfig) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    next();
  });
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'up' }));

  app.post('/api/sla', (req, res, next) => {
    if (!trustedRequest(req)) return failure(res, 403, 'INVALID_ORIGIN', 'Open SLA Guard directly on localhost.');
    if (!req.is('application/json')) return failure(res, 415, 'INVALID_REQUEST', 'Send a JSON request body.');
    next();
  }, express.json({ limit: '4kb' }), async (req, res) => {
    const input = GatewayRequest.safeParse(req.body);
    if (!input.success) return failure(res, 400, 'INVALID_REQUEST', 'Choose a supported action, dataset, and UTC month. Checks use the live dataset.');
    if (!key) return failure(res, 503, 'CONFIGURATION_ERROR', 'Set SLA_WEBHOOK_KEY in the server environment and restart the dashboard.');

    const request = input.data;
    let response: globalThis.Response;
    let payload: unknown;
    try {
      response = await fetch(webhookUrl, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-SLA-Key': key },
        body: JSON.stringify(request),
      });
      if (response.status === 401 || response.status === 403) {
        return failure(res, 502, 'GATEWAY_AUTH_FAILED', 'The gateway rejected the server key. Check the n8n credential and SLA_WEBHOOK_KEY.');
      }
      payload = await response.json();
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        return failure(res, 504, 'GATEWAY_TIMEOUT', 'The gateway did not respond in time. Refresh the saved result before trying another write.');
      }
      return failure(res, 502, 'GATEWAY_UNAVAILABLE', 'Could not reach the SLA Guard webhook. Check that n8n is running and the gateway is published.');
    }

    if (!response.ok) {
      const upstream = FailureEnvelope.safeParse(payload);
      const item = upstream.success && Object.hasOwn(safeErrors, upstream.data.code) ? safeErrors[upstream.data.code] : undefined;
      if (item && upstream.success && item.status === response.status) {
        return failure(res, item.status, upstream.data.code, item.message, upstream.data.execution_id);
      }
      return failure(res, 502, 'DEPENDENCY_ERROR', 'The gateway returned an unexpected error. Check the n8n execution history.');
    }

    const envelope = SuccessEnvelope.safeParse(payload);
    const invalid = () => failure(res, 502, 'INVALID_RESPONSE', 'The webhook response does not match the requested action or dataset. Check the n8n workflow.');
    if (!envelope.success || envelope.data.action !== request.action) return invalid();
    const dataset = request.dataset ?? 'live';
    const raw = envelope.data.result;
    let result: unknown;
    if (request.action === 'status') {
      const parsed = results.status.safeParse(raw);
      if (!parsed.success || parsed.data.dataset !== dataset || parsed.data.is_synthetic !== (dataset === 'demo')
          || parsed.data.recent_checks.some(check => check.source !== dataset)
          || (parsed.data.latest_check && parsed.data.latest_check.source !== dataset)) return invalid();
      const { service, ...status } = parsed.data;
      result = { ...status, service: { ...service, target_url: publicTarget(service.target_url) } };
    } else if (request.action === 'check') {
      const parsed = results.check.safeParse(raw);
      if (!parsed.success || parsed.data.check.source !== 'live') return invalid();
      result = parsed.data;
    } else {
      const parsed = results[request.action].safeParse(raw);
      if (!parsed.success) return invalid();
      const { report, claim_draft, ...saved } = parsed.data;
      if (report.dataset !== dataset || report.is_synthetic !== (dataset === 'demo')
          || report.month !== (request.month ?? previousUtcMonth())) return invalid();
      const realDraft = report.is_final && report.unknown_seconds === 0 && report.assessment === 'breach_detected'
        && claim_draft?.split(/\r?\n/, 1)[0] === 'SLA GUARD CLAIM DRAFT';
      const service = report.contract_snapshot;
      result = { ...saved, claim_draft: realDraft ? claim_draft : null, report: {
        ...report, contract_snapshot: { ...service, target_url: publicTarget(service.target_url) },
      } };
    }

    // Remove the server key if an upstream diagnostic happens to echo it.
    const data = JSON.stringify({ ...envelope.data, result });
    return res.type('json').send(data.replaceAll(JSON.stringify(key).slice(1, -1), '[redacted]'));
  });

  app.use('/api', (_req, res) => failure(res, 404, 'NOT_FOUND', 'This dashboard API route does not exist.'));
  const handleBodyError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const tooLarge = error.status === 413;
    return failure(res, tooLarge ? 413 : 400, 'INVALID_REQUEST', tooLarge ? 'The request body is too large.' : 'Send a valid JSON object.');
  };
  app.use('/api', handleBodyError);
  return app;
}
