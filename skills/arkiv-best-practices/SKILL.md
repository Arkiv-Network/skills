---
name: arkiv-best-practices
description: Best practices, patterns, and practical examples for building applications with Arkiv — a decentralized Ethereum database with queryable, time-scoped storage. Use this skill whenever the user is working with Arkiv SDK, the @arkiv-network/sdk package, Arkiv entities, Arkiv queries, the select() query API, Arkiv attributes, ExpiresIn/expiration, the Braga testnet, or building any application that stores, queries, or manages data on the Arkiv network. Also use when the user mentions decentralized data storage on Ethereum, blockchain database, Web3 data storage, on-chain data, entity CRUD operations with expiration, arkiv_query, migrating an Arkiv project from Kaolin to Braga, or upgrading an Arkiv project to SDK 0.7.x (viem peer dependency, buildQuery to select migration, orderBy removal).
---

# Arkiv Best Practices & Practical Examples

Arkiv is a decentralized data layer that brings queryable, time-scoped storage to Ethereum. It lets developers store, query, and manage data with built-in expiration and attribute systems. Think of it as an Ethereum-native database where every record (called an **entity**) has a payload, typed attributes for querying, and a programmable lifespan.

## Architecture Overview

Arkiv uses three layers:

1. **Ethereum Mainnet** — Final settlement, proof verification, source of truth.
2. **Arkiv Coordination Layer** — Data management, registry, cross-chain sync.
3. **Specialized DB-Chains** — High-performance CRUD via JSON-RPC, indexed queries, programmable expiration.

## Core Concepts

### Entities

An entity is a data record containing:

- **Payload** — The actual data (JSON, text, binary)
- **Attributes** — Key-value pairs for querying (string or numeric)
- **ExpiresIn** — Automatic expiration measured in seconds (use `ExpirationTime` helpers)
- **Content Type** — MIME type of the payload

### Attributes

Attributes are the backbone of querying. Use the right type for each attribute because it determines what query operators are available:

```typescript
// String attributes — support eq() equality checks
{ key: 'type', value: 'note' }
{ key: 'status', value: 'active' }

// Numeric attributes — support eq(), gt(), lt(), gte(), lte() range queries
{ key: 'priority', value: 5 }
{ key: 'created', value: Date.now() }
```

**Important:** If you store a number as a string (`{ key: 'priority', value: '5' }`), you lose the ability to do range queries with `gt()`, `lt()`, etc. Always use numeric values for attributes you plan to filter by range.

**Important:** Numeric attribute values must be **integers**. A float like `19.99` throws an `InvalidAttributeError` (the SDK validates this client-side since 0.7.0). Scale non-integers to a fixed precision instead — store `19.99` as `1999` cents and divide on read.

Glob pattern matching on string attributes (`~`) exists at the protocol level but is **not yet exposed in the TypeScript SDK** — if you need it, use the raw JSON-RPC API (see `references/api-reference.md`).

### ExpiresIn

Every entity has a lifespan expressed in **seconds**. Always use the `ExpirationTime` helper to convert human-readable durations — never hardcode raw numbers:

```typescript
import { ExpirationTime } from "@arkiv-network/sdk/utils";

ExpirationTime.fromMinutes(30); // 1800 seconds
ExpirationTime.fromHours(1); // 3600 seconds
ExpirationTime.fromHours(12); // 43200 seconds
ExpirationTime.fromHours(24); // 86400 seconds
ExpirationTime.fromDays(7); // 604800 seconds
```

**Important:** The `expiresIn` field takes a value in **seconds**. A raw number like `expiresIn: 3600` means 3600 seconds (1 hour). Always prefer `ExpirationTime.fromMinutes()`, `ExpirationTime.fromHours()`, or `ExpirationTime.fromDays()` for readability and to avoid mistakes.

**Important:** Arkiv measures expiration in whole blocks (1 block = 2 seconds), so `expiresIn` must be a **positive integer and a multiple of 2** — otherwise the SDK throws an `InvalidExpirationError`. The `ExpirationTime` helpers always produce valid values, which is another reason to use them over raw numbers.

Entities can be extended before they expire using `extendEntity()`. Over-allocating expiration wastes storage fees — start short and extend if needed.

## SDK Setup

Arkiv provides a TypeScript SDK. For detailed SDK reference, read `references/sdk-reference.md`.

### TypeScript (Node.js / Bun)

```bash
npm install @arkiv-network/sdk viem
# or
bun add @arkiv-network/sdk viem
```

