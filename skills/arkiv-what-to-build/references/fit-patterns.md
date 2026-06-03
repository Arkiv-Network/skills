# Fit Patterns — arkiv-what-to-build

## Green-flag patterns

These use cases hit all three triad legs naturally. When a participant's idea resembles one of these, the fit is strong.

| Pattern | Why it fits |
|---------|-------------|
| **Live leaderboards** | Read by every player on every refresh (high-frequency), scores become stale quickly (natural expiration in hours or at session end), visible to all participants (public). |
| **Intent / order pools** | Matched or consumed quickly — expiration is built into the protocol logic. Many readers racing to match the same order. Fully public by design. |
| **Sensor / telemetry feeds** | Readings are worthless after the next reading arrives (natural expiration in seconds to minutes). Read by dashboards and aggregators constantly. Public infrastructure data. |
| **Shared agent memory across agents** | Multiple agents read the same working state on every reasoning step (high-frequency). Memory is scoped to a session or task (natural expiration in minutes to hours). Shared across agent instances so it must be public. |
| **Reputation / attestation logs read by many** | Checked on every interaction by frontends, smart contracts, and other agents. Validity windows are finite (expiration in days to weeks). Public by construction — hiding reputation breaks the trust model. |
| **Session / auction / bid state** | Readers poll constantly during the session. Expiration is the auction close or session timeout. Must be public so all bidders can verify state. |
| **Multi-player game state** | Every client reads the authoritative state on every frame or turn. Games end (natural expiration). Shared among all players (public). |
| **Real-time feed or event stream** | Events lose relevance fast (expiration in minutes). Subscribers read continuously. Public broadcast. |

| **Private payload + clear queryable attributes** | The payload is encrypted (private content); the attributes (`date`, `tag`, `type`, `owner`, `status`) stay in clear text. Arkiv queries run on attributes — so the entity is fully queryable even though the content is private. The caller fetches the encrypted payload separately (`withPayload`) and decrypts client-side. This design pattern applies to personal logs, credential stores, privacy-preserving feeds, and any app that wants tamper-proof ownership *and* live querying without making content public. |

---

## Anti-pattern NOT-list

These patterns look plausible but break one or more triad legs. Steer away or pivot.

| Anti-pattern | Which leg fails | Why |
|-------------|----------------|-----|
| **Knowledge-base / doc clone** | Read frequency + expiration | Documents are read infrequently and kept indefinitely. A static site or IPFS is simpler and cheaper. |
| **Write-once archive** | Read frequency + expiration | Data written once, never queried live. No expiration makes sense. Arkiv's strength is live querying, not archival. |
| **Blob / file storage** | All three | Large binary files don't benefit from attribute querying or natural expiration. Use IPFS or Filecoin. |
| **Private-only data (when ownership is NOT the driver AND even attributes must be secret)** | Public | If every attribute the app would query on must also be encrypted or hidden — so nothing is left in clear text to filter or sort by — AND a cheaper tool (IPFS + client-side encryption) does the identical job, Arkiv adds nothing here. Note: encrypting only the *payload* while keeping attributes clear is NOT this anti-pattern — that design is still queryable. This is only an anti-pattern when **even the query attributes must be secret** and ownership or tamper-proof auditability is not the real reason to be on-chain. If it is, see the Partial-fit patterns below. |
| **Set-and-forget-forever config** | Expiration + read frequency | Config that never changes and is read rarely. No natural expiration. A smart contract mapping or environment variable is simpler. |
| **User profile store** | Expiration | Profiles don't expire. A traditional database handles this without the overhead. |

---

## Partial-fit patterns — ownership and data sovereignty as the driver

These patterns have weaker triad scores but are a legitimate Arkiv fit when **ownership or tamper-proof auditability is the primary architectural reason** for being on-chain. Spar question to ask first: *"Why on-chain specifically — is proving ownership or preventing deletion the reason?"*

