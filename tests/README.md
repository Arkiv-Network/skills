# Contributor verification

This repository has no root dependency installation or application build. Use an existing workspace with SDK **1.0.0**, its viem peer, TypeScript and Node types. Do not install unrelated dependencies for these checks.

```bash
export ARKIV_SNIPPET_WORKSPACE=/absolute/sdk-workspace
export ARKIV_IMPORT_TEST_SCRATCH=/absolute/owned-scratch
node scripts/check-skill-references.mjs
node tests/check-snippets.mjs
node --experimental-vm-modules --test tests/snippets/*.test.mjs
node tests/snippets/published-imports.mjs
```

`check-snippets` compiles every TypeScript skill/reference fence with strict and noUncheckedIndexedAccess, syntax-checks JavaScript, and writes a source/line/hash manifest inside the SDK workspace. It does not execute writes. The deterministic importer suite evaluates the exact published JavaScript fence with real SDK 1.0.0 encoding, synthetic transport/receipts and in-memory ephemeral test keys. Network fetches are forbidden in that suite. Preserve failing evidence; do not substitute deterministic results for live/provider/wallet behavior.

If only the SDK needs upgrading, `node tests/prepare-sdk.mjs <viem-workspace> <typescript-workspace> <node-types-workspace>` verifies the official 1.0.0 tarball and prepares `.checks`, reusing existing peers without installing or executing package scripts. It creates symlinks to those existing peers; their lifecycle remains the contributor's responsibility.

## Authorized Rabdi smoke and seed

Supply `ARKIV_ACCESS_KEY_A`, `TEST_SKILLS_ADDRESS` and `TEST_SKILLS_PRIVATE_KEY` through the local secret store. Never put them in argv, source, public env or output. Supply an existing absolute private `ARKIV_SEED_STATE_DIR` and optional `ARKIV_EVIDENCE_DIR` outside Git. Keep durable state across restarts; signed transaction journals must remain private. Do not delete journals to repeat a test.

```bash
node --experimental-vm-modules scripts/seed-rabdi.mjs
node --experimental-vm-modules --test tests/live/live.test.mjs
```

The seed is idempotent under exclusive signer custody and a durable genesis-bound journal. Its repeat reconciles the same hash and performs no new send. After a network reset the script creates a separately identified state directory while retaining prior evidence; dependent apps must adopt new keys. Unresolved pre-reset attempts are not automatically replayed. The live suite checks successful writes/readback on Rabdi plus repeat zero-send behavior. Browser-wallet nonce behavior and separate library releases require their own evidence.

The live runner also includes `tests/live/lifetime.test.mjs`: an explicitly authorized negative create using the dedicated SKILLS signer, maximum-u64 deadline and explicit 1,000,000 gas/current gasPrice/latest nonce. This deliberately pays for one reverted transaction. It persists signed intent before forwarding, confirms receipt.status is reverted with gas below the cap, decodes ExpiryBeyondMaxLifetime at latest and reconciles the same hash on reruns. It does not retry or automatically repeat after reset. Keep its private journal; clearing state does not authorize another negative create.

Updated importer gas policy does not authorize recreating an old seed. A completed v1 seed may reconcile with the exact previously verified helper, whose source hash is checked, with signing/broadcast explicitly blocked. An unfinished or unrecognized prior revision stops for reconciliation. New seed plans use the current importer and measured per-batch gas floor. Source/line regression tests reject permanent-expiration recommendations and exercise copied first-write/lifecycle/extension transaction fields and receipt handling.

All RPC errors are sanitized; the access key is in the URL path. The smoke counts arkiv_query calls for the supplied key. Ordinary calls do not consume query-cost units under the current provider policy. Tests never use or fund from another lane's signer.
