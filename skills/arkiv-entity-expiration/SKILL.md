---
name: arkiv-entity-expiration
description: Choose and verify Arkiv Entity Expiration and Lifetime Extension with @arkiv-network/sdk. Use for ExpirationTime helpers, absolute block deadlines, adding time to an existing entity, renewal races, permanent(), expiration sweeps, and expired or missing entities. Use arkiv-entity-lifecycle for permissions and arkiv-write-safety for uncertain transaction outcomes.
license: MIT
metadata:
  arkiv-sdk: ">=0.8.1 <0.9"
  network: tiramisu
  verified: "2026-10-05"
---

# Arkiv entity expiration

Entity Expiration is a block deadline. Lifetime Extension moves that deadline later; it does not add a duration automatically. Use the installed SDK and Tiramisu, and keep signer permissions separate from deadline calculations.

## Choose the right meaning

- Use this skill for lifetime units, renewal targets, imminent-expiration queries, and deciding whether a missing entity can be renewed.
- Use `arkiv-entity-lifecycle` for readonly/permissionless extension rights and replacement, and `arkiv-write-safety` when a renewal's submission or receipt is uncertain.
- Distinguish **add one hour to the current deadline** from **ensure at least one hour remains from now**. The first adds 1,800 blocks to the observed deadline; the second may need no write.

## Helpers and observed deadlines

| Helper | Meaning |
| --- | --- |
| `fromSeconds`, `fromMinutes`, `fromHours`, `fromDays`, `fromWeeks` | A relative lifetime floor measured from the inclusion block. |
| `fromMonths` / `fromYears` | Exactly 30-day months / 365-day years before conversion to blocks. |
| `fromBlocks(n)` | A positive whole number of blocks. |
| `atBlock(n)` | An absolute block deadline; it must still be live when submitted/applied. |
| `atDate(date)` | A date converted against the SDK's current block and local clock, rounding upward. |
| `atBlock` or `atDate` with `{ atLeast: fromHours(1) }` | An absolute deadline plus a minimum relative lifetime floor. |
| `permanent()` | The maximum u64 deadline, `(1n << 64n) - 1n`; an API value, not a durability promise. |

Relative helpers use a **nominal two seconds per block**. Converted seconds must be positive whole numbers divisible by two: `fromSeconds(3)` fails. Fractional minutes/hours are valid only if their converted seconds satisfy that rule. Real block production and local clocks can drift; these helpers do not enforce a wall-clock appointment.

The native operation carries an absolute deadline and a relative floor. The engine takes `max(absoluteDeadline, inclusionBlock + lifetimeFloor)`. A past `atBlock` can be constructed, then fail when the SDK resolves it before sending; a valid target can also become dead before inclusion. `atLeast` supplies a lifetime floor, not a promise the entity will disappear at the chosen date.

`createEntity().expiresAt` and `extendEntity().expiresAt` are decoded from their successful receipt events. Use those observed block values. SDK 0.8.1 create JSDoc describes a lower bound, but its implementation reads the emitted deadline; a pre-inclusion estimate is not the final observed expiration.

## Worked renewal and sweep

These exported functions require a same-network reader and an explicitly connected wallet. They do not send on import. Run renewals only when the user authorized the target and GLM spend.

```typescript
import {
  createPublicClient, createWalletClient, ExpirationTime, MAX_EXPIRES_AT,
} from "@arkiv-network/sdk"
import { u64 } from "@arkiv-network/sdk/attr"
import { eq, lte } from "@arkiv-network/sdk/query"
import type { Address, Hex } from "viem"

type Reader = ReturnType<typeof createPublicClient>
type Wallet = ReturnType<typeof createWalletClient>
const ONE_HOUR_BLOCKS = 1800n

async function readLive(reader: Reader, entityKey: Hex) {
  const entity = await reader.getEntity(entityKey)
  const head = await reader.getBlockNumber()
  if (entity.expiresAt <= head) throw new Error("Entity is no longer live; recreate it")
  return { entity, head }
}

export async function addOneHour(reader: Reader, wallet: Wallet, entityKey: Hex) {
  const { entity } = await readLive(reader, entityKey)
  if (entity.expiresAt > MAX_EXPIRES_AT - ONE_HOUR_BLOCKS) {
    throw new Error("One-hour extension exceeds the supported deadline range")
  }
  return wallet.extendEntity({
    entityKey,
    expires: ExpirationTime.atBlock(entity.expiresAt + ONE_HOUR_BLOCKS),
  })
}

export async function ensureOneHourRemains(
  reader: Reader, wallet: Wallet, entityKey: Hex,
) {
  const { entity, head } = await readLive(reader, entityKey)
  if (head > MAX_EXPIRES_AT - ONE_HOUR_BLOCKS) {
    throw new Error("Requested lifetime exceeds the supported deadline range")
  }
  const fromNow = head + ONE_HOUR_BLOCKS
  const target = entity.expiresAt > fromNow ? entity.expiresAt : fromNow
  if (target === entity.expiresAt) {
    return { status: "already_sufficient" as const, expiresAt: entity.expiresAt }
  }
  const extended = await wallet.extendEntity({
    entityKey, expires: ExpirationTime.atBlock(target),
  })
  return { status: "extended" as const, ...extended }
}

export function dateWithMinimumLife(date: Date) {
  return ExpirationTime.atDate(date, { atLeast: ExpirationTime.fromHours(1) })
}

export async function listExpiring(
  reader: Reader, project: string, trustedCreator: Address, withinBlocks: bigint,
) {
  if (withinBlocks < 0n) throw new Error("Choose a non-negative block window")
  const head = await reader.getBlockNumber()
  const cutoff = head > MAX_EXPIRES_AT - withinBlocks ? MAX_EXPIRES_AT : head + withinBlocks
  let page = await reader.select({ key: true, expiresAt: true })
    .where(eq("project", project), lte("$expiresAt", u64(cutoff)))
    .createdBy(trustedCreator).atBlock(head).limit(100).fetch()
  const entities = [...page.entities]
  while (page.hasNextPage()) {
    page = await page.next()
    entities.push(...page.entities)
  }
  return { atBlock: head, entities }
}
```

