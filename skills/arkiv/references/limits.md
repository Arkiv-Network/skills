# SDK 1.0.0 limits and units

These are source-checked SDK budgets, not a universal promise about every RPC ingress.

| Surface | Limit or rule | Source |
| --- | --- | --- |
| Schema attributes | 32 including a named schema's `arkiv.schema` tag; thus 31 named columns | `src/schema/schema.ts` |
| Names | ASCII letter first; letters/digits/`.`/`-`/`_` afterward; case-sensitive; 32 bytes; no `$`, reserved keywords or `--` | `src/schema/names.ts` |
| Strings | 128 UTF-8 bytes, validated by `str` | `src/schema/values.ts` |
| Binary values | 128 KiB per bytes value and aggregate bytes budget per create/patch | `src/schema/values.ts`, `attributes.ts` |
| Filters | Indexed columns only; no bytes; fixed system fields `$key/$owner/$creator/$expiresAt` | `src/query/expression.ts` |
| Ordering | One non-bytes key; schema columns need not be indexed to sort | `src/query/order.ts` |
| Query pages | 1–100, offset is a nonnegative safe integer; current state only | `src/query/engine.ts` |
| Numeric types | i32 signed; u64/u256 unsigned; dec fixed-point with 18 decimal places | `src/schema/values.ts` |
| Lifetimes | Absolute blocks or relative block floors; nominal conversion is 2 seconds/block | `src/utils/expirationTime.ts`, `src/entity/expiry.ts` |
| Access quota | 100,000,000 per key; each arkiv_query costs 10; other calls zero under current provider policy | [Access keys](https://hub.arkiv.network/access-keys) |

Byte encoding adds ABI and JSON-RPC overhead. Estimate the exact proposed operation; a value fitting the SDK limit need not fit a provider request/response cap. Bound scans, request size, gas and total spend. No universal operation-per-batch or ingress-size maximum is certified here.

An expiration deadline is not a wall-clock guarantee or secure-erasure mechanism. `ExpirationTime.permanent()` means max-u64, not permanently retained or always available data. Rabdi resets can invalidate existing entity keys.

Sources: [versioned schema](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/schema/), [query engine](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/query/engine.ts).
