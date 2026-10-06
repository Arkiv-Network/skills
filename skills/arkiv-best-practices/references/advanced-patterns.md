# Data modeling

Use attributes for indexed filters and payloads for nested data. Validate decoded payloads before using them; a generic type does not validate data. Reuse the parser pattern in [integration patterns](integration-patterns.md) or the project's installed schema library.

Names start with a lowercase letter, then use lowercase letters, digits and `_`; avoid reserved query words. Index `project`, `entity_type`, application IDs, status and queryable timestamps. Store timestamps with `u64`, and use that constructor in predicates. Respect 30 application attributes on create. A schema validator cannot prevent another wallet from writing matching namespace values: scope trusted reads by creator and inspect mutable ownership.

## Relationship entities

There is no indexed array attribute. Model each queryable membership as an entity. This two-transaction pattern uses a stable application ID as the join; it does not require predicting a chain key. Treat the second write as independently recoverable: the first may have succeeded when membership creation fails.

```typescript
import {
  createWalletClient, createPublicClient, ExpirationTime, jsonToPayload,
} from "@arkiv-network/sdk"
import { eq } from "@arkiv-network/sdk/query"

type Wallet = ReturnType<typeof createWalletClient>
type Reader = ReturnType<typeof createPublicClient>

export async function createProfileWithSkills(wallet: Wallet, profileId: string) {
  const profile = await wallet.createEntity({
    payload: jsonToPayload({ name: "Alice" }), contentType: "application/json",
    attributes: { project: "example_profiles", entity_type: "profile", profile_id: profileId },
    expires: ExpirationTime.fromDays(30),
  })
  const memberships = await wallet.executeBatch({
    creates: ["frontend", "backend"].map(skill => ({
      payload: new Uint8Array(), contentType: "application/octet-stream",
      attributes: {
        project: "example_profiles", entity_type: "profile_skill",
        profile_id: profileId, skill,
      },
      expires: ExpirationTime.fromDays(30),
    })),
  })
  return { profile, memberships }
}

export async function findFrontendMemberships(reader: Reader) {
  return reader.select({ key: true, attributes: true })
    .where(eq("project", "example_profiles"), eq("entity_type", "profile_skill"), eq("skill", "frontend"))
    .limit(100).fetch()
}
```

The query returns memberships, not profiles. Follow their `profile_id` values to fetch profiles, and paginate if the result set is larger than one page. For trust, add your application's creator or ownership policy. Namespace filtering alone is not authenticity.

Application IDs are strings and do not imply uniqueness. Serialize or coordinate writers and reconcile existing IDs before seeding; query-then-create races under concurrency. Duplicate memberships need an application policy. Expiration of either endpoint leaves dangling relationships; decide whether to hide, preserve or recreate them. Align lifetimes and verify actual expiration blocks, since separate transactions can land at different heights.

For direct chain-key relations, store a typed `key(parentKey)` attribute and query it with the same constructor. A same-batch parent/child create can use predicted entity keys, but only with custody of the entity-minting nonce and known salts in exact create order. Concurrent creates from that owner invalidate predictions. A bare hex string is `str`, not `key`.

Schema versioning belongs in an explicit attribute or validated payload. Soft deletion is an application status filter, not erasure; remember to apply it in every reader. Counts and aggregates need raw filtered count or client-side computation; SQL joins and server ordering are not available from the builder.

Sources checked on 2026-10-05: published SDK 0.8.1 attribute values, key derivation, create and batch encoders, and query builder. The example demonstrates two transactions and one membership page, not an atomic upsert or all-page join.
