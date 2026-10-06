import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp, readFile, writeFile, mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {repositoryRoot} from '../../scripts/build-plugin.mjs';
import {checkRpc, runRpcCheck} from '../../scripts/check-rpc.mjs';

const workspace = process.env.ARKIV_SNIPPET_WORKSPACE ?? path.join(repositoryRoot, 'tests/snippets');
const endpoint = 'https://rpc.tiramisu.db-chain.testnet.arkiv.network';
const secret = 'fixture-private-data-never-report-this';
function fixture(options = {}) {
  const calls = [];
  const request = async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    assert.equal(url, endpoint); assert.equal(init.redirect, 'error');
    assert.deepEqual([...new Headers(init.headers).keys()].sort(), ['accept', 'content-type']);
    assert.deepEqual(body.params, []); assert.ok(['eth_chainId', 'eth_blockNumber'].includes(body.method));
    if (options.quota && (!options.afterIdentity || body.method === 'eth_blockNumber')) return new Response(secret, {status: 429, headers: {'retry-after': options.retry ?? '1700'}});
    if (options.http) return new Response(secret, {status: options.http});
    if (options.reject) throw new Error(secret);
    if (options.pending) return new Promise(() => {});
    if (options.pendingBody) return new Response(new ReadableStream({start(controller) {
      init.signal.addEventListener('abort', () => controller.close(), {once: true});
    }}));
    if (options.bytes) return new Response(new Uint8Array(options.bytes));
    if (options.invalidUtf8) return new Response(new Uint8Array([255]));
    if (options.malformed) return new Response(secret);
    const message = {jsonrpc: '2.0', id: options.wrongId ? body.id + 1 : body.id,
      result: body.method === 'eth_chainId' ? options.chain ?? '0x7614d1' : options.block ?? '0x357c8'};
    if (options.error) {delete message.result; message.error = options.error;}
    if (options.both) message.error = {code: -32000, message: secret};
    return Response.json(options.array ? [message] : message);
  };
  return {request, calls};
}
const run = options => {const transport = fixture(options); return checkRpc({workspace, request: transport.request,
  env: {ARKIV_PRIVATE_KEY: secret, ARKIV_ACCESS_KEY: secret, ARKIV_RPC_URL: 'https://unreviewed.invalid/'}}).then(report => ({report, calls: transport.calls}));};

test('RPC producer import is side-effect free and sends only two pinned anonymous reads', async () => {
  let invoked = 0; const original = globalThis.fetch;
  globalThis.fetch = () => {invoked++; throw new Error('Unexpected import request');};
  try {await import(pathToFileURL(path.join(repositoryRoot, 'scripts/check-rpc.mjs')).href + '?import-no-network');}
  finally {globalThis.fetch = original;}
  assert.equal(invoked, 0);
  const {report, calls} = await run();
  assert.equal(report.result, 'PASS'); assert.equal(report.executionMode, 'synthetic_transport');
  assert.equal(report.kind, 'network_diagnostic'); assert.equal(report.sdk, '0.8.1');
  assert.deepEqual(report.chain, {name: 'tiramisu', id: 7738577});
  assert.deepEqual(calls.map(x => [x.method, x.id]), [['eth_chainId', 1], ['eth_blockNumber', 2]]);
  assert.deepEqual(report.cases.map(x => x.status), ['PASS', 'PASS']);
  assert.match(report.sourceBinding.configuration.sha256, /^[a-f0-9]{64}$/);
  assert.match(report.sourceBinding.chainDeclarationSha256, /^[a-f0-9]{64}$/);
  assert.equal(report.signing, false); assert.equal(report.submission, false);
  assert.equal(report.cases.some(x => x.skill || x.skills), false);
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(JSON.stringify(report).includes('unreviewed.invalid'), false);
});

test('invalid request bounds stop the default transport before any network execution', async () => {
  const report = await checkRpc({workspace, timeoutMs: 0});
  assert.equal(report.executionMode, 'rpc_readonly');
  assert.equal(report.result, 'FAIL'); assert.equal(report.reason, 'INVALID_REQUEST_TIME_BOUND');
  assert.deepEqual(report.requests, []);
  assert.equal(report.scope.includes('no skill'), true);
});

test('wrong chain fails before reading a head', async () => {
  const {report, calls} = await run({chain: '0x7590bf'});
  assert.equal(report.result, 'FAIL'); assert.equal(report.reason, 'RPC_CHAIN_ID_MISMATCH');
  assert.deepEqual(calls.map(x => x.method), ['eth_chainId']);
  assert.deepEqual(report.cases.map(x => x.status), ['FAIL', 'SKIPPED']);
});

test('invalid JSON, IDs, envelope shape and numeric encoding are confirmed failures', async () => {
  for (const options of [{malformed: true}, {wrongId: true}, {array: true}, {both: true}, {chain: '0x07614d1'}, {chain: 7738577}, {chain: '0x' + 'f'.repeat(17)}, {invalidUtf8: true}]) {
    const {report, calls} = await run(options);
    assert.equal(report.result, 'FAIL'); assert.equal(calls.length, 1);
    assert.equal(JSON.stringify(report).includes(secret), false);
  }
});

test('invalid head preserves identity evidence and fails the independent head case', async () => {
  const {report} = await run({block: '219080'});
  assert.equal(report.result, 'FAIL'); assert.equal(report.reason, 'INVALID_RPC_QUANTITY');
  assert.deepEqual(report.cases.map(x => x.status), ['PASS', 'FAIL']);
});

