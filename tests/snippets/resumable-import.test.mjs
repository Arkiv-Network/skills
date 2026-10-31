import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as filesystem from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import { after, before, test } from 'node:test';
import { makeFixture } from './fixtures/importer-rpc-fixture.mjs';

// Reuse an existing SDK 1.0.0 test workspace; do not install root dependencies.
// ARKIV_SNIPPET_WORKSPACE only locates installed SDK/viem dependencies.
// Run: node --experimental-vm-modules --test tests/snippets/resumable-import.test.mjs
const workspace = process.env.ARKIV_SNIPPET_WORKSPACE;
assert.ok(workspace, 'Set ARKIV_SNIPPET_WORKSPACE to an existing SDK snippet workspace');
const reference = process.env.ARKIV_IMPORT_REFERENCE ?? fileURLToPath(new URL('../../skills/arkiv-write-safety/references/resumable-import.md', import.meta.url));
const scratchRoot = process.env.ARKIV_IMPORT_TEST_SCRATCH;
assert.ok(scratchRoot && path.isAbsolute(scratchRoot), 'Set ARKIV_IMPORT_TEST_SCRATCH to an owned absolute scratch directory');
const sdkRoot = path.join(workspace, 'node_modules', '@arkiv-network/sdk');
const sdkJsonPath = path.join(sdkRoot, 'package.json');
const originalSdkJson = await filesystem.readFile(sdkJsonPath, 'utf8');
assert.equal(JSON.parse(originalSdkJson).version, '1.0.0', 'This deterministic receipt fixture targets SDK 1.0.0');
const sdk = await import(pathToFileURL(path.join(sdkRoot, 'dist/index.js')));
const query = await import(pathToFileURL(path.join(sdkRoot, 'dist/query/index.js')));
const chains = await import(pathToFileURL(path.join(sdkRoot, 'dist/chains/index.js')));
const attr = await import(pathToFileURL(path.join(sdkRoot, 'dist/schema/index.js')));
const viemRoot = path.join(workspace, 'node_modules', 'viem');
const viem = await import(pathToFileURL(path.join(viemRoot, '_esm/index.js')));
const accounts = await import(pathToFileURL(path.join(viemRoot, '_esm/accounts/index.js')));
const originalSdkExports = Object.entries(sdk);
const originalFetch = globalThis.fetch;
before(() => { globalThis.fetch = () => { throw new Error('Network forbidden in deterministic importer tests'); }; });
after(async () => {
  globalThis.fetch = originalFetch;
  assert.equal(await filesystem.readFile(sdkJsonPath, 'utf8'), originalSdkJson);
  assert.deepEqual(Object.entries(sdk), originalSdkExports, 'Native SDK exports were not modified');
});

async function loadExactHelper(harness) {
  const markdown = await filesystem.readFile(reference, 'utf8');
  const fences = [...markdown.matchAll(/```javascript\r?\n([\s\S]*?)\r?\n```/g)];
  assert.equal(fences.length, 1, 'Execute the one exact published JavaScript fence');
  const realOpen = filesystem.open;
  const isolatedFs = {
    ...filesystem,
    open: async (filename, flags, ...rest) => {
      const file = await realOpen(filename, flags, ...rest);
      if (filename !== harness.options.journalPath || flags !== 'a') return file;
      const previousBytes = await filesystem.readFile(filename, 'utf8');
      let state;
      return {
        writeFile: async (text, ...arguments_) => {
          state = JSON.parse(text).state;
          if (harness.fault?.state === state && harness.fault.phase === 'write') {
            harness.fault.failedPrefix = previousBytes;
            throw new Error(`Synthetic ${state} write failure`);
          }
          return file.writeFile(text, ...arguments_);
        },
        sync: async () => {
          if (harness.fault?.state === state && harness.fault.phase === 'sync') {
            harness.fault.failedPrefix = previousBytes;
            throw new Error(`Synthetic ${state} sync failure`);
          }
          await file.sync();
          harness.synced.push(state);
        },
        close: () => file.close(),
      };
    },
  };
  const linkedSdk = {
    ...sdk,
    createWalletClient: options => {
      const wallet = sdk.createWalletClient(options);
      if (options.account !== harness.options.account) return wallet;
      return {
        ...wallet,
        executeBatch: (...arguments_) => {
          harness.walletEntries++;
          assert.equal(harness.synced.at(-1), 'prepared', 'Prepared intent must be durable before funded wallet entry');
          return wallet.executeBatch(...arguments_);
        },
      };
    },
  };
  const bindings = new Map([
    ['@arkiv-network/sdk', linkedSdk], ['@arkiv-network/sdk/query', query], ['@arkiv-network/sdk/schema', attr], ['viem', viem], ['node:fs/promises', isolatedFs],
  ]);
  const module = new SourceTextModule(fences[0][1], { identifier: reference });
  await module.link(async specifier => {
    const exports = bindings.get(specifier) ?? await import(specifier);
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    });
  });
  await module.evaluate();
  return module.namespace;
}

