import assert from 'node:assert/strict';
import { ExpirationTime, EntityMutationError } from '@arkiv-network/sdk';
import { u256 } from '@arkiv-network/sdk/attr';
import { QueryError } from '@arkiv-network/sdk/query';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { generateKey, importKey } from 'arkiv-encryption';
import { makeFixture } from './rpc-fixture.mjs';

const id = (skill, reference = 'SKILL.md', block = 1) => `skills/${skill}/${reference}#${block}`;
const publicKey = number => '0x' + BigInt(number).toString(16).padStart(64, '0');
const owner = '0x1111111111111111111111111111111111111111';
const rows = count => Array.from({length: count}, (_, index) => ({id: `row-${index}`, body: `Synthetic ${index}`}));
const seed = (fixture, attributes = {project: 'expiration-test'}, expires = ExpirationTime.fromHours(1)) => fixture.wallet.createEntity({payload: new Uint8Array(), contentType: 'application/octet-stream', attributes, expires});
const safeError = error => String(error.shortMessage || error.message || error).split('\n')[0].replace(/0x[0-9a-fA-F]{66,}/g, '[serialized data omitted]');

export async function run({load, snippets}) {
  const cases = [];
  async function test(name, ids, action, kind = 'outcome') {
    const before = globalThis.fetch;
    try { await action(); cases.push({id: name, snippets: ids, skills: [...new Set(ids.map(id => id.split('/')[1]))], kind, status: 'PASS'}); }
    catch (error) { cases.push({id: name, snippets: ids, skills: [...new Set(ids.map(id => id.split('/')[1]))], kind, status: 'FAIL', error: safeError(error)}); }
    finally { globalThis.fetch = before; }
  }
  for (const snippet of snippets.filter(snippet => !snippet.skipReason)) await test(`module:${snippet.id}`, [snippet.id], () => load(snippet.id), 'module');
  const firstId = id('arkiv-first-write');
  const first = await load(firstId);
  await test('first-write-confirmed-readback-and-seed-reuse', [firstId], async () => {
    const account = privateKeyToAccount(generatePrivateKey()); // Never persist or log this key.
    const fixture = makeFixture(account.address); globalThis.fetch = fixture.fetch;
    const created = await first.ensureFirstNote(account, 'https://fixture.invalid');
    assert.equal(created.reused, false); assert.equal(fixture.sends.length, 1);
    const reused = await first.ensureFirstNote(account, 'https://fixture.invalid');
    assert.equal(reused.reused, true); assert.equal(reused.entityKey, created.entityKey); assert.equal(fixture.sends.length, 1);
  });
  await test('first-write-funding-and-chain-guards-precede-send', [firstId], async () => {
    const account = privateKeyToAccount(generatePrivateKey()); const fixture = makeFixture(account.address);
    globalThis.fetch = fixture.fetch; fixture.balance = 0n;
    await assert.rejects(first.ensureFirstNote(account, 'https://fixture.invalid'), /Fund the signer/);
    await assert.rejects(first.ensureFirstNote(account, 'https://fixture.invalid', {id: 1}), /Wrong chain/);
    assert.equal(fixture.sends.length, 0);
  });
  const estimateId = id('arkiv-first-write', 'references/estimate.md');
  await test('dry-run-stops-at-gas-estimate-before-any-send', [estimateId, firstId], async () => {
    const account = privateKeyToAccount(generatePrivateKey()); const fixture = makeFixture(account.address);
    globalThis.fetch = fixture.fetch; const example = await load(estimateId);
    assert.equal(await example.estimateCreate(account, first.firstNoteParameters(), 'https://fixture.invalid'), 100000n);
    assert.ok(fixture.methods.includes('eth_estimateGas')); assert.equal(fixture.sends.length, 0);
    assert.ok(!fixture.methods.some(method => method.startsWith('eth_send')));
  });
  const writesId = id('arkiv-write-safety'); const writes = await load(writesId);
  const importRows = (fixture, count, save = async () => {}) => writes.importRows(writes.createSerialWriter(), fixture.reader, fixture.wallet, 'job', rows(count), 2, save);
  await test('bounded-import-records-every-complete-and-final-batch', [writesId], async () => {
    const fixture = makeFixture(); const journal = []; const progress = await importRows(fixture, 5, async step => journal.push(step));
    assert.deepEqual(progress.map(step => step.rowIds.length), [2, 2, 1]); assert.equal(fixture.sends.length, 3);
    assert.ok(progress.every(step => step.state === 'confirmed' && step.txHash));
    assert.deepEqual(journal.map(step => step.state), Array(3).fill(['prepared', 'submitting', 'confirmed']).flat());
  });
  for (const [mode, hashExpected] of [['omitCreateLogs', true], ['broadcastResponseLost', false], ['denyMutation', false]]) {
    await test(`write-failure-${mode}-halts-with-reconciliation`, [writesId], async () => {
      const fixture = makeFixture(); fixture[mode] = true; const [step] = await importRows(fixture, 5);
      assert.equal(step.state, 'needs_reconciliation'); assert.equal(Boolean(step.txHash), hashExpected);
      assert.equal(fixture.sends.length, mode === 'denyMutation' ? 0 : 1);
    });
  }
  await test('confirmed-checkpoint-failure-keeps-keys-and-halts', [writesId], async () => {
    const fixture = makeFixture(); const [step] = await importRows(fixture, 5, async step => {if (step.state === 'confirmed') throw new Error('Checkpoint failed');});
    assert.equal(step.state, 'confirmed'); assert.equal(step.createdEntities.length, 2); assert.ok(step.checkpointError); assert.equal(fixture.sends.length, 1);
    const receipt = await writes.inspectCreateReceipt(fixture.reader, step.txHash, 2);
    assert.equal(receipt.state, 'receipt_success'); assert.equal('rowIds' in receipt, false); assert.equal('createdEntities' in receipt, false);
  });
  await test('writer-FIFO-failure-does-not-poison-next-task', [writesId], async () => {
    const run = writes.createSerialWriter(), observed = [];
    const failed = run(async () => { observed.push(1); throw new Error('Expected'); });
    const next = run(async () => observed.push(2)); await assert.rejects(failed); await next; assert.deepEqual(observed, [1, 2]);
  });
  const expiryId = id('arkiv-entity-expiration'); const expiry = await load(expiryId);
  await test('expiration-extends-returned-absolute-deadline-and-skips-sufficient-life', [expiryId], async () => {
    const fixture = makeFixture(); const created = await seed(fixture); fixture.head += 20n;
    const extended = await expiry.addOneHour(fixture.reader, fixture.wallet, created.entityKey);
    assert.equal(extended.expiresAt, created.expiresAt + 1800n); const sends = fixture.sends.length;
    assert.equal((await expiry.ensureOneHourRemains(fixture.reader, fixture.wallet, created.entityKey)).status, 'already_sufficient'); assert.equal(fixture.sends.length, sends);
    fixture.head = extended.expiresAt; await assert.rejects(expiry.addOneHour(fixture.reader, fixture.wallet, created.entityKey), /no longer live/);
  });
  const lifecycleId = id('arkiv-entity-lifecycle'); const lifecycle = await load(lifecycleId);
  await test('lifecycle-readonly-flags-and-predicted-related-create-keys', [lifecycleId], async () => {
    const fixture = makeFixture(); await lifecycle.publishSnapshot(fixture.wallet, true);
    assert.equal(fixture.sends[0].decodedOps[0].value.creationFlags, 3);
    const result = await lifecycle.createRelatedNotes(fixture.reader, fixture.wallet); assert.ok(result);
    assert.deepEqual(fixture.sends.at(-1).operationTags, [1, 1]);
  });
  const queryId = id('arkiv-query'); const query = await load(queryId);
  await test('query-cursor-restart-disposes-partial-results-and-budget-fails', [queryId], async () => {
    const fixture = makeFixture(); for (let index = 0; index < 5; index++) await seed(fixture, {project: 'example_marketplace', entity_type: 'listing', active: true, price_minor: u256(BigInt(index))});
    fixture.cursorExpiresOnce = true; const result = await query.fetchAllListings(fixture.reader, owner, {maxPages: 8});
    assert.equal(result.entities.length, 5); assert.equal(new Set(result.entities.map(row => row.key)).size, 5);
    assert.ok(fixture.queries.every(([, options]) => BigInt(options.atBlock) === result.snapshot));
    await assert.rejects(query.fetchAllListings(fixture.reader, owner, {maxPages: 1}), /budget exhausted/);
  });
  const sortId = id('arkiv-query', 'SKILL.md', 2);
  await test('query-bigint-price-ranking-and-type-rejection', [sortId], async () => {
    const sort = await load(sortId); const input = [{key: publicKey(1), attributes: {price_minor: u256(9007199254740993n)}}, {key: publicKey(2), attributes: {price_minor: u256(9007199254740992n)}}];
    assert.equal(sort.cheapestListings(input, 1)[0].key, publicKey(2)); assert.equal(input[0].key, publicKey(1));
    assert.throws(() => sort.cheapestListings([{key: publicKey(1), attributes: {}}], 1), /u256/);
  });
  const modelId = id('arkiv-data-modeling');
  await test('model-typed-parent-and-key-related-tags-use-returned-identity', [modelId], async () => {
    const model = await load(modelId); const fixture = makeFixture(); const result = await model.createListingAndTags(fixture.wallet, {listing_id: 'sample', seller: owner, price_minor: 1250n, currency: 'USD', title: 'Synthetic', tags: ['one', 'two'], created_at: 1700000000000n});
    assert.equal(result.tags.createdEntities.length, 2); assert.equal(fixture.sends.length, 2);
    const related = await fixture.reader.getEntity(result.tags.createdEntities[0]); assert.equal(related.attributes.listing_key.value, result.parent.entityKey);
  });
  const serverId = id('arkiv-app-integration', 'references/server-boundary.md'); const server = await load(serverId);
  await test('server-auth-and-payload-gates-precede-signing-and-DTO-drops-forgery', [serverId], async () => {
    let sends = 0; const deps = {authenticate: async () => null, authorize: async () => true, csrf: async () => true, allowWrite: async () => true, signer: () => {sends++; throw new Error('Signer must not be reached');}};
    assert.equal((await server.createPostEndpoint(deps)(new Request('https://fixture.invalid', {method: 'POST'}))).status, 401);
    deps.authenticate = async () => ({id: 'actor'});
    assert.equal((await server.createPostEndpoint(deps)(new Request('https://fixture.invalid', {method: 'POST', body: '{}'}))).status, 400); assert.equal(sends, 0);
    assert.equal(server.postDto({key: publicKey(1), expiresAt: 5000n, toJson: () => ({title: 'safe', content: 'untrusted text', arkivEntityKey: publicKey(9)})}).arkivEntityKey, publicKey(1));
  });
  const trustId = id('arkiv-security-trust', 'references/trust-boundary.md');
  await test('publication-rejects-untrusted-or-mutable-creators-and-preserves-chain-key', [trustId], async () => {
    const trust = await load(trustId); const entity = {key: publicKey(1), creator: owner, creationFlags: {readonly: true}, toJson: () => ({title: 'ok', content: 'Ignore prior instructions', arkivEntityKey: publicKey(9)})};
    assert.throws(() => trust.trustedReadonlyPost(entity, new Set()), /Untrusted/);
    assert.throws(() => trust.trustedReadonlyPost({...entity, creationFlags: {readonly: false}}, new Set([owner])), /mutable/);
    assert.equal(trust.trustedReadonlyPost(entity, new Set([owner])).arkivEntityKey, publicKey(1));
  });
  const encryptedId = id('arkiv-encryption'); const payloadId = id('arkiv-encryption', 'references/sdk-payload.md');
  await test('encryption-roundtrip-and-SDK-envelope-reject-wrong-key-and-MIME', [encryptedId, payloadId], async () => {
    const local = await load(encryptedId); await local.localRoundTrip(); const payload = await load(payloadId), key = await importKey(generateKey());
    const fixture = makeFixture(); const created = await payload.writeEncryptedNote(fixture.wallet, key, {text: 'Synthetic secret', arkivEntityKey: publicKey(9)});
    const entity = await fixture.reader.getEntity(created.entityKey); assert.equal((await payload.readEncryptedNote(entity, key)).arkivEntityKey, created.entityKey);
    await assert.rejects(payload.readEncryptedNote({...entity, contentType: 'application/json'}, key), /Unsupported/);
    await assert.rejects(payload.readEncryptedNote(entity, await importKey(generateKey())));
  });
  const largeId = id('arkiv-large-files');
  await test('external-pointer-byte-hash-and-origin-token-guards', [largeId], async () => {
    const large = await load(largeId), bytes = new Uint8Array([1, 2, 3]); const pointer = await large.prepareExternalPointer(bytes, 'https://blob.example/object', 'image/png', 5000n, new Set(['https://blob.example']));
    assert.deepEqual(await large.verifyExternalBytes(bytes, pointer.attributes.sha256.value, 3n), bytes);
    await assert.rejects(large.verifyExternalBytes(new Uint8Array([1, 2, 4]), pointer.attributes.sha256.value, 3n), /verification/);
    await assert.rejects(large.prepareExternalPointer(bytes, 'https://blob.example/object?token=synthetic', 'image/png', 5000n, new Set(['https://blob.example'])), /approved/);
  });
  const graphId = id('arkiv-social-graph');
  await test('social-graph-example-resolves-local-typed-join', [graphId], async () => {
    const graph = await load(graphId); const result = graph.localGraph(); assert.equal(result.entities.length, 3); assert.equal(result.graph.edges.length, 1);
  });
  const recoveryId = id('arkiv-troubleshooting', 'references/error-catalog.md');
  await test('diagnostic-recovers-by-type-without-sharing-query-or-secret', [recoveryId], async () => {
    const recovery = await load(recoveryId);
    assert.equal(recovery.recoveryFor({cause: {status: 429}}).action, 'wait_for_quota');
    const cursor = Object.create(QueryError.prototype); cursor.kind = 'cursor'; assert.equal(recovery.recoveryFor(cursor).action, 'restart_walk');
    const mutation = Object.create(EntityMutationError.prototype); mutation.txHash = publicKey(1); assert.equal(recovery.recoveryFor(mutation).action, 'reconcile_write');
  });
  const browserIds = [id('arkiv-app-integration', 'references/browser-wallet.md'), id('arkiv-best-practices', 'references/integration-patterns.md', 2)];
  for (const browserId of browserIds) await test(`wallet-explicit-account-and-connection-race:${browserId}`, [browserId], async () => {
    const browser = await load(browserId); let changed = false, connected = true;
    const provider = {request: async ({method}) => {
      if (method === 'eth_requestAccounts') return connected ? [owner] : [];
      if (method === 'eth_accounts') return [changed ? '0x2222222222222222222222222222222222222222' : owner];
      if (method === 'eth_chainId') return '0x7614d1';
      if (method === 'wallet_switchEthereumChain') return null;
      throw new Error('Unexpected connection method');
    }};
    assert.equal((await browser.connectArkivWallet(provider)).account.address, owner);
    if (browserId.includes('arkiv-app-integration')) {changed = true; await assert.rejects(browser.connectArkivWallet(provider), /account changed/);}
    connected = false; await assert.rejects(browser.connectArkivWallet(provider), /Connect/);
  });
  const realtimeId = id('arkiv-app-integration', 'references/realtime.md');
  await test('watcher-serializes-handlers-reports-failure-and-unwatches', [realtimeId], async () => {
    const realtime = await load(realtimeId); let callbacks, stopped = false; const seen = [], errors = [];
    const stop = realtime.watchSerially({watchEntityEvents: input => {callbacks = input; return () => {stopped = true;};}}, 3n,
      async event => {seen.push(event.index); if (event.index === 1) throw new Error('Synthetic event failure');}, error => errors.push(error));
    callbacks.onEvent({index: 1}); callbacks.onEvent({index: 2}); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(seen, [1, 2]); assert.equal(errors.length, 1); stop(); callbacks.onEvent({index: 3});
    await new Promise(resolve => setImmediate(resolve)); assert.equal(stopped, true); assert.deepEqual(seen, [1, 2]);
  });
  const readerId = id('arkiv-app-integration', 'references/server-boundary.md', 2);
  await test('server-reader-requires-header-key-without-broadcast-on-construction', [readerId], async () => {
    const reader = await load(readerId); assert.throws(() => reader.createServerReader(''), /Missing/);
    assert.equal(reader.createServerReader('synthetic-access-key').chain.id, 7738577);
  });
  const legacyDtoId = id('arkiv-best-practices', 'references/integration-patterns.md');
  await test('retained-DTO-parser-drops-forged-key-and-rejects-invalid-payload', [legacyDtoId], async () => {
    const dto = await load(legacyDtoId); assert.equal(dto.postDto({key: publicKey(1), toJson: () => ({title: 't', content: 'c', arkivEntityKey: publicKey(9)})}).arkivEntityKey, publicKey(1));
    assert.throws(() => dto.parsePost({title: false, content: 'c'}), /Invalid/);
  });
  const legacyAdvancedId = id('arkiv-best-practices', 'references/advanced-patterns.md');
  await test('retained-relationship-creates-separate-memberships-and-filtered-read', [legacyAdvancedId], async () => {
    const advanced = await load(legacyAdvancedId); const fixture = makeFixture(); await advanced.createProfileWithSkills(fixture.wallet, 'alice');
    const page = await advanced.findFrontendMemberships(fixture.reader); assert.equal(page.entities.length, 1); assert.equal(page.entities[0].attributes.skill.value, 'frontend'); assert.equal(fixture.sends.length, 2);
  });
  const legacySdkId = id('arkiv-best-practices', 'references/sdk-reference.md');
  await test('retained-SDK-create-and-bounded-batch-use-real-receipts', [legacySdkId], async () => {
    const sdk = await load(legacySdkId); const fixture = makeFixture(); const created = await sdk.createReadonly(fixture.wallet); assert.ok(created.entityKey);
    const result = await sdk.createNotes(fixture.wallet, ['one', 'two']); assert.equal(result.createdEntities.length, 2);
    const sends = fixture.sends.length; await sdk.createNotes(fixture.wallet, []); assert.equal(fixture.sends.length, sends);
  });
  const relationshipId = id('arkiv-data-modeling', 'references/relationships.md');
  await test('atomic-reference-check-detects-stale-creator-nonce-without-resend', [relationshipId], async () => {
    const relation = await load(relationshipId); const fixture = makeFixture(); const result = await relation.createAtomicListingAndTag(fixture.reader, fixture.wallet, owner, 'listing', 'tag');
    assert.equal(result.createdEntities.length, 2); assert.equal(fixture.sends.length, 1);
    fixture.staleNonce = true; await assert.rejects(relation.createAtomicListingAndTag(fixture.reader, fixture.wallet, owner, 'listing2', 'tag'), /prediction mismatch/); assert.equal(fixture.sends.length, 2);
  });
  const backupId = id('arkiv-entity-lifecycle', 'references/backup-restore.md');
  await test('snapshot-consumes-all-pages-and-cursor-failure-never-returns-partial', [backupId], async () => {
    const backup = await load(backupId); const fixture = makeFixture(); for (let index = 0; index < 3; index++) await seed(fixture);
    const captured = await backup.captureSnapshot(fixture.reader, 'expiration-test', owner); assert.equal(captured.entities.length, 3); assert.doesNotThrow(() => JSON.stringify(captured));
    fixture.cursorExpiresOnce = true; await assert.rejects(backup.captureSnapshot(fixture.reader, 'expiration-test', owner), error => error instanceof QueryError && error.kind === 'cursor');
  });
  const rawId = id('arkiv-query', 'references/json-rpc.md');
  await test('raw-estimate-request-uses-native-destination-and-shared-ABI', [rawId], async () => {
    const raw = await load(rawId); const request = raw.referenceEstimateRequest(owner);
    assert.equal(request.method, 'eth_estimateGas'); assert.equal(request.params[0].to, '0x4400000000000000000000000000000000000044'); assert.equal(request.params[0].data, raw.referenceCreateCalldata());
  });
  const graphFetchId = id('arkiv-social-graph', 'references/fetch-and-refresh.md');
  await test('graph-fetch-scopes-creator-and-rejects-invalid-project-before-RPC', [graphFetchId], async () => {
    const graph = await load(graphFetchId); const fixture = makeFixture(); await seed(fixture, {project: 'graph', entity_type: 'profile'});
    const result = await graph.readSocialGraph(fixture.reader, owner, 'graph'); assert.equal(result.entities.length, 1); assert.equal(result.truncated, false);
    assert.ok(fixture.queries.every(([query]) => query.includes('$creator'))); const calls = fixture.methods.length;
    await assert.rejects(graph.readSocialGraph(fixture.reader, owner, ''), /nonempty/); assert.equal(fixture.methods.length, calls);
  });
  const indexingId = id('arkiv-indexing', 'references/checkpoint-mirror.md');
  await test('mirror-canonical-checkpoint-stage-failure-and-rollback', [indexingId], async () => {
    const indexing = await load(indexingId); const baseline = {number: 1n, hash: publicKey(1), parentHash: publicKey(0)};
    const mirror = new indexing.OwnedMirror('synthetic', owner, baseline); const header = {number: 2n, hash: publicKey(2), parentHash: publicKey(1)};
    const log = {address: indexing.nativeAddress, blockNumber: 2n, blockHash: header.hash, transactionHash: publicKey(3), logIndex: 0, entityKey: publicKey(4)};
    const row = {key: log.entityKey, creator: owner, owner, expires_at: 100n, payload: new Uint8Array(), attributes: {}};
    await assert.rejects(mirror.applyBlock('synthetic', {header, logs: [log]}, async () => {throw new Error('Read failed');}), /Read failed/); assert.equal(mirror.checkpoint.number, 1n);
    await mirror.applyBlock('synthetic', {header, logs: [log, log]}, async () => row); assert.equal(mirror.rows.size, 1); assert.equal(mirror.checkpoint.number, 2n);
    await assert.rejects(mirror.applyBlock('another', {header, logs: []}, async () => null), /identity changed/);
    mirror.rollbackTo(baseline); assert.equal(mirror.rows.size, 0); assert.equal(mirror.checkpoint.hash, baseline.hash);
  });
  return cases;
}
