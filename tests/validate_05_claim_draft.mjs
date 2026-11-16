// Dependency-free checks of 05_Claim_Draft.json and its Code-node JS.
// Isolated logic validation, not a replacement for importing into n8n.
// Run with: node tests/validate_05_claim_draft.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const workflow = JSON.parse(fs.readFileSync(new URL('../05_Claim_Draft.json', import.meta.url), 'utf8'));
const nodes = new Map(workflow.nodes.map(n => [n.name, n]));
let assertions = 0;
function check(value, message) { assert.ok(value, message); assertions++; }

function run(name, input, references = {}) {
  const node = nodes.get(name);
  let code = node.parameters.jsCode;
  if (name === 'Settings and Validation' && references.__configuredUrl) {
    code = code.replace('https://YOUR_PROJECT_REF.supabase.co', references.__configuredUrl);
  }
  const get = nodeName => ({ first: () => ({ json: references[nodeName] }) });
  return new Function('$input', '$', '$execution', code)(
    { first: () => ({ json: input }) }, get, { id: 'test-execution-123' }
  )[0].json;
}

function expression(source, input, references = {}) {
  check(source.startsWith('={{') && source.endsWith('}}'), 'Expression wrapper');
  const get = nodeName => ({ first: () => ({ json: references[nodeName] }) });
  return new Function('$json', '$', `return (${source.slice(3, -2)});`)(input, get);
}

const REPORT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SNAP = {
  provider_name: 'Fictional Hosting Ltd',
  name: 'SLA Guard demo website',
  contract_reference: 'FICTIONAL-DEMO-SLA-v1',
  monthly_fee: 100,
  credit_pct: 10,
  sla_target_pct: 99.9,
};
const DEMO_REPORT = {
  is_final: true,
  unknown_seconds: 0,
  assessment: 'breach_detected',
  contract_snapshot: SNAP,
  candidate_credit_pct: 10,
  candidate_credit_amount: 10,
  currency: 'USD',
  down_seconds: 7200,
  estimated_monthly_availability_pct: 99.731183,
  month: '2026-10',
};
const SETTINGS_OK = {
  ok: true,
  supabase_url: 'https://test-project.supabase.co',
  service_id: 'website',
  report_id: REPORT_ID,
  revision: 1,
  dataset: 'demo',
  trace_id: 'test-1',
};

check(nodes.size === workflow.nodes.length, 'Unique node names');
check(new Set(workflow.nodes.map(n => n.id)).size === workflow.nodes.length, 'Unique node IDs');
check(workflow.active === false, 'Import is inactive');
check(workflow.settings.timezone === 'UTC', 'UTC billing');
check(workflow.settings.callerPolicy === 'workflowsFromSameOwner', 'Callable by same-owner workflow 04');

const required = [
  'When Executed by Another Workflow',
  'Settings and Validation',
  'Request Valid?',
  'Load Saved Report',
  'Evaluate Saved Report',
  'Report Eligible?',
  'Save Claim Draft',
  'Confirm Saved Draft',
  'Saved OK?',
  'Return Success',
  'Return Error',
];
for (const name of required) check(nodes.has(name), 'Required node: ' + name);

const trigger = nodes.get('When Executed by Another Workflow');
check(trigger.type === 'n8n-nodes-base.executeWorkflowTrigger', 'Sub-workflow trigger');
check(trigger.typeVersion === 1.1, 'Trigger version 1.1');
const fields = Object.fromEntries(trigger.parameters.workflowInputs.values.map(v => [v.name, v.type]));
check(fields.report_id === 'string' && fields.dataset === 'string' && fields.trace_id === 'string', 'String inputs');
check(fields.revision === 'number', 'Numeric revision input');

for (const node of workflow.nodes) {
  if (node.type.endsWith('.code')) {
    new Function('$input', '$', '$execution', node.parameters.jsCode);
    assertions++;
  }
  check(!node.credentials, 'No credential IDs or secrets exported');
  const blob = JSON.stringify(node);
  check(!/sb_secret_/.test(blob), 'No Supabase secret in node');
}

