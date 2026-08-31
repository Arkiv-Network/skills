# Arkiv JSON-RPC API Reference

Arkiv exposes a JSON-RPC 2.0 API over HTTP. Use this when you need raw HTTP access without the SDK, or for advanced query options. All examples target the Cheesecake devnet.

## Endpoint

| Property  | Value                                                         |
| --------- | ------------------------------------------------------------- |
| Chain ID  | `7733102` / `0x75ff6e`                                        |
| HTTP RPC  | `https://rpc.cheesecake.db-chain.devnet.gobas.me`             |
| WebSocket | `wss://rpc.cheesecake.db-chain.devnet.gobas.me`               |
| Explorer  | `https://indexer.cheesecake.db-chain.devnet.gobas.me`         |
| Faucet    | `https://hub.arkiv.network/faucet`                            |
| API keys  | `https://hub.arkiv.network/api-keys`                          |

Register an API key at `https://hub.arkiv.network/api-keys` for elevated RPC rate limits. Pass the key as a URL path segment, or as an HTTP header:

```bash
# Path segment
curl --json '{"jsonrpc":"2.0","id":1,"method":"arkiv_getEntityCount","params":[]}' \
  https://rpc.cheesecake.db-chain.devnet.gobas.me/YOUR_API_KEY

# X-API-KEY header
curl --json '{"jsonrpc":"2.0","id":1,"method":"arkiv_getEntityCount","params":[]}' \
  -H "X-API-KEY: YOUR_API_KEY" \
  https://rpc.cheesecake.db-chain.devnet.gobas.me

# Authorization: Bearer header
curl --json '{"jsonrpc":"2.0","id":1,"method":"arkiv_getEntityCount","params":[]}' \
  -H "Authorization: Bearer YOUR_API_KEY" \
  https://rpc.cheesecake.db-chain.devnet.gobas.me
```

## Request Format

All methods use standard JSON-RPC 2.0.

```bash
curl https://rpc.cheesecake.db-chain.devnet.gobas.me \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"METHOD_NAME","params":[]}'
```

## Methods

### arkiv_query

Query entities from the indexed store.

**Parameters:**

| Index | Type        | Required | Description      |
| ----- | ----------- | -------- | ---------------- |
| 0     | string      | Yes      | Query expression |
| 1     | object/null | No       | Query options    |

**Query Syntax — Operators:**

- Logical: `AND`, `OR`
- Negation: `NOT`
- Comparisons: `=`, `<`, `>`, `<=`, `>=`
- Prefix matching: `STARTSWITH` (raw UTF-8 byte prefix on `str` attributes)

**Reserved but not implemented:** `!=`, `EXISTS(…)`, `TYPEOF(…)`. Queries using these fail to parse. Use `NOT (attr = value)` for the complement — it also matches entities that never set the attribute.

**Typed literals** — every value carries a type tag:

| Type | Syntax | Example |
| ---- | ------ | ------- |
| bool | bare `true` / `false` | `flagged = true` |
| i32 | bare number or `i32(n)` | `level >= 10` or `level >= i32(10)` |
| u64 | `u64(n)` | `$expiresAt < u64(1200000)` |
| u256 | `u256(n)` | `balance > u256(1000000)` |
| dec | `dec("n.n")` | `score >= dec(3.5)` |
| str | `str('text')` | `name = str('Bob')` |
| addr | `addr(0x…)` | `$owner = addr(0xAbC…)` |
| key | `key(0x…)` | `parent = key(0x123…)` |
| bytes32 | `bytes32(0x…)` | `hash = bytes32(0xabc…)` |

An untagged number always means `i32`. System block heights (`$expiresAt`, `$createdAt`) must be explicitly tagged as `u64`.

**Synthetic Attributes (use with `$` prefix):**

- `$key` — Entity key
- `$owner` — Entity owner address (queryable)
- `$creator` — Entity creator address (queryable)
- `$expiresAt` — Expiration block (queryable, must use `u64` tag)
- `$createdAt`, `$updatedAt`, `$creationFlags`, `$contentType`, `$payload` — returned in projections only, not queryable

Use `*` to match all entities (cannot be combined with other predicates).

**Options:**

| Field    | Type       | Description                                      |
| -------- | ---------- | ------------------------------------------------ |
| atBlock  | hex string | Query at specific block (default: latest)        |
| select   | object     | Controls which fields are returned               |
| limit    | hex/number | Page size, max 200 (default: 100)                |
| cursor   | string     | Pagination cursor from previous response         |

