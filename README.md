# Arkiv skills

Agent skills for working with [Arkiv](https://arkiv.network) — the Web3 database, powered by $GLM. Each skill follows the [Agent Skills](https://agentskills.io/specification) format and provides focused guidance for compatible agents.

## Available skills

| Skill | What it does |
| --- | --- |
| [`arkiv`](skills/arkiv/SKILL.md) | Routes Arkiv tasks to the appropriate focused skill. |
| [`arkiv-first-write`](skills/arkiv-first-write/SKILL.md) | Sets up Rabdi and verifies a first entity and read-back. |
| [`arkiv-data-modeling`](skills/arkiv-data-modeling/SKILL.md) | Designs typed schemas, per-column indexes, bytes storage, and relations. |
| [`arkiv-query`](skills/arkiv-query/SKILL.md) | Builds typed queries, ordering, bounded current-state pages, and filtered counts. |
| [`arkiv-entity-lifecycle`](skills/arkiv-entity-lifecycle/SKILL.md) | Explains flags, patching, ownership, deletion, and backup/restore. |
| [`arkiv-entity-expiration`](skills/arkiv-entity-expiration/SKILL.md) | Chooses expiration deadlines and reconciles Lifetime Extension. |
| [`arkiv-write-safety`](skills/arkiv-write-safety/SKILL.md) | Serializes bounded batches and reconciles uncertain transaction outcomes. |
| [`arkiv-app-integration`](skills/arkiv-app-integration/SKILL.md) | Connects browser wallets, authenticated server routes, DTOs, and events. |
| [`arkiv-security-trust`](skills/arkiv-security-trust/SKILL.md) | Defines public-data, publisher, signer, and authorization boundaries. |
| [`arkiv-troubleshooting`](skills/arkiv-troubleshooting/SKILL.md) | Diagnoses exact errors, missing results, and stale reads. |
| [`arkiv-encryption`](skills/arkiv-encryption/SKILL.md) | Encrypts bytes columns and explains key custody and remaining metadata exposure. |
| [`arkiv-large-files`](skills/arkiv-large-files/SKILL.md) | Plans verified chunks/images, compatible package selection, hybrid pointers and recovery. |
| [`arkiv-social-graph`](skills/arkiv-social-graph/SKILL.md) | Models relationships and scopes arkiv-graph visualization. |
| [`arkiv-indexing`](skills/arkiv-indexing/SKILL.md) | Builds Arkiv-to-app projections and explains the separate EVM-to-Arkiv sync package. |
| [`arkiv-feedback`](skills/arkiv-feedback/SKILL.md) | Prepares sanitized bug/feature reports and submits only with authorization. |
| [`arkiv-mcp`](skills/arkiv-mcp/SKILL.md) | Explains the plugin's General connection, separate event profiles, read-only checks, consent-gated feedback and service privacy boundaries. |
| [`arkiv-best-practices`](skills/arkiv-best-practices/SKILL.md) | Deprecated compatibility entrypoint; start with arkiv. |

Library guides require checking each installed package's public API, SDK 1.0 compatibility and Rabdi support. Read its AGENTS.md and relevant skill; a candidate, widened peer range or earlier network test does not establish a published compatible release.

## Installation

Start with the router:

```bash
# npm
npx skills add Arkiv-Network/skills --skill arkiv

# pnpm
pnpm dlx skills add Arkiv-Network/skills --skill arkiv
```

Replace `arkiv` with a name from the index to install a specific skill. The default scope is the current project; add `--global` for your user account. Check `npx skills --help` for supported hosts and flags. `--all` installs every skill into every supported agent without prompts; choose a specific skill for a focused installation.

Load `arkiv` for an Arkiv task, then the task skill it selects. Use `arkiv-first-write` to install the SDK, configure Rabdi, verify a first entity and propose the inline Arkiv rules for the project's `AGENTS.md` while preserving existing guidance.

The guidance targets SDK `>=1.0.0 <2` and Rabdi (chain ID 7794095). Before using another version, inspect its installed declarations and current official documentation. Configure `rabdi({ accessKey })`; the SDK encodes the RPC key in its URL path. Keep operator keys server-side and redact keyed URLs from errors/logs; writes require an authorized signer and spending budget.

Each skill declares its checked SDK range, network, date and MIT license in frontmatter. These declarations describe the documented scope and do not certify every provider, application or future release.

For the combined plugin for Claude Code and Codex CLI, use the separate [Arkiv plugin repository](https://github.com/Arkiv-Network/ai-plugin). It imports a fixed canonical revision and bundles the General MCP connection and project rules. Read its installation and verification scope before use.

Contributors and agents should read [AGENTS.md](AGENTS.md). Recent guidance covers complete atomic batch validation, separately authorized removal after readonly corrections, transfer provenance and, in [`arkiv-mcp`](skills/arkiv-mcp/SKILL.md), the plugin's General connection, with event profiles as separate URLs the human adds and the ended Devfolio profile kept frozen. The resumable importer saves intent before wallet entry, distinguishes receipt-confirmed progress from verified fields and recovers without resubmitting a known transaction. Its plan-version-2/journal-version-3 importer fails closed on incompatible older files; preserve those files and reconcile with the original importer.

## Installed-import check

The router's advisory [installed-import check](skills/arkiv/references/import-check.md) reads named imports, package exports and installed declarations without executing application code or making network requests. Unsupported evidence stays unmeasured. Hosts can run the script explicitly; supported Claude hosts can also invoke its frontmatter hook. This check does not replace TypeScript compilation or runtime checks.

```bash
node --test tests/snippets/import-check.test.mjs tests/snippets/skill-references.test.mjs
node scripts/check-skill-references.mjs
# Explicit network fixture: verifies official tarball integrity, never runs package scripts.
node tests/snippets/published-imports.mjs
```

## SDK 1.0.0 and Rabdi

Use `defineSchema` and constructors from `@arkiv-network/sdk/schema`. Only columns marked `.indexed()` support predicates; `bytes()` stores binary/JSON data but cannot be indexed, filtered or sorted. Reads return flat `$key`, `$owner`, `$creator`, `$expiresAt` and selected column values. Use `$attributes` for all values or `$attributeSchema` for types/indexing without large values.

Rabdi queries read current state, with one-key server ordering, pages up to 100, offsets/keyset traversal and filtered counts. Multi-page scans are not inherently one snapshot. See the query and backup skills before claiming complete or historical exports. Natural expiration emits no event; watchers need current-state reconciliation after gaps.

Get free keys at [access keys](https://hub.arkiv.network/access-keys) and test funds at the [faucet](https://hub.arkiv.network/faucet). Missing keys raise MissingAccessKeyError; an explicitly empty key chooses heavily limited keyless access that can return HTTP 429. Current provider quota is 100,000,000 units per key, with each arkiv_query costing 10 and other methods zero. Keys do not fund or authorize writes.

Contributor validation, strict compilation of every executable example and separate authorized Rabdi live checks are documented in [tests/README.md](tests/README.md). The idempotent seed is `node --experimental-vm-modules scripts/seed-rabdi.mjs`; keep its private durable journal across restarts and reconcile ambiguous outcomes before another write.
