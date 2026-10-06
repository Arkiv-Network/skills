# Skill verification

The test workspace pins SDK 0.8.1, viem and TypeScript plus the library versions used by the examples. It uses Node's test runner and real installed package declarations. No model eval or funded chain result is implied by a local pass.

From the repository root:

```bash
npm ci --prefix tests/snippets --ignore-scripts --no-audit --no-fund
node --test tests/snippets/infrastructure.test.mjs
node scripts/run-local-checks.mjs
```

`results/` contains static, typecheck, runtime and aggregated health reports. Generated modules and manifests live under `.generated/`; neither directory is committed. To reuse an already installed dependency workspace, pass absolute `--workspace` and `--output` paths to `run-local-checks.mjs`.

Every TypeScript fence is extracted with its source path, line and hash. The current examples are complete modules. Future fragments require a `scaffolds.json` entry with the exact snippet ID/hash, reason, prefix and suffix. A deliberate `// arkiv-snippet: skip — reason` is counted and makes the relevant health coverage incomplete. There is no block limit.

Skills without TypeScript receive a `no-typescript-fences` coverage case only after every Markdown reference has been scanned. This records that types and code execution do not apply; it does not certify their prose or a chain operation.

Runtime fixtures import the current extracted code. They exercise SDK serialization/receipt decoding and application success/failure handling over deterministic local RPC, with network access blocked. Signing keys exist only in memory. The reports distinguish module loading from outcome assertions and list any uncovered modules. Native chain authorization, real expiration, live event transport and browser wallet behavior need separate tests.

The nightly checks npm release metadata and the semantic content of cited official docs against `source-baseline.json`. Review and re-verify changed sources before updating that baseline. Repository commits are not a trigger; changed source content is yellow until checked. A removed API becomes red only after an actual current-source diagnostic, not a hash change alone.

Funded execution is separately gated by `ARKIV_ENABLE_LIVE=true`, `ARKIV_PRIVATE_KEY`, a verified `ARKIV_RPC_URL`/`ARKIV_CHAIN_ID`, and a positive `ARKIV_MAX_SPEND_WEI`. An optional provider access key stays in `ARKIV_ACCESS_KEY`. The root-owned `tests/live/e2e.mjs` must return the [v1 report shape](health-report.schema.json) at `ARKIV_HEALTH_OUTPUT`; record hashes, transaction receipts and read-back evidence, and never raw keys or signed transactions. An absent runner, key, budget, quota-limited provider or missing result stays skipped/yellow.

Health requires fresh evidence for current source hashes from static, types, runtime, live, source watch, MCP and model evals. The live layer accepts only `executionMode: live_rpc`; injected transports produce runtime evidence, and unclassified legacy reports stay yellow. Missing evidence is yellow. Confirmed failures are red; missing/stale evidence and operational quota errors are yellow. Sorbet evidence does not certify the Tiramisu default. This deterministic suite does not fabricate model or chain results.

`check-mcp.mjs /external/mcp.json` requires the operator's `VERIFICATION_TOKEN` in the process environment. The nightly supplies it from `ARKIV_MCP_VERIFICATION_TOKEN`. This credential marks test traffic; it is separate from the SDK provider access key and signing key. Missing or invalid credentials produce skipped/yellow evidence with zero requests. Only gateway POSTs receive `x-arkiv-verification`; raw GitHub source requests never receive it. Keep credentials out of arguments, reports and logs.

The check initializes the canonical gateway, then confirms `server_status.trafficClass` is `verification` before discovery or source reads. It stops if classification is unconfirmed. It discovers tools/prompts and calls only input-free `server_status` and `list_skills`. It verifies each current skill's declared SDK/network and immutable raw GitHub source, including reference bytes. Only a complete matching skill/reference set enters `sourceFiles`. Missing or different published content, timeout and HTTP 429 stay skipped/yellow. A malformed observed protocol is a failure; that independent transport check does not claim catalog byte verification. Only `executionMode: mcp_readonly` can satisfy the gateway layer; fixtures use `synthetic_transport`. Retrieved text is never executed. The exchange follows the official [HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports), [initialization lifecycle](https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle) and [tool discovery](https://modelcontextprotocol.io/specification/2025-03-26/server/tools) specifications.

The nightly calls `import-eval-results.mjs /external/evals.json` separately. Until observed native-model bundles and their input/trace proofs are supplied, it emits skipped evidence. Deterministic fixtures do not substitute for those runs.

`status.json` includes `catalogHash`, the SHA256 of `JSON.stringify(sourceFiles)` after sorting `{file, sha256}` entries by file name. Consumers compare it with their generated skill catalog and re-check `generatedAt`/`maxAgeHours` when displaying status. A missing, stale or mismatched artifact is unavailable/yellow. `sourceCommit` and `observation` are null for local checks. The nightly aggregation adds its Actions repository, commit, event, ref, run ID/attempt and run URL only in an actual nightly Actions context. That proves a run was observed; the individual report results still decide health.

Publication is opt-in after review. The nightly upload is an artifact; `publish-health.mjs` can create/update only `SantiagoDevRel/skills:arkiv-status` from trusted default-branch schedule/manual runs. It preserves an existing branch unless its ownership marker matches, updates `status.json` with its prior SHA, and never deletes files or force-updates references. Enable publication with the reviewed `publish_status` input or `ARKIV_PUBLISH_STATUS` repository variable. Release dispatch produces evidence; no external npm webhook is configured here.

Host installation/model evals, organization secrets, a successful funded nightly run, source-baseline acceptance and the hub meter's observation window remain separate acceptance steps.
