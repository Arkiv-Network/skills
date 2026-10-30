---
name: arkiv-entity-lifecycle
description: Create, patch, transfer, replace and delete Arkiv entities with SDK 1.0.0. Use for immutable creation flags, ownership, native batches and restoring references; use write-safety for uncertain submissions.
license: MIT
metadata:
  arkiv-sdk: ">=1.0.0 <2"
  network: "rabdi"
  verified: "2026-10-30"
---

# Arkiv entity lifecycle

Use installed SDK 1.0.0 declarations and Rabdi. Native operations target `0x4400000000000000000000000000000000000044`; this does not enable arbitrary application contracts. Run mutations only within the user's entity, signer and spending authorization. Read access does not authorize deletion.

## Flags and permissions

| readonly | permissionlessExtension | Patch | Extend | Transfer | Delete |
| --- | --- | --- | --- | --- | --- |
| false | false | Owner | Owner | Owner | Owner |
| false | true | Owner | Anyone | Owner | Owner |
| true | false | Nobody | Owner | Owner | Owner |
| true | true | Nobody | Anyone | Owner | Owner |

Both flags default false and are immutable. They apply to live entities. Readonly protects attributes, including bytes columns; owner operations can still affect availability. Permissionless extension grants no patch, transfer or deletion right, and can postpone an owner's preferred expiration.

`$owner` is current authority; `$creator` is the creating wallet. A transfer needs no recipient consent. Creator plus current owner cannot authenticate mutable values after a transfer away/edit/transfer back. Follow the [publication policy](../arkiv-security-trust/SKILL.md#trust-a-publication-not-a-namespace).

## Exact write signatures

```typescript
import { createWalletClient, createPublicClient, ExpirationTime, type Expiry } from '@arkiv-network/sdk';
import { defineSchema, str, bytes, u64 } from '@arkiv-network/sdk/schema';
import { isAddressEqual, zeroAddress, type Address, type Hex } from 'viem';

export const Notes = defineSchema('example_notes', {
  status: str().indexed(), created_at: u64(), body: bytes(),
  draft_reason: str().optional(),
});
type Wallet = ReturnType<typeof createWalletClient>;
type Reader = ReturnType<typeof createPublicClient>;
export function publish(wallet: Wallet, expiration: Expiry) {
  return wallet.createEntity(Notes, { status: 'published', created_at: u64(Date.now()),
    body: new TextEncoder().encode('Public example') }, { expiration, flags: { readonly: true } });
}
export function patchDraft(wallet: Wallet, entityKey: Hex) {
  return wallet.patchEntity(Notes, entityKey, { set: { status: 'published' }, unset: ['draft_reason'] });
}
export async function transferAndInspect(reader: Reader, wallet: Wallet, entityKey: Hex, newOwner: Address) {
  const before = await reader.getEntity(entityKey, Notes);
  if (isAddressEqual(newOwner, zeroAddress) || isAddressEqual(newOwner, before.$owner)) throw new Error('Choose another nonzero owner');
  const transferred = await wallet.changeOwnership({ entityKey, newOwner });
  try {
    const after = await reader.getEntity(entityKey, Notes);
    return { ...transferred, ownerAtRead: after.$owner,
      creatorUnchanged: isAddressEqual(before.$creator, after.$creator) };
  } catch { return { ...transferred, status: 'confirmed_read_failed' as const }; }
}
export function extend(wallet: Wallet, entityKey: Hex, deadline: bigint) {
  return wallet.extendEntity({ entityKey, expiration: ExpirationTime.atBlock(deadline) });
}
// Only invoke when deletion of this exact entity is independently authorized.
export function remove(wallet: Wallet, entityKey: Hex) { return wallet.deleteEntity({ entityKey }); }
```

`patchEntity(schema, key, { set, unset }, txParams?)` changes only named columns. Unmentioned or undefined values remain. `unset` accepts only optional columns; required ones must keep a value. Defaults apply to creates only. Patch cannot change identity, owner, flags or expiration and has no compare-and-set. Coordinate same-owner writers.

Create uses `(schema, values, { expiration, flags?, salt? }, txParams?)`. Batches place `{ schema, values, expiration, flags?, salt? }` in `creates`, and `{ schema, entityKey, set?, unset? }` in `patches`. The SDK orders creates → patches → deletes → extensions → ownership changes. One batch is atomic regardless of object property order; multiple batches are independent. Deleting then extending the same key fails the whole native batch.

## Corrections and identity

Readonly corrections require a new entity and old-to-new mapping. Validate source provenance, preserve original creator/ownership history in an independently authenticated manifest and update authorized app references. A correction never authorizes deleting the original. New creates initially belong to and identify the restoring signer, not the old creator.

Same-batch key references require exclusive coordination of all creates from that signer, exact predicted salts and complete ordered key validation. Read [relationships](../arkiv-data-modeling/references/relationships.md). On a mismatch after confirmation retain the actual keys/hash and reconcile instead of resending.

Deletion and natural expiration remove live availability, not copies already read. A missing entity can also mean wrong key/network or reset. An expired entity cannot be revived under its original key. Read [backup/restore](references/backup-restore.md) for authenticated capture and reference remapping and expiration guidance for deadlines.

Verify successful receipts and fresh selected fields after each operation. A later read is a head observation, not necessarily the transaction's block state. Any ambiguous send or decoding failure goes to write-safety before another mutation.

Sources: [SDK 1.0.0 source](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/), [SDK README](https://unpkg.com/@arkiv-network/sdk@1.0.0/README.md). Inspect the installed declarations before adapting executable examples.
