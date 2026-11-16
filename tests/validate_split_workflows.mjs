// Executes the exported Code-node logic with test inputs and checks the workflow handoffs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const filenames = [
  '01_Webhook_Gateway', '02_Health_Monitor', '03_Status_Lookup',
  '04_Monthly_SLA_Assessment', '05_Claim_Draft',
];
const [gateway, monitor, lookup, assessment, draft] = filenames.map(name =>
  JSON.parse(readFileSync(new URL('../' + name + '.json', import.meta.url), 'utf8'))
);
const get = (workflow, name) => workflow.nodes.find(node => node.name === name);
const fakeUrl = 'http://sla-guard-gateway:3000';
const execution = { id: 'child-execution-01' };

function run(workflow, name, value, references = {}, items = [value]) {
  const source = get(workflow, name).parameters.jsCode.replace('https://YOUR_PROJECT_REF.supabase.co', fakeUrl);
  const input = { first: () => ({ json: value }), all: () => items.map(json => ({ json })) };
  const reference = name => ({ first: () => ({ json: references[name] }) });
  const [item, extra] = new Function('$input', '$', '$execution', source)(input, reference, execution);
  assert.equal(extra, undefined, name + ' must return exactly one item');
  return item.json;
}

function expression(source, $json) {
  return new Function('$json', 'return (' + source.slice(3, -2) + ');')($json);
}

for (const workflow of [gateway, monitor, lookup, assessment, draft]) {
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.timezone, 'UTC');
  assert.equal(new Set(workflow.nodes.map(node => node.name)).size, workflow.nodes.length);
  assert.equal(new Set(workflow.nodes.map(node => node.id)).size, workflow.nodes.length);
  for (const node of workflow.nodes) {
    assert.equal(node.credentials, undefined);
    if (node.parameters.jsCode) new Function(node.parameters.jsCode);
    if (node.parameters.genericAuthType === 'httpHeaderAuth') {
      assert.equal(node.retryOnFail, true);
      assert.equal(node.onError, 'continueErrorOutput');
      assert.ok(workflow.connections[node.name].main[1].length);
    }
  }
  for (const [source, { main }] of Object.entries(workflow.connections)) {
    assert.ok(get(workflow, source));
    for (const path of main) for (const { node } of path) assert.ok(get(workflow, node));
  }
}

for (const [caller, child, number] of [[gateway, monitor, '02'], [gateway, lookup, '03'],
  [gateway, assessment, '04'], [assessment, draft, '05']]) {
  const call = caller.nodes.find(n => n.parameters.workflowId?.value === 'REPLACE_WITH_' + number + '_WORKFLOW_ID');
  const trigger = child.nodes.find(n => n.type.endsWith('.executeWorkflowTrigger'));
  assert.equal(trigger.parameters.inputSource, 'workflowInputs');
  assert.deepEqual(call.parameters.workflowInputs.schema.map(({ id, type }) => ({ name: id, type }))
    .sort((a, b) => a.name.localeCompare(b.name)), trigger.parameters.workflowInputs.values
    .slice().sort((a, b) => a.name.localeCompare(b.name)));
  assert.equal(call.parameters.options.waitForSubWorkflow, true);
}

const headers = { 'content-type': 'application/json; charset=utf-8' };
const gwRequest = body => run(gateway, 'Validate Gateway Request', { headers, body });
assert.equal(gwRequest({}).action, 'status');
assert.deepEqual(gwRequest({}).childInput, { action: 'status', dataset: 'live', month: '', trace_id: execution.id });
assert.equal(gwRequest({ action: 'get_report' }).route, 3);
assert.equal(gwRequest({ action: 'check', dataset: 'demo' }).route, 3);
const month = '2024-02';
const opened = gwRequest({ action: 'get_report', dataset: 'demo', month });
assert.deepEqual(opened.childInput, { action: 'get_report', dataset: 'demo', month, trace_id: execution.id });
for (const [code, status] of Object.entries({ INVALID_REQUEST: 400, REPORT_NOT_FOUND: 404,
  STALE_REPORT: 409, NOT_ELIGIBLE: 409, DEPENDENCY_ERROR: 502 })) {
  const response = run(gateway, 'Build Gateway JSON Response', { ok: false, code, error: 'Test' },
    { 'Validate Gateway Request': opened });
  assert.equal(response.status, status);
  assert.equal(response.body.execution_id, execution.id);
}
assert.equal(run(gateway, 'Build Gateway JSON Response', { ok: true, result: null }, {
  'Validate Gateway Request': opened,
}).status, 502);

const statusSettings = run(lookup, 'Settings and Validation', { action: 'status', dataset: 'live', month: '', trace_id: 'gw' });
const stale = { dataset: 'live', current_status: 'unknown', latest_check: { is_up: true }, recent_checks: [] };
assert.deepEqual(run(lookup, 'Return Status', { body: stale }, { 'Settings and Validation': statusSettings }),
  { ok: true, result: stale });
assert.equal(run(lookup, 'Settings and Validation', { action: 'get_report', dataset: 'live', trace_id: 'gw' }).code,
  'INVALID_REQUEST');
assert.equal(run(lookup, 'Settings and Validation', { ...statusSettings, month }).code, 'INVALID_REQUEST');

