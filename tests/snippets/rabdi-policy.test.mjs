import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeFixture } from './fixtures/importer-rpc-fixture.mjs';
const workspace = process.env.ARKIV_SNIPPET_WORKSPACE;
assert.ok(workspace);
const root = path.resolve('skills');
const sdk = await import(pathToFileURL(path.join(workspace, 'node_modules/@arkiv-network/sdk/dist/index.js')));
const chains = await import(pathToFileURL(path.join(workspace, 'node_modules/@arkiv-network/sdk/dist/chains/index.js')));
const attr = await import(pathToFileURL(path.join(workspace, 'node_modules/@arkiv-network/sdk/dist/schema/index.js')));
const viem = await import(pathToFileURL(path.join(workspace, 'node_modules/viem/_esm/index.js')));
const accounts = await import(pathToFileURL(path.join(workspace, 'node_modules/viem/_esm/accounts/index.js')));

function validateRetentionGuidance(markdown) {
  for (const fence of markdown.matchAll(/```(?:typescript|javascript)\r?\n([\s\S]*?)\r?\n```/g)) {
    assert.doesNotMatch(fence[1], /\.permanent\s*\(|atBlock\s*\(\s*(?:MAX_EXPIRES_AT|18446744073709551615n)/,
      'Do not ship a permanent/maximum-u64 write sample for Rabdi');
  }
  for (const line of markdown.split('\n')) {
    if (/permanent\(\)/i.test(line)) assert.match(line, /not supported|unavailable|does not expose|reject|do not call/i,
      'A permanent() mention must explicitly reject it for Rabdi');
    assert.doesNotMatch(line, /(?:use|choose|supports?|option[sz]? include)[^\n]*(?:no[- ]expiration|without expiration)/i,
      'Rabdi must not recommend an expiration-free option');
  }
}

test('every skill/reference rejects permanent Rabdi writes instead of recommending them', async () => {
  const walk = async directory => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.name.endsWith('.md')) validateRetentionGuidance(await fs.readFile(file, 'utf8'));
    }
  };
  await walk(root);
});

test('retention regression guard catches the original table recommendation and executable alternatives', () => {
  for (const mutant of ['| `permanent()` | Maximum u64 deadline, not a durability guarantee |',
    'Use ExpirationTime.permanent() for no expiration.',
    '```typescript\nwallet.createEntity(Schema, values, { expiration: ExpirationTime.permanent() });\n```',
    '```typescript\nExpirationTime.atBlock(MAX_EXPIRES_AT)\n```']) assert.throws(() => validateRetentionGuidance(mutant));
  validateRetentionGuidance('ExpirationTime.permanent() is unavailable in SDK 1.0.0; maximum-u64 deadlines are rejected on Rabdi.');
  assert.equal(typeof sdk.ExpirationTime.permanent, 'undefined');
});

async function documentationModule(source) {
  const manifest = JSON.parse(await fs.readFile(path.join(workspace, 'snippet-manifest.json'), 'utf8'));
  const row = manifest.rows.find(row => row.source === source && row.language === 'typescript');
  assert.ok(row, 'Compiled source fence missing: ' + source);
  return import(pathToFileURL(row.path.replace(/\.ts$/, '.js')));
}

test('first-write default uses latest nonce and explicit gas/price, refuses pending conflict and fee overspend', async () => {
  const module = await documentationModule('skills/arkiv-first-write/SKILL.md');
  const address = '0x' + '11'.repeat(20);
  let pending = 7;
  const reader = { getTransactionCount: async ({ blockTag }) => blockTag === 'latest' ? 7 : pending,
    request: async ({ method }) => { assert.equal(method, 'eth_gasPrice'); return '0x2'; }, getBalance: async () => 10000000n };
  assert.deepEqual(await module.rabdiTxParams(reader, address, 2000000n), { nonce: 7, gas: 1000000n, gasPrice: 2n });
  await assert.rejects(module.rabdiTxParams(reader, address, 1999999n), /budget\/balance/);
  await assert.rejects(module.rabdiTxParams(reader, address, 2000000n, 999999n), /gas floor/);
  pending++;
  await assert.rejects(module.rabdiTxParams(reader, address, 2000000n), /pending nonce/);
});

test('lifecycle copied create sends explicit default gas/nonce/price and checks receipt without retry', async () => {
  const module = await documentationModule('skills/arkiv-entity-lifecycle/SKILL.md');
  const account = accounts.privateKeyToAccount(accounts.generatePrivateKey());
  const fixture = makeFixture(account.address, { sdk, viem, chains, attr });
  const wallet = sdk.createWalletClient({ account, chain: fixture.reader.chain, cacheTime: 0,
    transport: viem.custom({ request: fixture.request }, { retryCount: 0 }) });
  const result = await module.publish(fixture.reader, wallet, sdk.ExpirationTime.fromBlocks(100));
  const tx = fixture.transactions.get(result.txHash);
  assert.equal(BigInt(tx.gas), 1000000n);
  assert.equal(BigInt(tx.gasPrice), 1n);
  assert.equal(BigInt(tx.nonce), 0n);
  const failedReader = { ...fixture.reader, getTransactionReceipt: async () => ({ status: 'reverted' }) };
  await assert.rejects(module.publish(failedReader, wallet, sdk.ExpirationTime.fromBlocks(100)), /Reverted write/);
  assert.equal(fixture.sends.length, 2, 'One send per invocation; no automatic retry after failed receipt check');
});

test('expiration helpers enforce the measured forward window and explicit extension gas before sending', async () => {
  const module = await documentationModule('skills/arkiv-entity-expiration/SKILL.md');
  const entityKey = '0x' + '22'.repeat(32), txHash = '0x' + '33'.repeat(32);
  let expiresAt = 100n + 7884000n - 20n, sends = 0, captured;
  const reader = { getEntity: async () => ({ $expiresAt: expiresAt }), getBlockNumber: async () => 100n,
    getTransactionCount: async () => 2, request: async ({ method }) => { assert.equal(method, 'eth_gasPrice'); return '0x3'; },
    getTransactionReceipt: async () => ({ status: 'success' }) };
  const wallet = { account: { address: '0x' + '11'.repeat(20) }, extendEntity: async (operation, params) => {
    sends++; captured = { operation, params }; return { txHash, expiresAt: 1900n };
  } };
  await assert.rejects(module.addOneHour(reader, wallet, entityKey, 7884000n), /renewal window/);
  assert.equal(sends, 0);
  expiresAt = 200n;
  await module.ensureOneHourRemains(reader, wallet, entityKey, 7884000n);
  assert.deepEqual(captured.params, { nonce: 2, gas: 1000000n, gasPrice: 3n });
  assert.equal(captured.operation.expiration.minLifetime, 1800n);
  assert.equal(sends, 1);
  expiresAt = 99n;
  await assert.rejects(module.ensureOneHourRemains(reader, wallet, entityKey, 7884000n), /renewal window/);
  assert.equal(sends, 1);
});
