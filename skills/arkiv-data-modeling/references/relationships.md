# Same-batch entity references

Use this only when parent and child must be created atomically and every creator using the signing account shares an exclusive queue. An in-process mutex does not coordinate another server or a user's wallet. If that coordination cannot be guaranteed, create the parent first and reference its returned key in a later transaction.

The key depends on chain ID, native system address, creator, **entity nonce** and salt. This entity nonce is separate from the account's transaction nonce. Each create consumes one entity nonce in the batch's create-array order. The SDK constructs operations in create, patch, delete, extend, transfer order.

Inside the exclusive queue:

1. Keep all prior uncertain/in-flight creations reconciled before prediction.
2. Use `predictEntityKeys({ owner: creator, count: 2 })`, which reads the creator's entity nonce and returns a key/salt pair for each create in order.
3. Reuse both returned salts in the fixed creates array. Use `key(parent.key)` on the child.
4. Submit the batch through the same authorized creator. Validate the returned create count and every key in order before publishing references.
5. If the nonce/prediction is stale or the result is uncertain, stop and reconcile receipt/state. Do not retry the same stale relationship blindly.

```typescript
import { createPublicClient, createWalletClient, ExpirationTime } from '@arkiv-network/sdk';
import { key, str } from '@arkiv-network/sdk/attr';
import { tiramisu } from '@arkiv-network/sdk/chains';
import type { Address } from 'viem';

type Public = ReturnType<typeof createPublicClient>;
type Wallet = ReturnType<typeof createWalletClient>;

// The caller holds the exclusive creator queue through receipt reconciliation.
export async function createAtomicListingAndTag(
  publicClient: Public,
  wallet: Wallet,
  creator: Address,
  listing_id: string,
  tag: string,
) {
  if (wallet.account?.address.toLowerCase() !== creator.toLowerCase()) {
    throw new Error('The queued creator must match the explicit wallet account');
  }
  if (wallet.chain?.id !== tiramisu.id || publicClient.chain?.id !== tiramisu.id) {
    throw new Error('Both clients must use Tiramisu');
  }
  const [parent, child] = await publicClient.predictEntityKeys({ owner: creator, count: 2 });
  const result = await wallet.executeBatch({
    creates: [
      {
        salt: parent.salt,
        payload: new TextEncoder().encode(JSON.stringify({ listing_id })),
        contentType: 'application/json',
        attributes: {
          project: str('example_marketplace'),
          entity_type: str('listing'),
          listing_id: str(listing_id),
        },
        expires: ExpirationTime.fromDays(30),
      },
      {
        salt: child.salt,
        payload: new Uint8Array(),
        contentType: 'application/octet-stream',
        attributes: {
          project: str('example_marketplace'),
          entity_type: str('listing_tag'),
          listing_key: key(parent.key),
          listing_id: str(listing_id),
          tag: str(tag),
        },
        expires: ExpirationTime.fromDays(30),
      },
    ],
  });
  if (result.createdEntities.length !== 2 ||
      result.createdEntities[0] !== parent.key || result.createdEntities[1] !== child.key ||
      result.patchedEntities.length !== 0 || result.deletedEntities.length !== 0 ||
      result.extendedEntities.length !== 0 || result.ownershipChanges.length !== 0) {
    throw new Error(`Reference prediction mismatch after ${result.txHash}; reconcile the receipt before any retry`);
  }
  return result;
}
```

A mismatch check runs **after** a successful transaction. It cannot roll back the batch or repair a child that already points at the wrong target. Exclusive creator coordination is the prevention; the check detects a violated contract. Preserve the confirmed transaction hash and actual keys for reconciliation. The non-create result arrays reflect the submitted SDK operation lists; their absence is not an independent on-chain proof. Application IDs and a repair policy remain useful for remapping.

Neither `key()` validation nor key prediction checks that a target exists. Parent deletion, expiration or replacement can leave a valid dangling reference. A transaction receipt is not a promise about future retention or the application's reorganization policy.

The identical relative lifetimes in this atomic batch resolve against the same inclusion block. For a child created in a later transaction, use `ExpirationTime.atBlock(parent.expiresAt)` without an `atLeast` floor when it must not outlive the parent. Obtain a batch-created parent's deadline with `getEntity`; `executeBatch` returns keys, not per-entity deadlines. Check a fresh head and an application-defined remaining-block margin before submitting children, and verify their actual deadlines after confirmation.

SDK 0.8.1 sources: [prediction](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/entity/key.ts), [entity nonce](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/actions/public/getEntityNonce.ts), [batch result](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/actions/wallet/executeBatch.ts), [operation construction](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/utils/arkivTransactions.ts). Checked 2026-10-05; exact example verified with deterministic real-SDK fixtures, without a funded live write.
