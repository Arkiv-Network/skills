---
name: arkiv-best-practices
description: Best practices, patterns, and practical examples for building applications with Arkiv — a decentralized Ethereum database with queryable, time-scoped storage. Use this skill whenever the user is working with Arkiv SDK, the @arkiv-network/sdk package, Arkiv entities, Arkiv queries, the select() query API, Arkiv attributes, typed attributes, dec(), Expiry/expiration, the Tiramisu testnet, patchEntity, executeBatch, watchEntityEvents, changeOwnership, or building any application that stores, queries, or manages data on the Arkiv network. Also use when the user mentions decentralized data storage on Ethereum, blockchain database, Web3 data storage, on-chain data, entity CRUD operations with expiration, arkiv_query, migrating an Arkiv project from Braga to Tiramisu, or upgrading an Arkiv project to SDK 0.8.
---

# Arkiv Best Practices & Practical Examples

Arkiv is a decentralized data layer that brings queryable, time-scoped storage to Ethereum. It lets developers store, query, and manage data with built-in expiration and attribute systems. Think of it as an Ethereum-native database where every record (called an **entity**) has a payload, typed attributes for querying, and a programmable lifespan.

## Architecture Overview

Arkiv is **designed as three layers**:

1. **Ethereum Mainnet** — Final settlement, proof verification, source of truth.
2. **Arkiv Coordination Layer** — Data management, registry, cross-chain sync.
3. **Specialized DB-Chains** — High-performance CRUD via JSON-RPC, indexed queries, programmable expiration.

Nothing in the current source repos confirms the coordination layer or mainnet settlement is live on Tiramisu — treat the testnet as the active layer for now.

## Core Concepts

### Entities

An entity is a data record containing:

- **Payload** — The actual data (JSON, text, binary)
- **Attributes** — Key-value pairs for querying, with explicit types
- **Expiry** — Automatic expiration via the `expires` parameter (use `ExpirationTime` helpers)
- **Content Type** — MIME type of the payload

### Attributes

Attributes are the backbone of querying. In SDK 0.8, attributes are passed as an **object keyed by name** (not an array):

```typescript
import { i32, dec, str } from "@arkiv-network/sdk/attr"

// Object form — each key is the attribute name
attributes: {
  type: "note",              // bare string → str
  priority: i32(5),          // explicit i32 for range queries
  score: dec("4.5"),         // genuine decimal
  created: i32(Date.now()),  // timestamp as i32
}
```

When reading, `entity.attributes` is also an object keyed by name. Each value is `{ type, value }`:

```typescript
entity.attributes.priority?.value  // 5
entity.attributes.priority?.type   // "i32"
```

**Important:** If you store a number as a string (`type: "5"`), you lose the ability to do range queries with `gt()`, `lt()`, etc. Always use the correct typed helper for attributes you plan to filter by range.

**Important:** A bare float like `19.99` throws `InvalidValueError`. Use `dec("19.99")` for genuine decimals, or scale to an integer (`1999` cents) if you only need integer range queries.

**Attribute name rules:** 1–32 bytes, start with a letter, chars `[A-Za-z0-9._-]`, no `$` prefix, no `--`, not a reserved word (`and`, `or`, `not`, `true`, `false`, `startswith`, `exists`, `typeof`, or any type tag). Max 32 attributes per operation.

Prefix matching on string attributes is available via `startsWith()` in the TypeScript SDK and `STARTSWITH` in the raw JSON-RPC API (see `references/api-reference.md`).

### Expiry

Every entity has a lifespan expressed via the `expires` parameter. Always use the `ExpirationTime` helper — never hardcode raw numbers:

```typescript
import { ExpirationTime } from "@arkiv-network/sdk"

ExpirationTime.fromMinutes(30)
ExpirationTime.fromHours(1)
ExpirationTime.fromHours(12)
ExpirationTime.fromDays(7)
ExpirationTime.fromWeeks(2)
ExpirationTime.fromMonths(3)
ExpirationTime.permanent()
ExpirationTime.atBlock(1_200_000n)
ExpirationTime.atDate(new Date("2027-01-01"))
```

Entities can be extended before they expire using `extendEntity()`. Over-allocating expiration wastes storage fees — start short and extend if needed.

## SDK Setup

Arkiv provides a TypeScript SDK. For detailed SDK reference, read `references/sdk-reference.md`.

