---
name: arkiv-entity-expiration
description: Choose and verify Entity Expiration and Lifetime Extension on Rabdi. Use for relative lifetimes, absolute block deadlines, renewal races and missing entities; use lifecycle for mutation permissions.
license: MIT
metadata:
  arkiv-sdk: ">=1.0.0 <2"
  network: "rabdi"
  verified: "2026-10-30"
---

# Entity Expiration and Lifetime Extension

SDK 1.0.0 uses **`expiration`** in create/extension inputs; flat entity reads expose **`$expiresAt`**. Returned create/extend results expose receipt-derived **`expiresAt`**. Deadlines are block heights, separate from application milliseconds.

| Helper | Meaning |
| --- | --- |
| `fromSeconds/Minutes/Hours/Days/Weeks` | Relative lifetime floor from inclusion |
| `fromMonths/Years` | 30-day months / 365-day years before conversion |
| `fromBlocks(n)` | Positive block floor |
| `atBlock(n)` | Absolute block deadline |
| `atDate(date)` | Deadline resolved using the SDK's clock/head conversion |
| `atBlock/atDate` with `{ atLeast }` | Absolute deadline plus a relative minimum floor |
| `permanent()` | Unavailable in SDK 1.0.0; Rabdi rejects the equivalent maximum-u64 deadline |

Nominal conversion uses two seconds per block; converted seconds must be positive whole multiples of two. These are SDK conversion rules, not a wall-clock service promise. The engine resolves `max(absolute, inclusion + floor)`; an absolute target can become dead before inclusion.

## Rabdi maximum lifetime

Rabdi does not offer an expiration-free option. A live maximum-u64 create on 2026-10-30 UTC reverted with `ExpiryBeyondMaxLifetime(18446744073709551615, 9547, 7884000)`: the target exceeded the current block plus **7,884,000 blocks**, approximately 182.5 days at the nominal block interval. The revert was independently confirmed by its receipt; decoding at latest observes the then-current block, not historical state.

Read maxLifetime from a published SDK/node parameter getter when one is available. The inspected SDK 1.0.0 public actions/native ABI expose no such getter; use the dated measured value above as network configuration, not a timeless protocol constant, and revalidate after reset/upgrade. Every helper, including fromMonths/fromYears and atLeast floors, is subject to this bound. Keep the target below `currentBlock + maxLifetime` with an inclusion margin; a near-maximum relative choice for the measured value is `fromBlocks(7_883_970)`. Longer-lived data requires successful Lifetime Extension before expiry, recurring monitoring and an available authorized payer. No single write guarantees indefinite availability.

## Add time versus ensure remaining life

```typescript
import { createPublicClient, createWalletClient, ExpirationTime, type TxParams } from '@arkiv-network/sdk';
import type { Hex } from 'viem';
import { getGasPrice } from 'viem/actions';
type Reader = ReturnType<typeof createPublicClient>;
type Wallet = ReturnType<typeof createWalletClient>;
const HOUR = 1800n;
async function params(reader: Reader, wallet: Wallet, gas = 1000000n): Promise<TxParams> {
  if (!wallet.account || gas < 1000000n) throw new Error('Authorized account and gas floor required');
  const address = wallet.account.address;
  const latest = await reader.getTransactionCount({ address, blockTag: 'latest' });
  if (await reader.getTransactionCount({ address, blockTag: 'pending' }) !== latest) throw new Error('Resolve pending nonce');
  return { nonce: latest, gas, gasPrice: await getGasPrice(reader) };
}
async function confirmed<T extends { txHash: Hex }>(reader: Reader, result: T): Promise<T> {
  if ((await reader.getTransactionReceipt({ hash: result.txHash })).status !== 'success') throw new Error('Reverted extension; inspect before any retry');
  return result;
}
// maxLifetime comes from current network configuration: a published getter, or dated measured fallback.
export async function addOneHour(reader: Reader, wallet: Wallet, entityKey: Hex, maxLifetime: bigint) {
  const entity = await reader.getEntity(entityKey);
  const head = await reader.getBlockNumber({ cacheTime: 0 });
  const target = entity.$expiresAt + HOUR;
  if (entity.$expiresAt <= head || maxLifetime <= HOUR + 30n || target > head + maxLifetime - 30n) throw new Error('Deadline outside live renewal window');
  return confirmed(reader, await wallet.extendEntity({ entityKey, expiration: ExpirationTime.atBlock(target) }, await params(reader, wallet)));
}
export async function ensureOneHourRemains(reader: Reader, wallet: Wallet, entityKey: Hex, maxLifetime: bigint) {
  const entity = await reader.getEntity(entityKey);
  const head = await reader.getBlockNumber({ cacheTime: 0 });
  if (entity.$expiresAt <= head || maxLifetime <= HOUR + 30n) throw new Error('Invalid live renewal window');
  if (entity.$expiresAt >= head + HOUR) return { status: 'already_sufficient' as const, expiresAt: entity.$expiresAt };
  const result = await confirmed(reader, await wallet.extendEntity({ entityKey,
    expiration: ExpirationTime.atBlock(head + HOUR, { atLeast: ExpirationTime.fromHours(1) }) }, await params(reader, wallet)));
  return { status: 'extended' as const, ...result };
}
```

The first helper adds to the observed deadline; a concurrent extension can race it. The second ensures a floor from inclusion and skips already sufficient life. It does not automatically add an hour after an uncertain send. Use low-water/refill thresholds for heartbeats rather than paying to renew every block. Re-read actual receipt-derived deadlines and verify fresh entity state.

Before these helpers, apply first-write's exact unsigned estimate, balance/spend approval and exclusive signer custody. Explicit nonce/gas/gasPrice is the Rabdi default; these single-operation examples use the measured 1,000,000 gas starting cap. They do not retry. At most one corrected attempt is permitted only after an authoritative reverted receipt; successful/uncertain writes require reconciliation.

An extension sets a target, not a delta. A shorter effective target is rejected; an equal target need not add lifetime. Do not infer receipt status from equality alone. Owner or immutable permissionless-extension policy determines who can renew. Expired entities cannot be revived; create a new identity only under the authorized recovery policy.

## Monitoring and absence

Use an indexed system predicate such as `lte('$expiresAt', u64(cutoff))` with explicit schema/creator scope, bounded pages and current-state pagination from query guidance. Natural expiration emits no event; sweep prior known deadlines against a fresh head and refetch extensions before acting on cached liveness.

`NoEntityFoundError` alone cannot distinguish never-created, deleted, expired, wrong chain or reset. Check known creation/extension receipts, correct key and network/reset identity. SDK 1.0.0 cannot query old state or recover complete missed history; preserve gaps explicitly rather than substituting head as a historical answer.

A lifetime is neither a mutex nor an app authorization lease. A coordination protocol needs a writer/fencing policy and must reject expired state before its protected action. Permissionless extension can prolong data availability. Deletion or expiration cannot retract already read copies.

Read write-safety for `EntityMutationError`, nonce uncertainty or readback failure after confirmation. No absent hash or unchanged nonce proves a send never occurred.

Sources: [SDK 1.0.0 source](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/), [SDK README](https://unpkg.com/@arkiv-network/sdk@1.0.0/README.md). Inspect the installed declarations before adapting executable examples.
