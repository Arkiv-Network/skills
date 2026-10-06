# Estimate without broadcasting

SDK 0.8.1's `createEntity` submits by default and does not expose its operation encoder as a public API. Do not call it on an ordinary wallet transport merely to estimate. This guard uses public viem transport APIs, captures an actual `eth_estimateGas` result, and refuses broadcast before anything reaches the provider.

Pass the same `CreateEntityParameters` used for the proposed write, such as `firstNoteParameters()` in the main example. The account stays local. The SDK may prepare and sign in memory; the signed transaction is never forwarded or returned. Use only a trusted local development account and do not enable raw RPC/debug logging.

```typescript
import { createWalletClient, type CreateEntityParameters } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { custom, http, type Chain, type LocalAccount } from "viem";

export async function estimateCreate(
  account: LocalAccount,
  data: CreateEntityParameters,
  rpcUrl: string = tiramisu.rpcUrls.default.http[0],
  chain: Chain = tiramisu,
): Promise<bigint> {
  const rpc = http(rpcUrl, { retryCount: 0, timeout: 10_000 })({ chain });
  const chainId = await rpc.request({ method: "eth_chainId" });
  if (typeof chainId !== "string" || !/^0x[0-9a-f]+$/i.test(chainId)
      || BigInt(chainId) !== BigInt(chain.id)) throw new Error("Wrong chain for dry run");
  const reads = new Set([
    "eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getTransactionCount",
    "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_estimateGas", "eth_fillTransaction",
  ]);
  let gas: bigint | undefined;
  const transport = custom({
    async request(args) {
      if (args.method === "eth_sendRawTransaction" || args.method === "eth_sendTransaction") {
        throw new Error("Dry run: broadcast blocked");
      }
      if (!reads.has(args.method)) throw new Error("Dry run: unexpected RPC method blocked");
      let request = args;
      if (args.method === "eth_estimateGas") {
        const params = args.params as readonly [Record<string, unknown>, ...unknown[]];
        // Avoid balance-capping the simulation for an unfunded development EOA.
        // Keep from/to/data unchanged; fee sufficiency is checked separately before a write.
        const { gasPrice, maxFeePerGas, maxPriorityFeePerGas, ...transaction } = params[0];
        request = { ...args, params: [transaction, ...params.slice(1)] } as typeof args;
      }
      const result = await rpc.request(request);
      if (args.method === "eth_estimateGas") {
        if (typeof result !== "string" || !/^0x[0-9a-f]+$/i.test(result)) {
          throw new Error("Dry run: invalid gas estimate");
        }
        gas = BigInt(result);
        throw new Error("Dry run: estimate captured; stop before signing");
      }
      return result;
    },
  }, { retryCount: 0 });
  const wallet = createWalletClient({ account, chain, transport });
  try {
    await wallet.createEntity(data);
  } catch (error) {
    if (gas !== undefined) return gas;
    // A blocked send without eth_estimateGas, including provider fill shortcuts,
    // is not evidence of a successful estimate. Preserve the cause locally.
    throw new Error("Dry-run preparation or gas estimation failed", { cause: error });
  }
  throw new Error("Dry-run guard did not stop submission");
}
```

Only report success when the helper returns a gas value. Test the guard against both broadcast methods, an estimation failure and an unexpected RPC method. No provider request may use a broadcast method. Estimation can still fail because of network, fee or state requirements; do not weaken the guard or invent a passed estimate.

Gas units are not a fee quote. Recompute current fees and verify funding before a separately authorized write. The proposed payload, block conversion and chain state can change between estimation and inclusion.

Sources: [SDK transaction path](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/utils/arkivTransactions.ts), [viem custom transport](https://viem.sh/docs/clients/transports/custom), [viem HTTP transport](https://viem.sh/docs/clients/transports/http).