**select fields** (all opt-in; absent `select` returns key only):

`key`, `owner`, `creator`, `createdAt`, `updatedAt`, `expiresAt`, `creationFlags`, `contentType`, `payload`, `attributeSchema`, `attributes`

**Example — query active NFTs:**

```bash
curl https://rpc.cheesecake.db-chain.devnet.gobas.me \
  -H "content-type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":1,
    "method":"arkiv_query",
    "params":[
      "type = str(\"nft\") AND status = str(\"active\")",
      {"limit":"0xa"}
    ]
  }'
```

**Example — query by owner:**

```bash
curl https://rpc.cheesecake.db-chain.devnet.gobas.me \
  -H "content-type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":10,
    "method":"arkiv_query",
    "params":[
      "$owner = addr(0x2222222222222222222222222222222222222222)",
      null
    ]
  }'
```

**Example — numeric range:**

```bash
curl https://rpc.cheesecake.db-chain.devnet.gobas.me \
  -H "content-type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":12,
    "method":"arkiv_query",
    "params":["price >= i32(100) AND price <= i32(1000)", null]
  }'
```

**Example — prefix match with negation:**

```bash
curl https://rpc.cheesecake.db-chain.devnet.gobas.me \
  -H "content-type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":13,
    "method":"arkiv_query",
    "params":["name STARTSWITH str(\"test\") AND NOT (status = str(\"deleted\"))", null]
  }'
```

**Example — metadata only (omit payload):**

```bash
curl https://rpc.cheesecake.db-chain.devnet.gobas.me \
  -H "content-type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":14,
    "method":"arkiv_query",
    "params":[
      "*",
      {
        "limit":"0xa",
        "select":{
          "key":true,"attributes":true,"payload":false,
          "contentType":true,"expiresAt":true,
          "creator":true,"owner":true
        }
      }
    ]
  }'
```

**Response structure:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "data": [
      {
        "key": "0x...",
        "contentType": "application/json",
        "payload": "0x...",
        "expiresAt": "0x124f80",
        "creator": "0x...",
        "owner": "0x...",
        "createdAt": "0x191",
        "updatedAt": "0x1bb",
        "attributes": [
          { "name": "status", "type": "str", "value": "active" },
          { "name": "rarity", "type": "i32", "value": 5 }
        ]
      }
    ],
    "blockNumber": "0x1bc",
    "cursor": "0x2a"
  }
}
```

**Response encoding notes:**

If you select a field, it appears in the response. If you do not select a field, it does not appear at all. The response never sends an unselected field as `null`.

- `payload` is hex-encoded bytes. Decode it to read the entity content.
- `createdAt`, `updatedAt`, and `expiresAt` are hex block numbers.
- When no more pages remain, `cursor` is omitted.

The `type` of an attribute decides the JSON encoding of its `value`:

- `i32`: a JSON number
- `u64` and `u256`: a `0x` hex quantity
- `dec`: a decimal string
- The byte-shaped types: `0x` bytes
- `str`: a plain string
- `bool`: a JSON boolean

**Pagination:**

Use the returned `cursor` in the next request:

```json
{"method":"arkiv_query","params":["type = str(\"nft\")",{"cursor":"0x2a","limit":"0x2"}]}
```

### arkiv_getEntity

Read a single entity by key. Returns all fields (full projection).

**Parameters:**

| Index | Type       | Required | Description                          |
| ----- | ---------- | -------- | ------------------------------------ |
| 0     | hex string | Yes      | Entity key                           |
| 1     | hex string | No       | Block number to read at (historical) |

```bash
curl https://rpc.cheesecake.db-chain.devnet.gobas.me \
  -H "content-type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":5,
    "method":"arkiv_getEntity",
    "params":["0xYOUR_ENTITY_KEY"]
  }'
```

Returns `null` if the entity does not exist or has expired.

### arkiv_getEntityCount

Returns total number of entities currently stored. No parameters.

```bash
curl https://rpc.cheesecake.db-chain.devnet.gobas.me \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"arkiv_getEntityCount","params":[]}'
```

Result: plain JSON number (e.g., `18427`).

### arkiv_getBlockTiming

Returns timing for the current head block. No parameters.

Response:

```json
{
  "result": {
    "current_block": 582143,
    "current_block_time": 1742721127,
    "duration": 2
  }
}
```

- `current_block_time` — Unix timestamp in seconds
- `duration` — seconds since previous block
