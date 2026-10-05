# Raw JSON-RPC (Tiramisu, SDK 0.8.1 era)

Use raw RPC when the host has no current TypeScript SDK or when a raw-only capability is required. Send JSON-RPC 2.0 requests to `https://rpc.tiramisu.db-chain.testnet.arkiv.network`. Do not assume an older language SDK uses this protocol.

## Queries

`arkiv_query` accepts `[expression, options]`. Allowed options are `atBlock`, `select`, `limit`, `cursor`. `atBlock` is a hexadecimal block string; `limit` is page size, up to 200. A cursor is opaque and bound to expression, snapshot and selection: copy the response value unchanged. For cursor errors, restart the entire walk at a fresh pinned block.

```json
{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["entity_type = str('nft')",{"limit":100}]}
```

This is a single page. For an all-page walk, obtain `eth_blockNumber`, put that returned hex string in `atBlock` on the first request, and retain identical options for subsequent requests while adding the returned cursor.

Raw text uses single quotes: `str('nft')`. Escape embedded apostrophes by doubling them. Do not interpolate untrusted text without encoding it. The TypeScript helper `str("nft")` is valid TypeScript but those double quotes are invalid in raw query syntax. Raw decimal syntax is `dec(3.5)`, while the TypeScript helper takes `dec("3.5")`.

Typed literals use `str`, `i32`, `u64`, `u256`, `dec`, `addr`, `key`, and `bytes32`; booleans are bare `true` or `false`, not `bool(...)`. Match the stored attribute's type, not a visually equivalent value of another type. `*` is the raw all-entity expression; the SDK builder instead requires a predicate.

Comparison, `AND`, `OR`, `NOT` and string-prefix `STARTSWITH` are supported. `ne`, `exists`, and `hasType` are rejected by the node even though SDK exports exist. `NOT (field = value)` includes entities without that field. The documented query API provides no server sort; `STARTSWITH` is its only pattern operator, not full-text search.

The SDK filters `$key`, `$owner`, `$creator`, `$expiresAt`. Raw RPC also permits `$createdAt` and `$contentType`; do not copy those predicates into the SDK builder. `$expiresAt` and block metadata use u64 block values, not application millisecond timestamps. Application timestamp filters must match the application's chosen type.

## Counts and history

- `arkiv_getEntityCount` with no arguments counts chain-wide. A filtered count uses `params: [{ "query": "entity_type = str('nft')" }]`, not a bare expression string. SDK `getEntityCount()` only sends the chain-wide form. A misspelled `filter` field is silently ignored by this node; verify your request shape rather than trusting an apparently successful count.
- `arkiv_getEntity` takes `[entityKey, block]` for history. Here block is a JSON u64 **number**, unlike the hexadecimal `atBlock` option for queries. Reject unsafe integers in JavaScript before serializing a block; the RPC's type can exceed JavaScript precision.
- SDK `getEntity()` reads head. A missing entity is not proof it never existed or that past calldata has been erased.

## Error boundaries

| Code | Observed diagnosis |
| --- | --- |
| `-32001` | Query syntax parse error. |
| `-32002` | Unsupported or invalid typed operation, including the unsupported exported predicates. |
| `-32003` | Invalid literal, including `str` with double quotes. |
| `-32005` | Cursor malformed or bound to a different query, block, or selection. |
| `-32006` | Requested snapshot block is unavailable or ahead of head. |
| `-32602` | Invalid parameters: unknown options or a non-u64 historical block. |

Inspect the complete error response. A transport failure, HTTP 429, parse error, empty result, and failed transaction require different recovery. An invalid access key can produce HTTP 401 with `INVALID_KEY` instead of a JSON-RPC error. Do not label a network failure as a valid empty query. Read current rate-limit headers; no fixed monthly quota is promised here. For an unavailable block, preserve a historical request's target rather than silently switching it to head.

## Native write encoding

Prefer the current TypeScript SDK for writing. Raw callers ABI-encode `execute((uint8 operation, bytes operationData)[] ops)` to `0x4400000000000000000000000000000000000044`. This system entry point is valid despite user-deployed contracts being disabled.

Read `src/entity/operations.ts`, `src/entity/params.ts`, `src/attr/codec.ts` and `src/entity/expiry.ts` from the published SDK before encoding: operation tags, type IDs, byte widths and sorted bytes32 attribute names are protocol data, not guesses. Include required `$payload` and `$contentType` cells on create; their capitalization is a system exception, not permission for uppercase application attributes. `eth_estimateGas` validates calldata without broadcasting or signing.

Check canonical encodings against SDK-generated calldata and the live node. Operation logs are `EntityCreated`, `EntityPatched`, `ExpiryExtended`, `OwnershipTransferred`, `EntityDeleted`; they do not contain payload or attributes. A mirror fetches entity contents separately and sweeps expiration because no expiration log exists.

Sources: published SDK 0.8.1 query expression renderer, select builder, entity operation encoders and event ABI; live Tiramisu RPC checks on 2026-10-05. Recheck raw capabilities when the server changes.
