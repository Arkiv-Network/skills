---
name: arkiv-first-write
description: Set up SDK 1.0.0 on Rabdi with an access key, typed schema, authorized signer and verified first entity. Use for quickstarts and idempotent seeds; use arkiv-app-integration for application endpoints.
license: MIT
metadata:
  arkiv-sdk: ">=1.0.0 <2"
  network: "rabdi"
  verified: "2026-10-30"
---

# First Arkiv write

Target **SDK 1.0.0, Rabdi, chain 7794095 (`0x76edaf`)**. Inspect the application's manifest, lockfile and installed declarations before giving executable SDK code. If evidence is unavailable, obtain it first. Read write-safety before bulk work or an uncertain submission.

## Prepare inputs and authorization

Use the app's package manager and explain an SDK upgrade before doing it. The SDK requires viem as a peer; do not force peer requirements. Get a free RPC key at [Hub access keys](https://hub.arkiv.network/access-keys) and fund a dedicated development EOA through the [Hub faucet](https://hub.arkiv.network/faucet). Never request a private key in chat. Keep locally held signing keys in the server's secret store.

Configure `rabdi({ accessKey })` and `http()` from viem. The SDK places the encoded access key in the URL path. Missing or non-string keys raise `MissingAccessKeyError`; an explicitly empty key opts into a heavily limited endpoint that can return HTTP 429. Keep operator keys server-side, sanitize transport errors and never expose keyed URLs in logs. Browser wallets use the RPC configured by their user.

Announce network, signer, entity and spend scope before broadcasting. Verify RPC chain ID and signer balance; compare an unsigned exact gas estimate plus current fee cap and margin with both available funds and the approved budget. An access key does not pay gas or authenticate app users. SDK 1.0.0 has no public create-estimator method: use [the guarded estimator](references/estimate.md), which blocks signing and broadcast.

## Define and create a note

This module exports helpers and performs no write on import. The caller supplies an authorized wallet, matching reader and explicit retention choice. A `recordIntent` callback must durably register this operation before entry; for process-crash recovery use [the importer](../arkiv-write-safety/references/resumable-import.md), which also captures signed bytes before forwarding.

