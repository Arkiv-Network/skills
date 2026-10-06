import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {repositoryRoot} from '../../scripts/build-plugin.mjs';
import {readSnippets} from '../../scripts/extract-snippets.mjs';
import {frontmatter} from '../../scripts/check-static.mjs';
import {checkMcp} from '../../scripts/check-mcp.mjs';

const {files} = await readSnippets(repositoryRoot);
const commit = 'a'.repeat(40), raw = `https://raw.githubusercontent.com/Arkiv-Network/skills/${commit}/`;
const verificationToken = 'fixture-only-not-a-real-verification-credential';
const fixtureEnv = {VERIFICATION_TOKEN: verificationToken};
const source = new Map(await Promise.all(files.map(async file => [raw + file.file, await readFile(path.join(repositoryRoot, file.file), 'utf8')])));
const names = await Promise.all(files.filter(file => /^skills\/[^/]+\/SKILL\.md$/.test(file.file)).map(async file => frontmatter(await readFile(path.join(repositoryRoot, file.file), 'utf8')).name));
const entries = files.filter(file => /^skills\/[^/]+\/SKILL\.md$/.test(file.file)).map(file => ({id: `skills/${file.file.split('/')[1]}/skill`,
  sdk: ['0.8.1'], network: 'Tiramisu', source: {url: raw + file.file, version: commit, digest: file.sha256}}));
function fixture(options = {}) {
  const calls = [], reads = []; let initialized = false;
  const tools = ['server_status', 'list_skills', 'submit_feedback', 'model_entities', 'sign_transaction'].map(name => ({name, inputSchema: {type: 'object', properties: {}}}));
  if (options.required) tools.find(item => item.name === 'list_skills').inputSchema.required = ['private_input'];
  const request = async (url, init) => {
    if (init.method === 'GET') {
      assert.equal(new Headers(init.headers).has('x-arkiv-verification'), false);
      reads.push(url); if (options.source404) return new Response('not available', {status: 404});
      assert.ok(source.has(url));
      return new Response(options.badReference && url.includes('/references/') || options.badSkill && url.endsWith('/SKILL.md') ? 'changed bytes' : source.get(url));
    }
    const body = JSON.parse(init.body); calls.push(body);
    assert.equal(url, 'https://mcp.arkiv.network/'); assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('x-arkiv-verification'), verificationToken);
    if (options.quota) return new Response('ignored provider text', {status: 429, headers: {'retry-after': '1700'}});
    if (options.timeout) throw new Error('Private provider error must not reach evidence');
    if (body.method !== 'initialize') assert.equal(init.headers['Mcp-Session-Id'], 'synthetic-session');
    if (body.method === 'notifications/initialized') {
      assert.equal(body.id, undefined); initialized = true;
      return options.badNotification ? new Response('{}', {status: 200}) : new Response(null, {status: 202});
    }
    let result;
    if (body.method === 'initialize') result = {protocolVersion: options.newProtocol ? '2025-11-25' : '2025-03-26',
      serverInfo: {name: 'arkiv-general', version: '1.1.7'}, capabilities: {tools: {}, prompts: {}}};
    else {
      assert.equal(initialized, true);
      if (body.method === 'tools/list') result = options.paginated && !body.params.cursor ? {tools: tools.slice(0, 2), nextCursor: 'next'}
        : {tools: options.paginated ? tools.slice(2) : tools};
      else if (body.method === 'prompts/list') result = {prompts: [{name: 'start'}, {name: 'apply_skill'}]};
      else if (body.method === 'tools/call') {
        assert.ok(['server_status', 'list_skills'].includes(body.params.name)); assert.deepEqual(body.params.arguments, {});
        const data = body.params.name === 'server_status' ? {serverVersion: '1.1.7', trafficClass: options.trafficClass ?? 'verification'} : options.entries ?? entries;
        result = {content: [{type: 'text', text: JSON.stringify(data)}]};
      } else assert.fail('Unexpected protocol method');
    }
    if (options.badInitialize && body.method === 'initialize') delete result.serverInfo;
    if (options.reflectToken) result = {reflected: verificationToken};
    const message = {jsonrpc: '2.0', id: options.wrongId ? body.id + 1 : body.id, result};
    const headers = {'content-type': options.sse ? 'text/event-stream' : 'application/json', 'mcp-session-id': 'synthetic-session'};
    if (options.sse) return new Response('event: message\ndata: ' + JSON.stringify({jsonrpc: '2.0', method: 'notifications/tools/list_changed'}) + '\n\n'
      + 'event: message\ndata: ' + JSON.stringify(message) + '\n\n', {headers});
    return Response.json(message, {headers});
  };
  return {request, calls, reads};
}