### TypeScript (Node.js / Bun)

```bash
npm install @arkiv-network/sdk@dev viem
# or
bun add @arkiv-network/sdk@dev viem
```

The SDK builds on [viem](https://viem.sh) and declares it as a **peer dependency**. Install `viem` alongside the SDK. The SDK no longer re-exports viem's internals — `http`, `custom`, `privateKeyToAccount`, `Hex`, etc. must be imported from `viem` / `viem/accounts` directly.

**Install the `@dev` tag** — npm `latest` is still 0.7.0, which targets the retired Braga network. All examples below assume `0.8.0-dev.3+`.

Two client types exist:

1. **WalletClient** (read/write) — Requires a private key. Use for creating, patching, deleting entities.
2. **PublicClient** (read-only) — No private key needed. Use for queries and event watching.

```typescript
import { createWalletClient, createPublicClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { http } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const rpcUrl = process.env.TIRAMISU_RPC_URL
// Register an API key at https://hub.arkiv.network/api-keys
// and include it in the URL: https://rpc.tiramisu.db-chain.testnet.arkiv.network/<key>

const walletClient = createWalletClient({
  chain: tiramisu,
  transport: http(rpcUrl),
  account: privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`),
})

const publicClient = createPublicClient({
  chain: tiramisu,
  transport: http(rpcUrl),
})
```

Tiramisu is the current Arkiv testnet. If you are upgrading from Braga, read `references/migration-guide.md` before editing code.

## Wallet Actions

The SDK exposes six core mutation methods:

| Action | What it does |
|--------|--------------|
| `createEntity()` | Creates a new entity with a payload, content type, attributes, and an expiry |
| `patchEntity()` | Sets or unsets individual attributes, or replaces the payload, leaving anything unnamed untouched |
| `deleteEntity()` | Deletes an entity |
| `extendEntity()` | Moves an entity's expiry later |
| `changeOwnership()` | Transfers an entity to a new owner |
| `executeBatch()` | Applies a combination of creates, patches, deletes, extensions, and ownership changes atomically in one transaction |

## CRUD Operations

### Create

```typescript
import { jsonToPayload, ExpirationTime } from "@arkiv-network/sdk"
import { i32 } from "@arkiv-network/sdk/attr"

const { entityKey, txHash } = await walletClient.createEntity({
  payload: jsonToPayload({ title: "My Note", content: "Hello Arkiv!" }),
  contentType: "application/json",
  attributes: {
    project: "myapp-acme-7x9k",
    type: "note",
    id: crypto.randomUUID(),
    created: i32(Date.now()),
  },
  expires: ExpirationTime.fromHours(12),
})
```

### Read / Query

Start a query with `select()`, declaring which entity fields you want returned. Every field is opt-in — including `key` — and only the selected fields are fetched over the network:

```typescript
import { eq, gt } from "@arkiv-network/sdk/query"
import { i32 } from "@arkiv-network/sdk/attr"

const result = await publicClient
  .select({ key: true, payload: true, attributes: true })
  .where(eq("type", "note"), gt("created", i32(Date.now() - 86400000)))
  .limit(10)
  .fetch()

console.log("Found entities:", result.entities)

if (result.hasNextPage()) {
  await result.next()
}

const entity = await publicClient.getEntity(entityKey)
```

Available fields: `key`, `owner`, `creator`, `createdAt`, `updatedAt`, `expiresAt`, `creationFlags`, `contentType`, `payload`, `attributeSchema`, `attributes`.

Pass the selection **inline**. A selection stored in a variable widens `true` to `boolean` and the result type can't be narrowed; if you must reuse one, annotate it `as const`.

`.where()` accepts conditions as varargs, an array, or chained calls — all combined with AND. For nested logic, combine predicates with `and()` / `or()` from `@arkiv-network/sdk/query`:

```typescript
import { and, or, eq, gt } from "@arkiv-network/sdk/query"
import { i32 } from "@arkiv-network/sdk/attr"

await publicClient
  .select({ key: true, payload: true })
  .where(eq("type", "note"), or(gt("priority", i32(3)), eq("pinned", "true")))
  .fetch()
