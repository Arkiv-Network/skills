# Arkiv Integration Patterns

The three most common integration scenarios for Arkiv applications. All examples target `@arkiv-network/sdk@0.8.0-dev.3` on the Cheesecake devnet.

## Table of Contents

- [Arkiv Integration Patterns](#arkiv-integration-patterns)
  - [Table of Contents](#table-of-contents)
  - [Backend Read/Write](#backend-readwrite)
  - [Client-Side Reading](#client-side-reading)
  - [Client-Side Writing](#client-side-writing)
    - [Option A: Manual MetaMask integration](#option-a-manual-metamask-integration)
    - [Option B: Wagmi / RainbowKit integration (recommended for dApps)](#option-b-wagmi--rainbowkit-integration-recommended-for-dapps)
  - [Live Events with TanStack Query](#live-events-with-tanstack-query)

---

## Backend Read/Write

For server-side applications (Next.js API routes, Express, any Node.js backend). The private key lives in environment variables — never in client code.

```typescript
// lib/arkiv-server.ts
import { createWalletClient, createPublicClient, ExpirationTime, jsonToPayload } from "@arkiv-network/sdk"
import { cheesecake } from "@arkiv-network/sdk/chains"
import { eq } from "@arkiv-network/sdk/query"
import { http } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { PROJECT_ATTRIBUTE_NAME, PROJECT_ATTRIBUTE_VALUE } from "./arkiv"

// Include your API key in the URL: https://rpc.cheesecake.db-chain.devnet.gobas.me/<api-key>
// Obtained from the Arkiv Hub: https://hub.arkiv.network
const rpcUrl = process.env.CHEESECAKE_RPC_URL


const walletClient = createWalletClient({
  chain: cheesecake,
  transport: http(rpcUrl),
  account: privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`),
});

const publicClient = createPublicClient({
  chain: cheesecake,
  transport: http(rpcUrl),
});

// Write example
export async function createPost(title: string, content: string) {
  const { entityKey, txHash } = await walletClient.createEntity({
    payload: jsonToPayload({ title, content }),
    contentType: "application/json",
    attributes: {
      [PROJECT_ATTRIBUTE_NAME]: PROJECT_ATTRIBUTE_VALUE,
      entityType: "post",
      created: Date.now(),
    },
    expires: ExpirationTime.fromDays(30),
  })
  return { entityKey, txHash }
}

// Read example
export async function getPosts() {
  const result = await publicClient
    .select({ key: true, payload: true })
    .where(
      eq(PROJECT_ATTRIBUTE_NAME, PROJECT_ATTRIBUTE_VALUE),
      eq("entityType", "post"),
    )
    .limit(50)
    .fetch()
  return result
}

export async function updatePostStatus(entityKey: `0x${string}`, status: string) {
  const { txHash } = await walletClient.patchEntity({
    entityKey,
    set: { status },
  })
  return { txHash }
}
```

Use in a Next.js API route:

```typescript
// app/api/posts/route.ts
import { createPost, getPosts } from "@/lib/arkiv-server"

export async function GET() {
  const posts = await getPosts()
  return Response.json(posts)
}

export async function POST(request: Request) {
  const { title, content } = await request.json()
  const result = await createPost(title, content)
  return Response.json(result)
}
```

Or in Express:

```typescript
import express from "express"
import { createPost, getPosts } from "./lib/arkiv-server"

const app = express()
app.use(express.json())

app.get("/posts", async (req, res) => {
  const posts = await getPosts()
  res.json(posts)
})

app.post("/posts", async (req, res) => {
  const { title, content } = req.body
  const result = await createPost(title, content)
  res.json(result)
})

app.listen(3000)
```

---

## Client-Side Reading

For frontend applications that only need to query data. Uses a public client — no private key, safe to run in the browser.

```typescript
// lib/arkiv-queries.ts
import { createPublicClient } from "@arkiv-network/sdk"
import { cheesecake } from "@arkiv-network/sdk/chains"
import { eq } from "@arkiv-network/sdk/query"
import { http } from "viem"
import { PROJECT_ATTRIBUTE_NAME, PROJECT_ATTRIBUTE_VALUE } from "@/lib/arkiv"

export const publicClient = createPublicClient({
  chain: cheesecake,
  transport: http(process.env.NEXT_PUBLIC_CHEESECAKE_RPC_URL),
})

export async function fetchEntitiesByType<T>(entityType: string): Promise<(T & { arkivEntityKey: string })[]> {
  const result = await publicClient
    .select({ key: true, payload: true })
    .where(
      eq(PROJECT_ATTRIBUTE_NAME, PROJECT_ATTRIBUTE_VALUE),
      eq("entityType", entityType),
    )
    .limit(50)
    .fetch()

  return result.entities
    .map((entity) => {
      try {
        return { arkivEntityKey: entity.key!, ...entity.toJson() }
      } catch {
        return null
      }
    })
    .filter((item): item is T & { arkivEntityKey: string } => item !== null)
}

export async function fetchEntityByKey<T>(entityKey: string): Promise<T> {
  const entity = await publicClient.getEntity(entityKey as `0x${string}`)
  return entity.toJson()
}
```

Wrap them in hooks with TanStack Query (`@tanstack/react-query`):

```typescript
// hooks/useArkivQuery.ts
import { useQuery } from "@tanstack/react-query"
import { fetchEntitiesByType, fetchEntityByKey } from "@/lib/arkiv-queries"

export function useArkivQuery<T>(entityType: string) {
  return useQuery<T[]>({
    queryKey: ["arkiv", "entities", entityType],
    queryFn: () => fetchEntitiesByType<T>(entityType),
  })
}

export function useArkivEntity<T>(entityKey: string | null) {
  return useQuery<T>({
    queryKey: ["arkiv", "entity", entityKey],
    queryFn: () => fetchEntityByKey<T>(entityKey!),
    enabled: !!entityKey,
  })
}
```

Usage in components:

```tsx
// components/PostList.tsx
import { useArkivQuery } from "@/hooks/useArkivQuery"

interface Post {
  title: string
  content: string
}

function PostList() {
  const { data: posts, isLoading, error } = useArkivQuery<Post>("post")

  if (isLoading) return <p>Loading...</p>
  if (error) return <p>Error: {error.message}</p>

  return (
    <ul>
      {posts?.map((post) => (
        <li key={post.arkivEntityKey}>{post.title}</li>
      ))}
    </ul>
  )
}
```

> **Tip:** Every Arkiv entity has a unique `entity.key`. The fetcher merges it as `arkivEntityKey` into each item — use this as your React key instead of array indices.
> **Note:** `useEffect` + `useState` for data fetching is an anti-pattern — it doesn't handle caching, race conditions, deduplication, or background refetching. Always use a data-fetching library.

---

## Client-Side Writing

For dApps where the user's own wallet signs transactions. Two approaches depending on your stack.

### Option A: Manual MetaMask integration

**Adding the Arkiv network to MetaMask:**

```typescript
async function addArkivNetwork() {
  await window.ethereum.request({
    method: "wallet_addEthereumChain",
    params: [{
      chainId: "0x75ff6e",
      chainName: "Arkiv Cheesecake Testnet",
      nativeCurrency: { name: "GLM", symbol: "GLM", decimals: 18 },
      rpcUrls: ["https://rpc.cheesecake.db-chain.devnet.gobas.me"],
      blockExplorerUrls: ["https://indexer.cheesecake.db-chain.devnet.gobas.me"],
    }],
  })
}
```

**Creating a wallet client from MetaMask:**

```typescript
import { createWalletClient } from "@arkiv-network/sdk"
import { cheesecake } from "@arkiv-network/sdk/chains"
import { custom } from "viem"

await addArkivNetwork()
await window.ethereum.request({ method: "eth_requestAccounts" })

const walletClient = createWalletClient({
  chain: cheesecake,
  transport: custom(window.ethereum),
})
```

### Option B: Wagmi / RainbowKit integration (recommended for dApps)

```tsx
import { useAccount, useWalletClient } from "wagmi"
import { createWalletClient as createArkivWalletClient } from "@arkiv-network/sdk"
import { cheesecake } from "@arkiv-network/sdk/chains"
import { custom } from "viem"

const { address } = useAccount()
const { data: wagmiWalletClient } = useWalletClient()

const arkivWalletClient = createArkivWalletClient({
  chain: cheesecake,
  transport: custom(wagmiWalletClient!.transport),
  account: address,
});
```

Then use `arkivWalletClient` the same way as any other wallet client:

```typescript
import { jsonToPayload, ExpirationTime } from "@arkiv-network/sdk"
import { PROJECT_ATTRIBUTE_NAME, PROJECT_ATTRIBUTE_VALUE } from "@/lib/arkiv"

const { entityKey, txHash } = await arkivWalletClient.createEntity({
  payload: jsonToPayload({ title: "My Post", content: "Hello!" }),
  contentType: "application/json",
  attributes: {
    [PROJECT_ATTRIBUTE_NAME]: PROJECT_ATTRIBUTE_VALUE,
    entityType: "post",
    author: address,
  },
  expires: ExpirationTime.fromDays(30),
})
```

---

## Live Events with TanStack Query

Use `watchEntityEvents` to invalidate TanStack Query caches when entities change on-chain. Do not await the return value — it is the unwatch function:

```typescript
// lib/arkiv-events.ts
import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { publicClient } from "@/lib/arkiv-queries"
import { PROJECT_ATTRIBUTE_NAME, PROJECT_ATTRIBUTE_VALUE } from "@/lib/arkiv"

export function useArkivEventWatcher(entityType: string) {
  const queryClient = useQueryClient()

  useEffect(() => {
    const unwatch = publicClient.watchEntityEvents({
      onEntityCreated: () => {
        queryClient.invalidateQueries({ queryKey: ["arkiv", "entities", entityType] })
      },
      onEntityPatched: () => {
        queryClient.invalidateQueries({ queryKey: ["arkiv", "entities", entityType] })
      },
      onEntityDeleted: () => {
        queryClient.invalidateQueries({ queryKey: ["arkiv", "entities", entityType] })
      },
      onError: (error) => console.error("Arkiv event error:", error),
    })

    return unwatch
  }, [queryClient, entityType])
}
```

Mount the hook alongside your query hook:

```tsx
function PostList() {
  useArkivEventWatcher("post")
  const { data: posts, isLoading } = useArkivQuery<Post>("post")
  // ...
}
```

**Note:** Expiration fires no event in 0.8. To detect expired entities, poll with `getEntity()` and handle `NoEntityFoundError`, or query by `$expiresAt`.
