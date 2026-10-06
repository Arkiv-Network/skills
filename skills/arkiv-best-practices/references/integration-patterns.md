# Integration patterns

Use the SDK for Tiramisu. Check the application's installed versions and conventions before adapting these examples. They export functions and do not run writes on import.

## Server boundary

- Keep signing keys and access keys on the server. Access keys use `X-API-KEY` headers; public RPC URLs contain no credential. An access key does not pay gas.
- Authenticate first; authorize the specific operation, verify ownership where needed, validate input, and rate-limit before signing. Derive an actor from the verified session, never from a request body alone.
- A shared signer owns the entities it creates. User-session authorization must then be enforced by your backend; namespace attributes cannot enforce it on-chain. Serialize its write queue to avoid nonce collisions.
- Use the project's existing session and authorization implementation. A placeholder auth check that returns true is not a working endpoint. Add CSRF defenses when cookie authentication is used.
- Bound read-proxy filters, page size, total pages and response size. Rate-limit public read endpoints separately; never expose a generic credentialed RPC proxy.
- For fresh Next.js reads, use `http(url, { fetchOptions: { cache: "no-store" } })`; inspect route, application, service-worker and CDN caches too. Do not cache authenticated API routes in a service worker.
- Convert bigint fields to decimal strings explicitly in response DTOs. Do not return `QueryResult` or whole entities through `Response.json`.

## Validate payloads and keep entity identity

Use the application's existing validation library or a specific runtime parser. A TypeScript generic does not validate `toJson()` output. This complete parser drops unrecognized fields and attaches the chain key after validation, so a payload cannot overwrite it.

```typescript
import type { Hex } from "viem"

export type Post = { title: string; content: string }
export type StoredPost = Post & { arkivEntityKey: Hex }

export function parsePost(raw: unknown): Post {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Post payload must be an object")
  }
  if (!("title" in raw) || typeof raw.title !== "string" ||
      !("content" in raw) || typeof raw.content !== "string") {
    throw new Error("Invalid post payload")
  }
  return { title: raw.title, content: raw.content }
}

export function postDto(entity: { key: Hex; toJson(): unknown }): StoredPost {
  return { ...parsePost(entity.toJson()), arkivEntityKey: entity.key }
}
```

A React/TanStack Query hook should retain `StoredPost[]` as its result type, including `arkivEntityKey`. Query keys include chain ID, relevant account or trusted publisher, namespace, entity type and filters. Changing account or chain must clear stale write state and choose the new cache scope. If a detail query has no key, disable it and still guard its query function; do not use a non-null assertion to bypass connection or input checks.

## Browser wallet

Ask the injected wallet to connect and switch to Tiramisu. If switching returns code 4902, add the chain and switch again. Include the explorer explicitly: the SDK chain export does not supply `blockExplorers`.

```typescript
import { createWalletClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { custom, isAddress, type EIP1193Provider } from "viem"

export async function connectArkivWallet(provider: EIP1193Provider) {
  const addresses = await provider.request({ method: "eth_requestAccounts" })
  const account = addresses[0]
  if (!account || !isAddress(account)) throw new Error("Connect an EOA wallet")
  try {
    await provider.request({
      method: "wallet_switchEthereumChain", params: [{ chainId: "0x7614d1" }],
    })
  } catch (error) {
    if (typeof error !== "object" || error === null || !("code" in error) ||
        error.code !== 4902) throw error
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: "0x7614d1", chainName: "Arkiv Tiramisu Testnet",
        nativeCurrency: tiramisu.nativeCurrency,
        rpcUrls: [tiramisu.rpcUrls.default.http[0]],
        blockExplorerUrls: ["https://tiramisu.explorer.arkiv.network"],
      }],
    })
    await provider.request({
      method: "wallet_switchEthereumChain", params: [{ chainId: "0x7614d1" }],
    })
  }
  if (await provider.request({ method: "eth_chainId" }) !== "0x7614d1") {
    throw new Error("Wallet is not on Tiramisu")
  }
  return createWalletClient({ chain: tiramisu, account, transport: custom(provider) })
}
```

Recheck account and chain at write time; either can change after connection. Register cleanup for provider account/chain listeners. Never export a server account or private key into browser code.

For wagmi 2, call `useAccount` and `useWalletClient` inside a React custom hook or component, unconditionally and in a stable order. Check installed exports before adapting this guidance to another wagmi version. Return no Arkiv wallet until both a connected address and a wallet client for Tiramisu exist. Then create the Arkiv wallet with that explicit address and `custom(wagmiWalletClient.transport)`. Do not use module-level hooks or `wagmiWalletClient!` before connection. RainbowKit is a connection UI, not account abstraction. Embedded wallet EOA integrations need their own Tiramisu end-to-end test; do not claim an untested provider works.

Faucet SIWE authentication is not an application session. Establish and verify your application's own session before enabling server signing.

## Events and cache invalidation

The watcher filters the native system address, not your application. Keep a set of relevant entity keys and filter every event. Existing-key patch, extension, ownership and deletion events invalidate both detail and affected collection queries. When ownership or filter attributes change, invalidate the old scope too so entities can leave the list.

For a new key, fetch the entity, validate payload and check namespace plus creator/owner policy before invalidating the collection and adding the key. A new entity is not yet in the known-key set, so filtering only known keys would miss it. Deleted entities cannot be fetched at head: retain their prior collection membership for invalidation.

Catch asynchronous fetch and invalidation failures inside handlers. SDK event context exposes block number, transaction hash and log index, not block hash: deduplicate by chain, transaction hash and log index. For reorg detection, fetch block hashes separately, invalidate affected checkpoint state and replay; deduplication alone does not handle a reorg. Stop the synchronous unwatch function in React effect cleanup. Use stable dependencies to avoid recreating the watcher on every render.

Replay from a verified checkpoint; never use an arbitrary future block. Expiration has no event: sweep deadlines or periodically refetch. HTTP watches poll; WebSocket without a replay `fromBlock` can push, while a bigint replay block forces polling.

Sources checked on 2026-10-05: SDK 0.8.1 wallet account guard, entity decoder and watcher; viem HTTP fetch options and watcher; React hook rules and Vercel React Best Practices. Application authorization and CSRF behavior must be tested in the consumer app, not inferred from these snippets.
