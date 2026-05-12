# Arkiv skills

Agent skills for working with [Arkiv](https://arkiv.network) — the Web3 database, powered by $GLM. Each skill is framework-neutral and follows the [Anthropic Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) spec, so it runs in Claude Code, Cursor, Cline, Aider, and any other compatible runtime.

## Available skills

| Skill | What it does |
|-------|--------------|
| [`arkiv-best-practices`](skills/arkiv-best-practices) | Best practices, patterns, and practical examples for building on Arkiv. Covers the SDK, entities, attributes, queries, and expiration. |
| [`arkiv-feedback`](skills/arkiv-feedback) | Walks the user through reporting a bug or feature request to [`Arkiv-Network/reported-issues`](https://github.com/Arkiv-Network/reported-issues), then submits it via `gh` (with a graceful fallback when `gh` isn't available). |

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
