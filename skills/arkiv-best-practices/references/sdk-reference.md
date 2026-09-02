# Arkiv SDK Reference

All examples target `@arkiv-network/sdk@0.8.0-dev.3` on the Tiramisu testnet.

## TypeScript SDK

### Installation

```bash
# npm — install the latest release
npm install @arkiv-network/sdk viem

# pnpm
bun add @arkiv-network/sdk viem

# Bun
bun add @arkiv-network/sdk viem
```

[viem](https://viem.sh) is a **peer dependency** — install it alongside the SDK. The SDK no longer re-exports viem's internals (`http`, `custom`, `privateKeyToAccount`, `Hex`, etc.); import them from `viem` / `viem/accounts` directly.

### Package exports

| Subpath | Contents |
| ------- | -------- |
| `@arkiv-network/sdk` | Client factories, errors, `ExpirationTime`, payload helpers, re-exports from `/attr`, `/entity` |
| `@arkiv-network/sdk/chains` | `tiramisu`, `localhost` |
| `@arkiv-network/sdk/query` | Query operators, `SelectQueryBuilder`, `QueryResult` |
| `@arkiv-network/sdk/attr` | Typed value helpers: `i32`, `u64`, `u256`, `dec`, `str`, `addr`, `key`, `bytes32`, `bool` |
| `@arkiv-network/sdk/entity` | `Expiry`, `Lifetime` types |
| `@arkiv-network/sdk/utils` | `ExpirationTime`, `jsonToPayload`, `stringToPayload` (also available from root) |
| `@arkiv-network/sdk/types` | Shared type definitions |

There is no `@arkiv-network/sdk/accounts` export.

### Imports

```typescript
import {
  createWalletClient,
  createPublicClient,
  ExpirationTime,
  jsonToPayload,
  stringToPayload,
  InvalidValueError,
  InvalidExpiryError,
  EmptyPatchError,
  ConflictingMutationError,
  NoEntityFoundError,
} from "@arkiv-network/sdk"

import { i32, u64, dec, str, addr } from "@arkiv-network/sdk/attr"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { eq, gt, lt, gte, lte, and, or, not, startsWith } from "@arkiv-network/sdk/query"
import { http, custom } from "viem"
import { privateKeyToAccount, nonceManager } from "viem/accounts"
```

### WalletClient Methods (Write Operations)

All methods accept an optional second argument `txParams?: TxParams` for gas/nonce overrides.

#### createEntity

```typescript
const { entityKey, txHash, expiresAt } = await walletClient.createEntity({
  payload: jsonToPayload({ message: "Hello" }),
  contentType: "application/json",
  attributes: {
    type: "greeting",
    priority: i32(5),
    score: dec("4.5"),
  },
  expires: ExpirationTime.fromHours(12),
})
```

Returns: `{ entityKey: Hex, txHash: Hash, expiresAt: bigint }`

#### patchEntity

**Partial update** — only fields named in `set`/`unset`/`payload`/`contentType` are touched. Entity key, owner, creation flags, and expiry never change via patch (use `extendEntity` / `changeOwnership` for those).

```typescript
const { txHash } = await walletClient.patchEntity({
  entityKey,
  set: { status: "published", revision: i32(2) },
  unset: ["draft"],
  payload: jsonToPayload({ title: "Hello" }),
})
```

Throws `EmptyPatchError` if nothing is passed. Throws `ConflictingMutationError` if a name appears in both `set` and `unset`.

Returns: `{ entityKey: Hex, txHash: Hash }`

#### deleteEntity

```typescript
const { txHash } = await walletClient.deleteEntity({ entityKey })
```

Returns: `{ entityKey: Hex, txHash: Hash }`

#### extendEntity

```typescript
const { txHash, expiresAt } = await walletClient.extendEntity({
  entityKey,
  expires: ExpirationTime.fromHours(1),
})
```

Returns: `{ entityKey: Hex, txHash: Hash, expiresAt: bigint }`

#### changeOwnership

```typescript
const { txHash } = await walletClient.changeOwnership({
  entityKey,
  newOwner: "0xNewOwnerAddress",
})
```

Returns: `{ entityKey: Hex, txHash: Hash }`

#### executeBatch

Applies any combination of creates, patches, deletes, extensions, and ownership changes **atomically in one transaction**:

```typescript
const result = await walletClient.executeBatch({
  creates: [{
    payload: stringToPayload("item 1"),
    contentType: "text/plain",
    attributes: { type: "item" },
    expires: ExpirationTime.fromMinutes(30),
  }],
  patches: [{ entityKey, set: { status: "done" } }],
  extensions: [{ entityKey: "0x456...", expires: ExpirationTime.fromHours(1) }],
  deletes: [{ entityKey: "0x321..." }],
  ownershipChanges: [{ entityKey: "0x789...", newOwner: "0xNew..." }],
})
```

Returns: `{ txHash, createdEntities, patchedEntities, deletedEntities, extendedEntities, ownershipChanges }`

### Typed Attributes

Attributes are passed as an **object keyed by name**:

```typescript
attributes: {
  category: "docs",           // bare string → str
  level: i32(10),             // explicit i32
  balance: u256(1_000_000n),  // explicit u256
  price: dec("19.99"),        // genuine decimal
  owner: addr("0xAbC..."),    // checksummed address
  flagged: true,              // bare boolean → bool
}
```

Bare-form defaults: `boolean` → `bool`, `number` → `i32`, `bigint` → `u256`, `string` → `str`.

**Validation rules:**

- Attribute names: 1–32 bytes, start with a letter, chars `[A-Za-z0-9._-]`, no `$` prefix, no `--`, not a reserved word
- Max 32 attributes per operation
- Max payload 128 KiB
- `str` max 128 UTF-8 bytes
- A bare float like `19.99` throws `InvalidValueError` — use `dec("19.99")`

Reading attributes: `entity.attributes` is an object keyed by name, each value is `{ type, value }`:

```typescript
entity.attributes.priority?.value  // the raw value
entity.attributes.priority?.type   // "i32"
```

### ExpirationTime Helpers

Expiration uses the `expires: Expiry` parameter (not `expiresIn`):

```typescript
// Relative lifetimes
ExpirationTime.fromSeconds(30)
ExpirationTime.fromMinutes(30)
ExpirationTime.fromHours(1)
ExpirationTime.fromHours(12)
ExpirationTime.fromHours(24)
ExpirationTime.fromDays(7)
ExpirationTime.fromWeeks(2)
ExpirationTime.fromMonths(3)
ExpirationTime.fromYears(1)
ExpirationTime.fromBlocks(100)

// Absolute deadlines
ExpirationTime.atBlock(1_200_000n)
ExpirationTime.atDate(new Date("2027-01-01"))
ExpirationTime.permanent()
```

### Validation Rules

The SDK validates mutations client-side and throws typed errors before anything hits the network:

```typescript
import {
  InvalidValueError,
  InvalidExpiryError,
  InvalidAttributeNameError,
  EmptyPatchError,
  ConflictingMutationError,
} from "@arkiv-network/sdk"

try {
  await walletClient.createEntity({ /* ... */ })
} catch (error) {
  if (error instanceof InvalidValueError) {
    // a value did not match its declared type
  } else if (error instanceof InvalidExpiryError) {
    // invalid expiry configuration
  } else if (error instanceof InvalidAttributeNameError) {
    // attribute name violates grammar rules
  } else {
    throw error
  }
}
```

### Concurrent Writes and Nonces

All transactions from one wallet must use strictly sequential nonces, and the SDK does not manage nonces — each write fetches the next nonce from the network at send time. Two writes in flight simultaneously fetch the **same** nonce and collide.

```typescript
// Both writes fetch the same nonce — one fails or gets replaced
await Promise.all([
  walletClient.createEntity({ /* ... */ }),
  walletClient.createEntity({ /* ... */ }),
])
```

Two safe options:

1. **Batch into a single transaction (preferred):** `executeBatch()` — one transaction, one nonce.
2. **viem's nonce manager** when separate transactions are unavoidable:

```typescript
const walletClient = createWalletClient({
  chain: tiramisu,
  transport: http(process.env.TIRAMISU_RPC_URL),
  account: privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`, {
    nonceManager,
  }),
})
```

A nonce manager only coordinates writes **within a single process**. Multiple processes writing with the same private key still collide — give each writer its own wallet, or route all writes through one process.

### PublicClient Methods (Read Operations)

#### select + fetch

`select()` declares which entity fields to return. Every field is **opt-in — including `key`** — and only selected fields are fetched over the network:

```typescript
const result = await publicClient
  .select({ key: true, payload: true, attributes: true })
  .where(eq("type", "note"), gt("created", i32(Date.now() - 86400000)))
  .limit(10)
  .fetch()
