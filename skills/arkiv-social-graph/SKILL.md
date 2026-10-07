---
name: arkiv-social-graph
description: Model follows, likes and entity references with arkiv-graph. Use when an Arkiv app needs a graph or tables from explicit relationship rules, including direction, duplicate edges and missing or expired endpoints.
license: MIT
metadata:
  arkiv-sdk: ">=0.8.1 <0.9"
  arkiv-graph: "0.3.1"
  network: tiramisu
  verified: "2026-10-05"
---

# Arkiv social graphs

Use the published `arkiv-graph@0.3.1` public imports. Its SDK peer is `>=0.8.0 <0.9.0`; the examples below were checked with SDK 0.8.1. Read the package's [consumer guide](https://github.com/SantiagoDevRel/arkiv-graph/blob/main/packages/arkiv-graph/AGENTS.md) and installed declarations. Core builders can run without rendering React; `arkiv-graph/react` is a separate client entry.

## Define the relationship

- Choose the public creator/owner scope, app namespace, endpoint identifiers and relationship meaning with the developer. `project`, profile names and relationship attributes identify data; they do not authorize readers or establish trusted authorship.
- Store a follow/like as its own entity with lowercase attributes, such as `entity_type: "follow"`, `source_key` and `target_key`. Entity Expiration belongs to this edge independently of its endpoints. The package reads relationships; it does not write edges or enforce foreign keys.
- Pass `typeAttribute: "entity_type"` explicitly to builders/fetch. The library's default is camelCase `entityType`, which is unsuitable for newly written Tiramisu attributes. Also pass an explorer override: 0.3.1's default Tiramisu explorer constant is stale.
- A directed follow is source → target. Set `directed: true`; use `false` only when the product deliberately treats the relation as symmetric. Self-joins are skipped by the join builder.
- Distinct edge entities connecting the same pair remain distinct edges. The builder deduplicates edge IDs, not semantic pairs. Decide whether multiple follows/likes are meaningful; enforce any uniqueness in the app and reconcile concurrent or uncertain writes with `arkiv-write-safety`.
- Prefer entity keys as endpoints. Stable business IDs need type-specific matching and a uniqueness policy: join indexes keep the first matching entity when IDs collide.
- A ghost node means an endpoint was not fetched, not proof that it expired. It may be outside the query scope, truncated, missing or expired. Verify live availability separately. With placeholders disabled, unresolved joins remain standalone entities instead of becoming edges.

Use `arkiv-data-modeling` for the schema and `arkiv-security-trust` for publisher/mutable-owner policy. These are public relationships, not private follows or a SQL join engine.

## Build a local graph

This synthetic example needs no RPC, credentials or wallet. Install with the consumer's package manager after checking peers: `npm install arkiv-graph@0.3.1`. Use the existing compatible SDK/viem/React versions; do not force incompatible peer resolution.

```typescript
import { buildGraph, type ArkivEntityLike, type LinkRule } from "arkiv-graph"
import { tiramisu } from "@arkiv-network/sdk/chains"

export const follows: LinkRule[] = [{ type: "join", entityType: "follow",
  sourceAttr: "source_key", targetAttr: "target_key", directed: true, label: "follows" }]
export const graphOptions = { links: follows, typeAttribute: "entity_type",
  nativeChainId: tiramisu.id, arkivExplorer: "https://tiramisu.explorer.arkiv.network",
  external: { enabled: false }, createPlaceholders: true }

export function localGraph() {
  const alice = `0x${"11".repeat(32)}`, bob = `0x${"22".repeat(32)}`
  const entities: ArkivEntityLike[] = [
    { key: alice, attributes: { entity_type: { type: "str", value: "profile" } },
      payload: { name: "Alice" } },
    { key: bob, attributes: { entity_type: { type: "str", value: "profile" } },
      payload: { name: "Bob" } },
    { key: `0x${"33".repeat(32)}`, attributes: {
      entity_type: { type: "str", value: "follow" },
      source_key: { type: "key", value: alice }, target_key: { type: "key", value: bob } } }
  ]
  return { entities, graph: buildGraph(entities, graphOptions) }
}
```

The follow entity becomes an edge with `viaEntityKey`; its source is Alice and target is Bob. For scoped SDK fetching and matching tables, read [fetch-and-refresh.md](references/fetch-and-refresh.md).

## Keep a projection current

Treat graphs/tables as a bounded projection. They do not enforce authorization, uniqueness, endpoint existence, cascade deletion, archival retention or automatic synchronization. External-reference detection draws stored attributes; it does not query other blockchains.

Filter network events against the selected namespace/creator/owner before applying them. Subscribe through `arkiv-app-integration`, reconcile canonical metadata after writes/transfer/delete/extension, and periodically sweep Entity Expiration: automatic expiration has no entity event. A transfer can move an entity out of an owner-scoped graph. Keep replay, deduplication, gaps and reorg handling in the application.

Keep original SDK `bigint` metadata for liveness/transactions. The package preserves large typed attribute values as strings, but converts block metadata to display numbers; unsafe current/expiration blocks omit expiration estimates. Approximate dates or graph degree must not decide authorization, transaction targets or whole-network counts. Parse payload/labels as untrusted data and render text safely.

Verify direction, duplicate pairs, self-joins, missing/truncated endpoints, ambiguous stable IDs, empty/error states and refresh after expiration/transfer. Report local/mock checks separately from network evidence. If implementing the React view, apply the installed React practices and render narrow, medium and wide layouts before delivering it.
