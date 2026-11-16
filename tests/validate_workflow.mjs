// Dependency-free checks of the exported workflow and its actual Code-node JS.
// This is isolated logic validation, not a replacement for importing into n8n.
// Run with: node tests/validate_workflow.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const workflow = JSON.parse(fs.readFileSync(new URL('../SLA_Guard_Workflow.json', import.meta.url), 'utf8'));
const nodes = new Map(workflow.nodes.map(n => [n.name, n]));
let assertions = 0;
function check(value, message) { assert.ok(value, message); assertions++; }
function run(name, input, references = {}) {
  const code = nodes.get(name).parameters.jsCode.replace('https://YOUR_PROJECT_REF.supabase.co', 'https://test-project.supabase.co');
  const get = nodeName => ({ first: () => ({ json: references[nodeName] }) });
  return new Function('$input', '$', '$execution', code)(
    { first: () => ({ json: input }) }, get, { id: 'test-execution-123' }
  )[0].json;
}
function request(body) { return run('Settings and Request', { headers: {}, body }); }
function expression(source, input, references = {}) {
  check(source.startsWith('={{') && source.endsWith('}}'), 'Expression wrapper');
  const get = nodeName => ({ first: () => ({ json: references[nodeName] }) });
  return new Function('$json', '$', `return (${source.slice(3,-2)});`)(input, get);
}

check(nodes.size === workflow.nodes.length, 'Unique node names');
check(new Set(workflow.nodes.map(n => n.id)).size === workflow.nodes.length, 'Unique node IDs');
check(workflow.active === false, 'Import is inactive');
check(workflow.settings.timezone === 'UTC', 'UTC billing');
for (const node of workflow.nodes) {
  if (node.type.endsWith('.code')) {
    new Function('$input', '$', '$execution', node.parameters.jsCode);
    assertions++;
  }
  check(!node.credentials, 'No credential IDs or secrets exported');
}
for (const [name, outputs] of Object.entries(workflow.connections)) {
  check(nodes.has(name), 'Connection source exists');
  for (const port of outputs.main) for (const destination of port) {
    check(nodes.has(destination.node), 'Connection destination exists');
  }
}

for (const action of ['check','status','report']) {
  const s = request({ action });
  check(!s.validation_error, 'Valid request: ' + action);
  check(s.from_webhook === true, 'Webhook detection');
  const route = expression(nodes.get('Route Action').parameters.output, s);
  check(route === { check:0, status:1, report:2 }[action], 'Action output mapping');
}
for (const body of [
  { action:'unknown' }, { action:'report', month:'2026-13' },
  { action:'report', month:'2999-01' }, { action:'report', month:null },
  { action:'report', month:'2026-1' }, { action:'check', dataset:'demo' },
  { action:'status', dataset:'x' }, { action:'status', month:'2024-01' },
  { action:'check', target_url:'http://unexpected' }, 'not-json', [], null
]) {
  // Explicit null month uses the default (documented nullish behavior).
  if (body?.action === 'report' && body?.month === null) {
    check(!request(body).validation_error, 'Null month defaults to previous month');
    continue;
  }
  const s = request(body);
  check(Boolean(s.validation_error), 'Invalid request rejected: ' + JSON.stringify(body));
  check(expression(nodes.get('Route Action').parameters.output, s) === 3, 'Invalid requests use error output');
  const response = run('Response Envelope', s, { 'Settings and Request':s });
  check(response.http_status === 400 && response.body.ok === false, 'Invalid JSON response is 400');
}
const automatic = run('Settings and Request', { action:'check' });
check(!automatic.from_webhook, 'Schedule has no webhook response');
check(request({}).action === 'status', 'Empty webhook body safely defaults to status');
const demo = request({ action:'report', month:'2024-02', dataset:'demo' });
check(demo.month === '2024-02-01' && demo.dataset === 'demo', 'Report date and dataset');
const service = run('Start Probe', { id:'website', target_url:'http://demo-site:8000/health', enabled:true, expected_status:200 });
check(Number.isFinite(Date.parse(service.started_at)), 'Probe captures start time');
for (const bad of [{}, { id:'website', target_url:'https://example.com', enabled:false }]) {
  assert.throws(() => run('Start Probe', bad)); assertions++;
}
for (const [raw, isUp, status] of [
  [{statusCode:200, body:'healthy'},true,200], [{statusCode:503},false,503],
  [{statusCode:301},false,301], [{error:'ECONNREFUSED'},false,null],
  [{error:{message:'Timeout'}},false,null], [{body:'missing status'},false,null],
]) {
  const result = run('Normalize Check', raw, { 'Start Probe':service, 'Settings and Request':automatic });
  check(result.p_is_up === isUp && result.p_status_code === status, 'Probe normalization');
  check(result.p_execution_id === 'test-execution-123' && result.p_response_ms >= 0, 'Trace and elapsed time');
  check(isUp ? result.p_error === null : Boolean(result.p_error), 'Down evidence carries a reason');
}
const long = run('Normalize Check', {error:'x'.repeat(2000)}, { 'Start Probe':service, 'Settings and Request':automatic });
check(long.p_error.length === 500, 'Error length bounded');

const probe = nodes.get('Probe Website');
check(probe.onError === 'continueRegularOutput' && probe.retryOnFail === false, 'Probe failures are observable');
check(probe.parameters.options.response.response.neverError === true, 'HTTP 503 does not abort evidence collection');
check(probe.parameters.options.redirect.redirect.followRedirects === false, 'Redirect policy explicit');
for (const name of ['Load Service','Save Check','Get Status','Build Monthly Report']) {
  const n = nodes.get(name);
  check(n.retryOnFail === true && n.maxTries === 3 && !n.onError, 'Database failures retry then stop');
  check(n.parameters.genericAuthType === 'httpHeaderAuth', 'Backend key is a credential');
}
for (const [name, refs, input] of [
  ['Save Check',{'Settings and Request':automatic},{p_service_id:'website'}],
  ['Get Status',{'Settings and Request':automatic},{}],
  ['Build Monthly Report',{'Settings and Request':demo},{}],
]) {
  const body = expression(nodes.get(name).parameters.jsonBody,input,refs);
  check(body.p_service_id === 'website', 'RPC service ID');
  const url = expression(nodes.get(name).parameters.url,input,refs);
  check(url.startsWith('https://test-project.supabase.co/rest/v1/rpc/'), 'RPC URL');
}
check(nodes.get('Authenticated Webhook').parameters.authentication === 'headerAuth', 'Webhook authentication mandatory');
check(nodes.get('Authenticated Webhook').parameters.responseMode === 'responseNode', 'Webhook waits for real result');
check(nodes.get('Monthly at 00-05 UTC').parameters.rule.interval[0].expression === '0 5 0 1 * *', 'Monthly cron at 00:05 UTC');
console.log(`PASS: ${assertions} workflow structure, expression and Code-node assertions`);
