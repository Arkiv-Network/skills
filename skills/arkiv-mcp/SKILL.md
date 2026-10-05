---
name: arkiv-mcp
description: Use an already connected Arkiv MCP for source discovery, optional public-evidence verification and event preparation. Explain tools versus skills and diagnose missing capabilities or stale profiles. Use for Arkiv MCP questions; entity writes belong to SDK skills and this skill does not install or configure a plugin.
license: MIT
metadata:
  arkiv-sdk: ">=0.8.1 <0.9"
  network: "tiramisu"
  verified: "2026-10-05"
---

# Arkiv MCP

A skill is guidance the agent reads. A tool is a callable operation that returns data. The Arkiv gateway supplies knowledge and, in selected profiles, narrow public-evidence checks. It never signs or submits chain transactions. Optional feedback tools can send information to the service; those require separate sharing consent.

Use this skill for an **existing authorized connection**. If the user chooses skills/SDK only, honor that choice. Use `arkiv-first-write`, `arkiv-query` and `arkiv-troubleshooting` directly; an MCP is not a prerequisite.

## Discover the actual profile

The gateway is [mcp.arkiv.network](https://mcp.arkiv.network/). Event paths are separate profiles, not arbitrary query parameters. Do not install a connector, edit host configuration or switch profiles merely because a tool is missing. Ask for the intended profile when that choice changes the task.

1. Inspect the tools and prompts exposed by the already connected host, or the protocol's `tools/list` and `prompts/list` through that connection. Use the current names and input schemas; hosts add different tool-name prefixes.
2. Read `server_status` if available: profile, release/configuration and event source revision. Read `network_status` for its checked SDK and network details, distinguishing live observations from dated catalog data.
3. Choose the narrow capability that answers the question. Do not send a private schema, logs, keys or source code to learn whether a tool exists.
4. Compare returned version/source dates with the project's installed SDK. Neither an available tool nor fetched skill text proves an example works.

A GET response, HTTP405 or an old connector catalog is not a Streamable HTTP protocol test. Report which connection and operation failed. If discovery is unavailable, use the local SDK/docs instead of inventing tool availability.

## Match tools to the task

| Need | Capability, if exposed | Skill to read |
| --- | --- | --- |
| Network/version context | `server_status`, `network_status` | `arkiv` |
| Primary knowledge/package documentation | `search_knowledge`, `read_knowledge`, `list_packages`, `get_package` | Relevant core or library skill |
| Served skill text | `list_skills`, `get_skill` | Inspect returned source/version; use that task skill |
| Entity/transaction public observation | `verify_entity`, `verify_tx` | `arkiv-query`, `arkiv-troubleshooting` |
| Model or event preparation | `generate_entity_model`, `design_entity_model`, `check_schema`, `check_submission` | `arkiv-data-modeling`, `arkiv-security-trust` |
| Optional minimized feedback/outcome | `submit_feedback`, `report_outcome` | `arkiv-feedback` |

`prepare_feedback` is a **prompt**, not a tool. Prompt and workflow content guides local work; fetching it does not submit an issue or application. Discover prompt arguments before use. No fixed tool counts or generic health badge establish current capability.

## Read the evidence boundary

- `network_status` checks the RPC chain ID live in the reviewed service; other onboarding/service entries are dated catalog observations. It does not test funding, a signing adapter or complete faucet/login flow.
- Knowledge/model tools do not run arbitrary entity queries. Use the local SDK/RPC for actual application reads. `verify_*`, when exposed, are narrowly bounded observations, not a substitute for selected payloads or a full application query.
- Public verification requires the tool's current acknowledgment fields and a reviewed public key/hash. Never submit secrets as identifiers. Inspect **status, observation, warnings and error together**. Entity absence does not prove expiration, deletion or nonexistence; a successful receipt does not certify a particular payload, finality, authorship or a working app.
- Schema/submission checks are shallow text/model checks. Clearing blockers does not certify security, protocol acceptance, event eligibility or judging results. Verify generated names, types and code locally against the installed SDK.
- A skill catalog may lag the repository or serve unchanged examples. Record its source revision and warnings; do not assume new task skills or automated health are deployed.

For event work, inspect `server_status.event`, then the profile's current event sources, draft/frozen state and evidence checklist. Prompts such as `qualify`, `prepare_devfolio` or `pillar_fit` apply only if actually exposed. Preparing evidence is separate from submitting it. Do not borrow another event's dates, rules or profile capabilities.

## Writes and privacy

Writes happen in the developer's project through the SDK and authorized EOA, with a verified network, spending budget and read-back. A legacy service requesting a private key is not an acceptable signing path. Keep access/signing keys out of connection URLs, prompts, tools and logs.

`submit_feedback` and `report_outcome` require explicit consent for the minimized fields and `sharingApproved: true` under the reviewed schemas. A boolean asserts consent; it does not obtain it. Do not infer a user opinion from the agent's success or claim best-effort acknowledgment guarantees storage. Never upload a full report as optional feedback or silently substitute it for a GitHub issue.

## Worked diagnosis

Request: “My post is missing; this profile has no `verify_entity`.” Load `arkiv-troubleshooting` for the reported failure and `arkiv-query` for the read. Inspect installed SDK, chain, exact key, constructor types, lowercase attributes, creator/owner scope and Entity Expiration. Query locally with the SDK. Do not claim the missing tool means the network is down or add another integration automatically.

Request: “The event check passes; submit my app.” A text check is insufficient evidence. Read the actual event submission procedure and authorization scope; inspect the app and required evidence locally. A preparation prompt or optional feedback acknowledgment is not an application submission.

Sources: [Arkiv gateway](https://mcp.arkiv.network/), [official SDK](https://www.npmjs.com/package/@arkiv-network/sdk/v/0.8.1), [Arkiv documentation](https://docs.arkiv.network). Gateway semantics checked against the service source on 2026-10-05; no live connection or profile invocation is implied by this document.