async function withImport(count, action, { batchSize = 2, fees = { gasPrice: 1n }, estimatedGas = 100000n } = {}) {
  const directory = await filesystem.mkdtemp(path.join(scratchRoot, 'arkiv-import-regression-'));
  const signer = accounts.privateKeyToAccount(accounts.generatePrivateKey()); // Synthetic key stays in memory.
  const fixture = makeFixture(signer.address, { sdk, viem, chains, attr });
  fixture.estimatedGas = estimatedGas;
  const harness = { fixture, synced: [], signatures: 0, walletEntries: 0, fault: null };
  const account = { ...signer, signTransaction: async transaction => {
    harness.signatures++;
    assert.equal((await harness.journal()).at(-1).state, 'prepared');
    return signer.signTransaction(transaction);
  } };
  harness.options = {
    account, chain: fixture.reader.chain, request: fixture.request, jobId: 'synthetic-receipt-regression',
    batchSize, gasCeiling: 10000000n, maxTotalCost: 100000000n, fees,
    planPath: path.join(directory, 'plan.json'), journalPath: path.join(directory, 'journal.jsonl'),
    rows: Array.from({ length: count }, (_, index) => ({
      id: `row-${index}`, salt: BigInt(index), expiresAt: fixture.head + 3600n,
      schema: sdk.defineSchema('synthetic_import', { project: sdk.str().indexed(), row_number: sdk.u64().indexed(),
        enabled: sdk.bool().indexed(), body: sdk.bytes(), media_type: sdk.str().default('application/json') }),
      values: { body: new TextEncoder().encode(JSON.stringify({ body: `Synthetic ${index}` })),
        project: 'synthetic-import', row_number: sdk.u64(BigInt(index)), enabled: sdk.bool(index % 2 === 0) },
      flags: { readonly: true },
    })),
  };
  harness.journal = async () => (await filesystem.readFile(harness.options.journalPath, 'utf8')).trimEnd().split('\n').map(JSON.parse);
  harness.recoverFailedAppend = async () => {
    assert.ok(harness.fault?.failedPrefix, 'Only this test-owned failed append may be discarded');
    // Controlled storage-loss model: preserve the exact synced prefix, omit only the failed append.
    await filesystem.writeFile(harness.options.journalPath, harness.fault.failedPrefix);
    harness.fault = null;
  };
  try {
    harness.helper = await loadExactHelper(harness);
    const prepared = await harness.helper.prepareImport(harness.options);
    harness.options.planSha256 = prepared.planSha256;
    harness.plan = JSON.parse(await filesystem.readFile(harness.options.planPath, 'utf8'));
    assert.equal(harness.signatures, 0);
    assert.equal(fixture.sends.length, 0);
    fixture.beforeSend = async ({ method, params }) => {
      assert.equal(method, 'eth_sendRawTransaction');
      const entries = await harness.journal();
      const saved = entries.at(-1);
      assert.equal(saved.state, 'submitting');
      assert.equal(saved.raw, params[0]);
      assert.equal(saved.txHash, viem.keccak256(params[0]));
      assert.equal(harness.synced.at(-1), 'submitting', 'Capture is durable before provider forwarding');
      assert.equal(entries.filter(record => record.state === 'verified').length, fixture.sends.length, 'Previous batches are verified before admitting another send');
    };
    await action(harness);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(scratchRoot));
    assert.ok(path.basename(directory).startsWith('arkiv-import-regression-'));
    // Private signed bytes belong only to this synthetic test and are no longer in use.
    await filesystem.rm(directory, { recursive: true });
  }
}

