# Arkiv SDK Reference

## TypeScript SDK

### Installation

```bash
# npm
npm install @arkiv-network/sdk viem

# Bun
bun add @arkiv-network/sdk viem
```

Since `0.7.0`, [viem](https://viem.sh) is a **peer dependency** — install it alongside the SDK. The SDK no longer re-exports viem's internals (`http`, `custom`, `privateKeyToAccount`, `Hex`, etc.); import them from `viem` / `viem/accounts` directly.

Version minimums to keep in mind before suggesting code:

- `select()`, viem-style imports, client-side validation, typed errors — SDK `0.7.0+`
- `braga` chain export — SDK `0.6.5+`
- On `0.6.x`, `http`/`custom` import from `@arkiv-network/sdk` and `privateKeyToAccount` from `@arkiv-network/sdk/accounts`, and queries use `buildQuery()` with `.withPayload()`/`.withAttributes()`/`.withMetadata()`

Verify the user's installed SDK version. Do not pin install commands unless the user explicitly asks for a specific version.

### Imports (SDK 0.7.0+)

```typescript
// Core client factories and typed errors
import {
  createWalletClient,
  createPublicClient,
  InvalidAttributeError,
  InvalidExpirationError,
} from "@arkiv-network/sdk"

// Transports and account management come from viem
import { http, custom } from "viem"
import { privateKeyToAccount, nonceManager } from "viem/accounts"

// Chain configuration
import { braga } from "@arkiv-network/sdk/chains"

// Utilities
import { ExpirationTime, jsonToPayload, stringToPayload, payloadToString } from "@arkiv-network/sdk/utils"

// Query operators and predicates
import { eq, gt, lt, gte, lte, and, or } from "@arkiv-network/sdk/query"
```

### WalletClient Methods (Write Operations)

#### createEntity

```typescript
const { entityKey, txHash } = await walletClient.createEntity({
  payload: jsonToPayload({ message: 'Hello' }),
  contentType: 'application/json',
  attributes: [
    { key: 'type', value: 'greeting' },
    { key: 'priority', value: 5 }
  ],
  expiresIn: ExpirationTime.fromHours(12),
})
```

#### updateEntity

**Full replace, not a patch.** The attribute set becomes exactly the provided list; payload, content type, and expiration are overwritten. Omitted attributes are silently removed. To change only some fields, read the entity first (`getEntity`) and re-send the complete state.

```typescript
const { txHash } = await walletClient.updateEntity({
  entityKey: entityKey,
  payload: jsonToPayload({ message: 'Updated' }),
  contentType: 'application/json',
  attributes: [
    { key: 'type', value: 'greeting' },
    { key: 'updated', value: Date.now() }
  ],
  expiresIn: ExpirationTime.fromHours(24),
})
```

#### deleteEntity

```typescript
const { txHash } = await walletClient.deleteEntity({
  entityKey: entityKey
})
```

#### extendEntity

```typescript
const { txHash } = await walletClient.extendEntity({
  entityKey: entityKey,
  expiresIn: ExpirationTime.fromHours(1), // always use the helper for readability
})
```

#### mutateEntities (Batch Operations)

Performs any number of operations in a **single transaction**. Accepts `creates`, `updates`, `deletes`, `extensions`, and `ownershipChanges` — they can be mixed in one call:

```typescript
await walletClient.mutateEntities({
  creates: [
    {
      payload: stringToPayload('item 1'),
      contentType: 'text/plain',
      attributes: [{ key: 'type', value: 'item' }],
      expiresIn: ExpirationTime.fromMinutes(30),
    },
  ],
  extensions: [
    { entityKey: '0x456...', expiresIn: ExpirationTime.fromHours(1) },
  ],
  deletes: [{ entityKey: '0x321...' }],
})
```

### Validation Rules (SDK 0.7.0+)

The SDK validates mutations client-side and throws a descriptive typed error before anything hits the network:

- **Numeric attribute values must be integers.** A non-integer number throws `InvalidAttributeError`. To store a non-integer, scale it to a fixed precision (`1.5` → `1500`, dividing on read) to keep range queries working — or store it as a string, which only supports equality.
- **`expiresIn` must be a positive integer and a multiple of 2 seconds.** Arkiv measures expiration in whole blocks (1 block = 2 seconds); invalid values throw `InvalidExpirationError`. The `ExpirationTime` helpers always produce valid values.

```typescript
import { InvalidAttributeError, InvalidExpirationError } from "@arkiv-network/sdk"

try {
  await walletClient.createEntity({ /* ... */ })
} catch (error) {
  if (error instanceof InvalidAttributeError) {
    // a numeric attribute value was not an integer
  } else if (error instanceof InvalidExpirationError) {
    // expiresIn was not a positive multiple of the 2s block time
  } else {
    throw error
  }
}
```

### Concurrent Writes and Nonces

All transactions from one wallet must use strictly sequential nonces, and the SDK does not manage nonces — each write fetches the next nonce from the network at send time. Two writes in flight simultaneously fetch the **same** nonce and collide.

```typescript
// ❌ Both writes fetch the same nonce — one fails or gets replaced
await Promise.all([
  walletClient.createEntity({ /* ... */ }),
  walletClient.createEntity({ /* ... */ }),
])
```

Two safe options:

1. **Batch into a single transaction (preferred):** `mutateEntities()` — one transaction, one nonce.
2. **viem's nonce manager** when separate transactions are unavoidable:

```typescript
import { privateKeyToAccount, nonceManager } from "viem/accounts"

const walletClient = createWalletClient({
  chain: braga,
  transport: http(),
  account: privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`, {
    nonceManager,
  }),
})