The SDK builds on [viem](https://viem.sh) and declares it as a **peer dependency** since `0.7.0`, so install `viem` alongside the SDK. The SDK no longer re-exports viem's internals — `http`, `custom`, `privateKeyToAccount`, `Hex`, etc. must be imported from `viem` / `viem/accounts` directly.

**Check the installed SDK version before writing code** — the API differs across versions:

- `0.7.0+` — viem is a peer dependency; query with `select()`; `orderBy`/`asc`/`desc` are deprecated no-ops.
- `0.6.5` – `0.6.x` — `http`, `custom`, `privateKeyToAccount` import from the SDK itself (`@arkiv-network/sdk` and `@arkiv-network/sdk/accounts`); query with `buildQuery()` + `withPayload()`/`withAttributes()`/`withMetadata()`.
- Below `0.6.5` — the `braga` chain export does not exist yet.

Do not pin the install command unless the user explicitly asks for that; verify the currently installed version and upgrade only if needed. All examples below assume `0.7.0+`. If the project is on an older version, follow the "Upgrading to SDK 0.7.0" checklist later in this document.

Two client types exist:

1. **WalletClient** (read/write) — Requires a private key. Use for creating, updating, deleting entities.
2. **PublicClient** (read-only) — No private key needed. Use for queries.

```typescript
import { createWalletClient, createPublicClient } from "@arkiv-network/sdk";
import { braga } from "@arkiv-network/sdk/chains";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Write operations — keep private key in env vars, never hardcode
const walletClient = createWalletClient({
  chain: braga,
  transport: http(),
  account: privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`),
});

// Read operations — safe for frontend/public use
const publicClient = createPublicClient({
  chain: braga,
  transport: http(),
});
```

Braga is the current Arkiv testnet. If you are upgrading an existing Kaolin project, read `references/migration-guide.md` before editing code so you update chain imports, RPC URLs, wallet config, and seed data together.

## CRUD Operations

### Create

```typescript
import { jsonToPayload, ExpirationTime } from "@arkiv-network/sdk/utils";

const { entityKey, txHash } = await walletClient.createEntity({
  payload: jsonToPayload({ title: "My Note", content: "Hello Arkiv!" }),
  contentType: "application/json",
  attributes: [
    { key: "type", value: "note" },
    { key: "id", value: crypto.randomUUID() },
    { key: "created", value: Date.now() },
  ],
  expiresIn: ExpirationTime.fromHours(12),
});
```

### Read / Query

Start a query with `select()`, declaring which entity fields you want returned. Every field is opt-in — including `key` — and only the selected fields are fetched over the network, so ask for exactly what you'll use:

```typescript
import { eq, gt } from "@arkiv-network/sdk/query";

const result = await publicClient
  .select({ key: true, payload: true, attributes: true })
  .where(eq("type", "note"), gt("created", Date.now() - 86400000))
  .limit(10)
  .fetch();

console.log("Found entities:", result.entities);

// Pagination — fetch the next page if one exists
if (result.hasNextPage()) {
  await result.next();
  console.log("Next page:", result.entities);
}

// Get a specific entity by key
const entity = await publicClient.getEntity(entityKey);
```

Available fields: `key`, `owner`, `creator`, `contentType`, `payload`, `attributes`, `expiresAtBlock`, `createdAtBlock`, `lastModifiedAtBlock`, `transactionIndexInBlock`, `operationIndexInTransaction`. The result type is inferred from the selection — `entity.toJson()`/`entity.toText()` only exist when you select `payload`, and accessing an unselected field is a compile error.

Pass the selection **inline**. A selection stored in a variable widens `true` to `boolean` and the result type can't be narrowed; if you must reuse one, annotate it `as const`. `select()` with no argument (or `"*"`) fetches every field — fine while prototyping, wasteful in production.

`.where()` accepts conditions as varargs, an array, or chained calls — all combined with AND. For nested logic, combine predicates with `and()` / `or()` from `@arkiv-network/sdk/query`:

```typescript
import { and, or, eq, gt } from "@arkiv-network/sdk/query";

// type = "note" AND (priority > 3 OR pinned = "true")
await publicClient
  .select({ key: true, payload: true })
  .where(eq("type", "note"), or(gt("priority", 3), eq("pinned", "true")))
  .fetch();
