# Contributor verification

This repository has no root dependency installation or application build. Use an existing workspace with SDK **1.0.1**, its viem peer, TypeScript and Node types. Do not install unrelated dependencies for these checks.

```bash
export ARKIV_SNIPPET_WORKSPACE=/absolute/sdk-workspace
export ARKIV_IMPORT_TEST_SCRATCH=/absolute/owned-scratch
node scripts/check-skill-references.mjs
node scripts/check-vocabulary.mjs
node scripts/check-rabdi-log-window.mjs
node scripts/check-lifetime-margins.mjs
node scripts/check-sdk-101-guidance.mjs
node tests/check-snippets.mjs
node --experimental-vm-modules --test tests/snippets/*.test.mjs
node tests/snippets/published-imports.mjs
```

`check-snippets` compiles every TypeScript skill/reference fence with strict and noUncheckedIndexedAccess, syntax-checks JavaScript, and writes a source/line/hash manifest inside the SDK workspace. It does not execute writes. The deterministic importer suite evaluates the exact published JavaScript fence with real SDK 1.0.1 encoding, synthetic transport/receipts and in-memory ephemeral test keys. Network fetches are forbidden in that suite. Preserve failing evidence; do not substitute deterministic results for live/provider/wallet behavior.

The vocabulary gate checks resource names and repository text, including code fences, seeds, generated data and snapshots. Its CLI mutation tests inject retired wording into each of those surfaces and require a failing exit code. Encryption guidance uses `arkiv-encryption` 1.1.1; verify its named bytes exports before consuming it.

The Rabdi log-window guard discovers skill, reference and AGENTS resources, requires distinct troubleshooting rows for `segment_range_of(transactions): NotImplemented`, and rejects split/range-retry advice for that error. Omission and newly introduced guidance mutations run through the checker and CLI. GitHub's Guidance checks workflow runs these dependency-free checks plus vocabulary, references and retry-policy checks; the complete SDK-backed suite and half-block gas gate remain in `node tests/run-checks.mjs` using the existing workspace above.

The lifetime-margin guard scans all Markdown guidance and requires explicit SDK 1.0.0 compatibility scope for maximum-lifetime margins or subtraction, including context for deadline-cap code examples. SDK 1.0.1+ uses `ExpirationTime.max()` without manual subtraction. Unrelated fee and parent/child remaining-life checks retain their own meaning. The guard and its mutation tests run in both CI and the full suite.

The gas-bound repository gate requires both conservative AST validation and execution of each discovered helper's complete documentation fence. `verifyGasBounds` runs real helper bodies with synthetic above-bound and within-bound inputs in bounded workers; any missing adapter, execution error, timeout or missing result fails the gate. The importer's arithmetic-only formula is executed with its actual admission guard, while preparation, resume and the private guard also execute independently. `inspectGasBounds` remains the static unit-test layer. A passing structural result alone cannot certify a helper. No funded signer or provider is used.

The gas-bound gate catches accidental regressions in published snippets, including removed, weakened, unreachable or swallowed half-block checks. It does not defend against code deliberately written to detect and fool the tests; human review is required for every skill change.

Provider facades and raw/formatted return values are deeply frozen. Execution uses boundary, oversized and varied deterministic vectors from seed `0x41524b49`; the neutral network refusal adds no test-only global flag. The seed and complete vector table are emitted with the execution evidence.

If only the SDK needs upgrading, `node tests/prepare-sdk.mjs <viem-workspace> <typescript-workspace> <node-types-workspace>` verifies the official 1.0.1 tarball and prepares `.checks`, reusing existing peers without installing or executing package scripts. It creates symlinks to those existing peers; their lifecycle remains the contributor's responsibility.

The SDK guidance guard checks current source/install citations and labels against the verified 1.0.1 baseline. Historical SDK 1.0.0 behavior and compatible ranges remain valid. The check also inspects generated catalog metadata, source-map strings/keys and code setup pins; regression fixtures run through the checker and CLI in CI and the full suite.

The same guard checks package install/version/source references against `scripts/package-versions.json`. Update that map only after `npm view <package> dist-tags --json` confirms publication, then verify the published README and exports before changing guidance. Explicit history stays historical; current references to any other exact package version fail with `non_current_package_version`. Package-version mutations run in CI and the full suite.

## Authorized Rabdi smoke and seed

The historical seed/live scripts remain bound to their original SDK 1.0.0 workspace and durable journals; they are not the SDK 1.0.1 verification runner. Keep that workspace separate from the 1.0.1 contributor checks above. Do not replace a signed plan or run the historical negative probe as an SDK upgrade check.

Supply `ARKIV_ACCESS_KEY_A`, `TEST_SKILLS_ADDRESS` and `TEST_SKILLS_PRIVATE_KEY` through the local secret store. Never put them in argv, source, public env or output. Supply an existing absolute private `ARKIV_SEED_STATE_DIR` and optional `ARKIV_EVIDENCE_DIR` outside Git. Keep durable state across restarts; signed transaction journals must remain private. Do not delete journals to repeat a test.

```bash
node --experimental-vm-modules scripts/seed-rabdi.mjs
node --experimental-vm-modules --test tests/live/live.test.mjs
```

The seed is idempotent under exclusive signer custody and a durable genesis-bound journal. Its repeat reconciles the same hash and performs no new send. After a network reset the script creates a separately identified state directory while retaining prior evidence; dependent apps must adopt new keys. Unresolved pre-reset attempts are not automatically replayed. The live suite checks successful writes/readback on Rabdi plus repeat zero-send behavior. Browser-wallet nonce behavior and separate library releases require their own evidence.

Historical negative probe (SDK 1.0.0 only): the live runner also includes `tests/live/lifetime.test.mjs`: an explicitly authorized negative create using the dedicated SKILLS signer, maximum-u64 deadline and explicit 1,000,000 gas/current gasPrice/latest nonce. This deliberately pays for one reverted transaction on 1.0.0; it is not the 1.0.1 check, which rejects the excessive expiry before sending. Do not run or adapt that old probe to repeat a paid rejection. It persists signed intent before forwarding, confirms receipt.status is reverted with gas below the cap, decodes ExpiryBeyondMaxLifetime at latest and reconciles the same hash on reruns. It does not retry or automatically repeat after reset. Keep its private journal; clearing state does not authorize another negative create.

Updated importer gas policy does not authorize recreating an old seed. A completed v1 seed may reconcile with the exact previously verified helper, whose source hash is checked, with signing/broadcast explicitly blocked. An unfinished or unrecognized prior revision stops for reconciliation. New seed plans use the current importer and measured per-batch gas floor. Source/line regression tests reject permanent-expiration recommendations and exercise copied first-write/lifecycle/extension transaction fields and receipt handling.

All RPC errors are sanitized; the access key is in the URL path. The smoke counts arkiv_query calls for the supplied key. Ordinary calls do not consume query-cost units under the current provider policy. Tests never use or fund from another lane's signer.

The vocabulary guard covers all authored UTF-8 text and resource names, including root documentation, scripts, tests, SQL and generated source maps. Every JSON key and string is inspected recursively, including map names, sources, file, sourcesContent, sourceRoot and indexed sections. Invalid source-map encoding fails closed. Existing exact dated-history exceptions are retained; dependencies and framework build outputs are inventoried separately.
