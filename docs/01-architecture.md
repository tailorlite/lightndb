# Architecture

lightndb is organized into four modules over a thin LMDB wrapper. All modules are CommonJS; the package default-exports `{ connect }`.

## Components

- **Database** (`src/Database.js`) — owns the LMDB Environment and the fixed set of Sub-databases (`docs`, `indexes`, `meta`). Produces and caches Collection instances. Owns the write mutex and the stop-the-world quiescence barrier used to auto-grow `mapSize`. Exposes `connect`, `collection`, and `close`.
- **Collection** (`src/Collection.js`) — the user-facing CRUD surface (`insert`, `insertMany`, `find`, `findOne`, `update`, `updateMany`, `remove`, `deleteMany`, `createIndex`, `dropIndex`, `count`). Orchestrates the IndexManager and the QueryEngine.
- **QueryEngine** (`src/QueryEngine.js`) — a pure, side-effect-free matcher. Given a Document and a Selector, returns whether the Document matches. Also describes Selector shape to the Query Planner.
- **IndexManager** (`src/IndexManager.js`) — owns Index metadata (`meta` Sub-database), encodes/decodes Index keys, maintains Index entries on every write, and performs range scans for the Query Planner.

Two small helpers sit beneath these: a **txn helper** (`src/txn.js`) that wraps `beginTxn`/`commit`/`abort` with guaranteed cleanup, and a **WriteMutex** plus **read-quiescence barrier** (inside `Database`) that serialize Write Transactions and briefly pause all I/O during a `mapSize` auto-grow (ADR-0008).

## Request flow

### Insert: `c.insert({ name: 'Ada' })`

1. `Collection.insert` assigns `_id` (ULID) if absent and serializes the Document.
2. Acquires the write mutex; opens a read-write Write Transaction.
3. Checks the `docs` key `coll\0_id` is absent (duplicate-`_id` guard); `putBinary` the Document.
4. Asks `IndexManager` to insert Index entries for every Index on the Collection (with a uniqueness check per Unique Index).
5. Commits the transaction; releases the mutex; resolves with the Document.

### Find: `c.find({ age: { $gt: 18 } })`

1. `Collection.find` asks the Query Planner for an index plan.
2. If a usable Index exists, `IndexManager` opens a read-only transaction, range-scans the `indexes` Sub-database, collects `_id`s, fetches each Document, and post-filters with the `QueryEngine`.
3. Otherwise, full-scans the `docs` Sub-database over the `coll\0` prefix and filters with the `QueryEngine`.
4. Applies `sort`/`skip`/`limit`/`projection` in memory; resolves with the array.

### Update / remove

Find matching `_id`s first (via the planner), then within a single Write Transaction rewrite each Document and reconcile its Index entries.

## Layering rules

- `QueryEngine` never touches LMDB — it is pure and unit-testable without a Database.
- `Collection` is the only module users import; it orchestrates `IndexManager`, `QueryEngine`, and the `Database` transaction/mutex.
- The `node-lmdb` API is touched only inside `Database`, `IndexManager`, and `txn.js` — never in `QueryEngine` or `Collection` directly.