```typescript
import { createPublicClient, createWalletClient, ExpirationTime, type Expiry, type TxParams } from '@arkiv-network/sdk';
import { defineSchema, str, bytes, u64 } from '@arkiv-network/sdk/schema';
import { eq } from '@arkiv-network/sdk/query';
import { rabdi } from '@arkiv-network/sdk/chains';
import { http, type LocalAccount } from 'viem';

export const Notes = defineSchema('example_first_note', {
  seed_id: str().indexed(), created_at: u64(), body: bytes(),
  media_type: str().default('application/json'),
});
export function clients(account: LocalAccount, accessKey: string) {
  const chain = rabdi({ accessKey });
  const transport = http(undefined, { retryCount: 0, timeout: 10000,
    fetchOptions: { cache: 'no-store', redirect: 'error' } });
  return { reader: createPublicClient({ chain, transport, cacheTime: 0 }),
    wallet: createWalletClient({ account, chain, transport, cacheTime: 0 }) };
}
export function firstNoteParameters(expiration: Expiry = ExpirationTime.fromDays(1)) {
  return { schema: Notes, values: { seed_id: 'welcome_v1', created_at: u64(Date.now()),
    body: new TextEncoder().encode(JSON.stringify({ text: 'Hello, Arkiv' })) },
    expiration, flags: { readonly: true, permissionlessExtension: false } };
}
type Clients = ReturnType<typeof clients>;
export async function ensureFirstNote({ reader, wallet }: Clients,
  recordIntent: () => Promise<void>, expiration: Expiry, txParams: TxParams) {
  if (await reader.getChainId() !== 7794095 || wallet.chain?.id !== 7794095) throw new Error('Wrong chain');
  const prior = await reader.select({ $key: true, $creator: true, $creationFlags: true, body: true, media_type: true })
    .from(Notes, { onMismatch: 'throw' }).createdBy(wallet.account.address)
    .where(eq('seed_id', 'welcome_v1')).limit(2).fetch();
  if (prior.entities.length > 1) throw new Error('Duplicate seed; reconcile');
  const expected = new TextEncoder().encode(JSON.stringify({ text: 'Hello, Arkiv' }));
  const existing = prior.entities[0];
  if (existing) {
    const expectedHex = '0x' + Array.from(expected, b => b.toString(16).padStart(2, '0')).join('');
    if (!existing.$creationFlags.readonly || existing.$creationFlags.permissionlessExtension ||
      existing.media_type.value !== 'application/json' || existing.body.value !== expectedHex) throw new Error('Seed differs; reconcile');
    return { entityKey: existing.$key, reused: true as const };
  }
  // Precondition: exclusive writer, sufficient funding, successful unsigned estimate,
  // and no unresolved earlier seed attempt in the durable operation registry.
  await recordIntent();
  const input = firstNoteParameters(expiration);
  const result = await wallet.createEntity(input.schema, input.values,
    { expiration: input.expiration, flags: input.flags }, txParams);
  // Persist returned hash/key immediately in the caller's durable writer.
  try {
    const receipt = await reader.getTransactionReceipt({ hash: result.txHash });
    const entity = await reader.getEntity(result.entityKey, Notes);
    if (receipt.status !== 'success' || !entity.$creationFlags.readonly ||
      entity.$creator.toLowerCase() !== wallet.account.address.toLowerCase() ||
      entity.$expiresAt !== result.expiresAt || entity.created_at.value !== input.values.created_at.value ||
      entity.body.value !== '0x' + Array.from(expected, b => b.toString(16).padStart(2, '0')).join('')) {
      throw new Error('Readback mismatch');
    }
    return { ...result, reused: false as const };
  } catch (cause) {
    throw Object.assign(new Error('Confirmed write needs reconciliation; do not resend', { cause }), result);
  }
}
```

Supply `txParams` from the approved exact estimate, buffered gas cap, current fees and exclusive signer nonce allocation. Controlled Rabdi checks found some default gas estimates insufficient; see troubleshooting's measured workaround. A fixed example cap is not a universal transaction limit.

Query-before-create prevents routine repeats under an exclusive writer; it is not atomic uniqueness. A missing result after an uncertain send does not authorize recreating. A reset or expired seed creates a new identity; update dependent references. Readonly still allows owner transfer, deletion and Lifetime Extension.

Create uses `(schema, values, options, txParams?)`, patch uses `(schema, entityKey, changes, txParams?)`. Options use `expiration`, while returned flat entity metadata uses `$expiresAt`. `createEntity` returns `entityKey`, `txHash`, receipt-derived `expiresAt`. Keep keys and transaction hashes separate and inspect them in the [Rabdi explorer](https://rabdi.explorer.arkiv.network).

## Project rules and verification

Offer this block for the consumer's AGENTS.md with consent, preserving its existing instructions:

```markdown
## Arkiv rules for this project
- Use SDK 1.0.0 on Rabdi (7794095); inspect installed version/declarations before executable SDK code.
- Declare typed schemas; index filter columns explicitly. Store binary/JSON data in named bytes columns, which cannot be filtered.
- Preserve constructor types; use u64 for app milliseconds and expiry-block predicates.
- Configure rabdi({ accessKey }); redact keyed URLs. Operator access/signing keys stay server-side and out of chat/public bundles.
- Reconcile uncertain writes before another submission; load the arkiv router for Arkiv tasks.
```

Read [testing](references/testing.md) for deterministic and funded checks. Test missing access keys, schema mismatch, invalid indexing, seed collision, reset identity, insufficient funding, wrong chain and confirmed-read failure. Each key has 100,000,000 quota units; each query costs 10, other calls zero under current policy. A rejected query is not an empty result.

Sources: [SDK 1.0.0 source](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/), [SDK README](https://unpkg.com/@arkiv-network/sdk@1.0.0/README.md). Inspect the installed declarations before adapting executable examples.
