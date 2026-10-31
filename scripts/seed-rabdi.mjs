import {safeProviderError,safeProviderDiagnostic} from './safe-rpc-error.mjs';
// Explicitly authorized synthetic seed. Never import keys or send on module import.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function seedRabdi(metrics = { queries: 0, signatures: 0, broadcasts: 0 }) {
  try {
    const workspace = path.resolve(process.env.ARKIV_SNIPPET_WORKSPACE ?? path.join(repository, '.checks'));
    const stateRoot = process.env.ARKIV_SEED_STATE_DIR;
    assert.ok(stateRoot && path.isAbsolute(stateRoot), 'Supply an existing absolute private ARKIV_SEED_STATE_DIR');
    await fs.access(stateRoot);
    const accessKey = process.env.ARKIV_ACCESS_KEY_A;
    const privateKey = process.env.TEST_SKILLS_PRIVATE_KEY;
    const address = process.env.TEST_SKILLS_ADDRESS;
    assert.ok(accessKey && privateKey && address, 'Configure the dedicated SKILLS signer and RPC key in the local secret store');
    const sdkRoot = path.join(workspace, 'node_modules/@arkiv-network/sdk');
    assert.equal(JSON.parse(await fs.readFile(path.join(sdkRoot, 'package.json'), 'utf8')).version, '1.0.0');
    const sdk = await import(pathToFileURL(path.join(sdkRoot, 'dist/index.js')));
    const chains = await import(pathToFileURL(path.join(sdkRoot, 'dist/chains/index.js')));
    const query = await import(pathToFileURL(path.join(sdkRoot, 'dist/query/index.js')));
    const viem = await import(pathToFileURL(path.join(workspace, 'node_modules/viem/_esm/index.js')));
    const accounts = await import(pathToFileURL(path.join(workspace, 'node_modules/viem/_esm/accounts/index.js')));
    const signer = accounts.privateKeyToAccount(privateKey);
    assert.equal(signer.address.toLowerCase(), address.toLowerCase(), 'Dedicated signer address mismatch');
    let signatures = 0, broadcasts = 0, queries = 0, reconciliationOnly = false;
    const account = { ...signer, signTransaction: async (...args) => {
      assert.ok(!reconciliationOnly, 'Legacy seed reconciliation cannot sign');
      signatures++; metrics.signatures++; return signer.signTransaction(...args);
    } };
    const chain = chains.rabdi({ accessKey });
    const rpc = viem.http(undefined, { timeout: 15000, retryCount: 0,
      fetchOptions: { cache: 'no-store', redirect: 'error' } })({ chain });
    const request = async input => {
      if (input.method === 'arkiv_query') { queries++; metrics.queries++; }
      if (input.method.startsWith('eth_send')) {
        assert.ok(!reconciliationOnly, 'Legacy seed reconciliation cannot broadcast');
        broadcasts++; metrics.broadcasts++;
      }
      return rpc.request(input);
    };
    const reader = sdk.createPublicClient({ chain, cacheTime: 0, transport: viem.custom({ request }, { retryCount: 0 }) });
    assert.equal(await reader.getChainId(), 7794095);
    const genesis = await reader.getBlock({ blockNumber: 0n });
    assert.ok(genesis.hash, 'Missing network reset identity');
    const epoch = genesis.hash.slice(2, 18);
    const directory = path.join(stateRoot, `skills-seed-v1-${epoch}`);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    // Never migrate an unresolved prior-epoch journal into a fresh plan.
    for (const entry of await fs.readdir(stateRoot)) {
      if (!entry.startsWith('skills-seed-v1-') || entry === path.basename(directory)) continue;
      const journal = await fs.readFile(path.join(stateRoot, entry, 'journal.jsonl'), 'utf8').catch(error => {
        if (error.code === 'ENOENT') return ''; throw error;
      });
      const events = journal.trim().split('\n').filter(Boolean).map(JSON.parse);
      const submitted = events.filter(e => e.state === 'submitting');
      assert.ok(submitted.every(e => events.some(v => v.index === e.index && v.state === 'verified')),
        'Unresolved prior network-epoch attempt; reconcile before reseeding');
    }
    const markdown = await fs.readFile(path.join(repository, 'skills/arkiv-write-safety/references/resumable-import.md'), 'utf8');
    const fences = [...markdown.matchAll(/```javascript\r?\n([\s\S]*?)\r?\n```/g)];
    assert.equal(fences.length, 1);
    const source = fences[0][1];
    const sourceHash = createHash('sha256').update(source).digest('hex');
    const runtime = path.join(workspace, 'runtime');
    await fs.mkdir(runtime, { recursive: true });
    const helperPath = path.join(runtime, `resumable-import-${sourceHash}.mjs`);
    try { await fs.writeFile(helperPath, source, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST' || await fs.readFile(helperPath, 'utf8') !== source) throw error; }
    let helper = await import(pathToFileURL(helperPath));
    let replaySourceHash = sourceHash;
    const Seed = sdk.defineSchema('skills_rabdi_seed_v1', {
      app_id: sdk.str().indexed(), rank: sdk.u64().indexed(), price: sdk.dec().indexed(),
      active: sdk.bool().indexed().default(true), body: sdk.bytes(),
      media_type: sdk.str().default('application/json'), note: sdk.str().optional(),
    });
    const planPath = path.join(directory, 'plan.json');
    const journalPath = path.join(directory, 'journal.jsonl');
    const trustPath = path.join(directory, 'trusted-plan.json');
    const summaryPath = path.join(directory, 'public-summary.json');
    let planSha256;
    try {
      const trusted = JSON.parse(await fs.readFile(trustPath, 'utf8'));
      if (trusted.sourceHash !== sourceHash) {
        // Only the exact already-verified v1 seed helper may reconcile completed old state.
        // It cannot sign or forward; unfinished/different revisions still require explicit reconciliation.
        assert.ok(new Set(["4be8fd1aa74b3157cb3500198a4af3032343d079a94a9cb0eafac69d1044e78e","13ec3281c778e336103f7b151c764ef8848b6a55de535da7d8fd08384f155d6c","b379b3b48f55fe569538d674b37e0e56eeb82fd0badc35cefb74f41fd8b4537c"]).has(trusted.sourceHash), 'Unrecognized importer revision; retain original journal');
        const previousPlan = JSON.parse(await fs.readFile(planPath, 'utf8'));
        const entries = (await fs.readFile(journalPath, 'utf8')).trim().split('\n').map(JSON.parse);
        assert.ok(previousPlan.batches.every(batch => entries.some(event => event.index === batch.index && event.state === 'verified')),
          'Only completed old seed state can be reconciled with the prior helper');
        const previousPath = path.join(runtime, `resumable-import-${trusted.sourceHash}.mjs`);
        const previousSource = await fs.readFile(previousPath, 'utf8');
        assert.equal(createHash('sha256').update(previousSource).digest('hex'), trusted.sourceHash, 'Prior helper integrity mismatch');
        reconciliationOnly = true;
        replaySourceHash = trusted.sourceHash;
        helper = await import(pathToFileURL(previousPath));
      }
      planSha256 = trusted.planSha256;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // Querying a natural key is an extra collision check, never permission to replay an unknown send.
      const prior = await reader.count().from(Seed).createdBy(account.address).fetch();
      assert.equal(prior, 0n, 'Seed exists without this trusted journal; reconcile rather than duplicate');
      const head = await reader.getBlockNumber({ cacheTime: 0 });
      const gasPrice = await reader.getGasPrice();
      const options = { account, chain, request, planPath, journalPath, jobId: 'skills-rabdi-seed-v1',
        batchSize: 4, gasCeiling: 3000000n,
        maxTotalCost: 10n ** 16n, fees: { gasPrice },
        rows: Array.from({ length: 4 }, (_, index) => ({ id: `sample-${index}`, schema: Seed,
          values: { app_id: `skills-example-${index}`, rank: sdk.u64(index), price: sdk.dec(`${index}.25`),
            body: new TextEncoder().encode(JSON.stringify({ text: `Synthetic Arkiv example ${index}` })),
            ...(index === 0 ? { note: 'optional example' } : {}) },
          salt: BigInt(index + 1), expiresAt: head + 43200n,
          flags: { readonly: true, permissionlessExtension: false } })),
      };
      const prepared = await helper.prepareImport(options);
      planSha256 = prepared.planSha256;
      const file = await fs.open(trustPath, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify({ sourceHash, planSha256 })); await file.sync(); }
      finally { await file.close(); }
    }
    const result = await helper.runImport({ account, chain, request, planPath, journalPath, planSha256 });
    assert.equal(result.state, 'complete', 'Known write needs reconciliation; do not retry with a new plan');
    const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
    const entities = plan.batches.flatMap(batch => batch.rows.map(row => row.expectedKey));
    const page = await reader.select({ $key: true, $creator: true, $expiresAt: true,
      $creationFlags: true, $attributeSchema: true, app_id: true, rank: true, price: true, body: true, note: true })
      .from(Seed, { onMismatch: 'throw' }).createdBy(account.address).orderBy(query.asc('rank')).withCount().limit(100).fetch();
    assert.equal(page.count, 4n);
    assert.equal(page.entities.length, 4);
    assert.equal(page.skipped, 0);
    assert.deepEqual(page.entities.map(row => row.rank.value), [0n, 1n, 2n, 3n]);
    for (const row of page.entities) {
      assert.ok(entities.includes(row.$key));
      assert.equal(row.$creationFlags.readonly, true);
      assert.equal(row.$attributeSchema.rank.indexed, true);
      assert.equal(row.$attributeSchema.body.indexed, false);
      const original = plan.batches.flatMap(batch => batch.rows).find(item => item.expectedKey === row.$key);
      assert.equal(row.body.value, original.values.body.value);
    }
    const journal = (await fs.readFile(journalPath, 'utf8')).trim().split('\n').map(JSON.parse);
    const hashes = journal.filter(e => e.state === 'receipt_confirmed').map(e => e.txHash);
    const receipts = [];
    let feeWei = 0n;
    for (const hash of hashes) {
      const receipt = await reader.getTransactionReceipt({ hash });
      assert.equal(receipt.status, 'success');
      const cost = receipt.gasUsed * receipt.effectiveGasPrice;
      feeWei += cost;
      receipts.push({ txHash: hash, status: receipt.status, blockNumber: receipt.blockNumber.toString(),
        blockHash: receipt.blockHash, gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice.toString(), feeWei: cost.toString() });
    }
    assert.ok(feeWei <= BigInt(plan.maxTotalCost), 'Observed fees exceed the approved seed cap');
    const summary = { sdk: '1.0.0', chainId: chain.id, genesisHash: genesis.hash, signer: account.address,
      state: result.state, sourceHash, replaySourceHash, reconciliationOnly, planSha256, entityKeys: entities, transactionHashes: hashes,
      observedBlock: page.blockNumber.toString(), signatures, broadcasts, queries, reused: signatures === 0,
      receipts, feeWei: feeWei.toString(), maximumApprovedCostWei: plan.maxTotalCost,
      bodyAndIndexingVerified: true, verifiedAt: new Date().toISOString() };
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), { mode: 0o600 });
    return { summary, reader, Seed, sdk, query, workspace };
  } catch (error) { throw safeProviderError(error, 'seed'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const metrics = { queries: 0, signatures: 0, broadcasts: 0 };
  try { console.log(JSON.stringify((await seedRabdi(metrics)).summary, null, 2)); }
  catch (error) { console.error(JSON.stringify({ status: 'blocked', ...safeProviderDiagnostic(error, 'seed'), metrics })); process.exitCode = 1; }
}
