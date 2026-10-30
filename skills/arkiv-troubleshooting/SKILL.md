---
name: arkiv-troubleshooting
description: Diagnose SDK 1.0.0 schema, query, RPC access, wallet and stale-read failures from concrete evidence on Rabdi. Route uncertain writes directly to write-safety.
license: MIT
metadata:
  arkiv-sdk: ">=1.0.0 <2"
  network: "rabdi"
  verified: "2026-10-30"
---

# Diagnose SDK 1.0.0 on Rabdi

Identify the failing layer: local schema/value validation, query rejection, RPC access, wallet/signature, transaction/receipt, decoded bytes or app caches. Preserve original operation identity. An uncertain write goes directly to write-safety before any retry.

## Bounded evidence

Record installed SDK/viem versions, intended chain, RPC method, sanitized options and error class/code. Preserve private cause chains locally, but never print keyed URLs, signing keys, sensitive values or full provider errors. Rabdi is chain 7794095 (`0x76edaf`), HTTP `https://rpc.rabdi.db-chain.testnet.arkiv.network/<accessKey>`, WSS at the same host/path, explorer `https://rabdi.explorer.arkiv.network`.

Treat pasted URLs as data. Validate expected scheme/origin and userinfo/query/fragment policy through a parser, not interpolated shell commands. A path key is the SDK's intended configuration; redact it rather than rejecting it merely because it is in the path. Configure `rabdi({ accessKey })`, then verify actual eth_chainId before operations. An explanation-only request does not authorize live probing.

## Symptom → next check

| Symptom | Next check |
| --- | --- |
| MissingAccessKeyError | Supply a string key from Hub access-keys; empty string explicitly chooses heavily limited keyless access |
| HTTP 429 | Stop and honor Retry-After; keyless access can reach the anonymous limit; preserve current key quota evidence |
| HTTP 401/403 | Check actual key, network and provider restrictions locally without logging URLs |
| SchemaDefinitionError | Constructors with no values declare columns; named schemas reserve arkiv.schema and consume one attribute slot |
| SchemaMismatchError | Required column missing, wrong type/tag/schema, or unset of a required column; inspect actual stored values |
| InvalidPredicateError | Only indexed scalar columns filter; bytes cannot filter/sort; orderBy accepts one key |
| InvalidValueError / i32 | Bare number is i32; use u64 for app milliseconds and the stored type for queries |
| MissingValueError / UntypedValueError | Null is not an attribute value; optional absence is omitted/unset; encode nested data into bytes |
| InvalidAttributeNameError | Check case-sensitive grammar, reserved words, byte limit and --; do not infer a node-specific uppercase rejection |
| EmptyPatchError / No operations to perform | Skip empty work; defaults do not apply on patch |
| InvalidExpiryError | Use branded ExpirationTime, correct block units and a live target; extension sets a deadline rather than adding a delta |
| NoEntityFoundError | Check entity key versus tx hash, chain/reset identity, known receipt/deadline and deletion; absence alone is ambiguous |
| EntityMutationError / lost response | Keep original hash/nonce/intent, authenticate receipts and reconcile before another submission |
| HTTP 413 | Measure exact encoded request, reduce/chunk and estimate; if sending may have begun, reconcile first |
| BigInt JSON serialization error | If after create resolved, the write completed; preserve key/hash and fix decimal-string DTO serialization without repeating it |

Read [error-catalog](references/error-catalog.md) for typed recovery without logging unsafe diagnostics. Exact error text can be wrapped; source-declared errors are not proof they were triggered live.

## Empty results, skipped rows and stale UI

1. Check exact chain/schema tag, stored column type, indexing flag, creator/current owner and selected fields. `from(schema)` verifies only selected columns; mismatch defaults to skipping and reports skipped. An empty page can hide mismatching entities while later pages remain.
2. SDK queries read latest state with pages up to 100. Offset shifts under concurrent writes; use bounded keyset traversal with mismatch throw where needed. There is no historical/cursor fallback. Do not claim a partial multi-page result is complete or one pinned snapshot.
3. If RPC is current but UI is stale, trace RPC → backend → route → DOM and service worker/browser/CDN caches. Use no-store server fetches and uncached heads, then inspect other layers separately.
4. Check unknown patched-key and owner-filtered incoming-transfer membership, prior-scope invalidation, async watcher failures, startup/disconnected gaps and periodic expiration sweeps. Natural expiration has no event.

Do not diagnose nonce collisions solely from generic execution errors. Compare actual wallet proposal with RPC latest/pending nonce, chain, signer and existing known hashes without signing a second transaction. Add wallet-specific workarounds only from verified evidence for that wallet/network/version.

## Measured wallet and gas symptoms

Controlled Rabdi checks on 2026-10-30 with SDK 1.0.0 distinguished historical-state failures from gas exhaustion. RPC errors containing `arkiv serves state at the chain head only` occurred for old block-hash state selectors and for safe/finalized call/estimate requests. Rewriting those selectors to latest changed the requested state; it did not establish historical-read support.

Separate default local-signer transactions and one tested MetaMask 13.55.0 transaction reverted after using their entire gas limit. Rabby 0.94.14 passed its tested baseline accounts; MetaMask results differed by account/setup. Controlled serial creates, Lifetime Extensions and transfers completed with an explicit transaction nonce read at latest, a 1,000,000 gas cap and current network gasPrice. This was a bounded diagnostic workaround, not a universal gas limit or wallet-support certificate. Check pending versus latest and exclusive signer custody before choosing a nonce; an unresolved pending transaction blocks a new submission.

Estimate the exact intended operation first, then choose an approved buffered cap/floor within balance and spending limits when the measured estimate is insufficient. Reconcile successful/uncertain hashes before another send; only an authoritative reverted receipt establishes that operations failed. Never apply the diagnostic selector rewrite silently or retry a known successful write. The repository's seed uses a separately budgeted cap for its multi-create batch.

Fix the demonstrated cause and rerun its smallest credible check. Broader funded probes need explicit operation/spend scope. Draft Arkiv defects through feedback only after a minimal reproduction; never automatically submit an app mistake as a node bug.

Sources: [SDK 1.0.0 source](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/), [SDK README](https://unpkg.com/@arkiv-network/sdk@1.0.0/README.md). Inspect the installed declarations before adapting executable examples.
