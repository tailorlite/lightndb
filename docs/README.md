# lightndb — Technical Documentation

lightndb is a lightweight, schemaless, local JSON document database for Node.js. It wraps LMDB (via the `node-lmdb` package) for high-performance key-value storage and exposes a MongoDB-like query and index API.

This directory holds the design documentation. The vocabulary shared across these docs lives in [`../CONTEXT.md`](../CONTEXT.md).

## Documents

1. [Architecture](./01-architecture.md) — components, responsibilities, and request flow.
2. [Storage model](./02-storage-model.md) — environment, sub-databases, key encodings, document serialization.
3. [Indexing](./03-indexing.md) — index storage, the Value Encoder, maintenance on writes, and the Query Planner.
4. [Query engine](./04-query-engine.md) — Selector evaluation, Operators, dot notation, and scan vs. index.
5. [Concurrency & transactions](./05-concurrency-and-transactions.md) — the write mutex, read transactions, atomicity, and MapFull.
6. [API reference](./06-api-reference.md) — connection, collections, CRUD, indexes, options, return shapes, errors.

## Decisions

Architectural decisions are recorded as ADRs in [`./adr/`](./adr/).

## v1 scope

**In:** equality/comparison/logical Operators + dot notation; `$exists`, `$regex`; `insert`/`insertMany`, `find`/`findOne`, `update`/`updateMany`, `remove`/`deleteMany`; single-field and Compound Indexes with a `unique` option; `sort`/`limit`/`skip`/`projection`/`count`.

**Out (deferred):** `$type`, `$size`, `$all`, `$elemMatch`, `$nor`, `$where`; descending-direction Indexes; a lazy streaming cursor (`find` returns an array); geospatial and text Indexes; multi-process concurrency beyond LMDB's native MVCC.

See [ADR-0007](./adr/0007-v1-query-and-api-scope.md).
