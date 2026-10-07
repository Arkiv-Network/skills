# SDK examples (0.8.1)

Read the installed SDK declarations before using a method. Use `@arkiv-network/sdk/attr` for typed values, `/query` for predicates and query errors, `/chains` for Tiramisu, and `viem` for transports and accounts. There is no SDK accounts subpath.

## Native mutations

This module exports examples; call them only for entities you own and operations the user authorized. A readonly entity cannot be patched. Ownership transfer changes who can mutate next.

```typescript
import {
  createWalletClient, createPublicClient, ExpirationTime, jsonToPayload,
} from "@arkiv-network/sdk"
import { i32, u64, u256, dec, str, addr, key, bytes32, bool } from "@arkiv-network/sdk/attr"
import type { Hex, Address } from "viem"

type Wallet = ReturnType<typeof createWalletClient>
type Reader = ReturnType<typeof createPublicClient>

export function valueExamples(address: Address, entityKey: Hex, digest: Hex) {
  return {
    priority: i32(5), created_at: u64(Date.now()), balance: u256(1000000n),
    score: dec("4.5"), label: str("note"), publisher: addr(address),
    parent: key(entityKey), digest: bytes32(digest), active: bool(true),
  }
}

export async function createReadonly(wallet: Wallet) {
  return wallet.createEntity({
    payload: jsonToPayload({ message: "Published snapshot" }),
    contentType: "application/json",
    attributes: { project: "example_notes", entity_type: "snapshot" },
    expires: ExpirationTime.fromDays(30),
    flags: { readonly: true, permissionlessExtension: false },
  })
}

export async function patchNote(wallet: Wallet, entityKey: Hex) {
  return wallet.patchEntity({
    entityKey, set: { status: "published", updated_at: u64(Date.now()) },
    unset: ["draft_reason"],
  })
}

export async function replaceNotePayload(wallet: Wallet, entityKey: Hex) {
  return wallet.patchEntity({
    entityKey, payload: jsonToPayload({ message: "Corrected note" }),
    contentType: "application/json",
  })
}

export async function addOneHour(reader: Reader, wallet: Wallet, entityKey: Hex) {
  const current = await reader.getEntity(entityKey)
  if (current.expiresAt > (1n << 64n) - 1n - 1800n) {
    throw new Error("Expiration already exceeds this renewal's supported target range")
  }
  return wallet.extendEntity({
    entityKey, expires: ExpirationTime.atBlock(current.expiresAt + 1800n),
  })
}

export async function transfer(wallet: Wallet, entityKey: Hex, newOwner: Address) {
  return wallet.changeOwnership({ entityKey, newOwner })
}

export async function removeOwnedEntity(wallet: Wallet, entityKey: Hex) {
  return wallet.deleteEntity({ entityKey })
}

export async function createNotes(wallet: Wallet, messages: readonly string[]) {
  if (!messages.length) return null
  return wallet.executeBatch({
    creates: messages.map(message => ({
      payload: jsonToPayload({ message }), contentType: "application/json",
      attributes: { project: "example_notes", entity_type: "note" },
      expires: ExpirationTime.fromDays(30),
    })),
  })
}
```

- Create returns `entityKey`, `txHash`, `expiresAt`. The implementation reads `expiresAt` from the successful `EntityCreated` log. Its JSDoc's lower-bound wording is inconsistent with that implementation; do not rely on a pre-inclusion estimate as the observed expiration.
- Patch and delete do not accept expiration. Extension sets a target relative to now or an explicit absolute block, never adds a duration to the existing expiration automatically.
- Equal or shorter extension can revert with `ExpiryNotExtended`. Re-read after a concurrent renewal before deciding to retry. Adding blocks to a maximum-u64 expiration overflows the valid range; treat that entity as already beyond any ordinary requested renewal.
- Transfer requires a valid address different from the current owner and zero address. Creator remains unchanged.
- `executeBatch` returns `txHash` and key arrays: `createdEntities`, `patchedEntities`, `deletedEntities`, `extendedEntities`, `ownershipChanges`. New keys come from create logs; other arrays reflect keys supplied in the request. Order is creates → patches → deletes → extensions → ownership changes, regardless of object property order. Empty batch throws `No operations to perform`.
- Write methods accept optional `TxParams` as the second argument: gas, transaction nonce, and either legacy gas price or EIP-1559 fee fields. Do not mix fee styles or invent a nonce without controlling the signer queue.

## Values and limits

Indexed constructors: `i32`, `u64`, `u256`, `dec`, `str`, `addr`, `key`, `bytes32`, `bool`. Opaque payload bytes are a system cell, not an indexed application value. Defaults: boolean → bool; number → i32; bigint → u256; string → str. Null, undefined, nested objects, and arrays are not application attribute values; omit absent attributes.

Returned `entity.attributes` is an object keyed by name, not an array: read `entity.attributes.note_id?.value`, never `.find(...)`. Each value includes a type tag. Select attributes explicitly in a query before reading them.

Use `u64` for timestamps. `dec` accepts a decimal string with up to 18 decimal places and returns decimal strings when read. `str` rejects C0 controls and DEL and limits UTF-8 bytes to 128. Names must start with a letter; use lowercase to also satisfy the node. Avoid reserved words and keep names within 32 bytes. Names and limits are validated separately by SDK and node; node rejects uppercase names even though SDK permits them.

Create always includes payload and lowercase content type without MIME parameters: use an empty `Uint8Array` for attribute-only entities. Payload's SDK limit is 128 KiB, which does not mean an encoded transaction of that size will fit the node's transaction limit.

## Read clients and events

Create public clients with `http()` or `http(tiramisu.rpcUrls.default.http[0])`. Passing the RPC URL array is a type error. No signing key is needed to read. With Next.js use `http(url, { fetchOptions: { cache: "no-store" } })` for fresh RPC reads.

`watchEntityEvents` returns a synchronous unwatch function. It provides `onEntityCreated`, `onEntityPatched`, `onExpiryExtended`, `onOwnershipTransferred`, `onEntityDeleted`, and `onEvent` handlers. Logs carry identity and operation metadata, not payload or attributes; fetch the entity to determine whether it matches the application query. Filter by known entity keys. For newly created entities, fetch and validate the candidate before adding its key.

HTTP watches poll. A WebSocket transport without `fromBlock` supports push; a bigint `fromBlock` requests replay and forces polling in viem. Use a measured current checkpoint, never an invented future block. Catch rejected promises inside async event handlers; the watcher only catches synchronous throws. Expiration has no event, so periodic refresh remains necessary.

For CDN imports use the version before the subpath, such as `https://esm.sh/@arkiv-network/sdk@0.8.1/query`. Browser writing still requires an explicit account and an injected provider; never embed a signing key in a CDN example.

Sources checked on 2026-10-05: published SDK 0.8.1 `src/actions/wallet/*`, `src/attr/{values,attributes}.ts`, `src/entity/{flags,operations,expiry}.ts`, `src/utils/arkivTransactions.ts`, `src/actions/public/watchEntityEvents.ts`, and installed viem `actions/public/watchEvent.ts`.