```

### Patch

`patchEntity` is a **partial update** — only fields named in `set`, `unset`, `payload`, or `contentType` are touched:

```typescript
await walletClient.patchEntity({
  entityKey,
  set: { status: "done", updated: i32(Date.now()) },
  unset: ["draft"],
})
```

Entity key, owner, creation flags, and expiry never change via patch. Use `extendEntity()` for expiry and `changeOwnership()` for ownership.

### Delete

```typescript
await walletClient.deleteEntity({ entityKey })
```

### Extend Expiration

```typescript
await walletClient.extendEntity({
  entityKey,
  expires: ExpirationTime.fromHours(1),
})
```

### Change Ownership

```typescript
await walletClient.changeOwnership({
  entityKey,
  newOwner: "0xNewOwnerAddress",
})
```

## Best Practices

### 1. Always Use a Project Attribute

All entities in Arkiv are public and stored in a shared database. Every project **must** define a unique project attribute and include it on every entity. This is how you distinguish your app's data from everyone else's.

Create a dedicated file (e.g., `lib/arkiv.ts`) that exports the attribute name and value as separate constants:

```typescript
/** Attribute name used to filter this project's entities. */
export const PROJECT_ATTRIBUTE_NAME = "project" as const

/** Globally unique value identifying this project. */
export const PROJECT_ATTRIBUTE_VALUE = "myapp-acme-7x9k" as const

if (!PROJECT_ATTRIBUTE_VALUE) {
  throw new Error(
    "Set PROJECT_ATTRIBUTE_VALUE to a unique string that identifies your project.",
  )
}
```

When creating this file, come up with a globally unique value — for example, a combination of your project name, organization, and a short random suffix.

Include the project attribute in **every** create/patch and **every** query:

```typescript
import { PROJECT_ATTRIBUTE_NAME, PROJECT_ATTRIBUTE_VALUE } from "@/lib/arkiv"

const { entityKey, txHash } = await walletClient.createEntity({
  payload: jsonToPayload({ title, content }),
  contentType: "application/json",
  attributes: {
    [PROJECT_ATTRIBUTE_NAME]: PROJECT_ATTRIBUTE_VALUE,
    entityType: "post",
  },
  expires: ExpirationTime.fromDays(30),
})

const result = await publicClient
  .select({ key: true, payload: true })
  .where(
    eq(PROJECT_ATTRIBUTE_NAME, PROJECT_ATTRIBUTE_VALUE),
    eq("entityType", "post"),
  )
  .limit(50)
  .fetch()
```

Without this, your queries will return data from other projects, and other projects will see yours. This is the single most important practice for any Arkiv project.

### 2. Register an RPC API Key

Anonymous RPC access to Tiramisu is rate-limited. Register a project at `https://hub.arkiv.network/api-keys` for elevated rate limits (1,000,000 units/month). Pass the key as a URL path segment, `X-API-KEY` header, or `Authorization: Bearer` header:

```typescript
const rpcUrl = `https://rpc.tiramisu.db-chain.testnet.arkiv.network/${process.env.TIRAMISU_API_KEY}`

const publicClient = createPublicClient({
  chain: tiramisu,
  transport: http(rpcUrl),
})
```

### 3. Separate Read and Write Clients

Always use `createPublicClient` for queries. It prevents accidental writes, doesn't require a private key, and is safe for frontend/public use. Reserve `createWalletClient` for backend services that need to create/patch/delete.

### 4. Design Attributes for Queryability

Think about how you'll query data when you choose attributes. Attributes are your indexes — without the right ones, you'll be fetching too much data and filtering client-side.

```typescript
attributes: {
  type: "vote",
  proposalKey: proposalId,
  voter: voterAddr,
  choice: "yes",
  weight: i32(1),
}
```

### 5. Use Batch Operations — and Never Parallelize Writes from One Wallet

Every write is an on-chain transaction, and all transactions from one wallet must use strictly sequential nonces. The SDK does not manage nonces for you — two writes in flight at the same moment fetch the **same** nonce and collide.

```typescript
// Bad — sequential, slow and expensive
for (const item of items) {
  await walletClient.createEntity(item)
}

// Also bad — parallel writes from one wallet collide on the transaction nonce
await Promise.all(items.map((item) => walletClient.createEntity(item)))

