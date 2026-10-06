---
name: arkiv-data-modeling
description: Design typed Arkiv entity models for application queries, PostgreSQL mappings, marketplace schemas and relationships. Use when choosing attributes versus payload, exact numeric encodings, application IDs, entity-key references or consistency rules. This skill designs models; importing rows and executing writes require their own authorization.
license: MIT
metadata:
  arkiv-sdk: ">=0.8.1 <0.9"
  network: "tiramisu"
  verified: "2026-10-05"
---

# Model data for the queries you need

## When to use

Use this skill before implementing an Arkiv entity schema. Start with the requested screen or operation: which entity type it returns, filters, ranges, sort, expected cardinality, trusted creators and update policy.

For an existing error, use arkiv-troubleshooting first. Use arkiv-query for pagination and raw queries, arkiv-entity-lifecycle for mutation permissions, and arkiv-security-trust for authorization. For a first transaction, use arkiv-first-write.

Check the installed SDK version and declarations. Examples below target SDK 0.8.1 on Tiramisu. Producing a model does not authorize publishing data or spending GLM.

## Storage rules

- Put scalar fields needed by predicates in **attributes**. Put nested objects, arrays, long descriptions and other unqueried data in **payload**. Both are public; exclude secrets and private fields before encoding either.
- Create permits 32 cells total. Payload and content type consume two, leaving **30 user attributes**, including namespace and schema fields. Patches also count system mutations against their operation budget.
- Use lowercase `snake_case` application names, at most 32 bytes, beginning with a letter. The SDK accepts a wider alphabet than the current node; this conservative convention avoids the uppercase node rejection. `project` plus `entity_type` scopes an application's data. Anyone can copy these values; scope trusted reads by creator too.
- A `str` holds at most 128 UTF-8 bytes and excludes C0 controls and DEL. Validate a text limit from the input contract; never silently truncate or replace a requested text filter with a hash.
- There are nine user attribute types. `bytes` is system-only payload storage, not a tenth user type. No indexed array, object or null constructor exists.

| Constructor | Representation and use | Bare default |
| --- | --- | --- |
| `bool(true)` | Boolean | `true` / `false` |
| `i32(10)` | Signed 32-bit integer | JavaScript `number` |
| `u64(1700000000000n)` | Unsigned 64-bit integer; app milliseconds and blocks | None |
| `u256(1250n)` | Unsigned 256-bit integer; exact minor currency/token units | JavaScript `bigint` |
| `dec('12.50')` | Signed fixed-point, 18 decimal places; canonical decimal string | None |
| `bytes32('0x' + 'ab'.repeat(32))` | Exactly 32 opaque bytes | None |
| `str('listing_42')` | UTF-8 text | JavaScript `string` |
| `addr('0x1111111111111111111111111111111111111111')` | Address | None |
| `key('0x' + '12'.repeat(32))` | Entity reference; dangling targets are allowed | None |

Use the same constructor when writing and querying: `price_minor: u256(1250n)` pairs with `eq('price_minor', u256(1250n))`. Bare `1250` is `i32`; bare `1250n` is `u256`. A timestamp from `Date.now()` needs `u64(...)` because it exceeds `i32`.

For exact money, choose a documented currency and scale. Store nonnegative minor units with `u256`, or signed decimal amounts with `dec` using a decimal string. Fractional JavaScript numbers are rejected by `dec`; excess decimal precision is rejected, not rounded. Decide rounding in the application's numeric layer.

Omit a nullable attribute when absent; an update to null must unset the old attribute. Preserve `0`, `false` and `''`. Infer absence only from a complete attribute projection. JSON payload can retain explicit null, array order and duplicates.

`createdAt`, `updatedAt` and `expiresAt` metadata are block heights. Store application time separately as `created_at: u64(milliseconds)` with a declared clock/timezone policy.

## Worked marketplace model

This creates a listing, then its tag relationships in a second transaction. Run it only with an authorized, funded Tiramisu wallet. The caller supplies a stable application ID and exact price. The result is not an upsert or uniqueness guarantee.

```typescript
import { createWalletClient, ExpirationTime } from '@arkiv-network/sdk';
import { addr, bool, i32, key, str, u64, u256 } from '@arkiv-network/sdk/attr';
import type { Address } from 'viem';

type Wallet = ReturnType<typeof createWalletClient>;
type Listing = {
  listing_id: string;
  seller: Address;
  price_minor: bigint;
  currency: string;
  title: string;
  tags: string[];
  created_at: bigint;
};

export function listingInput(listing: Listing) {
  return {
    payload: new TextEncoder().encode(JSON.stringify({
      title: listing.title,
      tags: listing.tags,
      description: null,
    })),
    contentType: 'application/json',
    attributes: {
      project: str('example_marketplace'),
      entity_type: str('listing'),
      schema_version: i32(1),
      listing_id: str(listing.listing_id),
      seller: addr(listing.seller),
      price_minor: u256(listing.price_minor),
      currency: str(listing.currency),
      active: bool(true),
      created_at: u64(listing.created_at),
    },
    expires: ExpirationTime.fromDays(30),
  };
}

export async function createListingAndTags(wallet: Wallet, listing: Listing) {
  const parent = await wallet.createEntity(listingInput(listing));
  if (listing.tags.length === 0) return { parent, tags: undefined };
  const tags = await wallet.executeBatch({
    creates: listing.tags.map((tag) => ({
      payload: new Uint8Array(),
      contentType: 'application/octet-stream',
      attributes: {
        project: str('example_marketplace'),
        entity_type: str('listing_tag'),
        listing_id: str(listing.listing_id),
        listing_key: key(parent.entityKey),
        tag: str(tag),
      },
      expires: ExpirationTime.fromDays(30),
    })),
  });
  return { parent, tags };
}
```