test('60 rows verify each current batch of 20 after its durable receipt, then complete all three', () => withImport(60, async h => {
  const request = h.options.request;
  h.options.request = async input => {
    if (input.method === 'arkiv_query') {
      const entries = await h.journal();
      const batch = h.plan.batches[h.fixture.sends.length - 1];
      const confirmation = entries.find(record => record.index === batch.index && record.state === 'receipt_confirmed');
      assert.ok(confirmation, 'Receipt confirmation must precede field readback');
      assert.equal(h.synced.at(-1), 'receipt_confirmed');
      assert.equal(confirmation.txHash, h.fixture.sends.at(-1).txHash);
      const queriedKey = /\$key = key\((0x[0-9a-fA-F]+)\)/.exec(input.params[0])?.[1];
      assert.ok(batch.rows.some(row => row.expectedKey === queriedKey), 'Read only keys in the current batch');
    }
    return request(input);
  };
  const result = await h.helper.runImport(h.options);
  assert.equal(result.state, 'complete');
  assert.equal(result.confirmedBatches, 3);
  assert.equal(result.verifiedBatches, 3);
  assert.equal(h.fixture.queries.length, 60);
  assert.equal(h.fixture.sends.length, 3);
  assert.deepEqual((await h.journal()).map(record => record.state), ['initialized', ...Array(3).fill(['prepared', 'submitting', 'receipt_confirmed', 'verified']).flat()]);
  h.options.request = request;
  assert.equal((await h.helper.runImport(h.options)).verifiedBatches, 3);
  assert.equal(h.fixture.sends.length, 3);
  assert.equal(h.signatures, 3);
  assert.equal(h.walletEntries, 3);
}, { batchSize: 20 }));

test('readback failure retains receipt_confirmed and resumes without repeating the accepted batch', () => withImport(3, async h => {
  h.fixture.hideEntities = true;
  await assert.rejects(h.helper.runImport(h.options), /absent at the current readback/);
  const entries = await h.journal();
  assert.equal(entries.at(-1).state, 'receipt_confirmed');
  assert.deepEqual(entries.at(-1).receipt.keys, h.plan.batches[0].rows.map(row => row.expectedKey));
  assert.equal(entries.filter(record => record.state === 'verified').length, 0);
  assert.equal(h.fixture.sends.length, 1);
  h.fixture.hideEntities = false;
  assert.equal((await h.helper.runImport(h.options)).verifiedBatches, 2);
  assert.equal(h.fixture.sends.length, 2);
  assert.equal(h.signatures, 2);
  assert.equal(new Set(h.fixture.sends.map(send => send.txHash)).size, 2);
}));

for (const phase of ['write', 'sync']) {
  test(`verified checkpoint ${phase} failure retains prior receipt_confirmed and resume never resends`, () => withImport(3, async h => {
    h.fault = { state: 'verified', phase };
    await assert.rejects(h.helper.runImport(h.options), new RegExp(`Synthetic verified ${phase} failure`));
    const prefix = h.fault.failedPrefix.trimEnd().split('\n').map(JSON.parse);
    assert.equal(prefix.at(-1).state, 'receipt_confirmed');
    assert.equal(prefix.at(-1).txHash, h.fixture.sends[0].txHash);
    assert.equal(h.fixture.queries.length, 2);
    assert.equal(h.fixture.sends.length, 1);
    await h.recoverFailedAppend();
    assert.equal((await h.helper.runImport(h.options)).verifiedBatches, 2);
    assert.equal(h.fixture.sends.length, 2);
    assert.equal(h.signatures, 2);
  }));
  test(`prepared intent ${phase} failure prevents funded wallet entry and send`, () => withImport(3, async h => {
    h.fault = { state: 'prepared', phase };
    await assert.rejects(h.helper.runImport(h.options), new RegExp(`Synthetic prepared ${phase} failure`));
    assert.equal(h.walletEntries, 0);
    assert.equal(h.signatures, 0);
    assert.equal(h.fixture.sends.length, 0);
    assert.ok(!h.fixture.methods.some(method => method.startsWith('eth_send')));
  }));
}