// ✅ Safe — nonces are allocated locally and sequentially
await Promise.all([
  walletClient.createEntity({ /* ... */ }),
  walletClient.createEntity({ /* ... */ }),
])
```

A nonce manager only coordinates writes **within a single process**. Multiple processes writing with the same private key still collide — give each writer its own wallet, or route all writes through one process.

### PublicClient Methods (Read Operations)

#### select + fetch

`select()` declares which entity fields to return. Every field is **opt-in — including `key`** — and only selected fields are fetched over the network:

```typescript
const result = await publicClient
  .select({ key: true, payload: true, attributes: true })
  .where(eq('type', 'note'), gt('created', 1672531200))
  .limit(10)
  .fetch()
```

Available fields: `key`, `owner`, `creator`, `contentType`, `payload`, `attributes`, `expiresAtBlock`, `createdAtBlock`, `lastModifiedAtBlock`, `transactionIndexInBlock`, `operationIndexInTransaction`.

- `select()` with no argument (or `"*"`) fetches every field — fine for prototyping, wasteful in production.
- The result type is inferred from the selection: `entity.toJson()` / `entity.toText()` exist only when `payload` is selected; accessing an unselected field is a compile error.
- Pass the selection **inline**. A selection stored in a variable widens `true` to `boolean` and the result type can't be narrowed. To reuse one, annotate it `as const`:

```typescript
const fields = { owner: true, payload: true } as const
await publicClient.select(fields).where(eq('type', 'note')).fetch()
```

Query builder methods:

- `.where(...conditions)` — Add filter conditions; accepts varargs, an array, or chained calls, all combined with AND
- `.ownedBy(address)` — Filter by current owner address (can change over time)
- `.createdBy(address)` — Filter by original creator address (immutable)
- `.limit(n)` — Limit number of results (max 200 per page)
- `.fetch()` — Execute the query

On SDK `0.6.x`, use `buildQuery()` with `.withPayload(true)` / `.withAttributes(true)` / `.withMetadata(true)` instead of `select()`.

#### Ordering

Results always come back **newest first**; server-side ordering is not supported. `orderBy()` and the `asc()` / `desc()` helpers are deprecated no-ops since 0.7.0 — sort the fetched entities in JavaScript instead. Note that `.limit(n)` caps results *before* a client-side sort (it returns the n newest matches, not the top n by your attribute).

#### getEntity

```typescript
const entity = await publicClient.getEntity(entityKey)
const data = entity.toJson()   // Parse JSON payload
const text = entity.toText()   // Get text payload
```

### ExpirationTime Helpers

Expiration is expressed in **seconds**. Always use these helpers to convert human-readable durations:

```typescript
ExpirationTime.fromMinutes(30)  // 1800 seconds
ExpirationTime.fromHours(1)     // 3600 seconds
ExpirationTime.fromHours(12)    // 43200 seconds
ExpirationTime.fromHours(24)    // 86400 seconds
ExpirationTime.fromDays(7)      // 604800 seconds
```

**Always prefer the helpers over raw numbers for `expiresIn`** — they're more readable, less error-prone, and guaranteed to satisfy the positive-multiple-of-2 validation rule. If a raw number is passed, it is treated as seconds (e.g., `expiresIn: 3600` means 1 hour) and must be a positive multiple of 2.

### Payload Helpers

```typescript
import { jsonToPayload, stringToPayload, payloadToString } from "@arkiv-network/sdk/utils"