```

### Update

`updateEntity` is a **full replace**, not a patch — see best practice 15 below before using it:

```typescript
await walletClient.updateEntity({
  entityKey: entityKey,
  payload: jsonToPayload({ title: "Updated", content: "New content" }),
  contentType: "application/json",
  attributes: [
    { key: "type", value: "note" },
    { key: "updated", value: Date.now() },
  ],
  expiresIn: ExpirationTime.fromHours(24),
});
```

### Delete

```typescript
await walletClient.deleteEntity({ entityKey });
```

### Extend Expiration

```typescript
await walletClient.extendEntity({
  entityKey: entityKey,
  expiresIn: ExpirationTime.fromHours(1), // always use the helper
});
```

## Best Practices

### 1. Always Use a Project Attribute

All entities in Arkiv are public and stored in a shared database. Every project **must** define a unique project attribute and include it on every entity. This is how you distinguish your app's data from everyone else's.

Create a dedicated file (e.g., `lib/arkiv.ts` or `constants/arkiv.ts`) that exports this attribute:

```typescript
/** All entities created by this app share this attribute for easy filtering. */
export const PROJECT_ATTRIBUTE = {
  key: "project",
  value: "<GLOBALLY_UNIQUE_STRING_THAT_IDENTIFIES_THE_PROJECT>",
} as const;

if (!PROJECT_ATTRIBUTE.value) {
  throw new Error(
    "Please set the value of PROJECT_ATTRIBUTE to a unique string that identifies your project. This will help you filter and manage your entities on the Arkiv network.",
  );
}
```

When creating this file, come up with a globally unique value — for example, a combination of your project name, organization, and a short random suffix (e.g., `"myapp-acme-7x9k"`).

Then include `PROJECT_ATTRIBUTE` in **every** create/update call and **every** query:

```typescript
// Creating — always include PROJECT_ATTRIBUTE
const { entityKey, txHash } = await walletClient.createEntity({
  payload: jsonToPayload({ title, content }),
  contentType: "application/json",
  attributes: [PROJECT_ATTRIBUTE, { key: "entityType", value: "post" }],
  expiresIn: ExpirationTime.fromDays(30),
});

// Querying — always filter by PROJECT_ATTRIBUTE
const result = await publicClient
  .select({ key: true, payload: true })
  .where(
    eq(PROJECT_ATTRIBUTE.key, PROJECT_ATTRIBUTE.value),
    eq("entityType", "post"),
  )
  .limit(50)
  .fetch();
```

Without this, your queries will return data from other projects, and other projects will see yours. This is the single most important practice for any Arkiv project.

### 2. Separate Read and Write Clients

Always use `createPublicClient` for queries. It prevents accidental writes, doesn't require a private key, and is safe for frontend/public use. Reserve `createWalletClient` for backend services that need to create/update/delete.

### 3. Design Attributes for Queryability

Think about how you'll query data when you choose attributes. Attributes are your indexes — without the right ones, you'll be fetching too much data and filtering client-side.

```typescript
// Good: attributes map to your query patterns
attributes: [
  { key: "type", value: "vote" }, // filter by entity type
  { key: "proposalKey", value: proposalId }, // link related entities
  { key: "voter", value: voterAddr }, // filter by user
  { key: "choice", value: "yes" }, // filter by value
  { key: "weight", value: 1 }, // numeric for aggregation
];
```

### 4. Use Batch Operations — and Never Parallelize Writes from One Wallet

Every write is an on-chain transaction, and all transactions from one wallet must use strictly sequential nonces. The SDK does not manage nonces for you — two writes in flight at the same moment fetch the **same** nonce and collide: one gets rejected or silently replaces the other.

```typescript
// Bad — sequential, slow and expensive
for (const item of items) {
  await walletClient.createEntity(item);
}

// Also bad — parallel writes from one wallet collide on the transaction nonce
await Promise.all(items.map((item) => walletClient.createEntity(item)));

// Good — single batch operation, single transaction, one nonce
await walletClient.mutateEntities({
  creates: items.map((item) => ({
    payload: jsonToPayload(item.data),
    contentType: "application/json",
    attributes: item.attributes,
    expiresIn: ExpirationTime.fromHours(1),
  })),
});
```

`mutateEntities()` accepts `creates`, `updates`, `deletes`, `extensions`, and `ownershipChanges`, and you can mix them in one call. If separate concurrent transactions are unavoidable, create the account with viem's `nonceManager` (`privateKeyToAccount(key, { nonceManager })` from `viem/accounts`) so nonces are allocated locally — but note this only coordinates writes within a single process. Multiple processes writing with the same private key will still collide; give each writer its own wallet or route all writes through one process.

### 5. Write Specific Queries

Broad queries return too much data and cost more. Always add multiple filter criteria:

```typescript
// Bad — returns every note ever
await publicClient.select({ key: true }).where(eq("type", "note")).fetch();