The first transaction can succeed while tag creation fails. Persist its transaction hash and returned entity key, reconcile existing tag identities, and repair the second step without blindly creating another listing. A membership identity can include listing ID, tag and ordinal when duplicates matter.

The `seller` attribute is an application claim, not proof of who signed. Read the entity's creator and owner for provenance and mutation authority. Keep the payload tags and relationship projection consistent, or choose one authoritative representation. A relation's deadline is independent of its target's deadline.

## Relations, versions and races

- **Returned keys:** create a parent first, then use `key(parent.entityKey)` on children. Key references do not enforce foreign keys or cascades. Handle missing, deleted or expired targets with a policy such as hiding an orphan or repairing the relation.
- **Application IDs:** stable string IDs survive recreation and cross-provider mappings. Keep them distinct from entity keys. Resolve joins within project/type/creator scope; multiple matches require an explicit duplicate/version policy.
- **Same-batch references:** predict keys only under an exclusive creator queue shared by every process using that account. Read the entity nonce inside that queue; fix salts and create order; compare receipt keys to predictions. See [relationships.md](references/relationships.md) before using this mode.
- **Uniqueness/upserts:** a read-then-create can race and create duplicates. Arkiv does not implement SQL unique constraints for application attributes. Use a coordinated writer or choose deterministic conflict resolution; a random salt does not enforce application uniqueness. A transaction nonce is different from the entity nonce.
- **Versioning:** index `schema_version` for migrations. Define how old/new schemas coexist, how consumers choose revisions, and how replaced entity keys are remapped. Readonly content requires a new entity and updated references.
- **Soft delete:** `active: bool(false)` is an application filter, not deletion or a privacy control. Other readers can still request the data. Deletion and Entity Expiration remove live entities but cannot retract copies someone already read.
- **Reorganizations and uncertain writes:** make projections replayable from stable application identities. Reconcile receipt/state at the application's chosen confirmation policy before retrying a transaction or repointing references.
- **Top-N/aggregates:** the current SDK does not expose application-attribute ordering or general aggregates. Fetch the required pages before sorting a copy or aggregating; sorting one page cannot establish a global top-N. A raw filtered count is a separate API operation, not a general aggregate.

## Errors to recognize

| Error or exact message fragment | Model correction |
| --- | --- |
| `InvalidValueError` / `wider than 64 bits` | Choose a fitting type; do not coerce a large number through JavaScript `number`. |
| `a fractional number cannot be represented exactly in binary floating point` | Pass `dec` a decimal string. |
| `MissingValueError` / `An attribute is either set with a value and a type or not set at all` | Omit an absent attribute; unset it when patching to absence. |
| `TooManyAttributesError` | Count the operation's system cells and user attributes. Move unqueried data to payload. |
| `Ident32InvalidByte` | Check names; use the conservative lowercase convention. |
| `NoEntityFoundError` | A relation target may be missing, deleted or expired; do not assume historical erasure. |

For a tool-assisted schema proposal, check the actual tool's input and output contract. A `check_schema` string match is not a certification. If a connected profile offers `generate_entity_model` or `design_entity_model`, treat the result as a model to review; its presence does not authorize writes. This skill works directly from source schemas without those tools.

## References

- Read [postgres-to-entity.md](references/postgres-to-entity.md) when mapping PostgreSQL fields and constraints.
- Read [relationships.md](references/relationships.md) for atomic predicted-key references and their concurrency contract.
- SDK 0.8.1: [npm package](https://www.npmjs.com/package/@arkiv-network/sdk/v/0.8.1), [attribute values](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/attr/values.ts), [cell encoding](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/attr/attributes.ts), [key derivation](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/entity/key.ts).
- Official docs: [entity fundamentals](https://docs.arkiv.network/start-here/fundamentals/), [querying data](https://docs.arkiv.network/typescript-sdk/querying-data/), [mutating entities](https://docs.arkiv.network/json-rpc/mutating-entities/).

Verified against SDK 0.8.1 source and retained Tiramisu query probes on 2026-10-05. Examples compile and execute with the real SDK over deterministic fixtures; no funded live writes were performed for this skill.
