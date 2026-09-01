# Braga to Tiramisu Migration Guide

Use this guide when the user already has an Arkiv project that targets Braga and needs to move it to Tiramisu, including upgrading from SDK 0.7.x to 0.8.0-dev.3.

## What Changed

- Braga was **retired on 12 August 2026**. Its endpoints no longer respond.
- The chain target changes from `braga` to `tiramisu`.
- The SDK has a **breaking API change** from 0.7.x to 0.8.0-dev.3 — not just a version bump.
- Braga entity state does **not** migrate: entities written to Braga stay on Braga.

## Network Values

| Property | Tiramisu value |
| -------- | ---------------- |
| Chain ID | `7738577` / `0x7614d1` |
| HTTP RPC | `https://rpc.tiramisu.db-chain.testnet.arkiv.network` |
| WebSocket RPC | `wss://rpc.tiramisu.db-chain.testnet.arkiv.network` |
| Block explorer | `https://indexer.tiramisu.db-chain.testnet.arkiv.network` |
| Faucet | `https://hub.arkiv.network/faucet` (0.1 GLM, 24h cooldown, wallet + SIWE required) |
| API keys | `https://hub.arkiv.network/api-keys` (elevated RPC rate limits) |
| Native gas token | `GLM` |
| Bridge address | **Not published** — ask on [Discord](https://discord.gg/arkiv) |

## Migration Checklist

### 1. Update SDK version

Install the dev release — npm `latest` is still 0.7.0:

```bash
npm install @arkiv-network/sdk@dev viem
# or
bun add @arkiv-network/sdk@dev viem
```

Verify the installed version is `0.8.0-dev.3` or newer.

### 2. Update chain imports

```diff
- import { braga } from "@arkiv-network/sdk/chains";
+ import { tiramisu } from "@arkiv-network/sdk/chains";

  const client = createWalletClient({
-   chain: braga,
+   chain: tiramisu,
    transport: http(process.env.TIRAMISU_RPC_URL),
    account,
  });
```

Apply the same swap for `createWalletClient`, `createPublicClient`, wagmi-derived Arkiv clients, and any custom chain constants.

If the project adds the network to MetaMask or viem manually, update `chainId`, `chainName`, `rpcUrls`, `blockExplorers`, and `nativeCurrency` (symbol `GLM`).

### 3. Rename env vars and config keys

```diff
- BRAGA_RPC_URL=https://braga.hoodi.arkiv.network/rpc
+ TIRAMISU_RPC_URL=https://rpc.tiramisu.db-chain.testnet.arkiv.network/<your-api-key>
+ TIRAMISU_API_KEY=your-key-from-hub
```

Register an API key at `https://hub.arkiv.network/api-keys` and pass it as a URL path segment, `X-API-KEY` header, or `Authorization: Bearer` header. Without a key, anonymous RPC access is rate-limited.

Check `.env*` files, deployment configs, Docker wiring, shell/seed scripts, README setup steps, and frontend wallet config for stale Braga references.

### 4. Apply SDK 0.7 → 0.8 API changes

These ship together — apply all of them:

| 0.7.x (old) | 0.8.0-dev.3 (new) |
| ----------- | ----------------- |
| `import { … } from "@arkiv-network/sdk/utils"` | Import `ExpirationTime`, `jsonToPayload`, `stringToPayload` from `@arkiv-network/sdk` root |
| `payloadToString(entity.payload)` | `entity.toText()` or `entity.toJson()` |
| `attributes: [{ key: "type", value: "note" }]` | `attributes: { type: "note" }` |
| `entity.attributes.find(a => a.key === "x")?.value` | `entity.attributes.x?.value` (object keyed by name) |
| `expiresIn: ExpirationTime.fromHours(12)` | `expires: ExpirationTime.fromHours(12)` |
| `walletClient.updateEntity({ entityKey, payload, contentType, attributes, expiresIn })` | `walletClient.patchEntity({ entityKey, set: { status: "done" }, unset: ["draft"] })` |
| `walletClient.mutateEntities({ creates, updates, deletes, extensions })` | `walletClient.executeBatch({ creates, patches, deletes, extensions, ownershipChanges })` |
| `subscribeEntityEvents(...)` (async, returns Promise) | `watchEntityEvents(...)` (sync, returns unwatch function — do not await) |
| `InvalidAttributeError` | `InvalidValueError` |
| `InvalidExpirationError` | `InvalidExpiryError` |
| `orderBy()` / `asc()` / `desc()` (deprecated no-ops) | **Removed** — sort client-side |
| `expiresAtBlock`, `createdAtBlock`, `lastModifiedAtBlock` | `expiresAt`, `createdAt`, `updatedAt` |
| Bare float `19.99` as attribute value | `dec("19.99")` from `@arkiv-network/sdk/attr` |

**New methods in 0.8:** `changeOwnership()`, `executeBatch()`.

**New typed attribute helpers** from `@arkiv-network/sdk/attr`: `bool`, `i32`, `u64`, `u256`, `dec`, `decFromUnits`, `decUnits`, `str`, `addr`, `key`, `bytes32`.

**New expiry helpers:** `ExpirationTime.fromSeconds()`, `fromWeeks()`, `fromMonths()`, `fromYears()`, `fromBlocks()`, `atBlock()`, `atDate()`, `permanent()`.

**Event handler renames:** `onEntityUpdated` → `onEntityPatched`, `onEntityExpiresInExtended` → `onExpiryExtended`. New: `onOwnershipTransferred`, `onEvent`. `onEntityExpired` is **gone** — expiration fires no event; poll or handle `NoEntityFoundError` from `getEntity()`.

**Query operators:** `ne()`, `exists()`, and `hasType()` are exported by the SDK but **not implemented on the node** — queries using them fail to parse. Use `not(eq(...))` instead.

### 5. Refresh funding

- Request fresh test GLM from the [Tiramisu faucet](https://hub.arkiv.network/faucet).
- No bridge address is published for Tiramisu. Funds on Braga stay there.

### 6. Re-create entities and seed data

Braga entities do not migrate. If the app depends on seed data, startup entities, cached indexes, or demo content, run the seed/migration script against Tiramisu before switching traffic.

### 7. Verify both read and write paths

After updating:

- Run one write flow end-to-end (`createEntity`)
- Verify queries return the newly written entity
- Confirm wallet prompts show Tiramisu, not Braga
- Confirm gas is charged in `GLM`
- Test a partial update with `patchEntity` (not a full replace)

## Migration Notes for Agents

- Prefer narrow replacements: change active codepaths to Tiramisu, then remove Braga-only compatibility code.
- Keep Braga references only in migration docs or explicit legacy support blocks.
- If the codebase uses direct viem or wagmi chain definitions instead of the Arkiv exported chain, update `id`, `rpcUrls`, and `nativeCurrency` consistently.
- Do not teach users to hand-build raw entity mutation transactions — the SDK handles encoding internally via the Arkiv precompile at `0x4400000000000000000000000000000000000044`.