// JSON data
const jsonPayload = jsonToPayload({ key: "value" })

// Plain text
const textPayload = stringToPayload("Hello Arkiv!")

// Reading back
const text = payloadToString(entity.payload)
const data = JSON.parse(payloadToString(entity.payload))
// or use entity helper (requires payload to be selected)
const data = entity.toJson()
```

### Query Operators

```typescript
import { eq, gt, lt, gte, lte, and, or } from "@arkiv-network/sdk/query"

eq('type', 'note')        // type = "note"
gt('priority', 3)          // priority > 3
lt('price', 1000)          // price < 1000
gte('created', timestamp)  // created >= timestamp
lte('expiration', limit)   // expiration <= limit
```

String attributes only support `eq()`. Numeric attributes support all comparison operators (and values must be integers).

Nest conditions with `and()` / `or()` — both accept predicates as varargs or a single array:

```typescript
// type = "note" AND (priority > 3 OR pinned = "true")
await publicClient
  .select({ key: true, payload: true })
  .where(eq('type', 'note'), or(gt('priority', 3), eq('pinned', 'true')))
  .fetch()

// Array form works too: or([gt('priority', 3), eq('pinned', 'true')])
```

Glob matching on string attributes (`~`) exists at the protocol level but is not yet exposed in the TypeScript SDK — use the JSON-RPC API directly if you need it (see `api-reference.md`).

### Browser Usage with MetaMask

```typescript
import { createWalletClient, createPublicClient } from "@arkiv-network/sdk"
import { braga } from "@arkiv-network/sdk/chains"
import { custom, http } from "viem"

// Request wallet connection
await window.ethereum.request({ method: 'eth_requestAccounts' })

// Use MetaMask as transport (no private key needed)
const walletClient = createWalletClient({
  chain: braga,
  transport: custom(window.ethereum),
})

// Public client for queries
const publicClient = createPublicClient({
  chain: braga,
  transport: http(),
})
```

**Adding Arkiv Network to MetaMask:**

```typescript
await window.ethereum.request({
  method: 'wallet_addEthereumChain',
  params: [{
    chainId: '0xe0087f86e',
    chainName: 'Arkiv Braga Testnet',
    nativeCurrency: { name: 'GLM', symbol: 'GLM', decimals: 18 },
    rpcUrls: ['https://braga.hoodi.arkiv.network/rpc'],
    blockExplorerUrls: ['https://explorer.braga.hoodi.arkiv.network']
  }]
})
```

### Browser CDN Imports

For static HTML/JS pages without a bundler (note that `http` comes from viem's CDN build):

```javascript
import { createPublicClient } from 'https://esm.sh/@arkiv-network/sdk?target=es2022&bundle-deps'
import { eq } from 'https://esm.sh/@arkiv-network/sdk/query?target=es2022&bundle-deps'
import { braga } from 'https://esm.sh/@arkiv-network/sdk/chains?target=es2022&bundle-deps'
import { http } from 'https://esm.sh/viem?target=es2022'
```

If the user is working with a versioned CDN URL instead of the unpinned form above, make sure the selected SDK version supports what the code uses: `0.6.5+` for the `braga` import, `0.7.0+` for `select()` and viem-based imports.
