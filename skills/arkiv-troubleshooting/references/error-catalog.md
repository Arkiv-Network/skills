# Source-declared SDK 1.0.0 errors

This catalog describes inspected source, not a claim that every error was reproduced on a live node. Use fixed allowlisted diagnostics and validated local transaction identifiers. Never expose or persist raw provider errors or nested causes: the RPC URL path contains a credential. Outer viem or EntityMutationError objects can include that URL in multiple fields.

| Class | Correction |
| --- | --- |
| MissingAccessKeyError | rabdi requires an options.accessKey string; explicitly empty keys use the heavily limited endpoint |
| SchemaDefinitionError | Use defineSchema, valid columns/names and attribute budget |
| SchemaMismatchError | Inspect required/optional/default values, selected column types and named tag |
| InvalidAttributeNameError | ASCII name grammar, reserved names and 32-byte limit; case is significant |
| InvalidValueError | Preserve declared type, integer/range/byte bounds and decimal string precision |
| MissingValueError | Null is not a value; optional absence is omitted/unset |
| UntypedValueError | Objects/arrays need explicit byte encoding |
| TooManyAttributesError | 32 attributes including a named tag; do not silently drop columns |
| EntityTooLargeError | Aggregate bytes-column budget exceeded; use bounded chunks/external storage |
| ConflictingMutationError | A name cannot be set and unset in the same patch |
| EmptyPatchError | Supply set/unset changes or skip the operation |
| InvalidExpiryError | Correct branded expiry, nominal units and live u64 deadline |
| ExpiryBeyondMaxLifetime (native revert) | The effective target exceeds currentBlock + maxLifetime; reduce it with an inclusion margin and plan Lifetime Extension before expiry |
| InvalidPredicateError | Check indexing/type/system-field rules and single ordering key |
| UnsupportedOperatorError | Operator/type mismatch, such as prefix on non-string |
| QueryError | Inspect kind/code: parse -32001, type -32002, literal -32003, limits -32004 |
| NoEntityFoundError | No current live key; reason may be never-created, deleted, expired, reset or wrong chain |
| EntityMutationError | Preserve txHash if present; reconcile observed send phase and receipt before retrying |
| Head-only state / -32603 | `arkiv serves state at the chain head only`: use latest/pending instead of safe/finalized or old block-hash state selectors |
| Revert consuming the gas limit | Use explicit latest nonce/gas/network gasPrice; raise the approved gas cap above the measured Rabdi floor and exact-operation need |

There are no SDK 1.0.0 query cursor/block error kinds. HTTP access/quota failures and invalid raw params are separate from those four query errors. Every arkiv_query, including a filtered count, costs 10 units under current provider policy; other methods cost zero and each access key starts with 100,000,000 units. Honor actual Retry-After/reset policy; avoid retry storms or alternate-key quota bypass.

## Phase-aware recovery

```typescript
import { EntityMutationError, MissingAccessKeyError } from '@arkiv-network/sdk';
import { QueryError } from '@arkiv-network/sdk/query';
export function recoveryFor(error: unknown, sendAdmission: 'not_reached' | 'reached' | 'unknown' = 'unknown') {
  if (error instanceof EntityMutationError) {
    return { action: error.txHash || sendAdmission !== 'not_reached' ? 'reconcile_write' : 'inspect_presend_failure',
      transactionHash: error.txHash };
  }
  if (error instanceof MissingAccessKeyError) return { action: 'configure_access_key' };
  if (error instanceof QueryError) return { action: 'fix_query', kind: error.kind, code: error.code };
  return { action: 'inspect_sanitized_evidence' };
}
export function createResultDto(result: { entityKey: `0x${string}`; txHash: `0x${string}`; expiresAt: bigint }) {
  return { arkivEntityKey: result.entityKey, transactionHash: result.txHash, expiresAtBlock: result.expiresAt.toString() };
}
```

Set not_reached only from trusted instrumented send-admission evidence, never inferred from absent hashes, error text or unchanged nonces. A decode failure or later serialization/read error can follow a successful transaction. Store original hash/signed intent before formatting responses; fix verification without resubmission. Cross-bundle instanceof can fail, so preserve structured safe discriminants at the real boundary.

For HTTP 413 measure the exact request rather than only binary data size. Keep evidence of whether signing/forwarding occurred. A pre-send validation/unsigned-estimate failure and a paid reverted receipt are different outcomes. Explicit gas can skip estimation. Native revert names can be decoded from inspected versioned ABI/cause data; they are not guaranteed outer JavaScript class names.

Explicit transaction fields are the recommended Rabdi default. A successful receipt followed by a decode/read failure must never be retried. A corrected operation may be retried at most once only after a confirmed reverted receipt, fresh nonce/fees and approved budget; these recovery helpers do not send or retry.

Sources: [SDK errors](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/errors.ts), [schema errors](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/schema/errors.ts), [query errors](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/query/errors.ts).
