# Owned checkpoint mirror

This in-memory example belongs to its caller: every Map and journal entry is created here. A production storage adapter must commit the corresponding row changes, dedup identities, journal and checkpoint in one transaction scoped to the indexer's projection ID. A live consumer also verifies chain/genesis identity and checkpoint hashes on restart.

The adapter materializes one trusted creator's marketplace rows at a **block-end snapshot**. It uses a key-filtered SDK query to avoid substituting head for the historical block. A scoped empty page removes only that key's local projection row; transport/query failures propagate.

```typescript
import { createPublicClient, ENTITY_EVENTS_ABI } from '@arkiv-network/sdk';
import { key, str } from '@arkiv-network/sdk/attr';
import { eq } from '@arkiv-network/sdk/query';
import { decodeEventLog, type Address, type Hex } from 'viem';

type Public = ReturnType<typeof createPublicClient>;
export const nativeAddress: Address = '0x4400000000000000000000000000000000000044';
export type Header = { number: bigint; hash: Hex; parentHash: Hex };
export type MirrorRow = {
  key: Hex; creator: Address; owner: Address; expires_at: bigint;
  payload: Uint8Array; attributes: Record<string, unknown>;
};
export type PositionedLog = {
  address: Address; blockNumber: bigint; blockHash: Hex;
  transactionHash: Hex; logIndex: number; entityKey: Hex;
};
export type BlockInput = { header: Header; logs: readonly PositionedLog[] };

export async function readNativeBlock(client: Public, number: bigint): Promise<BlockInput> {
  const [block, logs] = await Promise.all([
    client.getBlock({ blockNumber: number }),
    client.getLogs({ address: nativeAddress, events: ENTITY_EVENTS_ABI,
      fromBlock: number, toBlock: number, strict: false }),
  ]);
  if (!block.hash) throw new Error('Block hash unavailable');
  const positioned: PositionedLog[] = [];
  for (const log of logs) {
    if (log.removed || log.blockNumber === null || log.blockHash === null ||
        log.transactionHash === null || log.logIndex === null) {
      throw new Error('Canonical log position unavailable');
    }
    // Keep malformed known-topic logs visible, then fail strict decoding instead of skipping them.
    const event = decodeEventLog({ abi: ENTITY_EVENTS_ABI, data: log.data,
      topics: log.topics as [Hex, ...Hex[]] });
    positioned.push({ address: log.address, blockNumber: log.blockNumber, blockHash: log.blockHash,
      transactionHash: log.transactionHash, logIndex: log.logIndex, entityKey: event.args.entityKey });
  }
  return { header: { number: block.number, hash: block.hash, parentHash: block.parentHash }, logs: positioned };
}

export async function readMarketplaceRowAt(
  client: Public, creator: Address, entityKey: Hex, block: bigint,
): Promise<MirrorRow | null> {
  const page = await client.select({ key: true, owner: true, creator: true,
    expiresAt: true, payload: true, attributes: true })
    .where(eq('$key', key(entityKey)), eq('project', str('example_marketplace')),
      eq('entity_type', str('listing')))
    .createdBy(creator).atBlock(block).limit(1).fetch();
  if (page.blockNumber !== block) throw new Error('Snapshot block mismatch');
  const row = page.entities[0];
  return row ? { key: row.key, creator: row.creator, owner: row.owner,
    expires_at: row.expiresAt, payload: row.payload, attributes: row.attributes } : null;
}

type JournalEntry = { header: Header; rows: Map<Hex, MirrorRow>; eventIds: Set<string> };
export class OwnedMirror {
  readonly identity: string;
  readonly creator: Address;
  readonly journalBlocks: number;
  rows: Map<Hex, MirrorRow>;
  checkpoint: Header;
  private journal: Map<bigint, JournalEntry>;

  constructor(identity: string, creator: Address, baseline: Header, rows: readonly MirrorRow[] = [], journalBlocks = 16) {
    if (!Number.isInteger(journalBlocks) || journalBlocks < 2) throw new Error('Invalid journal window');
    this.identity = identity; this.creator = creator; this.journalBlocks = journalBlocks;
    this.rows = new Map(rows.map((row) => [row.key, structuredClone(row)]));
    this.checkpoint = { ...baseline };
    this.journal = new Map([[baseline.number, { header: { ...baseline },
      rows: structuredClone(this.rows), eventIds: new Set() }]]);
  }

  assertCheckpoint(header: Header) {
    if (header.number !== this.checkpoint.number || header.hash !== this.checkpoint.hash) {
      throw new Error('Checkpoint hash mismatch');
    }
  }

  async applyBlock(identity: string, block: BlockInput, readAt: (key: Hex, number: bigint) => Promise<MirrorRow | null>) {
    if (identity !== this.identity) throw new Error('Chain identity changed; start a new projection generation');
    const { header } = block;
    const known = this.journal.get(header.number);
    if (known?.header.hash === header.hash && header.number <= this.checkpoint.number) return false;
    if (header.number !== this.checkpoint.number + 1n || header.parentHash !== this.checkpoint.hash) {
      throw new Error('Noncontiguous block or parent hash mismatch');
    }
    const staged = structuredClone(this.rows);
    const eventIds = new Set<string>();
    const touched = new Set<Hex>();
    for (const log of [...block.logs].sort((a, b) => a.logIndex - b.logIndex)) {
      if (log.address.toLowerCase() !== nativeAddress) continue;
      if (log.blockNumber !== header.number || log.blockHash !== header.hash ||
          !Number.isInteger(log.logIndex) || log.logIndex < 0) {
        throw new Error('Log does not belong to the canonical block');
      }
      const id = `${identity}:${header.hash}:${log.transactionHash}:${log.logIndex}`;
      if (eventIds.has(id)) continue;
      eventIds.add(id); touched.add(log.entityKey);
    }
    for (const entityKey of touched) {
      const row = await readAt(entityKey, header.number);
      if (row) {
        if (row.key !== entityKey || row.creator.toLowerCase() !== this.creator.toLowerCase()) {
          throw new Error('Snapshot row belongs to another creator');
        }
        staged.set(entityKey, structuredClone(row));
      } else staged.delete(entityKey); // Only the Map created by this projection.
    }
    for (const [entityKey, row] of staged) {
      if (row.expires_at <= header.number) staged.delete(entityKey);
    }
    // All reads/sweeps succeeded. Production adapters commit this state atomically.
    this.rows = staged; this.checkpoint = { ...header };
    this.journal.set(header.number, { header: { ...header }, rows: structuredClone(staged), eventIds });
    while (this.journal.size > this.journalBlocks) this.journal.delete(this.journal.keys().next().value!);
    return true;
  }

  rollbackTo(verifiedAncestor: Header) {
    const entry = this.journal.get(verifiedAncestor.number);
    if (!entry || entry.header.hash !== verifiedAncestor.hash) {
      throw new Error('Ancestor outside retained projection journal');
    }
    this.rows = structuredClone(entry.rows); this.checkpoint = { ...entry.header };
    for (const number of [...this.journal.keys()]) {
      if (number > verifiedAncestor.number) this.journal.delete(number);
    }
  }
}
```

