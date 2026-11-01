# Estimate without signing or broadcasting

Use public SDK 1.0.0 actions only through this guarded wallet. It intercepts gas estimation and also replaces the local account's signer with a refusal. The callback must use only the supplied wallet and let errors propagate. Do not enable raw RPC debugging; its URL contains an access key.

```typescript
import { createWalletClient } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { custom, http, MethodNotFoundRpcError, type LocalAccount } from 'viem';

// Diagnostics contain only fixed messages and validated local transaction identifiers.
type SafeDetails = { txHash?: string; entityKey?: string; expiresAt?: bigint };
const safeErrors = new WeakMap<object, { message: string; details: SafeDetails }>();
function safeError(message = 'Arkiv operation failed', details: SafeDetails = {}): Error & SafeDetails {
  const allowed: SafeDetails = {};
  for (const field of ['txHash', 'entityKey'] as const) {
    const value = details[field];
    if (typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)) allowed[field] = value;
  }
  if (typeof details.expiresAt === 'bigint' && details.expiresAt >= 0n && details.expiresAt < 2n ** 64n) allowed.expiresAt = details.expiresAt;
  const result = Object.assign(new Error(message), allowed);
  safeErrors.set(result, { message, details: { ...allowed } });
  return result;
}
function sanitizedFailure(error: unknown, fallback = 'Arkiv request failed; reconcile any admitted write before retrying'): Error & SafeDetails {
  const own = error !== null && typeof error === 'object' ? safeErrors.get(error) : undefined;
  if (own) return safeError(own.message, own.details);
  // Preserve this exact cross-recipe preflight verdict, never any attached diagnostics.
  try { if (error instanceof Error && error.message === 'Unsigned preparation/estimate failed') return safeError('Unsigned preparation/estimate failed'); } catch {}
  return safeError(fallback);
}



export async function estimateWithRequest(account: LocalAccount, chain: ReturnType<typeof rabdi>,
  rpc: Parameters<typeof custom>[0],
  prepare: (wallet: ReturnType<typeof createWalletClient>) => Promise<unknown>): Promise<bigint> {
  try {
    if (BigInt(await rpc.request({ method: 'eth_chainId' }) as string) !== 7794095n) throw safeError('Wrong chain');
    const reads = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber',
      'eth_getTransactionCount', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_estimateGas']);
    let gas: bigint | undefined;
    const stop = safeError('Unsigned estimate captured');
    const transport = custom({ async request(args) {
      if (args.method === 'eth_fillTransaction') throw new MethodNotFoundRpcError(safeError('Use guarded estimate path'));
      if (!reads.has(args.method)) throw safeError('Unexpected or mutating RPC blocked');
      const result = await rpc.request(args.method === 'eth_estimateGas'
        ? { method: 'eth_estimateGas', params: [args.params?.[0], 'latest'] } : args);
      if (args.method === 'eth_estimateGas') {
        if (typeof result !== 'string' || !/^0x[0-9a-f]+$/i.test(result)) throw safeError('Invalid estimate');
        gas = BigInt(result);
        if (gas <= 0n) throw safeError('Invalid estimate');
        throw stop;
      }
      return result;
    } }, { retryCount: 0 });
    const unsigned = { ...account, signTransaction: async () => { throw safeError('Signing blocked'); } };
    const wallet = createWalletClient({ account: unsigned, chain, transport });
    try { await prepare(wallet); }
    catch (error) {
      let cause: unknown = error;
      for (let depth = 0; cause && depth < 24; depth++) {
        if (cause === stop && gas !== undefined) return await gas;
        cause = typeof cause === 'object' ? (cause as { cause?: unknown }).cause : undefined;
      }
      throw safeError('Unsigned preparation/estimate failed');
    }
    throw safeError('Callback skipped estimation or swallowed the guard');
  } catch (error) {
    throw sanitizedFailure(error, 'Unsigned preparation/estimate failed');
  }
}
export function estimateWrite(account: LocalAccount, accessKey: string,
  prepare: (wallet: ReturnType<typeof createWalletClient>) => Promise<unknown>) {
  try {
    const chain = rabdi({ accessKey });
    const rpc = http(undefined, { retryCount: 0, timeout: 10000,
      fetchOptions: { cache: 'no-store', redirect: 'error' } })({ chain });
    return estimateWithRequest(account, chain, rpc, prepare);
  } catch (error) {
    throw sanitizedFailure(error, 'Unsigned preparation/estimate failed');
  }
}
```

Bind an `estimateLatest` callback in the other examples to `prepare => estimateWrite(account, accessKey, prepare)`. Its wallet is unsigned-only: signing and forwarding are blocked, and eth_estimateGas is pinned to latest. Invoke it with the exact frozen schema/values/options or batch that will be submitted; reuse explicit salts. If estimation fails, stop and display only fixed sanitized diagnostics, without raw or nested causes. The separately authorized funded wallet always sends explicit `gas = max(1,000,000 + 400,000 × (ops − 1), 2 × estimate)` with nonce and current gasPrice. Gas units are not a fee quote. Recompute fees and compare budget/balance before a separately authorized write. Never remove fee fields to manufacture a passing estimate. A successful estimate proves only this exact unsigned request at its observed state.

Source: [SDK transaction path](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/utils/arkivTransactions.ts).
