# Bounded Tiramisu verification

This runner executes the current first-write, patch and renewal skill helpers with SDK 0.8.1. It also checks synthetic creation flags, a pinned three-page query, observed expiration/recreation, and deletion/read-back. Its seven cases cover four skills. It does not certify all skills, libraries, the multi-wallet permission matrix, MCP, hosts or model evals.

Use the dependencies pinned in `tests/snippets/package-lock.json`. Importing `e2e.mjs` performs no network request and reads no environment secret. Deterministic tests use an in-memory signer and transport:

```bash
node --test tests/live/live.test.mjs
```

Funded execution requires a dedicated CI EOA with exclusive writer custody. Configure these server-side inputs; never place their values in a prompt or repository:

| Environment input | Required value |
| --- | --- |
| `ARKIV_ENABLE_LIVE` | `true` after authorizing the test budget |
| `ARKIV_PRIVATE_KEY` | A locally held 32-byte key for the dedicated funded EOA |
| `ARKIV_RPC_URL` | `https://rpc.tiramisu.db-chain.testnet.arkiv.network` |
| `ARKIV_CHAIN_ID` | `7738577` |
| `ARKIV_MAX_SPEND_WEI` | A positive integer, at most `1000000000000000000` (1 GLM) |
| `ARKIV_ACCESS_KEY` | Optional server-side `X-API-KEY` header |
| `ARKIV_HEALTH_OUTPUT` | Absolute report path outside the repository, when invoking `e2e.mjs` directly |

The workflow wrapper creates a fresh external evidence directory and passes the output input itself:

```bash
node scripts/run-live-check.mjs /absolute/external/arkiv-evidence/live.json
```

`ARKIV_SNIPPET_WORKSPACE` can point to an already installed dependency workspace; this runner installs nothing. For local tests, `ARKIV_TEST_TMPDIR` selects the temporary fixture directory. The nightly keeps reports and journals in `runner.temp` and uploads that directory as its evidence artifact.

A private local operator may import `runPublicLive({env, account, workspace, output})` with its dedicated viem `LocalAccount` already held in memory. This requires the same explicit opt-in, network and budget inputs; omit `ARKIV_PRIVATE_KEY` when supplying `account`. Malformed accounts or both signer inputs fail before RPC. The CLI still requires `ARKIV_PRIVATE_KEY` and never loads a local custody file.

Every signed transaction must recover the configured sender, use Tiramisu's native operation address, transfer zero native value and fit the remaining gas/fee budget and current balance. Before sending, the runner checks pending/latest transaction nonces, predicts create keys from the creator's minting nonce, and fsyncs a hash-linked journal. It then sends once. Canonical transaction fields, receipt provenance, every native event, keys, flags and deadlines must agree before a new key enters mutation custody. Only keys created and confirmed during this invocation can be patched, extended or deleted. Ownership broadcasts are disabled.

The exact first-write helper has its existing `first_note` seed. A preexisting seed is read/reused and remains outside mutation custody. The report distinguishes `reuse_only` from `created_and_reused`; the seed is retained for subsequent runs. Every other create uses a fresh synthetic namespace. Failure stops later writes and cleanup sends; retain its journal and reconcile the nonce/hash before another invocation. Do not restart after an unresolved broadcast.

Receipt waits stop within 60 seconds. HTTP 429 records a sanitized Retry-After value and stops without a retry. Missing funding/configuration, insufficient budget/balance, transport failures and an unobserved expiration window are skipped/operational. Confirmed verification failures are failures. Reports contain hashes, nonce/fee reservations, validated transaction/event summaries and selected read-back fields. They omit signing keys, access keys, raw signed transactions and local configuration paths.

Local fixture passes exercise code and admission boundaries. An injected transport produces a `runtime` report with a `synthetic` chain name; it cannot serve as live evidence. They do not establish real chain behavior or a successful funded nightly; publish live health only from an actual runner report.
