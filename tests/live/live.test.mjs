import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {repositoryRoot} from '../../scripts/build-plugin.mjs';
import {loadDependencies} from './dependencies.mjs';
import {LiveOperator, NATIVE_ADDRESS, TIRAMISU_RPC, validateEnvironment} from './operator.mjs';
import {runPublicLive} from './e2e.mjs';

const workspace = process.env.ARKIV_SNIPPET_WORKSPACE || path.join(repositoryRoot, 'tests/snippets');
const dependencies = await loadDependencies(workspace);
const key = '0x' + '1'.repeat(64); // Synthetic test-only signer, created in memory.
const account = dependencies.accounts.privateKeyToAccount(key);
const namespace = 'arkiv_live_' + 'a'.repeat(32);
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const rpcSource = (await readFile(path.join(repositoryRoot, 'tests/snippets/rpc-fixture.mjs'), 'utf8'))
  .replace(/\bfrom\s*(['"])([^'"]+)\1/g, (_, quote, specifier) => `from ${JSON.stringify(dependencies.imports[specifier])}`);
const fixtureSource = (await readFile(path.join(repositoryRoot, 'tests/live/live-fixture.mjs'), 'utf8'))
  .replace("'../snippets/rpc-fixture.mjs'", JSON.stringify(moduleUrl(rpcSource)));
const {liveFixture} = await import(moduleUrl(fixtureSource));

async function directory(context) {
  const value = await mkdtemp(path.join(process.env.ARKIV_TEST_TMPDIR || tmpdir(), 'arkiv-live-tests-'));
  context.after(() => rm(value, {recursive: true})); return value;
}
async function setup(context, {maxSpend = 10n ** 18n, accessKey = ''} = {}) {
  let operator; context.after(async () => {if (operator) await operator.close();});
  const output = await directory(context), fixture = liveFixture(dependencies, account);
  operator = new LiveOperator({account, namespace, maxSpend, journalPath: path.join(output, 'journal.jsonl'),
    sdk: dependencies.sdk, viem: dependencies.viem, request: fixture.request, accessKey});
  await operator.initialize(); return {operator, fixture, output};
}
const parameters = () => ({payload: dependencies.sdk.jsonToPayload({synthetic: true, run: namespace, name: 'test'}),
  contentType: 'application/json', attributes: {project: namespace, entity_type: 'live_note'},
  expires: dependencies.sdk.ExpirationTime.fromBlocks(300), flags: {readonly: false, permissionlessExtension: false}});
function operation(operator, {entityKey, project = namespace} = {}) {
  const v = dependencies.viem;
  if (entityKey) return {operation: 2, operationData: v.encodeAbiParameters(operator.parameters[2], [{entityKey,
    mutations: [{name: v.stringToHex('status', {size: 32}), typeId: 8, value: v.stringToHex('changed')}]}])};
  const attributes = [['$contentType', 8, v.stringToHex('application/json')], ['$payload', 7, v.stringToHex(JSON.stringify({synthetic: true, run: namespace}))], ['project', 8, v.stringToHex(project)]];
  return {operation: 1, operationData: v.encodeAbiParameters(operator.parameters[1], [{salt: 0n, expiresAt: 0n, minLifetime: 300n,
    creationFlags: 0, attributes: attributes.map(([name, typeId, value]) => ({name: v.stringToHex(name, {size: 32}), typeId, value}))}])};
}
async function signed(operator, {nonce = 0, chainId = 7738577, to = NATIVE_ADDRESS, value = 0n, operations = [operation(operator)], signer = account} = {}) {
  return signer.signTransaction({type: 'legacy', chainId, to, nonce, value, gas: 100000n, gasPrice: 1n,
    data: dependencies.viem.encodeFunctionData({abi: operator.executeAbi, functionName: 'execute', args: [operations]})});
}
const env = output => ({ARKIV_ENABLE_LIVE: 'true', ARKIV_PRIVATE_KEY: key, ARKIV_CHAIN_ID: '7738577',
  ARKIV_RPC_URL: TIRAMISU_RPC, ARKIV_MAX_SPEND_WEI: (10n ** 18n).toString(), ARKIV_HEALTH_OUTPUT: output});

test('imports have no network effect and missing/malformed environment stops before any transport', async context => {
  let calls = 0; const original = globalThis.fetch; globalThis.fetch = () => {calls++; throw new Error('Network denied');};
  try {await import(pathToFileURL(path.join(repositoryRoot, 'tests/live/e2e.mjs')).href + '?side-effect-check');}
  finally {globalThis.fetch = original;}
  const dir = await directory(context);
  const mutations = [{}, {ARKIV_ENABLE_LIVE: 'false'}, {ARKIV_PRIVATE_KEY: ''}, {ARKIV_PRIVATE_KEY: '0x' + '0'.repeat(64)},
    {ARKIV_MAX_SPEND_WEI: '0'}, {ARKIV_MAX_SPEND_WEI: (10n ** 18n + 1n).toString()}, {ARKIV_CHAIN_ID: '7706815'},
    {ARKIV_RPC_URL: TIRAMISU_RPC + '?key=synthetic'}, {ARKIV_ACCESS_KEY: 'invalid\nheader'}];
  for (let index = 0; index < mutations.length; index++) {
    const output = path.join(dir, `${index}.json`);
    const configured = index === 0 ? {} : {...env(output), ...mutations[index]};
    const result = await runPublicLive({root: repositoryRoot, workspace, output, env: configured, request: () => {calls++; throw new Error();}});
    assert.equal(result.result, 'SKIPPED');
  }
  assert.equal(calls, 0);
  assert.throws(() => validateEnvironment({...env(path.join(dir, 'valid.json')), ARKIV_MAX_SPEND_WEI: '1000000000000000001'}, {root: repositoryRoot, output: path.join(dir, 'valid.json')}), /BUDGET/);
});
test('the seven live cases execute current skill helpers through real SDK over deterministic transport', async context => {
  const dir = await directory(context), output = path.join(dir, 'report.json'), fixture = liveFixture(dependencies, account);
  const report = await runPublicLive({root: repositoryRoot, workspace, env: env(output), request: fixture.request, wait: async () => {}});
  assert.equal(report.result, 'PASS', JSON.stringify({reason: report.reason, cases: report.cases, trace: report.proof?.rpcTrace}));
  assert.equal(report.kind, 'runtime'); assert.equal(report.chain.name, 'synthetic'); assert.equal(report.executionMode, 'synthetic_transport');
  assert.equal(report.cases.length, 7); assert.ok(report.cases.every(test => test.status === 'PASS'));
  assert.equal(report.proof.transactions.length, 7); assert.equal(report.unresolvedTransactionHashes.length, 0);
  assert.equal(report.cases[0].evidence.exactHelperInvoked, true); assert.equal(report.cases[0].evidence.repeatBroadcasts, 0);
  assert.equal(report.cases[2].evidence.pages, 3); assert.equal(report.cases[3].evidence.readonlyBroadcasts, 0);
  assert.equal(report.cases[4].evidence.skipBroadcasts, 0);
  assert.ok(BigInt(report.actualConfirmedSpendWei) <= 10n ** 18n);
  const serialized = await readFile(output, 'utf8'); assert.ok(!serialized.includes(key));
  const rows = (await readFile(output + '.journal.jsonl', 'utf8')).trim().split('\n').map(JSON.parse);
  let previous = '0'.repeat(64);
  for (const row of rows) {
    assert.equal(row.previousHash, previous); const {sha256, ...entry} = row;
    assert.equal(createHash('sha256').update(JSON.stringify(entry)).digest('hex'), sha256); previous = sha256;
  }
});

test('an explicitly custodied LocalAccount signs in memory while malformed or ambiguous accounts fail closed', async context => {
  const dir = await directory(context), output = path.join(dir, 'local-account.json'), fixture = liveFixture(dependencies, account);
  const configured = {...env(output)}; delete configured.ARKIV_PRIVATE_KEY;
  const report = await runPublicLive({root: repositoryRoot, workspace, output, account, env: configured, request: fixture.request, wait: async () => {}});
  assert.equal(report.result, 'PASS'); assert.equal(report.kind, 'runtime');
  assert.equal(report.preflight.sender, account.address);
  assert.ok(report.proof.transactions.every(tx => tx.sender.toLowerCase() === account.address.toLowerCase()));
  assert.ok(!(await readFile(output, 'utf8')).includes(key));
  let calls = 0;
  for (const [index, candidate] of [{...account, type: 'json-rpc'}, {...account, address: '0x' + '0'.repeat(40)},
    {...account, signTransaction: undefined}, {...account, address: 'not-an-address'}].entries()) {
    const result = await runPublicLive({root: repositoryRoot, workspace, output: path.join(dir, `invalid-account-${index}.json`),
      account: candidate, env: configured, request: () => {calls++; throw new Error();}});
    assert.equal(result.reason, 'DEDICATED_LOCAL_ACCOUNT_REQUIRED'); assert.equal(result.result, 'SKIPPED');
  }
  const ambiguous = await runPublicLive({root: repositoryRoot, workspace, output: path.join(dir, 'ambiguous-account.json'),
    account, env: env(output), request: () => {calls++; throw new Error();}});
  assert.equal(ambiguous.reason, 'AMBIGUOUS_SIGNER_CONFIGURATION'); assert.equal(calls, 0);
});
test('foreign keys, foreign signed sender/chain/destination/value and overspend are denied before broadcast', async context => {
  const {operator, fixture} = await setup(context);
  const stranger = dependencies.accounts.privateKeyToAccount('0x' + '2'.repeat(64));
  for (const options of [{chainId: 7706815}, {to: stranger.address}, {value: 1n}, {signer: stranger},
    {operations: [operation(operator, {entityKey: '0x' + '99'.repeat(32)})]}, {operations: [operation(operator, {project: 'user_project'})]}]) {
    await assert.rejects(operator.request('eth_sendRawTransaction', [await signed(operator, options)]));
  }
  assert.equal(fixture.sends.length, 0); assert.equal(fixture.actualTransportCalls, 0);
  operator.maxSpend = 1n;
  await assert.rejects(operator.request('eth_sendRawTransaction', [await signed(operator)]), /SPEND_BUDGET/);
  assert.equal(fixture.actualTransportCalls, 0);
  await assert.rejects(operator.request('eth_sendTransaction', [{}]), /RPC_METHOD_DENIED/);
  assert.equal(fixture.actualTransportCalls, 0);
});
test('canonical receipt/transaction provenance and complete events are required before custody', async context => {
  for (const fault of ['forgedReceipt', 'forgedCanonical', 'missingEvent']) {
    const {operator, fixture} = await setup(context); fixture[fault] = true;
    const txHash = await operator.request('eth_sendRawTransaction', [await signed(operator)]);
    await assert.rejects(operator.request('eth_getTransactionReceipt', [txHash]));
    assert.equal(fixture.sends.length, 1); assert.equal(operator.owned.size, 0); assert.equal(operator.stopped, true);
  }
});
test('ambiguous send or mismatched returned hash stops later nonces and never resends', async context => {
  for (const fault of ['lostBroadcast', 'wrongHash']) {
    const {operator, fixture} = await setup(context); fixture[fault] = true;
    await assert.rejects(operator.request('eth_sendRawTransaction', [await signed(operator)]));
    const calls = fixture.actualTransportCalls;
    await assert.rejects(operator.request('eth_sendRawTransaction', [await signed(operator, {nonce: 1})]));
    assert.equal(fixture.sends.length, 1); assert.equal(fixture.actualTransportCalls, calls);
    assert.equal(operator.owned.size, 0); assert.equal([...operator.transactions.values()][0].state, 'ambiguous');
  }
});
test('429 records Retry-After, does not retry and keeps access keys out of proof', async context => {
  const accessKey = 'synthetic-confidential-header'; const {operator, fixture, output} = await setup(context, {accessKey});
  fixture.quota = true;
  await assert.rejects(operator.reader.getChainId(), /RPC_QUOTA_LIMITED/);
  await assert.rejects(operator.reader.getBalance({address: account.address}));
  assert.equal(fixture.actualTransportCalls, 1);
  const journal = await readFile(path.join(output, 'journal.jsonl'), 'utf8');
  assert.ok(journal.includes('1700 seconds')); assert.ok(!journal.includes(accessKey)); assert.ok(!journal.includes(key));
});
test('the receipt deadline and pending-nonce mismatch stop admission without another RPC send', async context => {
  const {operator, fixture} = await setup(context);
  let now = 1000; operator.clock = () => now;
  const txHash = await operator.request('eth_sendRawTransaction', [await signed(operator)]);
  const count = fixture.actualTransportCalls; now += 60001;
  await assert.rejects(operator.request('eth_getTransactionReceipt', [txHash]), /RECEIPT_DEADLINE_EXCEEDED/);
  assert.equal(fixture.actualTransportCalls, count); assert.equal(operator.owned.size, 0);
  const other = await setup(context);
  const original = other.operator.requestFetch;
  other.operator.requestFetch = async (url, input) => {
    const body = JSON.parse(input.body);
    if (body.method === 'eth_getTransactionCount' && body.params[1] === 'pending') return Response.json({jsonrpc: '2.0', id: body.id, result: '0x1'});
    return original(url, input);
  };
  await assert.rejects(other.operator.request('eth_sendRawTransaction', [await signed(other.operator)]), /EXCLUSIVE_WRITER/);
  assert.equal(other.fixture.sends.length, 0);
});
test('a preexisting exact seed is read/reused and excluded from this run mutation custody', async context => {
  const dir = await directory(context), output = path.join(dir, 'reused.json'), fixture = liveFixture(dependencies, account);
  const modules = await (await import('./dependencies.mjs')).skillModules(repositoryRoot, dependencies);
  const first = await modules.load('skills/arkiv-first-write/SKILL.md#1');
  const seeded = await fixture.wallet.createEntity(first.module.firstNoteParameters());
  fixture.entities.get(seeded.entityKey).owner = '0x2222222222222222222222222222222222222222';
  const report = await runPublicLive({root: repositoryRoot, workspace, env: env(output), request: fixture.request, wait: async () => {}});
  assert.equal(report.result, 'PASS'); assert.equal(report.cases[0].evidence.mode, 'reuse_only');
  assert.equal(report.cases[0].evidence.createdThisInvocation, false);
  assert.ok(!report.proof.ownedEntityKeys.includes(seeded.entityKey.toLowerCase()));
  assert.ok(report.proof.transactions.every(tx => tx.operations.every(op => op.entityKey !== seeded.entityKey.toLowerCase())));
  assert.ok(fixture.entities.has(seeded.entityKey));
});
