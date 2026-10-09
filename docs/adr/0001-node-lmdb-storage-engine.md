# Use the `node-lmdb` package as the storage engine

lightndb wraps LMDB via the `node-lmdb` npm package (the original C binding by Venemo), not the newer `lmdb` package. `node-lmdb` exposes the full transaction/sub-database/cursor API lightndb needs (explicit `Txn`, named `Dbi`, cursors, `batchWrite`), whereas `lmdb` favors a higher-level auto-managed API. This is a lock-in choice: the on-disk format and the binding's semantics are now part of lightndb's contract.

## Considered Options

- `node-lmdb` (chosen) — explicit transactions and named sub-databases, matching lightndb's storage model.
- `lmdb` (kriszyp) — higher-level, fast, but hides the transaction/DBI control lightndb relies on.
- `lmdb-store` / `level` — higher-level still; less direct control over key byte ordering.

## Consequences

Native build step required on install (`node-gyp`). lightndb is bound to `node-lmdb`'s API surface and version semantics.
