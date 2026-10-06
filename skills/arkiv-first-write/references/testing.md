# Testing a first write

Test the installed SDK with an in-memory transport or deterministic HTTP fixture. A mock validates application behavior and SDK encoding, not persisted chain state. Keep these cases distinct:

| Case | Observable result |
| --- | --- |
| Fresh seed | One native create; lowercase names, u64 timestamp, explicit expiration; receipt key matches query read-back. |
| Existing readonly seed with matching payload | Return its key; no create, balance check or broadcast. |
| Duplicate or changed seed | Fail before sending; preserve existing entities. |
| Wrong network / zero balance | No broadcast. Positive balance still needs sufficient gas. |
| Confirmed receipt missing expected create log | `EntityMutationError.txHash` retained; inspect receipt and identity; no resend. |
| Reverted receipt | Report failure; change the input or state before a separately authorized retry. |
| Missing/changed read-back | Preserve key/hash and reconcile; no new create. |
| Multi-page seed lookup | Pin a block; assign each returned page; discard partial results on a cursor restart; bound retries. |
| Entity Expiration | Compare blocks as bigint; returned create expiry comes from the receipt; elapsed time is not a wall-clock lock. |

For a live smoke, agree on the signer, Tiramisu network, maximum writes and spend first. Estimate the exact payload without broadcasting, then create only within that budget and read by returned key. Report whether a real write/read-back happened or only an estimate/fixture passed. Never log a key, raw signed transaction or authorization header.

The SDK exports a `localhost` chain configuration; that export is not an installed local node. Do not promise a runnable devnet from it alone.

Sources: [SDK clients and actions](https://github.com/Arkiv-Network/arkiv-sdk-js/tree/main/src), [QueryError](https://docs.arkiv.network/typescript-sdk/api-reference/query/classes/queryerror/).
