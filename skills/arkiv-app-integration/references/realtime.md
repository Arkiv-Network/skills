# Events and current cache reconciliation

`watchEntityEvents` in SDK 1.0.0 exposes EntityCreated, EntityPatched, ExpiryExtended, OwnershipTransferred and EntityDeleted, plus onEvent/onError. Context contains blockNumber, transactionHash and logIndex; it is not a historical state snapshot or checkpoint hash. Extension owner is not necessarily the extender.

This bounded queue is for UI invalidation. It does not establish durable replay or guarantee delivery during startup/disconnection.

```typescript
import type { PublicArkivClient } from '@arkiv-network/sdk';
import type { EntityEvent } from '@arkiv-network/sdk/types';
export function watchSerially(client: Pick<PublicArkivClient, 'watchEntityEvents'>,
  handle: (event: EntityEvent) => Promise<void>, report: (error: unknown) => void,
  options: { maxQueued?: number; pollingInterval?: number } = {}) {
  const { maxQueued = 256, pollingInterval = 1000 } = options;
  if (!Number.isSafeInteger(maxQueued) || maxQueued < 1 || !Number.isSafeInteger(pollingInterval) || pollingInterval < 1) throw new Error('Invalid watcher bounds');
  let stopped = false, queued = 0;
  let unwatch = () => {};
  let tail = Promise.resolve();
  const fail = (error: unknown) => { stopped = true; unwatch(); try { report(error); } catch {} };
  unwatch = client.watchEntityEvents({ pollingInterval, onEvent: event => {
    if (stopped) return;
    if (++queued > maxQueued) { fail(new Error('Queue overflow; reconcile cache')); return; }
    tail = tail.then(async () => { try { if (!stopped) await handle(event); } finally { queued--; } }).catch(fail);
  }, onError: fail });
  if (stopped) unwatch();
  return () => { stopped = true; unwatch(); };
}
```

Start the listener before the initial current query and tolerate overlap. It becomes active on its first poll, so starting it is not an acknowledgment of complete coverage. Periodically reconcile scope and mark freshness unavailable after errors/gaps. No historical replay parameter exists on this watcher.

For EntityCreated a creator allowlist may prefilter the event's creation owner before a read. For EntityPatched fetch unknown keys as well; the new values can move them into scope. For OwnershipTransferred fetch unknown keys only when the new owner matches the selected owner, but always invalidate known keys' prior scope. Verify actual schema/publication/liveness filters before caching. Deletion needs prior membership because current lookup no longer returns the entity.

Invalidate detail plus affected collection caches. Keep cache keys scoped by chain/reset identity, account/trusted publisher, schema, filters and pagination. Guard late requests with a generation token; unwatch cannot cancel an already active handler. A quiet stream does not prove continuity.

Natural Entity Expiration emits no event. Sweep exact block deadlines against a fresh head and refetch extensions. A current query can repair current membership but cannot recover deleted/expired intermediate versions. A persistent mirror must expose gaps and follow [projection generation guidance](../../arkiv-indexing/references/checkpoint-mirror.md).

Source: [SDK watcher implementation](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/actions/public/watchEntityEvents.ts).