for (const [name, outputs] of Object.entries(workflow.connections)) {
  check(nodes.has(name), 'Connection source exists: ' + name);
  for (const port of outputs.main) {
    for (const destination of port || []) {
      check(nodes.has(destination.node), 'Connection destination exists: ' + destination.node);
    }
  }
}

function destinations(name, port = 0) {
  return (workflow.connections[name]?.main?.[port] || []).map(d => d.node);
}
check(destinations('Request Valid?', 0).includes('Load Saved Report'), 'Valid request loads report');
check(destinations('Request Valid?', 1).includes('Return Error'), 'Invalid request returns error');
check(destinations('Load Saved Report', 0).includes('Evaluate Saved Report'), 'GET success evaluates');
check(destinations('Load Saved Report', 1).includes('Return Error'), 'GET error output returns error');
check(destinations('Report Eligible?', 0).includes('Save Claim Draft'), 'Eligible report is saved');
check(destinations('Report Eligible?', 1).includes('Return Error'), 'Ineligible returns error');
check(destinations('Save Claim Draft', 0).includes('Confirm Saved Draft'), 'PATCH success confirms');
check(destinations('Save Claim Draft', 1).includes('Return Error'), 'PATCH error output returns error');
check(destinations('Saved OK?', 0).includes('Return Success'), 'Confirmed save returns success');
check(destinations('Saved OK?', 1).includes('Return Error'), 'Failed confirm returns error');
check(!workflow.connections['Return Success'], 'Success is a terminal node');
check(!workflow.connections['Return Error'], 'Error is a terminal node');

for (const name of ['Load Saved Report', 'Save Claim Draft']) {
  const n = nodes.get(name);
  check(n.retryOnFail === true && n.maxTries === 3, 'HTTP retries: ' + name);
  check(n.onError === 'continueErrorOutput', 'HTTP error output: ' + name);
  check(n.parameters.genericAuthType === 'httpHeaderAuth', 'Header Auth credential type: ' + name);
  check(n.parameters.options.response.response.fullResponse === true, 'Full response: ' + name);
  check(!n.credentials, 'Credential left unbound: ' + name);
}
check(nodes.get('Save Claim Draft').parameters.method === 'PATCH', 'Save uses PATCH');
const prefer = nodes.get('Save Claim Draft').parameters.headerParameters.parameters.find(h => h.name === 'Prefer');
check(prefer?.value === 'return=representation', 'Prefer representation on PATCH');

const settingsNode = nodes.get('Settings and Validation');
check(settingsNode.parameters.jsCode.includes("supabaseUrl: 'https://YOUR_PROJECT_REF.supabase.co'"), 'Placeholder Project URL');

const loadUrl = expression(
  nodes.get('Load Saved Report').parameters.url,
  SETTINGS_OK,
  { 'Settings and Validation': SETTINGS_OK }
);
check(loadUrl === 'https://test-project.supabase.co/rest/v1/sg_reports', 'GET URL');
const loadId = expression(
  nodes.get('Load Saved Report').parameters.queryParameters.parameters[0].value,
  SETTINGS_OK,
  { 'Settings and Validation': SETTINGS_OK }
);
check(loadId === 'eq.' + REPORT_ID, 'GET id filter');

const evalOk = {
  ok: true,
  supabase_url: SETTINGS_OK.supabase_url,
  report_id: REPORT_ID,
  revision: 1,
  dataset: 'demo',
  claim_draft: 'SLA GUARD CLAIM DRAFT',
};
const patchBody = expression(nodes.get('Save Claim Draft').parameters.jsonBody, evalOk);
check(Object.keys(patchBody).length === 1 && patchBody.claim_draft === evalOk.claim_draft, 'PATCH body is only claim_draft');
const patchRevision = expression(nodes.get('Save Claim Draft').parameters.queryParameters.parameters[1].value, evalOk);
check(patchRevision === 'eq.1', 'PATCH revision filter');

const validInput = { report_id: REPORT_ID, revision: 1, dataset: 'demo', trace_id: 'test-1' };
const configured = run('Settings and Validation', validInput, { __configuredUrl: 'https://test-project.supabase.co' });
check(configured.ok === true && configured.supabase_url === 'https://test-project.supabase.co', 'Configured URL accepted');
check(configured.service_id === 'website' && configured.revision === 1, 'Validated fields');
check(expression(nodes.get('Request Valid?').parameters.output, configured) === 0, 'Valid request uses continue output');

