# Model evaluations

Each of the 17 skill entrypoints has a trigger, negative trigger and outcome case. Five additional cases cover multi-skill routing, untrusted payloads, RPC configuration, signing-key custody and SDK version mismatch. Twelve cases compare six rule topics with and without the exact project block. `catalog.json` indexes the 68 cases; adjacent `sources.json` files record their skill sources because the native runner rejects that frontmatter field.

Validate coverage:

```bash
node scripts/check-evals.mjs
```

Run real model evaluations with the supported, authenticated Claude Code CLI. Choose a new absolute output directory outside the checkout:

```bash
node scripts/run-model-evals.mjs /absolute/new-eval-output
node scripts/import-eval-results.mjs /absolute/evals.json /absolute/new-eval-output
```

`--trust-plugin` approves execution of this reviewed local plugin, not arbitrary third-party suites. This suite grants only Read, Glob, Grep and Skill. No case authorizes RPC access, signing, file changes or issue submission. MCP servers without a mock remain withheld; the MCP profile case supplies an explicit mock discovery inventory in its prompt. A model answer is not a funded execution or live-service certification.

The wrapper records input hashes before and after the native run, preserves its traces, and archives only the temporary directories named by that run. Keep the output private: the temporary archive may contain native host configuration. Import only the sanitized `evals.json` into health evidence. Changed inputs, missing traces, incomplete runs or baseline plugin contamination cannot produce a pass.

The native with/without-plugin arms measure behavior separately from skill invocation. Inspect the actual Skill calls for routing. LLM grader scores alone do not prove invocation or generated-code correctness. An optional case glob and run count select a focused check, for example `node scripts/run-model-evals.mjs /absolute/new-query-eval 'arkiv-query-*' 1`.

Rule pairs use the native `append_system_prompt` field for controlled project context, with a separate with/without-plugin comparison. This measures the supplied block; it does not prove that a host loaded an AGENTS.md file or a hook. The native-EVM topic remains a control case outside the selected five-rule block. Partial runs, provider limits and missing traces remain incomplete evidence.