```

Available fields: `key`, `owner`, `creator`, `createdAt`, `updatedAt`, `expiresAt`, `creationFlags`, `contentType`, `payload`, `attributeSchema`, `attributes`.

- `select()` with no argument (or `"*"`) fetches every field — fine for prototyping, wasteful in production.
- The result type is inferred from the selection: `entity.toJson()` / `entity.toText()` exist only when `payload` is selected; accessing an unselected field is a compile error.
- Pass the selection **inline**. A selection stored in a variable widens `true` to `boolean` and the result type can't be narrowed. To reuse one, annotate it `as const`.

Query builder methods:

- `.where(...conditions)` — Add filter conditions; accepts varargs, an array, or chained calls, all combined with AND
- `.ownedBy(address)` — Filter by current owner address (can change over time)
- `.createdBy(address)` — Filter by original creator address (immutable)
- `.limit(n)` — Limit number of results (max 200 per page)
- `.cursor(cursor)` — Resume from a previous page's cursor
- `.atBlock(block)` — Query at a specific block
- `.fetch()` — Execute the query
- `[Symbol.asyncIterator]` — Async generator over all pages

Pagination:

```typescript
if (result.hasNextPage()) {
  const nextPage = await result.next()
}
```

#### Ordering

Results always come back **newest first**; server-side ordering is not supported. `orderBy()`, `asc()`, and `desc()` were removed in 0.8 — sort the fetched entities in JavaScript instead. Note that `.limit(n)` caps results *before* a client-side sort (it returns the n newest matches, not the top n by your attribute).

#### getEntity

```typescript
const entity = await publicClient.getEntity(entityKey)
const data = entity.toJson()   // Parse JSON payload
const text = entity.toText()   // Get text payload
```

Throws `NoEntityFoundError` if the entity does not exist or has expired.

### Payload Helpers

```typescript
import { jsonToPayload, stringToPayload } from "@arkiv-network/sdk"