const placeholder = run('Settings and Validation', validInput);
check(placeholder.ok === false && placeholder.code === 'DEPENDENCY_ERROR', 'Placeholder URL is DEPENDENCY_ERROR');
check(expression(nodes.get('Request Valid?').parameters.output, placeholder) === 1, 'Placeholder never calls HTTP');

const coerced = run('Settings and Validation', { ...validInput, revision: '2' }, { __configuredUrl: 'https://test-project.supabase.co' });
check(coerced.ok === true && coerced.revision === 2, 'Numeric revision string is coerced');

for (const [label, body] of [
  ['bad uuid', { ...validInput, report_id: 'not-a-uuid' }],
  ['zero revision', { ...validInput, revision: 0 }],
  ['negative revision', { ...validInput, revision: -1 }],
  ['float revision', { ...validInput, revision: 1.5 }],
  ['bad dataset', { ...validInput, dataset: 'staging' }],
  ['empty trace', { ...validInput, trace_id: '   ' }],
  ['missing report_id', { revision: 1, dataset: 'demo', trace_id: 'x' }],
]) {
  const s = run('Settings and Validation', body, { __configuredUrl: 'https://test-project.supabase.co' });
  check(s.ok === false && s.code === 'INVALID_REQUEST', 'Invalid input: ' + label);
  const routed = expression(nodes.get('Request Valid?').parameters.output, s);
  check(routed === 1, 'Invalid input routes to error: ' + label);
}

function evaluate(body, settings = SETTINGS_OK) {
  return run('Evaluate Saved Report', { statusCode: 200, body }, { 'Settings and Validation': settings });
}

const missing = evaluate([]);
check(missing.ok === false && missing.code === 'REPORT_NOT_FOUND', 'Empty array is REPORT_NOT_FOUND');

const stale = evaluate([{ id: REPORT_ID, revision: 2, report: DEMO_REPORT, claim_draft: 'old' }]);
check(stale.ok === false && stale.code === 'STALE_REPORT', 'Revision mismatch is STALE_REPORT');

for (const [label, report] of [
  ['within sla', { ...DEMO_REPORT, assessment: 'within_sla' }],
  ['unknown time', { ...DEMO_REPORT, unknown_seconds: 60 }],
  ['not final', { ...DEMO_REPORT, is_final: false }],
]) {
  const r = evaluate([{ id: REPORT_ID, revision: 1, report, claim_draft: 'old' }]);
  check(r.ok === false && r.code === 'NOT_ELIGIBLE', 'Not eligible: ' + label);
}

for (const [label, report] of [
  ['no snapshot', { ...DEMO_REPORT, contract_snapshot: null }],
  ['no credit amount', { ...DEMO_REPORT, candidate_credit_amount: null }],
  ['no credit pct', { ...DEMO_REPORT, candidate_credit_pct: null }],
]) {
  const r = evaluate([{ id: REPORT_ID, revision: 1, report, claim_draft: 'old' }]);
  check(r.ok === false && r.code === 'DEPENDENCY_ERROR', 'Dependency: ' + label);
}

const oddShape = evaluate({ not: 'an array' });
check(oddShape.ok === false && oddShape.code === 'DEPENDENCY_ERROR', 'Unexpected GET shape is DEPENDENCY_ERROR');