test('receipt checkpoint fsync failure retains submitting and resumes original hash without resend', () => withImport(3, async h => {
  h.fault = { state: 'receipt_confirmed', phase: 'sync' };
  await assert.rejects(h.helper.runImport(h.options), /Synthetic receipt_confirmed sync failure/);
  const prefix = h.fault.failedPrefix.trimEnd().split('\n').map(JSON.parse);
  assert.equal(prefix.at(-1).state, 'submitting');
  assert.equal(prefix.at(-1).txHash, h.fixture.sends[0].txHash);
  assert.equal(h.fixture.queries.length, 0);
  await h.recoverFailedAppend();
  assert.equal((await h.helper.runImport(h.options)).verifiedBatches, 2);
  assert.equal(h.fixture.sends.length, 2);
  assert.equal(h.signatures, 2);
}));

test('submitting capture fsync failure prevents forwarding the locally signed transaction', () => withImport(3, async h => {
  h.fault = { state: 'submitting', phase: 'sync' };
  await assert.rejects(h.helper.runImport(h.options), /Stopped before durable send admission/);
  assert.equal(h.walletEntries, 1);
  assert.equal(h.signatures, 1);
  assert.equal(h.fixture.sends.length, 0);
  assert.ok(!h.fixture.methods.some(method => method.startsWith('eth_send')));
}));

test('lost send response retains hash; reconciliation saves receipt before reads and never sends again', () => withImport(2, async h => {
  h.fixture.broadcastResponseLost = true;
  const result = await h.helper.runImport(h.options);
  assert.equal(result.state, 'needs_reconciliation');
  assert.equal(result.txHash, (await h.journal()).find(record => record.state === 'submitting').txHash);
  assert.equal(h.fixture.sends.length, 1);
  h.fixture.broadcastResponseLost = false;
  h.fixture.hideEntities = true;
  await assert.rejects(h.helper.runImport(h.options), /absent at the current readback/);
  assert.equal((await h.journal()).at(-1).state, 'receipt_confirmed');
  h.fixture.hideEntities = false;
  assert.equal((await h.helper.runImport(h.options)).state, 'complete');
  assert.equal(h.fixture.sends.length, 1);
  assert.equal(h.signatures, 1);
}));

for (const fault of ['wrong-input', 'reverted-receipt', 'wrong-key-order', 'reorg']) {
  test(`a superficially successful receipt cannot confirm planned intent: ${fault}`, () => withImport(3, async h => {
    h.fixture.broadcastResponseLost = true;
    const uncertain = await h.helper.runImport(h.options);
    h.fixture.broadcastResponseLost = false;
    const receipt = h.fixture.receipts.get(uncertain.txHash);
    if (fault === 'wrong-input') h.fixture.transactions.get(uncertain.txHash).input = '0x';
    if (fault === 'reverted-receipt') receipt.status = '0x0';
    if (fault === 'wrong-key-order') {
      [receipt.logs[0].topics, receipt.logs[1].topics] = [receipt.logs[1].topics, receipt.logs[0].topics];
    }
    if (fault === 'reorg') {
      const request = h.options.request;
      h.options.request = async input => {
        const result = await request(input);
        return input.method === 'eth_getBlockByNumber' && input.params[0] !== '0x0' ? { ...result, hash: `0x${'00'.repeat(32)}` } : result;
      };
    }
    const expected = { 'wrong-input': /Provider transaction differs/, 'reverted-receipt': /successful inclusion/, 'wrong-key-order': /Created key\/order/, reorg: /no longer canonical/ };
    await assert.rejects(h.helper.runImport(h.options), expected[fault]);
    assert.ok(!(await h.journal()).some(record => ['receipt_confirmed', 'verified'].includes(record.state)));
    assert.equal(h.fixture.queries.length, 0);
    assert.equal(h.fixture.sends.length, 1);
    assert.equal(h.signatures, 1);
  }));
}

