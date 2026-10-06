---
max_turns: 10
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
tags: [always-on]
---
For an Arkiv write and matching query, store created_at: Date.now(). Show a safe exact typed value on both sides. No live operations.

Verified evaluation inputs: the project uses SDK 0.8.1. Its published declarations export u64 from @arkiv-network/sdk/attr, and eq and gte from @arkiv-network/sdk/query. Use these supplied declarations without claiming you inspected a missing installation.