test('MCP producer imports without RPC and complete immutable published bytes bind every current skill', async () => {
  let network = 0; const original = globalThis.fetch; globalThis.fetch = () => {network++; throw new Error();};
  try {await import(pathToFileURL(path.join(repositoryRoot, 'scripts/check-mcp.mjs')).href + '?side-effect-check');}
  finally {globalThis.fetch = original;}
  const transport = fixture(), report = await checkMcp({request: transport.request, env: fixtureEnv});
  assert.equal(network, 0); assert.equal(report.result, 'PASS'); assert.equal(report.executionMode, 'synthetic_transport');
  assert.deepEqual(report.sourceFiles.slice().sort((a, b) => a.file.localeCompare(b.file)), files.slice().sort((a, b) => a.file.localeCompare(b.file)));
  assert.equal(report.cases.filter(test => test.id === 'published-skill-source' && test.status === 'PASS').length, names.length);
  assert.ok(transport.calls.filter(call => call.method === 'tools/call').every(call => ['server_status', 'list_skills'].includes(call.params.name)));
  assert.equal(report.signing, false); assert.equal(report.submission, false);
  assert.equal(report.trafficClass, 'verification');
  assert.ok(transport.calls.findIndex(call => call.method === 'tools/call' && call.params.name === 'server_status') < transport.calls.findIndex(call => call.method === 'tools/list'));
  assert.equal(transport.calls.filter(call => call.method === 'tools/call' && call.params.name === 'server_status').length, 1);
  assert.ok(!JSON.stringify(report).includes(verificationToken));
  assert.ok(!JSON.stringify(report).includes('synthetic-session'));
});

test('SSE, negotiated supported version, notification ordering and paginated discovery preserve byte verification', async () => {
  const transport = fixture({sse: true, paginated: true, newProtocol: true}), report = await checkMcp({request: transport.request, env: fixtureEnv});
  assert.equal(report.result, 'PASS'); assert.equal(report.protocolVersion, '2025-11-25');
  assert.equal(transport.calls.filter(call => call.method === 'tools/list').length, 2);
});

test('a historical partial catalog passes protocol but current skills remain skipped without claimed source hashes', async () => {
  const legacy = entries.filter(entry => entry.id.includes('arkiv-best-practices') || entry.id.includes('arkiv-feedback'))
    .map(entry => ({...entry, source: {...entry.source, digest: 'b'.repeat(64)}, recommended: false, executionCompatible: false}));
  const transport = fixture({entries: legacy}), report = await checkMcp({request: transport.request, env: fixtureEnv});
  assert.equal(report.result, 'SKIPPED'); assert.equal(report.cases[0].status, 'PASS'); assert.deepEqual(report.sourceFiles, []);
  assert.ok(report.cases.slice(1).every(test => test.status === 'SKIPPED')); assert.equal(transport.reads.length, 0);
});

test('claimed matching digest cannot certify changed published skill or reference bytes', async () => {
  for (const options of [{badSkill: true}, {badReference: true}]) {
    const report = await checkMcp({request: fixture(options).request, env: fixtureEnv});
    assert.equal(report.result, 'SKIPPED');
    const affected = report.cases.filter(test => test.id === 'published-skill-source' && test.status === 'SKIPPED').map(test => test.skill);
    assert.ok(affected.length > 0);
    assert.ok(report.sourceFiles.every(file => !affected.includes(file.file.split('/')[1])));
  }
});

test('SDK/network mismatch and untrusted or unpinned source URLs fail closed before GET', async () => {
  for (const mutate of [entry => ({...entry, sdk: ['0.7.0']}), entry => ({...entry, network: 'Sorbet'}),
    entry => ({...entry, source: {...entry.source, url: 'https://localhost/private'}}),
    entry => ({...entry, source: {...entry.source, version: 'main'}})]) {
    const transport = fixture({entries: entries.map(mutate)}), report = await checkMcp({request: transport.request, env: fixtureEnv});
    assert.equal(report.result, 'SKIPPED'); assert.deepEqual(report.sourceFiles, []); assert.equal(transport.reads.length, 0);
  }
});