const jsonPayload = jsonToPayload({ key: "value" })
const textPayload = stringToPayload("Hello Arkiv!")

// Reading back (requires payload to be selected in the query)
const text = entity.toText()
const data = entity.toJson()
```

`payloadToString` was removed in 0.8 — use `entity.toText()` / `entity.toJson()` instead.

### Query Operators

```typescript
import { eq, gt, lt, gte, lte, and, or, not, startsWith } from "@arkiv-network/sdk/query"

eq("type", "note")              // type = str('note')
gt("priority", i32(3))          // priority > i32(3)
lt("price", i32(1000))          // price < i32(1000)
gte("created", i32(timestamp))  // created >= i32(timestamp)
lte("expiresAt", u64(limit))    // expiresAt <= u64(limit)
startsWith("name", "test")      // name STARTSWITH str('test')
not(eq("status", "deleted"))    // NOT status = str('deleted')
```

String attributes only support `eq()` and `startsWith()`. Numeric attributes support all comparison operators.

**Caution:** `ne()`, `exists()`, and `hasType()` are exported by the SDK but **not implemented on the node** — queries using them fail to parse. Use `not(eq(...))` as the not-equal workaround. It matches the full complement, including entities that never set the attribute.

Nest conditions with `and()` / `or()`:

```typescript
await publicClient
  .select({ key: true, payload: true })
  .where(eq("type", "note"), or(gt("priority", i32(3)), eq("pinned", "true")))
  .fetch()
