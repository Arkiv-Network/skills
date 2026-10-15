# Installed import check

Run `node <installed-skill-directory>/scripts/check-imports.mjs <file>` from the application workspace. The JSON result distinguishes an incomplete inspection (`measured:false`) from supported imports or definite missing names/subpaths. Never run application code to obtain this evidence. Missing Node, unreadable files, unsupported syntax or missing declarations produce no automatic warning.

The Claude plugin adapter registers the router's `PostToolUse` hook when the skill is invoked. Claude keeps such hooks for the rest of the session, including later turns. Every invocation therefore requires a native Write/Edit event, a file inside the current workspace and a direct named Arkiv SDK import. Unrelated files, unrelated chains and shell commands are excluded. Standalone installs without `CLAUDE_PLUGIN_ROOT` use the explicit script command instead.

Codex frontmatter execution has not yet been verified. Use explicit script execution as an advisory alternative; it is not an equivalent lifecycle event and supplies no observed skill-use metric. Native host validation and comparable context ablation are required before publishing this hook in a distribution.

## Evidence and reproduction

The sanitized ETHRome September 12 friction report, sections 1–3, observed SDK 0.7.0 declaring only `braga`, `kaolin` and `localhost` in its chains entrypoint while current examples required `tiramisu`. It also recorded a different location for `ExpirationTime`. These observations justify checking the actual installed export map and declaration names, rather than assuming that current examples work on an older installation.

Reproduction: `node tests/snippets/published-imports.mjs` obtains official 0.7.0 and 0.8.1 tarballs in an isolated temporary workspace, verifies their published integrity and reads their declarations without installation or package-script execution. A named `tiramisu` import fails on 0.7.0 and passes on 0.8.1. Synthetic positive, negative and neighboring cases in `tests/snippets/import-check.test.mjs` also cover old exports, aliases, comments, strings, unrelated `viem/chains` imports and ambiguous declarations. These are not observations of a live network.

No private-key detector is selected: the retained evidence inspected here did not establish the proposed key-literal failure. A chain/RPC policy is also deferred: the observed retired-chain import is covered by declaration evidence, while arbitrary network configuration requires explicit client binding to avoid flagging unrelated connections. This checker makes no network calls and declares no network compatibility.

Limits: static named imports and explicit non-wildcard package export maps only. Standard import/require declaration targets use TypeScript extension substitution, and a name is reported missing only if absent from all inspected targets. Dynamic imports, CommonJS require expressions, namespace/default imports, unreadable targets, compound variable declarations and unsupported external declaration reexports remain unmeasured. This is not a TypeScript compiler or a secret scanner.

Sources: [Claude hook lifetime](https://code.claude.com/docs/en/hooks#hooks-in-skills-and-agents), [Codex hooks](https://learn.chatgpt.com/docs/hooks), [SDK 0.7.0](https://www.npmjs.com/package/@arkiv-network/sdk/v/0.7.0).
