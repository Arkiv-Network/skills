# Estimate without signing or broadcasting

Use public SDK 1.0.0 actions only through this guarded wallet. It intercepts gas estimation and also replaces the local account's signer with a refusal. The callback must use only the supplied wallet and let errors propagate. Do not enable raw RPC debugging; its URL contains an access key.

```typescript
import { createWalletClient } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { custom, http, MethodNotFoundRpcError, type LocalAccount } from 'viem';

export async function estimateWrite(account: LocalAccount, accessKey: string,
  prepare: (wallet: ReturnType<typeof createWalletClient>) => Promise<unknown>): Promise<bigint> {
  const chain = rabdi({ accessKey });
  const rpc = http(undefined, { retryCount: 0, timeout: 10000,
    fetchOptions: { cache: 'no-store', redirect: 'error' } })({ chain });
  if (BigInt(await rpc.request({ method: 'eth_chainId' }) as string) !== 7794095n) throw new Error('Wrong chain');
  const reads = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber',
    'eth_getTransactionCount', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_estimateGas']);
  let gas: bigint | undefined;
  const stop = new Error('Unsigned estimate captured');
  const transport = custom({ async request(args) {
    if (args.method === 'eth_fillTransaction') throw new MethodNotFoundRpcError(new Error('Use guarded estimate path'));
    if (!reads.has(args.method)) throw new Error('Unexpected or mutating RPC blocked');
    const result = await rpc.request(args);
    if (args.method === 'eth_estimateGas') {
      if (typeof result !== 'string' || !/^0x[0-9a-f]+$/i.test(result)) throw new Error('Invalid estimate');
      gas = BigInt(result);
      if (gas <= 0n) throw new Error('Invalid estimate');
      throw stop;
    }
    return result;
  } }, { retryCount: 0 });
  const unsigned = { ...account, signTransaction: async () => { throw new Error('Signing blocked'); } };
  const wallet = createWalletClient({ account: unsigned, chain, transport });
  try { await prepare(wallet); }
  catch (error) {
    let cause: unknown = error;
    for (let depth = 0; cause && depth < 24; depth++) {
      if (cause === stop && gas !== undefined) return gas;
      cause = typeof cause === 'object' ? (cause as { cause?: unknown }).cause : undefined;
    }
    throw new Error('Unsigned preparation/estimate failed', { cause: error });
  }
  throw new Error('Callback skipped estimation or swallowed the guard');
}
```

Invoke with `wallet => wallet.createEntity(Schema, values, options)` or `wallet => wallet.executeBatch(batch)` without a gas override. Gas units are not a fee quote. Recompute fees and compare budget/balance before a separately authorized write. Never remove fee fields to manufacture a passing estimate. A successful estimate proves only this exact unsigned request at its observed state.

Source: [SDK transaction path](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/utils/arkivTransactions.ts).