test('HTTP 429 stops without retry, retains only bounded Retry-After metadata and stays skipped', async () => {
  for (const options of [{quota: true}, {quota: true, afterIdentity: true}, {quota: true, retry: secret}]) {
    const {report, calls} = await run(options);
    assert.equal(report.result, 'SKIPPED'); assert.equal(report.reason, 'RPC_QUOTA_LIMITED');
    assert.equal(calls.length, options.afterIdentity ? 2 : 1);
    assert.equal(report.httpStatus, 429);
    assert.equal(report.retryAfterSeconds, options.retry ? undefined : 1700);
    assert.equal(JSON.stringify(report).includes(secret), false);
  }
});

test('timeouts bound both fetch and response-body reads; they never retry', async () => {
  for (const options of [{pending: true}, {pendingBody: true}]) {
    const transport = fixture(options), started = Date.now();
    const report = await checkRpc({workspace, request: transport.request, timeoutMs: 25});
    assert.equal(report.result, 'SKIPPED'); assert.equal(report.reason, 'RPC_REQUEST_TIMEOUT');
    assert.equal(transport.calls.length, 1); assert.equal(report.requests.length, 1);
    assert.ok(Date.now() - started < 1000);
  }
});

test('transport and HTTP outage errors stay skipped and do not leak provider messages', async () => {
  for (const options of [{reject: true}, {http: 503}, {error: {code: -32005, message: secret}}]) {
    const {report, calls} = await run(options);
    assert.equal(report.result, 'SKIPPED'); assert.equal(calls.length, 1);
    assert.equal(JSON.stringify(report).includes(secret), false);
  }
});

test('unsupported readonly RPC method and malformed error object are failures', async () => {
  for (const error of [{code: -32601, message: secret}, {code: 'private', message: secret}]) {
    const {report} = await run({error}); assert.equal(report.result, 'FAIL');
    assert.equal(JSON.stringify(report).includes(secret), false);
  }
});

test('response byte bound rejects an oversized successful body', async () => {
  const {report} = await run({bytes: 65537});
  assert.equal(report.result, 'FAIL'); assert.equal(report.reason, 'RPC_RESPONSE_SIZE_BOUND_EXCEEDED');
});

test('unreviewed config, SDK and export paths fail closed before any request', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'arkiv-readonly-rpc-'));
  const config = JSON.parse(await readFile(path.join(repositoryRoot, 'plugin.config.json'), 'utf8'));
  const pkgDirectory = path.join(base, 'node_modules/@arkiv-network/sdk'); await mkdir(pkgDirectory, {recursive: true});
  let calls = 0; const request = () => {calls++; throw new Error(secret);};
  for (const [nextConfig, pkg, expected] of [
    [{...config, chainId: 7706815}, {name: '@arkiv-network/sdk', version: '0.8.1'}, 'FAIL'],
    [{...config, sdkVersion: '0.8.2'}, {name: '@arkiv-network/sdk', version: '0.8.2'}, 'SKIPPED'],
    [config, {name: '@arkiv-network/sdk', version: '0.8.0'}, 'SKIPPED'],
    [config, {name: '@arkiv-network/sdk', version: '0.8.1', exports: {'./chains': {import: '../private.js'}}}, 'SKIPPED']
  ]) {
    await writeFile(path.join(base, 'plugin.config.json'), JSON.stringify(nextConfig));
    await writeFile(path.join(pkgDirectory, 'package.json'), JSON.stringify(pkg));
    const report = await checkRpc({root: base, workspace: base, request}); assert.equal(report.result, expected);
  }
  const report = await checkRpc({workspace, request, timeoutMs: 15001}); assert.equal(report.result, 'FAIL');
  assert.equal(calls, 0);
});

test('CLI output and argument admission reject repository writes before network work', async () => {
  let calls = 0; const original = globalThis.fetch; globalThis.fetch = () => {calls++; throw new Error(secret);};
  try {
    for (const args of [[], ['relative.json'], [path.join(repositoryRoot, 'network.json')], ['/external/report.json', '--workspace', 'relative']]) {
      await assert.rejects(runRpcCheck(args));
    }
  } finally {globalThis.fetch = original;}
  assert.equal(calls, 0);
});

test('CLI records a guarded failure outside the repository and never replaces existing evidence', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'arkiv-rpc-evidence-'));
  const root = path.join(base, 'repo'), output = path.join(base, 'network.json'); await mkdir(root);
  const config = JSON.parse(await readFile(path.join(repositoryRoot, 'plugin.config.json'), 'utf8'));
  await writeFile(path.join(root, 'plugin.config.json'), JSON.stringify({...config, chainId: 1}));
  let calls = 0; const original = globalThis.fetch; globalThis.fetch = () => {calls++; throw new Error(secret);};
  try {
    const report = await runRpcCheck([output], {root}); assert.equal(report.result, 'FAIL');
    const preserved = await readFile(output, 'utf8');
    await assert.rejects(runRpcCheck([output], {root}), /already exists/);
    assert.equal(await readFile(output, 'utf8'), preserved);
  } finally {globalThis.fetch = original;}
  assert.equal(calls, 0);
});

test('PR and nightly retain the network diagnostic as an independent artifact', async () => {
  for (const name of ['ci.yml', 'nightly.yml']) {
    const text = await readFile(path.join(repositoryRoot, '.github/workflows', name), 'utf8');
    assert.match(text, /node --test tests\/snippets\/rpc\.test\.mjs/);
    assert.match(text, /Record anonymous network identity and head separately\r?\n\s+if: always\(\)\r?\n\s+run: node scripts\/check-rpc\.mjs "\$ARKIV_HEALTH_DIRECTORY\/network\.json"/);
    const aggregate = text.split('\n').find(line => line.includes('run: node scripts/build-health.mjs'));
    if (aggregate) assert.equal(aggregate.includes('network.json'), false);
  }
});