// Good — narrows down to what you actually need
await publicClient
  .select({ key: true })
  .where(
    eq("type", "note"),
    gt("created", Date.now() - 86400000),
    gt("priority", 3),
  )
  .fetch();
```

The same thinking applies to field selection: `select()` fetches only the fields you name, so ask for what you'll actually use — don't select everything out of habit.

### 6. Right-Size Expiration

Match `expiresIn` to actual data lifetime. Session data gets 30 minutes, not 7 days. Cache gets 1 hour. Don't over-allocate — it costs more and pollutes queries with stale data before cleanup.

### 7. Never Expose Private Keys

```typescript
// Always load from environment
const privateKey = process.env.PRIVATE_KEY;

// Never hardcode
const privateKey = "0x1234..."; // DANGEROUS
```

### 8. Validate Input Before Storing

Check length and content before creating entities. Arkiv stores what you give it — garbage in, garbage out.

### 9. Use Numeric Types for Numeric Data

If you'll filter or sort by a value, store it as a number attribute. String attributes only support equality checks. Remember that numeric attribute values must be **integers** — scale floats to a fixed precision (e.g. `19.99` → `{ key: 'priceCents', value: 1999 }`) so range queries keep working.

### 10. Model Related Data with Shared Attributes

Link entities together using a shared attribute key (like `proposalKey` in a voting system). This is Arkiv's version of foreign keys:

```typescript
// Proposal entity
attributes: [{ key: "type", value: "proposal" }];

// Vote entities reference the proposal
attributes: [
  { key: "type", value: "vote" },
  { key: "proposalKey", value: proposalEntityKey },
];

// Query all votes for a proposal
await publicClient
  .select({ key: true, payload: true })
  .where(eq("type", "vote"), eq("proposalKey", proposalEntityKey))
  .fetch();
```

### 11. Understand $owner vs $creator

Every Arkiv entity has two special metadata fields:

- **$owner** — The wallet address that currently owns the entity. The owner has permission to update, delete, and extend the entity. **Ownership can be transferred**, so the owner may change over an entity's lifetime.
- **$creator** — The wallet address that originally created the entity. This is **set at creation time and is immutable** — it can never change. Being the creator does not grant any special privileges (only the owner can modify/delete).

Query these with `.ownedBy()` and `.createdBy()`, or include them in results by selecting the `owner` / `creator` fields:

```typescript
// Filter by current owner
const owned = await publicClient
  .select({ key: true, owner: true, payload: true })
  .where(eq(PROJECT_ATTRIBUTE.key, PROJECT_ATTRIBUTE.value))
  .ownedBy("0xOwnerAddress")
  .fetch();

// Filter by original creator (immutable, tamper-proof)
const created = await publicClient
  .select({ key: true, creator: true, payload: true })
  .where(eq(PROJECT_ATTRIBUTE.key, PROJECT_ATTRIBUTE.value))
  .createdBy("0xCreatorAddress")
  .fetch();
```

**When to use which:**

- Use **$creator** (`createdBy`) when you need a tamper-proof guarantee of who originally wrote the data (e.g., verifying data came from your trusted backend). Since it's immutable, it cannot be spoofed after creation.
- Use **$owner** (`ownedBy`) when you need to know who currently controls the entity (e.g., checking who can modify it). Be aware that ownership can change.

### 12. Filter by Creator Wallet for Trusted Data

When your app has a backend that publishes data to Arkiv and a frontend that reads it, filtering by `PROJECT_ATTRIBUTE` alone is **not enough**. A malicious actor can create entities with your project attribute to inject fake data into your dashboard.

The solution: combine `PROJECT_ATTRIBUTE` filtering with `.createdBy()` to only accept entities created by your trusted backend wallet:

```typescript
// lib/arkiv.ts — export your trusted backend wallet address
export const PROJECT_ATTRIBUTE = {
  key: "project",
  value: "myapp-acme-7x9k",
} as const;

/** The wallet address of the backend that publishes trusted data. */
export const CREATOR_WALLET_ADDRESS = "0xYourBackendWalletAddress";
```

```typescript
// Reading trusted data only
import { PROJECT_ATTRIBUTE, CREATOR_WALLET_ADDRESS } from "@/lib/arkiv";