const reportId = '61f718a3-a536-423d-82c3-4095c0f6768b';
const claimText = 'SLA GUARD CLAIM DRAFT\nDraft for human review';
function fixture(dataset) {
  return { service_id: 'website', dataset, month, is_final: true, unknown_seconds: 0,
    assessment: 'breach_detected', down_seconds: 7200, candidate_credit_amount: 10 };
}

for (const dataset of ['live', 'demo']) {
  const settings = run(lookup, 'Settings and Validation', { action: 'get_report', dataset, month, trace_id: 'gw' });
  assert.equal(settings.ok, true);
  const params = get(lookup, 'Load Saved Report').parameters.queryParameters.parameters;
  assert.equal(expression(params.find(x => x.name === 'source').value, settings), 'eq.' + dataset);
  assert.equal(expression(params.find(x => x.name === 'month').value, settings), 'eq.' + month + '-01');
  const find = body => run(lookup, 'Return Saved Report', { body }, { 'Settings and Validation': settings });
  const row = { id: reportId, revision: 4, report: fixture(dataset), claim_draft: claimText };
  assert.deepEqual(find([row]), { ok: true, result: {
    report_id: reportId, revision: 4, report: row.report, claim_draft: claimText,
  } });
  assert.equal(find([]).code, 'REPORT_NOT_FOUND');
  assert.equal(find([row, row]).code, 'DEPENDENCY_ERROR');
  assert.equal(find([{ ...row, claim_draft: claimText.replace('DRAFT', 'DRAFT v2') }]).result.claim_draft, null);
  assert.equal(find([{ ...row, claim_draft: 'DRAFT - HUMAN REVIEW REQUIRED' }]).result.claim_draft, null);
  assert.equal(find([{ ...row, report: { ...row.report, unknown_seconds: 1 } }]).result.claim_draft, null);
  assert.equal(find([{ ...row, report: { ...row.report, is_final: false } }]).result.claim_draft, null);
}

const cron = get(assessment, 'Monthly at 00-05 UTC').parameters.rule.interval[0];
assert.deepEqual(cron, { field: 'cronExpression', expression: '0 5 0 1 * *' });
const scheduled = run(assessment, 'Prepare Previous UTC Month', {});
assert.equal(scheduled.dataset, 'live');
assert.equal(scheduled.trace_id, execution.id);
const settings = run(assessment, 'Settings and Validation', { dataset: 'demo', month, trace_id: 'gw' });
const rpc = get(assessment, 'Save Monthly Assessment').parameters;
assert.deepEqual(expression(rpc.jsonBody, settings), {
  p_service_id: 'website', p_month: month + '-01', p_source: 'demo', p_execution_id: execution.id,
});
const assess = report => run(assessment, 'Validate Saved Assessment', { body: {
  report_id: reportId, revision: 4, report, claim_draft: 'legacy draft', duplicate: false,
} }, { 'Settings and Validation': settings });
const report = fixture('demo');
const saved = assess(report);
assert.equal(saved.eligible, true);
assert.equal(saved.result.report.candidate_credit_amount, 10);
assert.equal(saved.trace_id, 'gw');
for (const variation of [{ unknown_seconds: 60, assessment: 'needs_data_review' },
  { is_final: false, assessment: 'provisional' }, { assessment: 'within_sla' }]) {
  const result = assess({ ...report, ...variation });
  assert.equal(result.eligible, false);
  assert.equal(run(assessment, 'Return Assessment without Draft', result).result.claim_draft, null);
}
const child = { ok: true, result: { report_id: reportId, revision: 4, claim_draft: claimText } };
const finalize = (input, items) => run(assessment, 'Return Assessment with Draft', input,
  { 'Validate Saved Assessment': saved }, items);
assert.deepEqual(finalize(child), { ok: true, result: { ...saved.result, claim_draft: claimText } });
assert.equal(finalize({ ...child, result: { ...child.result, revision: 5 } }).code, 'DEPENDENCY_ERROR');
assert.equal(finalize({ error: 'thrown' }).code, 'DEPENDENCY_ERROR');
assert.equal(finalize(child, [child, child]).code, 'DEPENDENCY_ERROR');
const staleDraft = { ok: false, code: 'STALE_REPORT', error: 'Report changed' };
assert.deepEqual(finalize(staleDraft), staleDraft);

const monitorSettings = run(monitor, 'Health Monitor Settings and Validation', { dataset: 'live', trace_id: 'gw' });
const site = { id: 'website', enabled: true, target_url: 'http://demo-site:8000/health', timeout_ms: 100, expected_status: 200 };
const started = run(monitor, 'Validate Service and Start Clock', { body: [site] },
  { 'Health Monitor Settings and Validation': monitorSettings });
assert.equal(started.checked_at, new Date(started.request_started_ms).toISOString());
for (const [response, expectedStatus, up] of [[{ statusCode: 200 }, 200, true],
  [{ statusCode: 503 }, 503, false], [{ statusCode: 200, error: 'Timeout' }, null, false]]) {
  const normalized = run(monitor, 'Normalize Live Observation', response, { 'Validate Service and Start Clock': started });
  assert.equal(normalized.p_status_code, expectedStatus);
  assert.equal(normalized.p_is_up, up);
  assert.equal(normalized.p_execution_id, execution.id);
}
assert.equal(run(monitor, 'Return Database Error', {}).code, 'DEPENDENCY_ERROR');
console.log('PASS: five workflow graphs, handoffs, gateway errors, status lookup, assessment and monitor');