Create the baseline from an empty known starting block or a complete scoped query at a pinned snapshot. Set `identity` from verified chain ID, genesis/reset identifier and projection scope/schema configuration. The function argument is not identity verification by itself: fetch and verify those inputs before constructing or resuming the consumer.

One worker owns this instance. Queue blocks serially; do not run `applyBlock` concurrently. The example performs no asynchronous database commit, external deletion or network write. Its journal keeps a configurable number of full row snapshots; budget their storage for the actual row/payload volume. It is a rollback window, not an unbounded historical archive.

To detect a reorganization, re-fetch the saved checkpoint header and call `assertCheckpoint`. On mismatch, walk saved/canonical header pairs to a verified common ancestor before `rollbackTo`. Do not treat a transient RPC failure as a missing block. If the ancestor is outside the journal, bootstrap a new isolated projection rather than manufacturing state. Fetch hashes separately when consuming SDK event callbacks because those callbacks omit them.

Deletion or scope changes produce a null pinned row read. Expiration requires an empty-block sweep too. The final row read at a block coalesces all its operations; it does not reconstruct intermediate payload versions. A block read or row failure leaves the checkpoint, rows and journal unchanged.

SDK 0.8.1 sources: [native address](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/consts.ts), [event ABI](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/entity/events.ts), [watch context](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/types/events.ts), [query snapshot](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/query/engine.ts). The persistence/rollback policy is consumer guidance verified with deterministic fixtures, not an SDK service guarantee.
