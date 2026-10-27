# Arkiv skills

Agent skills for working with [Arkiv](https://arkiv.network) — the Web3 database, powered by $GLM. Each skill follows the [Agent Skills](https://agentskills.io/specification) format and provides focused guidance for compatible agents.

## Available skills

| Skill | What it does |
| --- | --- |
| [`arkiv`](skills/arkiv/SKILL.md) | Routes Arkiv tasks to the appropriate focused skill. |
| [`arkiv-first-write`](skills/arkiv-first-write/SKILL.md) | Sets up Tiramisu and verifies a first entity and read-back. |
| [`arkiv-data-modeling`](skills/arkiv-data-modeling/SKILL.md) | Designs attributes, payloads, relations, and schema mappings. |
| [`arkiv-query`](skills/arkiv-query/SKILL.md) | Builds typed queries, pinned pagination, counts, and historical reads. |
| [`arkiv-entity-lifecycle`](skills/arkiv-entity-lifecycle/SKILL.md) | Explains flags, patching, ownership, deletion, and backup/restore. |
| [`arkiv-entity-expiration`](skills/arkiv-entity-expiration/SKILL.md) | Chooses expiration deadlines and reconciles Lifetime Extension. |
| [`arkiv-write-safety`](skills/arkiv-write-safety/SKILL.md) | Serializes bounded batches and reconciles uncertain transaction outcomes. |
| [`arkiv-app-integration`](skills/arkiv-app-integration/SKILL.md) | Connects browser wallets, authenticated server routes, DTOs, and events. |
| [`arkiv-security-trust`](skills/arkiv-security-trust/SKILL.md) | Defines public-data, publisher, signer, and authorization boundaries. |
| [`arkiv-troubleshooting`](skills/arkiv-troubleshooting/SKILL.md) | Diagnoses exact errors, missing results, and stale reads. |
| [`arkiv-encryption`](skills/arkiv-encryption/SKILL.md) | Encrypts payloads and explains key custody and remaining metadata exposure. |
| [`arkiv-large-files`](skills/arkiv-large-files/SKILL.md) | Stores and verifies chunks/images with SDK 0.8.1 releases; plans hybrid pointers and recovery. |
| [`arkiv-social-graph`](skills/arkiv-social-graph/SKILL.md) | Models relationships and scopes arkiv-graph visualization. |
| [`arkiv-indexing`](skills/arkiv-indexing/SKILL.md) | Builds Arkiv-to-app projections and explains the separate EVM-to-Arkiv sync package. |
| [`arkiv-feedback`](skills/arkiv-feedback/SKILL.md) | Prepares sanitized bug/feature reports and submits only with authorization. |
| [`arkiv-mcp`](skills/arkiv-mcp/SKILL.md) | Explains the plugin's General connection, separate event profiles, read-only checks, consent-gated feedback and service privacy boundaries. |
| [`arkiv-best-practices`](skills/arkiv-best-practices/SKILL.md) | Deprecated compatibility entrypoint; start with arkiv. |

The library guides cover published `arkiv-chunking@0.1.1`, `arkiv-images@0.1.2`, `arkiv-sync@0.3.0` and `create-arkiv-sync@0.3.0`, verified with SDK 0.8.1. Read the installed package's `AGENTS.md` and relevant skill for configuration, tested scope and recovery limits.

## Installation

Start with the router:

```bash
# npm
npx skills add Arkiv-Network/skills --skill arkiv

# pnpm
pnpm dlx skills add Arkiv-Network/skills --skill arkiv
```

Replace `arkiv` with a name from the index to install a specific skill. The default scope is the current project; add `--global` for your user account. Check `npx skills --help` for supported hosts and flags. `--all` installs every skill into every supported agent without prompts; choose a specific skill for a focused installation.

Load `arkiv` for an Arkiv task, then the task skill it selects. Use `arkiv-first-write` to install the SDK, configure Tiramisu, verify a first entity and propose the inline Arkiv rules for the project's `AGENTS.md` while preserving existing guidance.

The guidance targets SDK `>=0.8.1 <0.9` and Tiramisu (chain ID 7738577). Before using another version, inspect its installed declarations and current official documentation. Keep credentials out of source code, URLs and chat; writes require an authorized signer and spending budget.

Each skill declares its checked SDK range, network, date and MIT license in frontmatter. These declarations describe the documented scope and do not certify every provider, application or future release.

For the combined plugin for Claude Code and Codex CLI, use the separate [Arkiv plugin repository](https://github.com/Arkiv-Network/ai-plugin). It imports a fixed canonical revision and bundles the General MCP connection and project rules. Read its installation and verification scope before use.

Contributors and agents should read [AGENTS.md](AGENTS.md). Recent guidance covers complete atomic batch validation, separately authorized removal after readonly corrections, transfer provenance and, in [`arkiv-mcp`](skills/arkiv-mcp/SKILL.md), the plugin's General connection, with event profiles as separate URLs the human adds and the ended Devfolio profile kept frozen. The resumable importer saves intent before wallet entry, distinguishes receipt-confirmed progress from verified fields and recovers without resubmitting a known transaction. Its version-2 journal fails closed on older journals; preserve those files and reconcile with the original importer.

## Installed-import check

The router includes an advisory [installed-import check](skills/arkiv/references/import-check.md), derived from a sanitized SDK 0.7.0 friction report. It reads named imports, package exports and installed declarations without executing application code or making network requests. Unsupported evidence stays unmeasured. In Claude Code the router's frontmatter hook runs it after Write/Edit on files that import the SDK; other hosts can run the script explicitly. The Arkiv plugin measures each release's guidance with a context-only ablation before shipping it.

```bash
node --test tests/snippets/import-check.test.mjs tests/snippets/skill-references.test.mjs
node scripts/check-skill-references.mjs
# Explicit network fixture: verifies official tarball integrity, never runs package scripts.
node tests/snippets/published-imports.mjs
```
