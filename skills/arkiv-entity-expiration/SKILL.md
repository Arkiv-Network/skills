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
| `permanent()` | Maximum u64 deadline, not a durability guarantee |

Nominal conversion uses two seconds per block; converted seconds must be positive whole multiples of two. These are SDK conversion rules, not a wall-clock service promise. The engine resolves `max(absolute, inclusion + floor)`; an absolute target can become dead before inclusion.

## Add time versus ensure remaining life

```typescript
import { createPublicClient, createWalletClient, ExpirationTime, MAX_EXPIRES_AT } from '@arkiv-network/sdk';
import type { Hex } from 'viem';
type Reader = ReturnType<typeof createPublicClient>;
type Wallet = ReturnType<typeof createWalletClient>;
const HOUR = 1800n;
export async function addOneHour(reader: Reader, wallet: Wallet, entityKey: Hex) {
  const entity = await reader.getEntity(entityKey);
  const head = await reader.getBlockNumber({ cacheTime: 0 });
  if (entity.$expiresAt <= head || entity.$expiresAt > MAX_EXPIRES_AT - HOUR) throw new Error('Invalid live deadline');
  return wallet.extendEntity({ entityKey, expiration: ExpirationTime.atBlock(entity.$expiresAt + HOUR) });
}
export async function ensureOneHourRemains(reader: Reader, wallet: Wallet, entityKey: Hex) {
  const entity = await reader.getEntity(entityKey);
  const head = await reader.getBlockNumber({ cacheTime: 0 });
  if (entity.$expiresAt <= head || head > MAX_EXPIRES_AT - HOUR) throw new Error('Invalid live deadline');
  if (entity.$expiresAt >= head + HOUR) return { status: 'already_sufficient' as const, expiresAt: entity.$expiresAt };
  const result = await wallet.extendEntity({ entityKey,
    expiration: ExpirationTime.atBlock(head + HOUR, { atLeast: ExpirationTime.fromHours(1) }) });
  return { status: 'extended' as const, ...result };
}
```

The first helper adds to the observed deadline; a concurrent extension can race it. The second ensures a floor from inclusion and skips already sufficient life. It does not automatically add an hour after an uncertain send. Use low-water/refill thresholds for heartbeats rather than paying to renew every block. Re-read actual receipt-derived deadlines and verify fresh entity state.

An extension sets a target, not a delta. A shorter effective target is rejected; an equal target need not add lifetime. Do not infer receipt status from equality alone. Owner or immutable permissionless-extension policy determines who can renew. Expired entities cannot be revived; create a new identity only under the authorized recovery policy.

## Monitoring and absence

Use an indexed system predicate such as `lte('$expiresAt', u64(cutoff))` with explicit schema/creator scope, bounded pages and current-state pagination from query guidance. Natural expiration emits no event; sweep prior known deadlines against a fresh head and refetch extensions before acting on cached liveness.

`NoEntityFoundError` alone cannot distinguish never-created, deleted, expired, wrong chain or reset. Check known creation/extension receipts, correct key and network/reset identity. SDK 1.0.0 cannot query old state or recover complete missed history; preserve gaps explicitly rather than substituting head as a historical answer.

A lifetime is neither a mutex nor an app authorization lease. A coordination protocol needs a writer/fencing policy and must reject expired state before its protected action. Permissionless extension can prolong data availability. Deletion or expiration cannot retract already read copies.

Read write-safety for `EntityMutationError`, nonce uncertainty or readback failure after confirmation. No absent hash or unchanged nonce proves a send never occurred.

Sources: [SDK 1.0.0 source](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/), [SDK README](https://unpkg.com/@arkiv-network/sdk@1.0.0/README.md). Inspect the installed declarations before adapting executable examples.
