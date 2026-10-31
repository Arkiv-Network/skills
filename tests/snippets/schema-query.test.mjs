import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeFixture } from './fixtures/importer-rpc-fixture.mjs';
const workspace = process.env.ARKIV_SNIPPET_WORKSPACE;
assert.ok(workspace, 'Set ARKIV_SNIPPET_WORKSPACE to the installed SDK 1.0.0 workspace');
const load = name => import(pathToFileURL(path.join(workspace, 'node_modules/@arkiv-network/sdk/dist', name, 'index.js')));
const sdk = await import(pathToFileURL(path.join(workspace, 'node_modules/@arkiv-network/sdk/dist/index.js')));
const chains = await load('chains'), query = await load('query'), attr = await load('schema');
const viem = await import(pathToFileURL(path.join(workspace, 'node_modules/viem/_esm/index.js')));
const accounts = await import(pathToFileURL(path.join(workspace, 'node_modules/viem/_esm/accounts/index.js')));

test('Rabdi requires a string key and encodes it into HTTP/WSS paths', () => {
  assert.throws(() => chains.rabdi(), sdk.MissingAccessKeyError);
  assert.throws(() => chains.rabdi({ accessKey: null }), sdk.MissingAccessKeyError);
  const chain = chains.rabdi({ accessKey: 'synthetic/key' });
  assert.equal(chain.id, 7794095);
  assert.equal(new URL(chain.rpcUrls.default.http[0]).pathname, '/synthetic%2Fkey');
  assert.equal(new URL(chain.rpcUrls.default.webSocket[0]).pathname, '/synthetic%2Fkey');
  assert.equal(chain.blockExplorers.default.url, 'https://rabdi.explorer.arkiv.network');
});

test('actual SDK create encodes defaults, schema tag and indexed bit; bytes read as hex', async () => {
  const signer = accounts.privateKeyToAccount(accounts.generatePrivateKey());
  const fixture = makeFixture(signer.address, { sdk, viem, chains, attr });
  const wallet = sdk.createWalletClient({ account: signer, chain: fixture.reader.chain,
    transport: viem.custom({ request: fixture.request }, { retryCount: 0 }) });
  const Model = sdk.defineSchema('schema_regression', {
    app_id: sdk.str().indexed(), timestamp: sdk.u64().indexed(), body: sdk.bytes(),
    active: sdk.bool().default(false), optional_note: sdk.str().optional(),
  });
  const created = await wallet.createEntity(Model, { app_id: 'synthetic', timestamp: sdk.u64(1700000000000n),
    body: new Uint8Array([0, 1, 255]) }, { expiration: sdk.ExpirationTime.fromBlocks(100), flags: { readonly: true } },
    { nonce: 0, gas: 1000000n, gasPrice: 1n });
  assert.equal(fixture.sends.length, 1);
  const cells = fixture.sends[0].decodedOps[0].value.attributes;
  const byName = new Map(cells.map(cell => [new TextDecoder().decode(viem.hexToBytes(cell.name)).replace(/\0+$/, ''), cell]));
  assert.equal(byName.get('arkiv.schema').typeId, 0x88);
  assert.equal(byName.get('timestamp').typeId, 0x83);
  assert.equal(byName.get('body').typeId, 7);
  assert.equal(byName.get('active').typeId, 1);
  const page = await fixture.reader.select({ $key: true, $creationFlags: true, $attributeSchema: true,
    app_id: true, body: true, active: true, optional_note: true }).from(Model, { onMismatch: 'throw' })
    .where(query.eq('app_id', 'synthetic')).fetch();
  assert.equal(page.entities[0].$key, created.entityKey);
  assert.equal(page.entities[0].body.value, '0x0001ff');
  assert.equal(page.entities[0].active.value, false);
  assert.equal(page.entities[0].optional_note, undefined);
  assert.equal(page.entities[0].$attributeSchema.body.indexed, false);
  assert.equal(page.entities[0].$creationFlags.readonly, true);
});

test('schema/index/type/query failures reject before RPC; bytes cannot be indexed', async () => {
  const account = accounts.privateKeyToAccount(accounts.generatePrivateKey());
  const fixture = makeFixture(account.address, { sdk, viem, chains, attr });
  const Model = sdk.defineSchema('validation_regression', {
    app_id: sdk.str().indexed(), amount: sdk.dec().indexed(), title: sdk.str(), body: sdk.bytes(),
  });
  for (const expression of [query.eq('title', 'x'), query.eq('body', 'x'), query.eq('amount', 1)]) {
    await assert.rejects(fixture.reader.select({ $key: true }).from(Model).where(expression).fetch(), query.InvalidPredicateError);
  }
  assert.throws(() => sdk.bytes().indexed(), sdk.SchemaDefinitionError);
  assert.throws(() => sdk.u64(-1n), sdk.InvalidValueError);
  assert.throws(() => sdk.i32(Date.now()), sdk.InvalidValueError);
  assert.equal(fixture.methods.length, 0);
});

test('default schema mismatch skipping is distinct from an empty matching set', async () => {
  const Model = sdk.defineSchema('skip_regression', { app_id: sdk.str().indexed(), body: sdk.bytes() });
  const client = sdk.createPublicClient({ chain: chains.rabdi({ accessKey: 'synthetic-offline' }),
    transport: viem.custom({ request: async ({ method, params }) => {
      assert.equal(method, 'arkiv_query');
      assert.ok(params[0].includes('arkiv.schema'));
      return { blockNumber: '0x10', data: [{ key: '0x' + '01'.repeat(32), attributes: [
        { name: 'arkiv.schema', type: 'str', value: 'skip_regression' },
        { name: 'app_id', type: 'str', value: 'x' },
        // Missing the required selected body, representing a hostile or malformed match.
      ] }], count: '0x1' };
    } }, { retryCount: 0 }) });
  const skipped = await client.select({ $key: true, body: true }).from(Model).withCount().fetch();
  assert.equal(skipped.entities.length, 0);
  assert.equal(skipped.skipped, 1);
  assert.equal(skipped.count, 1n);
  await assert.rejects(client.select({ $key: true, body: true }).from(Model, { onMismatch: 'throw' }).fetch(), sdk.SchemaMismatchError);
});

test('every compiled documentation module imports without a signature or network request', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(workspace, 'snippet-manifest.json'), 'utf8'));
  const previous = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Network forbidden while loading documentation helpers'); };
  try {
    for (const row of manifest.rows.filter(row => row.language === 'typescript')) {
      await import(pathToFileURL(row.path.replace(/\.ts$/, '.js')));
    }
  } finally { globalThis.fetch = previous; }
});
