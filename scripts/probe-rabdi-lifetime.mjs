import {safeProviderError,safeProviderDiagnostic} from './safe-rpc-error.mjs';
// Explicitly authorized negative probe: one create, never automatically retried or repeated after reset.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

export async function probeRabdiLifetime() {
  try {
    const workspace = path.resolve(process.env.ARKIV_SNIPPET_WORKSPACE ?? '.checks');
    const stateRoot = process.env.ARKIV_SEED_STATE_DIR;
    assert.ok(stateRoot && path.isAbsolute(stateRoot), 'Private durable state directory required');
    const sdkRoot = path.join(workspace, 'node_modules/@arkiv-network/sdk');
    assert.equal(JSON.parse(await fs.readFile(path.join(sdkRoot, 'package.json'), 'utf8')).version, '1.0.0');
    const sdk = await import(pathToFileURL(path.join(sdkRoot, 'dist/index.js')));
    const chains = await import(pathToFileURL(path.join(sdkRoot, 'dist/chains/index.js')));
    const viem = await import(pathToFileURL(path.join(workspace, 'node_modules/viem/_esm/index.js')));
    const accounts = await import(pathToFileURL(path.join(workspace, 'node_modules/viem/_esm/accounts/index.js')));
    const accessKey = process.env.ARKIV_ACCESS_KEY_A;
    const signer = accounts.privateKeyToAccount(process.env.TEST_SKILLS_PRIVATE_KEY);
    assert.equal(signer.address.toLowerCase(), process.env.TEST_SKILLS_ADDRESS?.toLowerCase());
    const chain = chains.rabdi({ accessKey });
    const rpc = viem.http(undefined, { retryCount: 0, timeout: 15000,
      fetchOptions: { cache: 'no-store', redirect: 'error' } })({ chain });
    let signatures = 0, broadcasts = 0;
    const reader = sdk.createPublicClient({ chain, cacheTime: 0, transport: viem.custom({ request: rpc.request }, { retryCount: 0 }) });
    assert.equal(await reader.getChainId(), 7794095);
    const genesis = await reader.getBlock({ blockNumber: 0n });
    assert.ok(genesis.hash);
    const directory = path.join(stateRoot, 'lifetime-probe-v1-' + genesis.hash.slice(2, 18));
    const previous = (await fs.readdir(stateRoot)).filter(name => name.startsWith('lifetime-probe-v1-'));
    assert.ok(previous.every(name => name === path.basename(directory)), 'A reset does not authorize another negative create');
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const journalPath = path.join(directory, 'journal.jsonl');
    const summaryPath = path.join(directory, 'public-summary.json');
    const append = async event => {
      const file = await fs.open(journalPath, 'a', 0o600);
      try { await file.writeFile(JSON.stringify(event) + '\n'); await file.sync(); }
      finally { await file.close(); }
    };
    let events;
    try { events = (await fs.readFile(journalPath, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code !== 'ENOENT') throw error; events = []; }
    let hash = events.find(event => event.state === 'submitting')?.txHash;
    let sdkError;
    if (!events.length) {
      const nonce = await reader.getTransactionCount({ address: signer.address, blockTag: 'latest' });
      assert.equal(await reader.getTransactionCount({ address: signer.address, blockTag: 'pending' }), nonce, 'Pending transaction blocks negative probe');
      const gasPrice = await reader.getGasPrice(), gas = 1000000n;
      assert.ok(gas * gasPrice <= 2n * 10n ** 15n, 'Negative probe maximum fee exceeds 0.002 GLM');
      assert.ok(await reader.getBalance({ address: signer.address }) >= gas * gasPrice);
      const file = await fs.open(journalPath, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify({ state: 'prepared', chainId: chain.id, genesisHash: genesis.hash,
        signer: signer.address, nonce, gas: gas.toString(), gasPrice: gasPrice.toString(), target: ((1n << 64n) - 1n).toString() }) + '\n'); await file.sync(); }
      finally { await file.close(); }
      const account = { ...signer, signTransaction: async transaction => {
        assert.equal(signatures, 0, 'Exactly one signature is authorized');
        assert.equal(transaction.nonce, nonce);
        const raw = await signer.signTransaction(transaction);
        assert.equal((await viem.recoverTransactionAddress({ serializedTransaction: raw })).toLowerCase(), signer.address.toLowerCase());
        signatures++;
        hash = viem.keccak256(raw);
        await append({ state: 'submitting', txHash: hash, raw });
        return raw;
      } };
      const wallet = sdk.createWalletClient({ account, chain, cacheTime: 0, transport: viem.custom({ request: async input => {
        if (input.method.startsWith('eth_send')) {
          assert.equal(input.method, 'eth_sendRawTransaction');
          assert.equal(broadcasts, 0, 'Exactly one broadcast is authorized');
          assert.equal(viem.keccak256(input.params[0]), hash);
          broadcasts++;
        }
        return rpc.request(input);
      } }, { retryCount: 0 }) });
      const Model = sdk.defineSchema('skills_lifetime_negative_v1', { test_id: sdk.str().indexed() });
      try {
        await wallet.createEntity(Model, { test_id: 'max-u64-rejection' },
          { expiration: sdk.ExpirationTime.atBlock((1n << 64n) - 1n), salt: 1n }, { nonce, gas, gasPrice });
        assert.fail('Maximum-u64 create unexpectedly succeeded; retain evidence and do not repeat');
      } catch (error) {
        if (error.name === 'AssertionError') throw error;
        // SDK's decoded engine explanation contains no RPC URL. Do not log nested transport errors.
        if (error.name === 'EntityMutationError' && /maximum lifetime/.test(error.message)) sdkError = "Maximum lifetime rejection reported by SDK";
        await append({ state: 'sdk_returned', txHash: hash, errorName: "ProviderError", engineExplanation: sdkError });
      }
      events = (await fs.readFile(journalPath, 'utf8')).trim().split('\n').map(JSON.parse);
    }
    assert.ok(hash, 'Prepared probe has no known hash; reconcile private state without creating again');
    const submitted = events.filter(event => event.state === 'submitting');
    assert.equal(submitted.length, 1);
    const raw = submitted[0].raw;
    assert.equal(viem.keccak256(raw), hash);
    assert.equal((await viem.recoverTransactionAddress({ serializedTransaction: raw })).toLowerCase(), signer.address.toLowerCase());
    const transaction = viem.parseTransaction(raw);
    assert.equal(transaction.chainId, 7794095);
    const receipt = await reader.getTransactionReceipt({ hash });
    assert.equal(receipt.from.toLowerCase(), signer.address.toLowerCase());
    assert.equal(receipt.status, 'reverted', 'Only an authoritative reverted receipt satisfies this negative probe');
    assert.ok(receipt.gasUsed < transaction.gas, 'Must establish lifetime rejection separately from gas exhaustion');
    let decoded, literalRpcMessage;
    const ABI = viem.parseAbi(['error ExpiryBeyondMaxLifetime(uint64 target, uint64 currentBlock, uint64 maxLifetime)']);
    try { await reader.call({ account: signer.address, to: transaction.to, data: transaction.data, blockTag: 'latest' }); }
    catch (error) {
      const seen = new Set();
      const visit = object => {
        if (!object || typeof object !== 'object' || seen.has(object)) return;
        seen.add(object);
        if (typeof object.data === 'string') {
          try { decoded = viem.decodeErrorResult({ abi: ABI, data: object.data }); } catch {}
        }
        for (const field of ['message', 'details']) {
          if (typeof object[field] === 'string' && object[field].startsWith('execution reverted')) {
            literalRpcMessage = 'execution reverted';
          }
        }
        for (const field of ['cause', 'error', 'data']) visit(object[field]);
      };
      visit(error);
    }
    assert.equal(decoded?.errorName, 'ExpiryBeyondMaxLifetime', 'Preserve known hash and inspect error without another create');
    const [target, currentBlock, maxLifetime] = decoded.args;
    assert.equal(target, (1n << 64n) - 1n);
    assert.equal(maxLifetime, 7884000n);
    const summary = { passed: true, sdk: '1.0.0', permanentHelper: typeof sdk.ExpirationTime.permanent,
      chainId: chain.id, genesisHash: genesis.hash, signer: signer.address, txHash: hash,
      transactionNonce: transaction.nonce, to: transaction.to, valueWei: (transaction.value ?? 0n).toString(), receiptStatus: receipt.status,
      receiptBlock: receipt.blockNumber.toString(), gasLimit: transaction.gas.toString(), gasUsed: receipt.gasUsed.toString(),
      feeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
      literalError: `ExpiryBeyondMaxLifetime(${target}, ${currentBlock}, ${maxLifetime})`, literalRpcMessage,
      target: target.toString(), currentBlock: currentBlock.toString(), maxLifetime: maxLifetime.toString(),
      sdkExplanation: sdkError ?? (events.some(event => event.state === 'sdk_returned') ? 'SDK response recorded; see decoded receipt verification' : undefined),
      interpretation: 'Receipt establishes the original revert; latest read-only replay decodes the error at its current observation block, not the receipt block',
      signatures, broadcasts, reused: signatures === 0, queries: 0, verifiedAt: new Date().toISOString() };
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), { mode: 0o600 });
    return summary;
  } catch (error) { throw safeProviderError(error, 'lifetime'); }
}
