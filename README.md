# Arkiv skills

Agent skills for working with [Arkiv](https://arkiv.network) — the Web3 database, powered by $GLM. Each skill is framework-neutral and follows the [Anthropic Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) spec, so it runs in Claude Code, Cursor, Cline, Aider, and any other compatible runtime.

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
| [`arkiv-large-files`](skills/arkiv-large-files/SKILL.md) | Plans chunks, images, and hybrid pointers; current package adoption is gated. |
| [`arkiv-social-graph`](skills/arkiv-social-graph/SKILL.md) | Models relationships and scopes arkiv-graph visualization. |
| [`arkiv-indexing`](skills/arkiv-indexing/SKILL.md) | Builds Arkiv-to-app projections; incompatible ingestion packages stay gated. |
| [`arkiv-feedback`](skills/arkiv-feedback/SKILL.md) | Prepares sanitized bug/feature reports and submits only with authorization. |
| [`arkiv-mcp`](skills/arkiv-mcp/SKILL.md) | Documents read-only profiles and tool/schema checks for an existing connection. |
| [`arkiv-best-practices`](skills/arkiv-best-practices/SKILL.md) | Deprecated compatibility entrypoint; start with arkiv. |

## Installation

Install a single skill:

```bash
# npm
npx skills add https://github.com/Arkiv-Network/skills --skill arkiv-best-practices
npx skills add https://github.com/Arkiv-Network/skills --skill arkiv-feedback

# pnpm
pnpm dlx skills add https://github.com/Arkiv-Network/skills --skill arkiv-best-practices
pnpm dlx skills add https://github.com/Arkiv-Network/skills --skill arkiv-feedback
```

Install everything in this repo at once:

```bash
# npm
npx skills add https://github.com/Arkiv-Network/skills --all

# pnpm
pnpm dlx skills add https://github.com/Arkiv-Network/skills --all
```

Pass `-g` / `--global` to install at the user level instead of the current project. See `npx skills --help` (or `pnpm dlx skills --help`) for the full set of flags.