```

For prefix matching on string attributes, use `startsWith()` or the raw JSON-RPC API (see `api-reference.md`).

### watchEntityEvents

Live event subscription. Returns an unwatch function directly — **do not await it**:

```typescript
const unwatch = publicClient.watchEntityEvents({
  onEntityCreated: (event) => {
    // { type: "EntityCreated", entityKey, owner, expiresAt, creationFlags, blockNumber, transactionHash, logIndex }
  },
  onEntityPatched: (event) => {
    // { type: "EntityPatched", entityKey, owner, blockNumber, transactionHash, logIndex }
  },
  onExpiryExtended: (event) => {
    // { type: "ExpiryExtended", entityKey, owner, expiresAt, blockNumber, transactionHash, logIndex }
  },
  onOwnershipTransferred: (event) => {
    // { type: "OwnershipTransferred", entityKey, previousOwner, newOwner, blockNumber, transactionHash, logIndex }
  },
  onEntityDeleted: (event) => {
    // { type: "EntityDeleted", entityKey, owner, blockNumber, transactionHash, logIndex }
  },
  onEvent: (event) => {
    // Catch-all — runs before per-type handlers
  },
  onError: (error) => console.error(error),
  fromBlock: 1_000_000n,
  pollingInterval: 1000,
})

// Later: stop watching
unwatch()
```

**Important:** `onEntityExpired` no longer exists — expiration fires no event. Poll with `getEntity()` and handle `NoEntityFoundError`, or query for entities approaching expiry via `$expiresAt`.

Every event carries `{ blockNumber, transactionHash, logIndex }`. The old `cost`/`oldExpirationBlock`/`newExpirationBlock` fields are gone.

### Browser Usage with MetaMask

```typescript
import { createWalletClient, createPublicClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { custom, http } from "viem"

await window.ethereum.request({ method: "eth_requestAccounts" })

const walletClient = createWalletClient({
  chain: tiramisu,
  transport: custom(window.ethereum),
})

const publicClient = createPublicClient({
  chain: tiramisu,
  transport: http(tiramisu.rpcUrls.default.http),
})
```

**Adding Arkiv Network to MetaMask:**

```typescript
await window.ethereum.request({
  method: "wallet_addEthereumChain",
  params: [{
    chainId: "0x7614d1",
    chainName: "Arkiv Tiramisu Testnet",
    nativeCurrency: { name: "GLM", symbol: "GLM", decimals: 18 },
    rpcUrls: ["https://rpc.tiramisu.db-chain.testnet.arkiv.network"],
    blockExplorerUrls: ["https://indexer.tiramisu.db-chain.testnet.arkiv.network"],
  }],
})
```

### Browser CDN Imports

For static HTML/JS pages without a bundler:

```javascript
import { createPublicClient } from 'https://esm.sh/@arkiv-network/sdk@0.8.0-dev.3?target=es2022&bundle-deps'
import { eq } from 'https://esm.sh/@arkiv-network/sdk/query@0.8.0-dev.3?target=es2022&bundle-deps'
import { tiramisu } from 'https://esm.sh/@arkiv-network/sdk/chains@0.8.0-dev.3?target=es2022&bundle-deps'
import { http } from 'https://esm.sh/viem?target=es2022'
```

Pin the version in CDN URLs — the `tiramisu` chain export and `select()` require 0.8.0-dev.3+.
