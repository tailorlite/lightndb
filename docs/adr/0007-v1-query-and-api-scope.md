# v1 query and API scope

v1 ships the Operators the prompt requires plus `$exists` and `$regex`, and defers `$type`, `$size`, `$all`, `$elemMatch`, `$nor`, and `$where`. `find()` returns a `Promise` resolving to an array (no lazy cursor) and supports `sort`, `limit`, `skip`, `projection`, and `count`. The deliberate no-s — a streaming cursor and the deferred Operators — are recorded so a later contributor doesn't assume they were forgotten.

## Considered Options

- Required Operators + `$exists`/`$regex`, array-returning `find` with modifiers (chosen).
- Full MongoDB Operator parity (rejected for v1 — scope and complexity).
- Array-only `find` with no modifiers (rejected — `sort`/`limit` are expected from a Mongo-like surface).

## Consequences

Large result sets materialize fully in memory before `limit` is applied (the planner applies `limit` during scan where an Index is used). Adding a cursor later is a backward-compatible addition (keep the array path, add `.cursor()`).
