# Serialize writes through a mutex; one transaction per batch; reject batchWrite for the primary path

All writes acquire an internal async mutex and run inside a single read-write Write Transaction (LMDB permits only one writer at a time). `insertMany`/`updateMany`/`deleteMany` perform all their work in one transaction, so a batch is atomic and a failure leaves no partial state. `node-lmdb`'s `batchWrite` is not used for the primary path: its conditional-write semantics and separate-thread blocking are more than lightndb needs, and plain synchronous transactions under a mutex are simpler and still fast. Reads use short read-only transactions (MVCC, non-blocking, no mutex).

## Considered Options

- Async mutex + synchronous transactions (chosen).
- `batchWrite` (rejected — overkill conditional semantics, separate-thread blocking interactions).
- No serialization (rejected — LMDB allows one writer anyway; unmanaged `beginTxn` calls would block or throw).

## Consequences

Writes serialize, so throughput is bounded by single-writer throughput (acceptable for a local embedded DB). Read transactions never block writers and are not pooled in v1.