// Good — single batch operation, single transaction, one nonce
await walletClient.executeBatch({
  creates: items.map((item) => ({
    payload: jsonToPayload(item.data),
    contentType: "application/json",
    attributes: item.attributes,
    expires: ExpirationTime.fromHours(1),
  })),
})
```

`executeBatch()` accepts `creates`, `patches`, `deletes`, `extensions`, and `ownershipChanges`, and you can mix them in one call. If separate concurrent transactions are unavoidable, create the account with viem's `nonceManager` (`privateKeyToAccount(key, { nonceManager })` from `viem/accounts`) so nonces are allocated locally — but note this only coordinates writes within a single process.

### 6. Write Specific Queries

Broad queries return too much data and cost more. Always add multiple filter criteria:

```typescript
await publicClient
  .select({ key: true })
  .where(
    eq("type", "note"),
    gt("created", i32(Date.now() - 86400000)),
    gt("priority", i32(3)),
  )
  .fetch()
```

The same thinking applies to field selection: `select()` fetches only the fields you name, so ask for what you'll actually use.

### 7. Right-Size Expiration

Match `expires` to actual data lifetime. Session data gets 30 minutes, not 7 days. Cache gets 1 hour. Don't over-allocate — it costs more and pollutes queries with stale data before cleanup.

### 8. Never Expose Private Keys

```typescript
const privateKey = process.env.PRIVATE_KEY
// Never hardcode: const privateKey = "0x1234..." // DANGEROUS
```

### 9. Use Typed Attributes for Typed Data

Use the typed helpers from `@arkiv-network/sdk/attr` for attributes you'll filter or sort by:

```typescript
import { i32, dec, u64 } from "@arkiv-network/sdk/attr"

attributes: {
  priceCents: i32(1999),       // integer range queries
  rating: dec("4.5"),            // genuine decimal
  blockHeight: u64(1_200_000n),  // large unsigned integer
}
```

String attributes only support equality and prefix matching. Numeric attributes support all comparison operators.

### 10. Model Related Data with Shared Attributes

Link entities together using a shared attribute key (like `proposalKey` in a voting system). This is Arkiv's version of foreign keys:

```typescript
// Proposal entity
attributes: { type: "proposal" }

// Vote entities reference the proposal
attributes: {
  type: "vote",
  proposalKey: proposalEntityKey,
}

// Query all votes for a proposal
await publicClient
  .select({ key: true, payload: true })
  .where(eq("type", "vote"), eq("proposalKey", proposalEntityKey))
  .fetch()
```

### 11. Understand $owner vs $creator

Every Arkiv entity has two special metadata fields:

- **$owner** — The wallet address that currently owns the entity. The owner has permission to patch, delete, and extend the entity. **Ownership can be transferred**, so the owner may change over an entity's lifetime.
- **$creator** — The wallet address that originally created the entity. This is **set at creation time and is immutable** — it can never change. Being the creator does not grant any special privileges (only the owner can modify/delete).

Query these with `.ownedBy()` and `.createdBy()`, or include them in results by selecting the `owner` / `creator` fields:

```typescript
const owned = await publicClient
  .select({ key: true, owner: true, payload: true })
  .where(eq(PROJECT_ATTRIBUTE_NAME, PROJECT_ATTRIBUTE_VALUE))
  .ownedBy("0xOwnerAddress")
  .fetch()

const created = await publicClient
  .select({ key: true, creator: true, payload: true })
  .where(eq(PROJECT_ATTRIBUTE_NAME, PROJECT_ATTRIBUTE_VALUE))
  .createdBy("0xCreatorAddress")
  .fetch()
```

**When to use which:**

- Use **$creator** (`createdBy`) when you need a tamper-proof guarantee of who originally wrote the data. Since it's immutable, it cannot be spoofed after creation.
- Use **$owner** (`ownedBy`) when you need to know who currently controls the entity. Be aware that ownership can change.

### 12. Filter by Creator Wallet for Trusted Data

When your app has a backend that publishes data to Arkiv and a frontend that reads it, filtering by `PROJECT_ATTRIBUTE` alone is **not enough**. A malicious actor can create entities with your project attribute to inject fake data.

Combine `PROJECT_ATTRIBUTE` filtering with `.createdBy()` to only accept entities created by your trusted backend wallet:

```typescript
export const CREATOR_WALLET_ADDRESS = "0xYourBackendWalletAddress"

const trustedPosts = await publicClient
  .select({ key: true, payload: true })
  .where(
    eq(PROJECT_ATTRIBUTE_NAME, PROJECT_ATTRIBUTE_VALUE),
    eq("entityType", "post"),
  )
  .createdBy(CREATOR_WALLET_ADDRESS)
  .fetch()
