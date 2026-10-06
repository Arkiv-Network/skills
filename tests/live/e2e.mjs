import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFile, realpath} from 'node:fs/promises';
import {randomUUID, createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {setTimeout as pause} from 'node:timers/promises';
import {repositoryRoot} from '../../scripts/build-plugin.mjs';
import {readSnippets} from '../../scripts/extract-snippets.mjs';
import {LiveOperator, LiveError, validateEnvironment} from './operator.mjs';
import {loadDependencies, skillModules} from './dependencies.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
const sid = name => `skills/${name}/SKILL.md#1`;
const cases = [
  {id: 'first-write-exact', skill: 'arkiv-first-write'},
  {id: 'synthetic-create-flags', skill: 'arkiv-entity-lifecycle'},
  {id: 'query-pinned-pages', skill: 'arkiv-query'},
  {id: 'lifecycle-patch-readonly-estimate', skill: 'arkiv-entity-lifecycle'},
  {id: 'expiration-add-hour', skill: 'arkiv-entity-expiration'},
  {id: 'expiration-observed-recreate', skills: ['arkiv-entity-expiration', 'arkiv-entity-lifecycle']},
  {id: 'owned-delete-readback', skill: 'arkiv-entity-lifecycle'},
];
async function externalOutput(root, output) {
  if (!output || !path.isAbsolute(output)) return false;
  try {
    const parent = await realpath(path.dirname(output)), repository = await realpath(root);
    const relative = path.relative(repository, parent);
    return relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
  } catch {return false;}
}
function safeFailure(error, operator) {
  if (error instanceof LiveError) return {code: error.code, operational: error.operational, httpStatus: error.httpStatus, retryAfter: error.retryAfter};
  if (operator?.failure) return safeFailure(operator.failure);
  const quota = operator?.rpcTrace.find(entry => entry.httpStatus === 429);
  return quota ? {code: 'RPC_QUOTA_LIMITED', operational: true, httpStatus: 429} : {code: 'SDK_OR_ASSERTION_FAILED', operational: false};
}
function view(entity) {
  return {entityKey: entity.key, creator: entity.creator, owner: entity.owner, expiresAt: entity.expiresAt.toString(),
    contentType: entity.contentType, creationFlags: entity.creationFlags, payloadHash: sha256(entity.payload),
    attributes: Object.fromEntries(['project', 'entity_type', 'seed_id', 'status'].filter(name => entity.attributes[name]).map(name => [name, entity.attributes[name].value]))};
}
async function bounded(operation) {
  let timer;
  try {return await Promise.race([operation(), new Promise((_, reject) => {timer = setTimeout(() => reject(new LiveError('RECEIPT_DEADLINE_EXCEEDED', {operational: true})), 60000);})]);}
  finally {clearTimeout(timer);}
}

export async function runPublicLive({root = repositoryRoot, env = process.env, account: injectedAccount, workspace = env.ARKIV_SNIPPET_WORKSPACE || path.join(root, 'tests/snippets'),
  output = env.ARKIV_HEALTH_OUTPUT, request = fetch, wait = pause} = {}) {
  const synthetic = request !== globalThis.fetch;
  const {files} = await readSnippets(root);
  const report = {version: 1, checkedAt: new Date().toISOString(),
    head: /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') ? env.GITHUB_SHA : null,
    sdk: '0.8.1', chain: {name: synthetic ? 'synthetic' : 'tiramisu', id: 7738577}, kind: synthetic ? 'runtime' : 'live',
    executionMode: synthetic ? 'synthetic_transport' : 'live_rpc', result: 'SKIPPED',
    sourceFiles: files, cases: [], scope: 'Exact first-write seed helper and bounded own synthetic lifecycle/query/expiration; four skills only.',
    limits: ['One signer cannot prove the multi-wallet permission matrix.',
      'No library, host, MCP or model-eval result is implied.',
      'A reused first-write seed proves the helper/read path, not a fresh first-write create.',
      'Expiration absence is associated with this run\'s prior receipt/deadline; NoEntityFoundError alone does not identify the cause.']};
  let operator, failure, previousFetch;
  try {
    const {maxSpend} = validateEnvironment(env, {root, output, account: injectedAccount});
    if (!await externalOutput(root, output)) throw new LiveError('ABSOLUTE_EXTERNAL_OUTPUT_REQUIRED', {operational: true});
    const dependencies = await loadDependencies(workspace);
    let account;
    try {account = injectedAccount ?? dependencies.accounts.privateKeyToAccount(env.ARKIV_PRIVATE_KEY);}
    catch {throw new LiveError('SIGNER_NOT_CONFIGURED', {operational: true});}
    const modules = await skillModules(root, dependencies);
    const first = await modules.load(sid('arkiv-first-write'));
    const lifecycle = await modules.load(sid('arkiv-entity-lifecycle'));
    const expiration = await modules.load(sid('arkiv-entity-expiration'));
    const namespace = 'arkiv_live_' + randomUUID().replaceAll('-', '');
    operator = new LiveOperator({account, namespace, maxSpend, journalPath: output + '.journal.jsonl', sdk: dependencies.sdk,
      viem: dependencies.viem, request, accessKey: env.ARKIV_ACCESS_KEY ?? ''});
    await operator.initialize();
    if (await operator.reader.getChainId() !== 7738577) throw new LiveError('RPC_CHAIN_ID_MISMATCH', {operational: true});
    const balance = await operator.reader.getBalance({address: account.address});
    if (balance === 0n) throw new LiveError('SIGNER_NOT_FUNDED', {operational: true});
    report.preflight = {sender: account.address, balanceWei: balance.toString(), maxSpendWei: maxSpend.toString()};
    const proxyUrl = await operator.openProxy();
    previousFetch = globalThis.fetch;
    globalThis.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (url.origin !== proxyUrl) throw new LiveError('SNIPPET_NETWORK_BYPASS_DENIED');
      return previousFetch(input, options);
    };
    const state = {};
    const read = async key => {
      const entity = await operator.reader.getEntity(key);
      assert.equal(entity.creator.toLowerCase(), account.address.toLowerCase());
      return entity;
    };
    const parameters = (name, {readonly = false, blocks = 300} = {}) => ({
      payload: dependencies.sdk.jsonToPayload({synthetic: true, run: namespace, name}), contentType: 'application/json',
      attributes: {project: namespace, entity_type: 'live_note', status: 'draft', draft_reason: 'synthetic'},
      expires: dependencies.sdk.ExpirationTime.fromBlocks(blocks), flags: {readonly, permissionlessExtension: false},
    });
    const sends = () => operator.transactions.size;
    const run = async (definition, source, fn) => {
      operator.caseId = definition.id;
      try {
        const evidence = await fn();
        const transactions = [...operator.transactions.values()].filter(tx => tx.caseId === definition.id);
        assert.ok(transactions.every(tx => tx.state === 'confirmed_success'));
        const completed = {...definition, status: 'PASS', evidence: {...evidence, ...(source ? {source} : {}),
          transactionHashes: transactions.map(tx => tx.hash)}};
        completed.evidenceHash = sha256(json(completed.evidence)); report.cases.push(completed);
      } catch (error) {
        failure = safeFailure(error, operator);
        report.cases.push({...definition, status: failure.operational ? 'SKIPPED' : 'FAIL', reason: failure.code,
          evidence: {source, transactionHashes: [...operator.transactions.values()].filter(tx => tx.caseId === definition.id).map(tx => tx.hash)}});
        throw error;
      }
    };
    await run(cases[0], first.source, async () => {
      const value = await bounded(() => first.module.ensureFirstNote(account, proxyUrl, dependencies.sdk.tiramisu));
      const entity = await read(value.entityKey);
      assert.equal(entity.contentType, 'application/json'); assert.equal(entity.creationFlags.readonly, true);
      assert.equal(entity.expiresAt.toString(), value.expiresAt);
      assert.equal(sha256(entity.payload), sha256(dependencies.sdk.jsonToPayload({text: 'Hello, Arkiv'})));
      if (!value.reused) {
        const confirmed = operator.transactions.get(value.txHash.toLowerCase());
        assert.equal(confirmed?.state, 'confirmed_success'); assert.ok(operator.owned.has(value.entityKey.toLowerCase()));
      }
      const count = sends();
      const reused = await bounded(() => first.module.ensureFirstNote(account, proxyUrl, dependencies.sdk.tiramisu));
      assert.equal(reused.reused, true); assert.equal(reused.entityKey, value.entityKey); assert.equal(sends(), count);
      state.first = value;
      return {mode: value.reused ? 'reuse_only' : 'created_and_reused', exactHelperInvoked: true,
        createdThisInvocation: !value.reused, repeatBroadcasts: 0, readBack: view(entity)};
    });
    await run(cases[1], {file: 'skills/arkiv-entity-lifecycle/SKILL.md'}, async () => {
      const created = await bounded(() => operator.wallet.executeBatch({creates: [parameters('draft_a'), parameters('draft_b'), parameters('readonly', {readonly: true})]}));
      assert.equal(created.createdEntities.length, 3); state.keys = created.createdEntities;
      const entities = await Promise.all(state.keys.map(read));
      for (let index = 0; index < entities.length; index++) {
        assert.ok(operator.owned.has(entities[index].key.toLowerCase()));
        assert.equal(entities[index].creationFlags.readonly, index === 2);
        assert.equal(entities[index].creationFlags.permissionlessExtension, false);
        assert.equal(entities[index].attributes.project.value, namespace);
        assert.equal(entities[index].contentType, 'application/json');
      }
      return {runNamespace: namespace, readBack: entities.map(view)};
    });
    await run(cases[2], {file: 'skills/arkiv-query/SKILL.md'}, async () => {
      const atBlock = await operator.reader.getBlockNumber();
      let page = await operator.reader.select({key: true, payload: true, expiresAt: true}).where(dependencies.query.eq('project', namespace))
        .createdBy(account.address).atBlock(atBlock).limit(1).fetch();
      const found = [...page.entities]; let pages = 1;
      while (page.hasNextPage()) {if (pages >= 4) throw new LiveError('PAGE_BUDGET_EXCEEDED'); page = await page.next(); pages++; found.push(...page.entities);}
      assert.equal(pages, 3); assert.deepEqual(found.map(entity => entity.key).sort(), [...state.keys].sort());
      return {atBlock: atBlock.toString(), pages, uniqueKeys: found.map(entity => entity.key), payloadHashes: found.map(entity => sha256(entity.payload))};
    });
    await run(cases[3], lifecycle.source, async () => {
      const traceStart = operator.rpcTrace.length, before = sends();
      await assert.rejects(operator.wallet.patchEntity({entityKey: state.keys[2], set: {status: 'forbidden'}}));
      assert.equal(sends(), before);
      assert.ok(operator.rpcTrace.slice(traceStart).some(entry => entry.method === 'eth_estimateGas' && entry.nativeError === 'ReadOnlyEntity'));
      const patched = await bounded(() => lifecycle.module.patchDraft(operator.wallet, state.keys[0]));
      const entity = await read(state.keys[0]); assert.equal(entity.attributes.status.value, 'published'); assert.equal(entity.attributes.draft_reason, undefined);
      return {txHash: patched.txHash, readonlyFailure: 'observed_ReadOnlyEntity_estimate', readonlyBroadcasts: 0, readBack: view(entity)};
    });
    await run(cases[4], expiration.source, async () => {
      const before = await read(state.keys[0]);
      const extended = await bounded(() => expiration.module.addOneHour(operator.reader, operator.wallet, state.keys[0]));
      const after = await read(state.keys[0]);
      assert.equal(extended.expiresAt, before.expiresAt + 1800n); assert.equal(after.expiresAt, extended.expiresAt);
      const count = sends(); const sufficient = await expiration.module.ensureOneHourRemains(operator.reader, operator.wallet, state.keys[0]);
      assert.equal(sufficient.status, 'already_sufficient'); assert.equal(sends(), count);
      return {previousExpiresAt: before.expiresAt.toString(), receiptExpiresAt: extended.expiresAt.toString(), skipBroadcasts: 0, readBack: view(after)};
    });
    await run(cases[5], expiration.source, async () => {
      const short = await bounded(() => operator.wallet.createEntity(parameters('short', {blocks: 3})));
      const deadline = short.expiresAt; const started = Date.now(); let head;
      do {head = await operator.reader.getBlockNumber(); if (head > deadline) break; if (Date.now() - started > 30000) throw new LiveError('EXPIRATION_OBSERVATION_WINDOW_EXCEEDED', {operational: true}); await wait(1000);} while (true);
      await assert.rejects(operator.reader.getEntity(short.entityKey), error => error instanceof dependencies.sdk.NoEntityFoundError);
      operator.owned.get(short.entityKey.toLowerCase()).expired = true;
      const recreated = await bounded(() => operator.wallet.createEntity(parameters('short')));
      assert.notEqual(recreated.entityKey, short.entityKey);
      const entity = await read(recreated.entityKey); state.recreated = recreated.entityKey;
      return {expiredEntityKey: short.entityKey, receiptExpiresAt: deadline.toString(), absenceAtBlock: head.toString(),
        absenceClassification: 'prior_create_receipt_plus_deadline_plus_live_query_absence', recreatedReadBack: view(entity)};
    });
    await run(cases[6], {file: 'skills/arkiv-entity-lifecycle/SKILL.md'}, async () => {
      const retiring = [...state.keys, state.recreated];
      const deleted = await bounded(() => operator.wallet.executeBatch({deletes: retiring.map(entityKey => ({entityKey}))}));
      for (const entityKey of retiring) await assert.rejects(operator.reader.getEntity(entityKey), error => error instanceof dependencies.sdk.NoEntityFoundError);
      return {txHash: deleted.txHash, deletedKeys: retiring, readBack: 'all_absent',
        retainedFirstWriteSeed: state.first.entityKey, retainedReason: 'Keep the exact helper seed for future reuse; never mutate a preexisting seed.'};
    });
    report.result = 'PASS';
  } catch (error) {
    failure ??= safeFailure(error, operator);
    Object.assign(report, {result: failure.operational ? 'SKIPPED' : 'FAIL', reason: failure.code,
      ...(failure.operational ? {operational: true} : {}), ...(failure.httpStatus ? {httpStatus: failure.httpStatus} : {}), ...(failure.retryAfter ? {retryAfter: failure.retryAfter} : {})});
    for (const definition of cases.filter(definition => !report.cases.some(test => test.id === definition.id))) report.cases.push({...definition, status: 'SKIPPED', reason: 'Suite stopped; no later sends attempted'});
  } finally {
    if (previousFetch) globalThis.fetch = previousFetch;
    if (operator) {
      report.proof = operator.proof();
      report.actualConfirmedSpendWei = [...operator.transactions.values()].reduce((sum, tx) => sum + BigInt(tx.actualCostWei ?? '0'), 0n).toString();
      report.unresolvedTransactionHashes = [...operator.transactions.values()].filter(tx => !['confirmed_success', 'confirmed_revert'].includes(tx.state)).map(tx => tx.hash);
      try {Object.assign(report, await operator.close());}
      catch {report.result = 'SKIPPED'; report.reason = 'JOURNAL_FINALIZATION_UNAVAILABLE'; report.operational = true;}
    }
    report.checkedAt = new Date().toISOString();
    if (await externalOutput(root, output)) await writeFile(output, json(report) + '\n', {flag: 'wx', mode: 0o600});
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const report = await runPublicLive();
    console.log(json({result: report.result, reason: report.reason, passedCases: report.cases.filter(test => test.status === 'PASS').length,
      confirmedTransactions: report.proof?.transactions.filter(tx => tx.state === 'confirmed_success').length ?? 0}));
    process.exit(report.result === 'FAIL' && !report.operational ? 1 : 0);
  } catch {console.error('Live verification could not write safe evidence'); process.exit(1);}
}