const trustedPosts = await publicClient
  .select({ key: true, payload: true })
  .where(
    eq(PROJECT_ATTRIBUTE.key, PROJECT_ATTRIBUTE.value),
    eq("entityType", "post"),
  )
  .createdBy(CREATOR_WALLET_ADDRESS)
  .fetch();
```

This works because `$creator` is immutable — no one can create an entity and fake the creator address. Even if someone creates an entity with your project attribute, it won't pass the `.createdBy()` filter unless it was actually created by your whitelisted wallet.

**Use this pattern whenever:**

- Your backend publishes data that a frontend/dashboard reads
- You need to trust the source of entities
- You're building any system where data integrity matters

### 13. Handle Errors Gracefully

The Arkiv SDK does not retry on failure — all methods throw on error. Write operations (create, update, delete, extend) can fail for several reasons: the user rejects the transaction in MetaMask, the wallet has insufficient gas, the RPC endpoint is unreachable, or the entity has already expired. Wrap write operations in try/catch and handle each failure mode appropriately:

```typescript
try {
  const { entityKey, txHash } = await walletClient.createEntity({
    payload: jsonToPayload({ title: "My Post" }),
    contentType: "application/json",
    attributes: [PROJECT_ATTRIBUTE, { key: "entityType", value: "post" }],
    expiresIn: ExpirationTime.fromHours(12),
  });
} catch (error) {
  // Common failures:
  // - Invalid input (InvalidAttributeError, InvalidExpirationError)
  // - User rejected the transaction (MetaMask popup dismissed)
  // - Insufficient funds / gas
  // - Network error (RPC unreachable)
  // - Entity already expired (for update/extend)
  console.error("Transaction failed:", error);
}
```

Since 0.7.0 the SDK validates inputs client-side and throws typed errors before anything hits the network. They're exported from the package root, so you can handle them specifically:

```typescript
import { InvalidAttributeError, InvalidExpirationError } from "@arkiv-network/sdk";

try {
  await walletClient.createEntity({ /* ... */ });
} catch (error) {
  if (error instanceof InvalidAttributeError) {
    // a numeric attribute value was not an integer
  } else if (error instanceof InvalidExpirationError) {
    // expiresIn was not a positive multiple of the 2s block time
  } else {
    throw error;
  }
}
```

Read operations (`select().fetch()`, `getEntity()`) can also throw on network errors. If your app needs retries, implement them yourself — the SDK won't do it for you.

### 14. Validate Entity Data and Model Relationships

Two important advanced patterns for production Arkiv apps:

- **Schema validation** — `entity.toJson()` returns `any`. Always validate with a schema library (zod, valibot, etc.) to protect against malformed payloads and namespace collisions.
- **Relationship entities** — Arkiv attributes are flat key-value pairs with no array type. To model one-to-many or many-to-many relationships (tags, skills, memberships), create separate relationship entities instead of encoding lists into attributes.

For full examples and code for both patterns, read `references/advanced-patterns.md`.

### 15. Remember That updateEntity Is a Full Replace

`updateEntity` is a full replace, not a patch: the attribute set becomes exactly the list you provide, and the payload, content type, and expiration are all overwritten. Any attribute you omit is silently removed. To change only some fields, read the entity first and re-send the complete state with your changes applied:

```typescript
// Bad — wipes every attribute except "status", replaces the payload
await walletClient.updateEntity({
  entityKey,
  payload: jsonToPayload({}),
  contentType: "application/json",
  attributes: [{ key: "status", value: "done" }],
  expiresIn: ExpirationTime.fromDays(7),
});

// Good — read, modify, write back the full entity
const entity = await publicClient.getEntity(entityKey);

await walletClient.updateEntity({
  entityKey,
  payload: entity.payload,
  contentType: entity.contentType,
  attributes: [
    ...entity.attributes.filter((attr) => attr.key !== "status"),
    { key: "status", value: "done" },
  ],
  expiresIn: ExpirationTime.fromDays(7),
});
```

### 16. Sort Client-Side — orderBy Is Deprecated

The network always returns matching entities **newest first**; server-side ordering by anything else is not supported. The query builder's `orderBy()` and the `asc()` / `desc()` helpers are deprecated no-ops since SDK 0.7.0 — remove them from existing code rather than trusting them. To sort by an attribute, fetch the entities and sort in JavaScript:

```typescript
const { entities } = await publicClient
  .select({ key: true, payload: true, attributes: true })
  .where(eq("type", "note"))
  .fetch();

const priorityOf = (entity: (typeof entities)[number]) =>
  Number(entity.attributes.find((attr) => attr.key === "priority")?.value ?? 0);