test('schema changes requiring inputs never cause a readonly tool to receive invented/private arguments', async () => {
  const transport = fixture({required: true}), report = await checkMcp({request: transport.request, env: fixtureEnv});
  assert.equal(report.result, 'SKIPPED'); assert.equal(report.reason, 'READONLY_TOOL_INPUT_REVIEW_REQUIRED');
  assert.equal(transport.calls.filter(call => call.method === 'tools/call' && call.params.name === 'list_skills').length, 0);
});

test('observed malformed initialization, response IDs and initialized acknowledgement are protocol failures', async () => {
  for (const options of [{badInitialize: true}, {wrongId: true}, {badNotification: true}]) {
    const report = await checkMcp({request: fixture(options).request, env: fixtureEnv});
    assert.equal(report.result, 'FAIL'); assert.equal(report.cases[0].status, 'FAIL'); assert.deepEqual(report.sourceFiles, []);
    assert.equal(report.cases[0].evidence.scope, 'transport_protocol');
  }
});

test('429 and timeout stop without retries and expose only sanitized operational codes', async () => {
  for (const options of [{quota: true}, {timeout: true}]) {
    const transport = fixture(options), report = await checkMcp({request: transport.request, env: fixtureEnv});
    assert.equal(report.result, 'SKIPPED'); assert.equal(report.operational, true); assert.equal(transport.calls.length, 1);
    assert.ok(!JSON.stringify(report).includes('Private provider error')); assert.ok(!JSON.stringify(report).includes('ignored provider text'));
    if (options.quota) {assert.equal(report.httpStatus, 429); assert.equal(report.retryAfter, '1700 seconds');}
  }
});

test('public source unavailability remains skipped after successful protocol and confers no byte custody', async () => {
  const report = await checkMcp({request: fixture({source404: true}).request, env: fixtureEnv});
  assert.equal(report.result, 'SKIPPED'); assert.equal(report.operational, true); assert.equal(report.cases[0].status, 'PASS');
  assert.deepEqual(report.sourceFiles, []);
});

test('missing or invalid operator credential makes zero gateway or source requests', async () => {
  for (const token of [undefined, '', 'short', 'a'.repeat(257), 'a'.repeat(32) + '\n']) {
    const transport = fixture(), report = await checkMcp({request: transport.request, env: {VERIFICATION_TOKEN: token}});
    assert.equal(report.result, 'SKIPPED'); assert.equal(report.reason, 'OPERATOR_VERIFICATION_TOKEN_REQUIRED');
    assert.equal(report.operational, true); assert.deepEqual(report.rpcTrace, []); assert.deepEqual(report.sourceFiles, []);
    assert.equal(transport.calls.length + transport.reads.length, 0);
    assert.equal(report.cases.filter(test => test.id === 'published-skill-source' && test.status === 'SKIPPED').length, names.length);
  }
});

test('unmarked traffic stops after acknowledgement before discovery or published-source requests', async () => {
  const transport = fixture({trafficClass: 'live'}), report = await checkMcp({request: transport.request, env: fixtureEnv});
  assert.equal(report.result, 'SKIPPED'); assert.equal(report.reason, 'OPERATOR_VERIFICATION_NOT_CONFIRMED');
  assert.equal(transport.calls.length, 3); assert.equal(transport.reads.length, 0); assert.deepEqual(report.sourceFiles, []);
  assert.deepEqual(transport.calls.map(call => call.method), ['initialize', 'notifications/initialized', 'tools/call']);
  assert.equal(transport.calls[2].params.name, 'server_status'); assert.equal(report.discovery, undefined);
});

test('reflected verification credential is not persisted and closes the check', async () => {
  const transport = fixture({reflectToken: true}), report = await checkMcp({request: transport.request, env: fixtureEnv});
  assert.equal(report.result, 'SKIPPED'); assert.equal(report.reason, 'VERIFICATION_CREDENTIAL_REFLECTED');
  assert.equal(transport.calls.length, 1); assert.equal(transport.reads.length, 0); assert.equal(report.discovery, undefined);
  assert.ok(!JSON.stringify(report).includes(verificationToken)); assert.deepEqual(report.sourceFiles, []);
});