test('typed attribute mismatch preserves receipt confirmation, blocks next batch, and repairs without resend', () => withImport(3, async h => {
  const request = h.options.request;
  let corrupt = true;
  h.options.request = async input => {
    const result = await request(input);
    if (input.method !== 'arkiv_query' || !corrupt) return result;
    return { ...result, data: result.data.map(entity => ({ ...entity, attributes: entity.attributes.map(attribute => attribute.name === 'enabled' ? { ...attribute, value: !attribute.value } : attribute) })) };
  };
  await assert.rejects(h.helper.runImport(h.options), /Typed attributes\/order mismatch/);
  assert.equal((await h.journal()).at(-1).state, 'receipt_confirmed');
  assert.equal(h.fixture.sends.length, 1);
  corrupt = false;
  assert.equal((await h.helper.runImport(h.options)).verifiedBatches, 2);
  assert.equal(h.fixture.sends.length, 2);
  assert.equal(h.signatures, 2);
}));

test('legacy combined-confirmed journal is explicitly incompatible and remains byte-identical', () => withImport(1, async h => {
  assert.equal((await h.helper.runImport(h.options)).state, 'complete');
  const current = await h.journal();
  const legacyEvents = current.filter(record => record.state !== 'receipt_confirmed').map(record => {
    const { hash, previous, journalVersion, ...body } = record;
    if (body.state !== 'verified') return body;
    const { receipt, snapshot, ...event } = body;
    return { ...event, state: 'confirmed', verified: receipt };
  });
  let previous = '';
  const legacyBytes = legacyEvents.map(event => {
    const body = { ...event, previous };
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    previous = hash;
    return JSON.stringify({ ...body, hash });
  }).join('\n') + '\n';
  assert.ok(legacyEvents.some(event => event.state === 'confirmed'));
  await filesystem.writeFile(h.options.journalPath, legacyBytes);
  const calls = h.fixture.methods.length;
  await assert.rejects(h.helper.runImport(h.options), /Legacy or unsupported importer journal/);
  assert.equal(await filesystem.readFile(h.options.journalPath, 'utf8'), legacyBytes);
  assert.equal(h.fixture.methods.length, calls);
  assert.equal(h.walletEntries, 1);
  assert.equal(h.fixture.sends.length, 1);
}));

test('EIP1559 signed fee intent still authenticates and verifies the current batch', () => withImport(1, async h => {
  assert.equal((await h.helper.runImport(h.options)).verifiedBatches, 1);
  assert.equal(h.fixture.transactions.values().next().value.type, '0x2');
  assert.equal((await h.journal()).at(-2).state, 'receipt_confirmed');
  assert.equal((await h.journal()).at(-1).state, 'verified');
}, { fees: { maxFeePerGas: 2n, maxPriorityFeePerGas: 1n } }));

test('twice the exact unsigned estimate governs gas when above the operation floor', () => withImport(1, async h => {
  assert.equal(h.plan.batches[0].gas, '1600000');
  assert.equal((await h.helper.runImport(h.options)).verifiedBatches, 1);
}, { estimatedGas: 800000n }));

test('computed gas above the approved cap is refused before signing or submission', async () => {
  await assert.rejects(withImport(1, async () => assert.fail('Must reject during preparation'), { estimatedGas: 6000000n }), /Estimated gas exceeds approved ceiling/);
});

test('Rabdi batch gas floor scales by actual operation count, with one-operation floor on the tail', () => withImport(3, async h => {
  assert.deepEqual(h.plan.batches.map(batch => batch.gas), ['1400000', '1000000']);
  assert.equal((await h.helper.runImport(h.options)).verifiedBatches, 2);
}));
