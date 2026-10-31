# Versioned capability boundaries

Checked against published SDK 1.0.0 source on 2026-10-30. Source inspection is distinct from a funded or wallet-specific test.

- Queries read current state. The exported API has no historical snapshot, opaque query cursor or historical entity version parameter. Do not present head observations as old block-end state.
- Server ordering and filtered counts are available. A sort takes one key; bytes cannot be sorted. A count includes schema-mismatching matches.
- A schema's default mismatch policy skips rows; an empty returned page does not alone prove traversal completion. Track `skipped` for offsets or fail on mismatch for keyset pagination.
- `watchEntityEvents` starts on its first poll and follows the head; startup and disconnected intervals are gaps. It has no historical replay parameter. Natural Entity Expiration emits no event. Bootstrap and reconcile current state; do not promise recovery of unavailable old values.
- A named schema's tag and creator scope do not authenticate mutable content after transfer. See [trust policy](../../arkiv-security-trust/SKILL.md).
- Provider access keys are URL path segments. Missing/non-string keys throw `MissingAccessKeyError`; explicitly empty keys use the heavily limited endpoint. Redact complete transport errors before sharing.
- SDK `createEntity` and `extendEntity` return receipt-derived expiration blocks. A later read failure does not undo a confirmed write. Batches return ordered keys without deadlines; inspect authenticated receipts and read back.
- Library APIs must pass their own installed SDK 1.0 compatibility gate. Never widen peers, downgrade the SDK or invent a release to make examples appear compatible.

Sources: [query implementation](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/query/queryBuilder.ts), [watcher](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/actions/public/watchEntityEvents.ts), [chain](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/chains/rabdi.ts).