// Highest priority first
entities.sort((a, b) => priorityOf(b) - priorityOf(a));
```

**Caution:** `.limit(n)` caps results **before** your sort — it gives you the n *newest* matches, not the top n by your attribute. To get a true top n, fetch all matching entities (paginating if needed), then sort and slice.

## Upgrading to SDK 0.7.0

When a project upgrades `@arkiv-network/sdk` from 0.6.x to 0.7.0+, apply all of these together — they ship in one release:

1. **Install viem** — it's now a peer dependency: `npm install @arkiv-network/sdk viem`.
2. **Fix imports** — the SDK no longer re-exports viem's internals. Move `http`, `custom`, `Hex` imports to `viem` and `privateKeyToAccount` to `viem/accounts`. Imports from `@arkiv-network/sdk/accounts` are gone.
3. **Migrate queries** — replace `buildQuery()` + `.withPayload(true)`/`.withAttributes(true)`/`.withMetadata(true)` with `select({...})`, naming the fields you need (`payload`, `attributes`, `owner`, `creator`, `key`, ...). Every field is opt-in, including `key`.
4. **Remove `orderBy()`/`asc()`/`desc()`** — deprecated no-ops. Sort fetched entities in JavaScript instead (see best practice 16).
5. **Audit inputs against the new client-side validation** — non-integer numeric attribute values now throw `InvalidAttributeError`, and `expiresIn` values that aren't a positive multiple of 2 throw `InvalidExpirationError`. Code that previously "worked" with floats or odd expirations will start throwing.

## Migration from Kaolin to Braga

When a user wants to upgrade an existing Arkiv project, treat it as a migration instead of a generic refactor. The SDK API is unchanged; the main work is swapping the target chain, updating wallet/network config, renaming Kaolin-specific env vars, and recreating testnet data that lived on Kaolin.

Follow this sequence:

1. Read `references/migration-guide.md` before making edits.
2. Check the installed `@arkiv-network/sdk` version first. The `braga` chain export is only available in `0.6.5` or higher. If the upgrade lands on `0.7.0+`, also apply the "Upgrading to SDK 0.7.0" checklist above (viem peer dependency, import moves, `select()` migration).
3. Replace `kaolin` chain imports/usages with `braga`.
4. Update RPC URLs, WebSocket URLs, chain IDs, explorer links, faucet links, and wallet `nativeCurrency` from ETH to GLM.
5. Rename env vars and config keys so `KAOLIN_*` names do not remain in active codepaths.
6. Re-seed or recreate any entities the app expects on startup, because Kaolin state does not migrate to Braga.

Keep Kaolin only as legacy context during migration work. For new code, examples, and setup instructions, default to Braga.

## Reference Files

The `references/` directory contains detailed documentation for specific topics. Read these when you need deeper information:

- **`references/sdk-reference.md`** — Full SDK API surface: all WalletClient/PublicClient methods, the `select()` query builder API, validation rules, nonce management, ExpirationTime helpers, payload utilities, MetaMask browser usage, and CDN imports.
- **`references/integration-patterns.md`** — Three integration scenarios: backend read/write (Next.js/Express), client-side reading (TanStack Query hooks), and client-side writing (MetaMask and wagmi/RainbowKit).
- **`references/api-reference.md`** — Raw JSON-RPC 2.0 API: `arkiv_query` syntax, query operators, synthetic attributes (`$owner`, `$creator`, `$key`), pagination with cursors, and utility methods.
- **`references/advanced-patterns.md`** — Advanced data modeling: schema validation with zod/valibot, and modeling lists with relationship entities.
- **`references/migration-guide.md`** — Step-by-step Kaolin to Braga migration checklist: chain swaps, env/config updates, wallet settings, faucet, bridge changes, and reseeding testnet data.

## Testnet Resources

| Resource | URL                                            |
| -------- | ---------------------------------------------- |
| Chain ID | `60138453102`                                  |
| HTTP RPC | `https://braga.hoodi.arkiv.network/rpc`        |
| Faucet   | `https://braga.hoodi.arkiv.network/faucet/`    |
| Explorer | `https://explorer.braga.hoodi.arkiv.network/`  |

## Troubleshooting

- **"Invalid sender"** — Your RPC URL may point to the wrong network. Verify it matches Braga.
- **"Insufficient funds"** — Get test GLM from the Braga faucet. Writes require gas.
- **Queries return empty** — Check that attributes match exactly (case-sensitive). Verify entities haven't expired.
