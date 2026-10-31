---
name: arkiv-indexing
description: Build current-state Arkiv application projections with bounded queries, event invalidation, reset identity and expiration sweeps. Distinguish current observations from historical archives and EVM-to-Arkiv ingestion.
license: MIT
metadata:
  arkiv-sdk: ">=1.0.0 <2"
  network: "rabdi"
  verified: "2026-10-30"
---

# Current-state Arkiv projections

Use SDK 1.0.0 on Rabdi for an owned application projection. The SDK reads current entity state and its watcher follows the head; it does not reconstruct historical values. Distinguish a current-state mirror from an archive before choosing a design. Query access does not authorize deleting source entities, dropping user tables or deploying a worker.

## Choose the direction and compatibility

`arkiv-sync` is an EVM-events-to-Arkiv ingestion package, not automatically an Arkiv-to-app mirror. Inspect the installed package version, public declarations, peer/dependency range and Rabdi support before integration. Accept only a source-verified SDK 1.0-compatible release; do not widen peers, downgrade the SDK or claim another lane's candidate is published. The package's source identity and its funded acceptance are separate evidence.

## Project current observations honestly

1. Bind chain ID, genesis/reset identity, schema/index/trust scope and projection generation. A chain ID alone does not distinguish a reset.
2. Bootstrap with a bounded current-state scan. Keep observed blocks; keyset pagination prevents repeats of prior keys but is not an atomic snapshot. For a consistent baseline, coordinate writers and require the same unchanged head across every page, using [backup capture](../arkiv-entity-lifecycle/references/backup-restore.md).
3. Start `watchEntityEvents` as an invalidation signal, then reconcile current state. The listener becomes active on its first poll, so startup/disconnected intervals have gaps. A successful watch call or idle stream is not continuity evidence.
4. Re-fetch affected keys and re-evaluate schema, creator/publication policy, owner and collection filters. A patch can move an unknown key into scope; an incoming transfer can add it to an owner filter. Known keys need prior-scope invalidation even when a fresh read fails or no longer matches.
5. Periodically reconcile the full bounded scope and sweep expired deadlines. Natural Entity Expiration has no event. Report projection lag, observation blocks and unhealthy/gapped state to readers.
6. Commit rows, source identity, generation and progress atomically in storage owned by this consumer. Do not present an event's old block number as the block of a later head read.

Read [checkpoint-mirror](references/checkpoint-mirror.md) for generation persistence and conservative recovery. Event identities can include block/transaction/log context, but a durable cursor cannot recover values that were never captured. When continuity/reset identity cannot be verified, freeze the old generation and build an isolated current generation; verify it before changing readers. Keep inaccessible historical intervals as explicit gaps.

## Historical requirements

If an application needs exact block-end or mutation-version history, it must capture authenticated state while available or use a separately verified archival service. Event logs alone lack column values. SDK 1.0.0 has no historical entity query; do not synthesize a historical implementation by attaching head values to an old checkpoint. Reorganizations, missed operations, disappearance between reads and network resets need explicit product semantics.

Use a signed snapshot/version policy for trusted history, retain canonical identity where independently available, and scope rollback/rebuild to the consumer's owned projection. A timeout or missing old block is not proof of a fork. A number-only legacy checkpoint has no authenticated lineage; preserve it and bootstrap a separate generation rather than inventing an ancestor.

A projection may retain public values after source deletion/expiration. Apply app access/retention policy; neither a namespace nor a shared signer is app-user authorization. Verify reset recovery, skipped schema rows, duplicate events, changed owner, unknown patched-key membership, expiration-only removal and failure before atomic commit. Controlled fixtures do not certify natural chain reorganizations or production persistence.

Sources: [SDK 1.0.0 source](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/), [SDK README](https://unpkg.com/@arkiv-network/sdk@1.0.0/README.md). Inspect the installed declarations before adapting executable examples.