| Pattern | Why it (partially) fits | What to watch |
|---------|------------------------|---------------|
| **Wallet-owned private data where ownership or tamper-proof auditability matters** | The holder of the wallet key owns the entity — no central server can delete or alter it. A central database could silently edit or remove records; Arkiv cannot. Example: a personal audit log or credential the user can prove was not altered, useful for compliance, dispute resolution, or portable identity. Crucially: if the app keeps clear queryable attributes (e.g. `date`, `tag`, `type`, `entryId`) alongside an encrypted payload, it has a genuine queryability story too — so this can score medium rather than weak on the public leg. The strongest version of this pattern is **encrypted payload + clear queryable attributes**: private content, tamper-proof ownership, and live attribute querying all at once. | Read frequency and expiration still matter for feasibility. Ask: could the attributes you'd filter or sort by stay in clear text even if the payload is encrypted? If yes, the queryability angle is not off the table — coach toward that design. Ask separately whether ownership or tamper-proof auditability is the real driver, and whether a cheaper off-chain store plus a tamper-proof hash on-chain achieves the same thing. |

---

## Triad-onto-tracks mapping

How common hackathon verticals map onto the triad — and what to watch out for.

### DePIN — Strong fit

DePIN (Decentralised Physical Infrastructure Networks) is the best natural match:
- Sensors report readings constantly → **high-frequency writes and reads**.
- Readings are stale within seconds to minutes → **natural expiration**.
- Infrastructure data is shared with the whole network → **public**.

Pivot suggestions for weak DePIN ideas: if the team is building device registration (write-once, rare reads), steer toward the live telemetry layer instead — what does the device report, who queries it, and how often?

### AI — Partial fit

AI agent memory is a genuine green flag **only** when memory is shared across agents or sessions. Watch for:
- Single-agent, single-session memory → owner-only reads → breaks the **public** leg. Steer toward multi-agent shared state or task coordination queues.
- Model outputs stored as a log → check read frequency. If nobody queries the log live, it is an archive anti-pattern.

Good pivot: shared scratchpad for a swarm of agents coordinating on a task, or a public feed of agent decisions that downstream agents read to avoid duplicate work.

### Privacy — Inverts the public leg, unless ownership is the driver

Privacy tracks often put pressure on the **public** leg — but encrypting the *payload* does not automatically kill queryability. Arkiv never indexes the payload; all querying runs on *attributes* (`stringAttributes` / `numericalAttributes`). So a builder can encrypt the entry body (payload) and keep clear attributes like `date`, `tag`, `type`, `owner`, or `status` — Arkiv queries those just fine. The genuine red flag is when **even the attributes** the app would filter or sort by must be secret, leaving nothing in clear text to query. Don't force the triad fit in that case, but don't dismiss an idea simply because the payload is encrypted.

Two exceptions worth engaging rather than dismissing:

1. **Clear queryable attributes with an encrypted or off-chain payload.** E.g., "a privacy-preserving proof was submitted at timestamp X by address Y — query by prover address or status." The attributes (`prover`, `submitted_at`, `verified`, `tag`) live in Arkiv in clear text; the payload (the actual content) can be either kept encrypted on Arkiv or stored off-chain — both are valid.

   - **Encrypted payload on Arkiv:** the entry body is ciphertext; attributes are clear. Arkiv queries the attributes; the caller fetches the payload separately (`withPayload`) and decrypts client-side. Good when the payload is small and you want tamper-proof storage of the ciphertext itself.
   - **Payload off-chain (e.g. IPFS or a private store):** Arkiv holds only the metadata attributes; a content hash or pointer lives in the payload or an attribute. Better for large blobs or when you want to avoid on-chain storage costs entirely.

   Off-chain is not required for queryability — it is a cost and size trade-off. Concrete entity-model sketch for the on-Arkiv variant: `{ prover: address, proof_hash: bytes32, submitted_at: timestamp, verified: bool }` expiring after the verification window. Frontends query Arkiv for submission status in real time; submission metadata is public; proof contents are encrypted or off-chain — the public leg holds on the attribute side.

2. **Ownership / tamper-proof auditability is the stated reason.** If the participant says they want this on Arkiv so the user genuinely owns it and no central server can delete or alter it, that is the fourth driver — not a triad failure. Ask: *"Is proving ownership or preventing deletion the real reason you want this on-chain?"* If yes, route to the Partial-fit pattern above and evaluate accordingly.

### Generic Web3 / DeFi — Find the hot-path sub-feature

Generic "Web3 app" ideas are neither green nor red — it depends on the sub-feature:
- Order books, swap intents, liquidation queues → green (all three legs).
- DAO proposal archive → red (write-once, infrequent reads, no natural expiration).
- Live governance signal aggregation during a vote → green (high read frequency during the voting window, natural expiration at vote close).

Ask: "Which specific feature of your app has the most reads per minute? Is that feature time-scoped?" That answer determines fit.