Adding one hour uses the deadline actually read, not `Date.now()` or only the current chain head. It can still race another renewal: if the deadline has changed, re-read and decide whether the original request is already satisfied or should be recomputed. Never automatically add another hour after an ambiguous confirmed transaction.

`ensureOneHourRemains` uses `max(existingDeadline, observedHead + 1800)`, skips equal targets, and returns the receipt's observed expiration after a write. Transaction inclusion can happen later than the observed head. If the product requires a full hour from inclusion, use a relative `fromHours(1)` floor with an explicitly later target and reconcile concurrent changes. Skip equal targets in the client; do not depend on a node rejecting a renewal that adds no lifetime.

## Expiration monitoring and end of life

- Natural expiration emits no event. Watches cover explicit operations such as Lifetime Extension; use periodic block checks and refresh queries.
- `listExpiring` returns still-queryable entities whose deadlines are approaching in one pinned snapshot. After expiration, those entities no longer appear: maintain prior known deadlines if you need to remove local cache entries or mirror state.
- An expired entity cannot be revived by extending its old key. Create a new entity, record its new key, and remap references under `arkiv-entity-lifecycle`.
- `NoEntityFoundError` can mean never created, deleted, expired, or the wrong network/key. Check the network, key, and known creation/expiration evidence; the exception alone does not identify the cause.
- Expiration removes live queryable state, not copies already read by others. Keep secrets out of plaintext payloads and attributes. With `permissionlessExtension`, a third party may keep a live entity beyond the owner's preferred deadline.

## Leases and recovery

Expiration can bound the lifetime of coordination state; it does not establish unique lock ownership or mutual exclusion. Query-then-create can race, block time can drift, renewal can fail, and readers can hold stale state. For a lease protocol, define the authoritative clock, writer coordination, ownership, fencing/version check, and recovery outside a mere deadline. Reject an expired lease before performing its protected operation.

| Error or condition | Response |
| --- | --- |
| `InvalidExpiryError` | Check units, positive even converted seconds, valid dates, u64 bounds, and a deadline after the observed head. |
| `ExpiryDeadOnArrival` | The target is already dead at application; choose a live target only within the authorized renewal intent. |
| `ExpiryNotExtended` | Re-read; the target is shorter than the current deadline, possibly because another renewal won the race. Skip equal client targets and do not blindly resend. |
| `EntityExpired` / `EntityNotFound` | A longer deadline does not restore a dead entity; investigate the identity and recreate when appropriate. |
| `NotOwner` | Check owner/connected account and whether permissionless extension was enabled at creation. |
| `EntityMutationError` with a hash | Inspect receipt status and `ExpiryExtended` before calculating another target. |

## Verification and sources

Verify the receipt's deadline and a fresh entity read after renewal. Treat a subsequent read failure as a verification issue, not proof the renewal failed. Optional connected read-only `verify_entity`/`verify_tx` tools may supplement this; inspect their schema and never pass a signing key.

- [Native expiration and events](https://docs.arkiv.network/json-rpc/mutating-entities/).
- [Entity lifecycle fundamentals](https://docs.arkiv.network/start-here/fundamentals/).
- [SDK source](https://github.com/Arkiv-Network/arkiv-sdk-js): published 0.8.1 `src/utils/expirationTime.ts`, `src/entity/expiry.ts`, `src/actions/wallet/{createEntity,extendEntity}.ts`, `src/utils/arkivTransactions.ts`, `src/entity/events.ts`, and `src/actions/public/getEntity.ts`.