```

This works because `$creator` is immutable — no one can create an entity and fake the creator address.

### 13. Handle Errors Gracefully

The Arkiv SDK does not retry on failure — all methods throw on error. Write operations can fail for several reasons: the user rejects the transaction in MetaMask, the wallet has insufficient gas, the RPC endpoint is unreachable, or the entity has already expired. Wrap write operations in try/catch:

```typescript
import {
  InvalidValueError,
  InvalidExpiryError,
  EmptyPatchError,
  ConflictingMutationError,
  NoEntityFoundError,
} from "@arkiv-network/sdk"

try {
  await walletClient.createEntity({ /* ... */ })
} catch (error) {
  if (error instanceof InvalidValueError) {
    // a value did not match its declared type (e.g. bare float)
  } else if (error instanceof InvalidExpiryError) {
    // invalid expiry configuration
  } else if (error instanceof EmptyPatchError) {
    // patchEntity called with no changes
  } else if (error instanceof ConflictingMutationError) {
    // same attribute in both set and unset
  } else {
    throw error
  }
}
```

Read operations can also throw on network errors. If your app needs retries, implement them yourself — the SDK won't do it for you.

### 14. Validate Entity Data and Model Relationships

Two important advanced patterns for production Arkiv apps:

- **Schema validation** — `entity.toJson()` returns `any`. Always validate with a schema library (zod, valibot, etc.) to protect against malformed payloads and namespace collisions.
- **Relationship entities** — Arkiv attributes are flat key-value pairs with no array type. To model one-to-many or many-to-many relationships (tags, skills, memberships), create separate relationship entities instead of encoding lists into attributes.

For full examples and code for both patterns, read `references/advanced-patterns.md`.

### 15. Remember That patchEntity Is a Partial Update

`patchEntity` only touches what you name — attributes in `set` are added/updated, names in `unset` are removed, and anything not mentioned stays as-is. Entity key, owner, creation flags, and expiry never change via patch:

```typescript
// Good — only changes status, leaves everything else untouched
await walletClient.patchEntity({
  entityKey,
  set: { status: "done" },
  unset: ["draft"],
})

// Bad — throws EmptyPatchError
await walletClient.patchEntity({ entityKey })

// Bad — throws ConflictingMutationError
await walletClient.patchEntity({
  entityKey,
  set: { status: "done" },
  unset: ["status"],
})
```

To replace the payload without touching attributes:

```typescript
await walletClient.patchEntity({
  entityKey,
  payload: jsonToPayload({ title: "Updated", content: "New content" }),
  contentType: "application/json",
})
```

### 16. Sort Client-Side — Server Ordering Is Not Supported

The network always returns matching entities **newest first**; server-side ordering by anything else is not supported. `orderBy()`, `asc()`, and `desc()` were removed in SDK 0.8. To sort by an attribute, fetch the entities and sort in JavaScript:

```typescript
const { entities } = await publicClient
  .select({ key: true, payload: true, attributes: true })
  .where(eq("type", "note"))
  .fetch()

const priorityOf = (entity: (typeof entities)[number]) =>
  Number(entity.attributes.priority?.value ?? 0)