const draftOnce = evaluate([{ id: REPORT_ID, revision: 1, report: DEMO_REPORT, claim_draft: 'old' }]);
const draftTwice = evaluate([{ id: REPORT_ID, revision: 1, report: DEMO_REPORT, claim_draft: 'old' }]);
check(draftOnce.ok === true, 'Eligible demo report builds a draft');
check(draftOnce.claim_draft === draftTwice.claim_draft, 'Repeated runs yield identical text');
const lines = draftOnce.claim_draft.split('\n');
check(lines[0] === 'SLA GUARD CLAIM DRAFT', 'Exact first line');
check(lines[1] === 'DEMO ONLY - SYNTHETIC EVIDENCE', 'Demo banner is second line');
check(draftOnce.claim_draft.includes('120 minutes'), '120 minutes downtime');
check(draftOnce.claim_draft.includes('(7200 seconds)'), '7200 seconds downtime');
check(draftOnce.claim_draft.includes('10.00 USD'), 'USD 10.00 credit');
check(draftOnce.claim_draft.includes('99.731183%'), 'October 2026 availability');
check(draftOnce.claim_draft.includes('SYNTHETIC DATA'), 'Demo synthetic warning');
check(!Object.hasOwn(draftOnce, 'action') && !Object.hasOwn(draftOnce, 'execution_id'), 'Evaluate omits gateway fields');
check(expression(nodes.get('Report Eligible?').parameters.output, draftOnce) === 0, 'Eligible uses save output');

const liveSettings = { ...SETTINGS_OK, dataset: 'live' };
const liveDraft = evaluate([{ id: REPORT_ID, revision: 1, report: { ...DEMO_REPORT, month: '2026-10' }, claim_draft: 'old' }], liveSettings);
check(!liveDraft.claim_draft.includes('DEMO ONLY - SYNTHETIC EVIDENCE'), 'Live draft has no demo banner');
check(!liveDraft.claim_draft.includes('SYNTHETIC DATA'), 'Live draft has no synthetic warning');
check(liveDraft.claim_draft.startsWith('SLA GUARD CLAIM DRAFT\nStatus: DRAFT FOR HUMAN REVIEW - NOT SUBMITTED\n'), 'Live second line is status');

const confirmOk = run('Confirm Saved Draft', {
  statusCode: 200,
  body: [{ id: REPORT_ID, revision: 1, claim_draft: draftOnce.claim_draft }],
}, { 'Evaluate Saved Report': draftOnce });
check(confirmOk.ok === true && confirmOk.report_id === REPORT_ID && confirmOk.revision === 1, 'Confirm accepts one matching row');

const zeroRows = run('Confirm Saved Draft', { statusCode: 200, body: [] }, { 'Evaluate Saved Report': draftOnce });
check(zeroRows.ok === false && zeroRows.code === 'STALE_REPORT', 'Zero updated rows is STALE_REPORT');

const mismatch = run('Confirm Saved Draft', {
  statusCode: 200,
  body: [{ id: REPORT_ID, revision: 1, claim_draft: 'different' }],
}, { 'Evaluate Saved Report': draftOnce });
check(mismatch.ok === false && mismatch.code === 'DEPENDENCY_ERROR', 'Mismatched PATCH body is DEPENDENCY_ERROR');

const success = run('Return Success', confirmOk);
check(success.ok === true, 'Success envelope ok');
check(success.result.report_id === REPORT_ID && success.result.revision === 1, 'Success result ids');
check(success.result.claim_draft === draftOnce.claim_draft, 'Success includes draft');
check(!Object.hasOwn(success, 'action') && !Object.hasOwn(success, 'execution_id'), 'Success omits action and execution_id');
check(Object.keys(success).join(',') === 'ok,result', 'Success keys only ok and result');
check(Object.keys(success.result).sort().join(',') === 'claim_draft,report_id,revision', 'Result keys');

for (const code of ['INVALID_REQUEST', 'REPORT_NOT_FOUND', 'STALE_REPORT', 'NOT_ELIGIBLE', 'DEPENDENCY_ERROR']) {
  const out = run('Return Error', { ok: false, code, error: 'detail' });
  check(out.ok === false && out.code === code && out.error === 'detail', 'Return Error preserves ' + code);
  check(!Object.hasOwn(out, 'action') && !Object.hasOwn(out, 'execution_id'), 'Error omits gateway fields: ' + code);
}

const httpFail = run('Return Error', { error: { message: 'connect ECONNREFUSED' } });
check(httpFail.ok === false && httpFail.code === 'DEPENDENCY_ERROR', 'HTTP error output maps to DEPENDENCY_ERROR');
check(httpFail.error.includes('ECONNREFUSED'), 'HTTP error message preserved');

console.log(`PASS: ${assertions} workflow 05 structure, expression and Code-node assertions`);
