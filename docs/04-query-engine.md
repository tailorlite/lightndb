# Query engine

`QueryEngine` is a pure function `match(doc, selector) -> boolean`, plus helpers that describe Selector shape to the Query Planner. It has no LMDB dependency and is fully unit-testable in isolation.

## Selector grammar

A Selector is an object. Each key is either a **field path** or a **top-level logical Operator**.

- Field path: `'profile.name'` (dot notation), `'tags'`, `'age'`.
- Top-level logical Operators: `$and` (array of Selectors), `$or` (array), `$not` (single Selector or regex).

A Document matches when **every** top-level key matches (implicit `$and`).

## Field selector

The value at a field path is matched against the selector:

- **Equality** (implicit): `{ age: 30 }` — deep-equal to 30. For arrays, equality matches if the array equals the value or **contains** it (MongoDB semantics).
- **Operator object:** `{ age: { $gt: 18, $lt: 65 } }` — all Operators must hold.
- **Regex literal:** `{ name: /^A/ }` — `$regex`-style match on strings.

## Operators

| Operator | Meaning |
|----------|---------|
| `$eq` | equality (also implicit) |
| `$ne` | not equal |
| `$gt` `$gte` `$lt` `$lte` | comparison |
| `$in` | value equals or is an array containing any element of the given array |
| `$nin` | none of `$in` |
| `$exists` | `true` iff the path resolves (to any value, incl. null); `false` iff absent |
| `$regex` | string matches the pattern (string or RegExp) |
| `$and` | all sub-Selectors match (top-level or nested) |
| `$or` | any sub-Selector matches |
| `$not` | negates a single Selector object or regex |

Deferred to later: `$type`, `$size`, `$all`, `$elemMatch`, `$nor`, `$where` (ADR-0007).

## Dot notation & arrays

Path resolution walks object keys. When an intermediate segment resolves to an **array**, the matcher matches if **any** element's remaining subpath matches — so `{ 'tags.0': 'x' }` checks the first element, while `{ tags: 'x' }` matches if any tag is `'x'`. This mirrors MongoDB.

## Comparison semantics

Comparisons use JS semantics with type-strict ordering: numbers compare numerically, strings by UTF-16 code unit, booleans `false < true`. Cross-type comparisons (e.g. number vs string) follow the fixed type order the Value Encoder uses (null < boolean < number < date < string) so that index-accelerated and in-memory results agree.

## Index-accelerated vs. scan

The Query Planner decides the access path (see [indexing](./03-indexing.md)); `QueryEngine` is always run as a post-filter over the candidate set, so correctness never depends on the planner's choice.

## Sort

`sort` is applied in memory over the result set (before `limit`). Sort keys follow the same type order as comparisons.