entities.sort((a, b) => priorityOf(b) - priorityOf(a))
```

**Caution:** `.limit(n)` caps results **before** your sort — it gives you the n *newest* matches, not the top n by your attribute. To get a true top n, fetch all matching entities (paginating if needed), then sort and slice.

## Upgrading to SDK 0.8.0

When a project upgrades `@arkiv-network/sdk` from 0.7.x to 0.8.0-dev.3+, apply all of these together:

1. **Install the dev release:** `npm install @arkiv-network/sdk@dev viem`.
2. **Swap chain:** `braga` → `tiramisu` in all imports and client setup.
3. **Fix imports:** import `ExpirationTime`, `jsonToPayload`, `stringToPayload` from `@arkiv-network/sdk` root (not `/utils`).
4. **Attributes array → object:** `{ key: "type", value: "note" }` → `{ type: "note" }`.
5. **`expiresIn` → `expires`:** rename the parameter on create/extend/batch.
6. **`updateEntity` → `patchEntity`:** partial updates with `set`/`unset` instead of full replace.
7. **`mutateEntities` → `executeBatch`:** rename and use `patches` instead of `updates`.
8. **`subscribeEntityEvents` → `watchEntityEvents`:** sync, returns unwatch function directly.
9. **Error renames:** `InvalidAttributeError` → `InvalidValueError`, `InvalidExpirationError` → `InvalidExpiryError`.
10. **Remove `orderBy()`/`asc()`/`desc()`:** sort client-side.
11. **Remove `payloadToString`:** use `entity.toText()` / `entity.toJson()`.
12. **Use typed attribute helpers:** import from `@arkiv-network/sdk/attr` for non-default types.

For the full migration checklist including network constants, read `references/migration-guide.md`.

## Migration from Braga to Tiramisu

Braga was retired on 12 August 2026. When a user wants to upgrade an existing Arkiv project, treat it as a migration instead of a generic refactor. The SDK API has breaking changes from 0.7 to 0.8, and the main work is swapping the target chain, updating wallet/network config, renaming Braga-specific env vars, and recreating testnet data.

Follow this sequence:

1. Read `references/migration-guide.md` before making edits.
2. Install `@arkiv-network/sdk@dev` and apply the "Upgrading to SDK 0.8.0" checklist above.
3. Replace `braga` chain imports/usages with `tiramisu`.
4. Update RPC URLs, WebSocket URLs, chain IDs, explorer links, faucet links, and wallet `nativeCurrency` (symbol `GLM`).
5. Register an RPC API key at `https://hub.arkiv.network/api-keys`.
6. Rename env vars and config keys so `BRAGA_*` names do not remain in active codepaths.
7. Re-seed or recreate any entities the app expects on startup, because Braga state does not migrate to Tiramisu.

Keep Braga only as legacy context during migration work. For new code, examples, and setup instructions, default to Tiramisu.

## Reference Files

The `references/` directory contains detailed documentation for specific topics. Read these when you need deeper information:

- **`references/sdk-reference.md`** — Full SDK API surface: all WalletClient/PublicClient methods, the `select()` query builder API, typed attributes, validation rules, nonce management, ExpirationTime helpers, payload utilities, `watchEntityEvents`, MetaMask browser usage, and CDN imports.
- **`references/integration-patterns.md`** — Four integration scenarios: backend read/write (Next.js/Express), client-side reading (TanStack Query hooks), client-side writing (MetaMask and wagmi/RainbowKit), and live events with cache invalidation.
- **`references/api-reference.md`** — Raw JSON-RPC 2.0 API: `arkiv_query` syntax, typed literals, query operators, synthetic attributes, pagination with cursors, and utility methods.
- **`references/advanced-patterns.md`** — Advanced data modeling: schema validation with zod/valibot, and modeling lists with relationship entities.
- **`references/migration-guide.md`** — Step-by-step Braga to Tiramisu migration checklist: chain swaps, SDK 0.7→0.8 API changes, env/config updates, faucet, and reseeding testnet data.

## Testnet Resources

| Resource | URL |
| -------- | --- |
| Chain ID | `7738577` / `0x7614d1` |
| HTTP RPC | `https://rpc.tiramisu.db-chain.testnet.arkiv.network` |
| WebSocket RPC | `wss://rpc.tiramisu.db-chain.testnet.arkiv.network` |
| Block explorer | `https://indexer.tiramisu.db-chain.testnet.arkiv.network` |
| Faucet | `https://hub.arkiv.network/faucet` (0.1 GLM, 24h cooldown, wallet + SIWE) |
| API keys | `https://hub.arkiv.network/api-keys` |

## Troubleshooting

- **"Invalid sender"** — Your RPC URL may point to the wrong network. Verify it matches Tiramisu.
- **"Insufficient funds"** — Get test GLM from the [Tiramisu faucet](https://hub.arkiv.network/faucet). Writes require gas.
- **Queries return empty** — Check that attributes match exactly (case-sensitive). Verify entities haven't expired.
- **`InvalidValueError` on a number** — Bare floats are rejected. Use `dec("19.99")` for decimals or `i32(1999)` for scaled integers.
- **`NoEntityFoundError`** — The entity does not exist or has expired. Expiration fires no event in 0.8 — poll or query by `$expiresAt`.
- **RPC rate limited** — Register an API key at `https://hub.arkiv.network/api-keys` and pass it in the RPC URL or as a header.
- **Query parse error on `ne()`/`exists()`/`hasType()`** — These operators are exported by the SDK but not implemented on the node. Use `not(eq(...))` instead.
