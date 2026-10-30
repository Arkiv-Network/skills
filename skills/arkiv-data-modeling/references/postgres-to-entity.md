# Map PostgreSQL to Arkiv schemas

Use schema-only DDL and actual query requirements. Do not request database credentials for a model. The mapping does not import entities, enforce SQL constraints or authorize writes.

| PostgreSQL concept | SDK 1.0.0 mapping | Required decision |
| --- | --- | --- |
| Table | Named `defineSchema` | Creator scope, public fields, lifetime |
| Primary/foreign key | Indexed str source ID or resolved key column | Uniqueness, missing targets and remapping |
| Boolean | bool column | Preserve false versus absent |
| Integer | i32 if fitting; unsigned u64/u256 for declared nonnegative ranges | Reject overflow; never parse unsafe JS numbers |
| Signed BIGINT | Exact string in bytes, or dec(sourceIntegerString) for numeric filters | Signed range and precision |
| Numeric/money | dec string up to 18 decimal places, or exact minor units | Currency, scale and rounding |
| Timestamp | u64 epoch milliseconds when nonnegative, original meaning in bytes | Timezone and pre-epoch encoding |
| Bounded text | str, at most 128 UTF-8 bytes | Index only if filtering; no silent truncation |
| Long text/JSON/arrays | Named bytes columns with declared encoding | Schema validation, nulls/order/duplicates |
| NULL | Optional column omitted; unset on a later transition to absence | Undefined patch values leave prior values alone |
| UNIQUE/CHECK/FK | App validation and coordinated writer | No native SQL constraint guarantee |
| JOIN/aggregate | Explicit relationship model or external projection | Bounded traversal, freshness and cardinality |
| ORDER BY/count | SDK one-key ordering / filtered count | Types, mismatch and pagination policy |

Index scalar columns used in predicates. Bytes cannot be filtered or sorted. A named schema adds an indexed public `arkiv.schema` tag and has at most 31 declared columns under the SDK's 32-attribute budget. All bytes in one create/patch share the 128 KiB SDK budget; encoded transactions have additional overhead.

Preserve source-to-destination mapping and explicit Entity Expiration for every type. Nullable optional values retain `0`, `false` and empty strings. Arrays needing membership queries require separate indexed relationships, with an ordinal when order or duplicates matter.

If using `postgres-to-entity`, inspect the installed version, README, generated schema and SDK compatibility. Its model-only converter is distinct from importing SQL data; never infer current method names or package versions from this guide. Preserve `needs-input` and `blocked` outcomes. A schema model cannot certify SQL constraints, data privacy or a live migration.

Source: [SDK 1.0.0 schemas](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/schema/), [converter](https://github.com/SantiagoDevRel/postgres-to-entity).
