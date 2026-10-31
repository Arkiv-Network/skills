# Atomic relationships

Hold exclusive custody of every create from the signer between prediction and receipt reconciliation. An in-process mutex cannot coordinate another server, wallet app or tab. Otherwise create the parent first and use its confirmed key later.

`predictEntityKeys({ owner, count })` reads the creator's entity nonce, separate from the transaction nonce. Reuse every returned salt in create order. Validate the complete ordered result before publishing references; a post-confirmation mismatch requires repair, not resubmission.

```typescript
import { createPublicClient, createWalletClient, ExpirationTime, type Expiry } from '@arkiv-network/sdk';
import { defineSchema, str, key } from '@arkiv-network/sdk/schema';
import type { Address } from 'viem';
import { getGasPrice } from 'viem/actions';
type Wallet = ReturnType<typeof createWalletClient>;
type EstimateLatest = (prepare: (unsigned: Wallet) => Promise<unknown>) => Promise<bigint>;
const Parent = defineSchema('example_parent', { app_id: str().indexed() });
const Child = defineSchema('example_child', { app_id: str().indexed(), parent_key: key().indexed() });
export async function createRelated(reader: ReturnType<typeof createPublicClient>,
  wallet: ReturnType<typeof createWalletClient>, creator: Address, appId: string, estimateLatest: EstimateLatest,
  expiration: Expiry = ExpirationTime.fromDays(1)) {
  if (wallet.account?.address.toLowerCase() !== creator.toLowerCase() ||
      wallet.chain?.id !== 7794095 || reader.chain?.id !== 7794095) throw new Error('Wrong signer or chain');
  const predictions = await reader.predictEntityKeys({ owner: creator, count: 2 });
  const parent = predictions[0], child = predictions[1];
  if (!parent || !child) throw new Error('Incomplete predictions');
  const latest = await reader.getTransactionCount({ address: creator, blockTag: 'latest' });
  if (await reader.getTransactionCount({ address: creator, blockTag: 'pending' }) !== latest) throw new Error('Resolve pending nonce');
  const gasPrice = await getGasPrice(reader);
  const batch = { creates: [
    { schema: Parent, values: { app_id: appId }, salt: parent.salt, expiration },
    { schema: Child, values: { app_id: appId, parent_key: key(parent.key) }, salt: child.salt, expiration },
  ] };
  const estimate = await estimateLatest(unsigned => unsigned.executeBatch(batch));
  if (estimate <= 0n) throw new Error('Unsigned estimate required');
  const gas = 2n * estimate > 1400000n ? 2n * estimate : 1400000n;
  const result = await wallet.executeBatch(batch, { nonce: latest, gas, gasPrice });
  if ((await reader.getTransactionReceipt({ hash: result.txHash })).status !== 'success') throw new Error('Reverted batch; inspect before any retry');
  if (result.createdEntities.length !== 2 || result.createdEntities[0] !== parent.key || result.createdEntities[1] !== child.key ||
    result.patchedEntities.length || result.deletedEntities.length || result.extendedEntities.length || result.ownershipChanges.length) {
    throw Object.assign(new Error('Confirmed batch prediction mismatch; reconcile before retrying'), result);
  }
  return result;
}
```

Only the creating wallet's creates consume that entity nonce. Incoming transfers do not. Random predicted salts are the default; `NO_SALT` makes a key predictable but does not remove nonce dependence. A key reference does not enforce target existence, foreign keys or cascade behavior.

Precondition: an exact unsigned estimate and approved balance/spend check for these two small creates. Increase the gas cap for larger operations using first-write guidance; explicit nonce/gas/gasPrice is the Rabdi default. There is no automatic retry; at most one corrected attempt only after a confirmed revert, preserving salts and reconciling identity first.

Equal relative lifetimes in one batch share inclusion; later child transactions resolve relative life later. To prevent a later child outliving a parent, use the parent's observed `$expiresAt` with `ExpirationTime.atBlock(...)` and no relative floor, check remaining-life margin and verify the result. Batch results carry keys rather than deadlines; read the successful receipt and current entities.

Source: [SDK 1.0.0 prediction](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/actions/public/predictEntityKeys.ts), [batch](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/actions/wallet/executeBatch.ts).

The required `estimateLatest` callback is bound to the guarded unsigned estimator in `arkiv-first-write/references/estimate.md`: `prepare => estimateWrite(account, accessKey, prepare)`. It must estimate the supplied exact operation at latest, return its positive gas estimate, and propagate a sanitized original error without signing/sending. If preflight errors, stop. Funded writes always pass explicit `gas = max(1,000,000 + 400,000 × (ops − 1), 2 × estimate)`, current gasPrice and latest nonce; approve the resulting cost before admission.
