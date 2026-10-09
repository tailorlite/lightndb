# Concurrency & transactions

## LMDB's model

LMDB is single-writer, multi-reader: at most one **write** transaction may be open on an Environment at a time; any number of **read-only** transactions may run concurrently (MVCC, lock-free). `node-lmdb` honors this — `beginTxn()` for a second writer blocks until the first commits or aborts.

## Write mutex

lightndb wraps every write in an internal **async mutex** owned by `Database`:

1. The write method (`insert` / `insertMany` / `update` / `updateMany` / `remove` / `deleteMany` / `createIndex`) acquires the mutex.
2. Opens a read-write Write Transaction via the `txn` helper (which guarantees `abort` on throw).
3. Does all its work (Document writes **and** Index reconciliation).
4. Commits; releases the mutex; resolves the promise.

Because LMDB already serializes writers, the mutex mainly prevents unmanaged `beginTxn` calls from blocking one another on the event loop and gives clean, ordered error handling.

## Batch atomicity

`insertMany`, `updateMany`, and `deleteMany` do **all** their work in a single transaction. A failure at any point aborts the transaction and the batch has **no partial effect** — no half-written Documents, no dangling Index entries. This is the main correctness guarantee of the write path.

## Reads

Reads (`find`, `findOne`, `count`) open a short **read-only** transaction (`beginTxn({ readOnly: true })`), do their cursor/`get` work, and abort/commit immediately. They never touch the write mutex and never block writers — the sole exception is an in-progress `mapSize` auto-grow, which briefly pauses both reads and writes to drain transactions (see below). lightndb does **not** reuse read transactions across calls in v1 (simple and safe; a read-transaction pool is a later optimization).

## Error handling and MapFull

- A thrown error inside a write aborts the transaction (guaranteed by the `txn` helper) and rejects the promise.
- Duplicate `_id` and Unique Index violations throw `DuplicateKeyError` before commit.
- If the Environment's `mapSize` is exhausted, `commit()` raises `MDB_MAP_FULL`. lightndb does **not** surface this to the caller; it auto-grows (ADR-0008):

  1. Abort the failing transaction (no partial state).
  2. Acquire a **stop-the-world barrier**: hold the write mutex and wait for all in-flight read-only transactions to finish, briefly blocking new reads and writes.
  3. Call `env.resize(currentMapSize * 2)` — `node-lmdb` exposes `Env.resize`, valid only with no active transactions, which the barrier guarantees. DBI handles stay valid; no Sub-databases are reopened.
  4. Release the barrier and retry the original operation.

  A `MapFullError` is thrown only as a last resort: if `resize()` fails or a caller-supplied size cap is reached.

## Closing

`db.close()` closes the Sub-databases and the Environment. After `close()`, further operations throw. `close()` is idempotent.
