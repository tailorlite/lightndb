# API reference

All Collection methods are **async** and return Promises, even though LMDB operations themselves are synchronous — the async surface keeps the write mutex and future I/O non-blocking for callers.

## `lightndb.connect(path, options?) -> Database`

```js
const lightndb = require('lightndb');
const db = lightndb.connect('./path.db');          // sizing is automatic
// optional: { mapSize } sets the initial size only
```

- `path` — directory for the LMDB Environment (created if missing).
- `options.mapSize` — optional initial Environment size in bytes (default 1 GiB). lightndb auto-grows beyond this on demand when the map fills (ADR-0008); this only sets the starting size.
- `maxDbs` is **not** exposed — it is an internal constant, since lightndb uses a fixed 3 Sub-databases regardless of Collection/Index count.
- Synchronously opens the Environment and the fixed Sub-databases; returns a `Database`.

## `db.collection(name) -> Collection`

Returns (and caches) the named Collection, creating it lazily on first access.

## CLI Shell

```bash
lightn 'path/db'
```

Starts an interactive shell against the Database at `path/db`:

```text
lightn>
```

The shell exposes the opened Database as `db` and supports mongosh-like Collection access:

```js
await db.collection('users').insertOne({ name: 'Ada', age: 36 })
await db.users.insertMany([{ name: 'Grace', age: 85 }])
await db.users.find({}).sort({ age: -1 }).limit(10)
await db.users.updateOne({ name: 'Ada' }, { $set: { active: true } })
await db.users.deleteOne({ name: 'Grace' })
await db.setEmbedding('./path/to/model.gguf')
await db.users.createVectorIndex('bio')
await db.users.search('systems programmer')
await db.collection('users').search('systems programmer')
await db.search('systems programmer')
await db.users.showVector({ _id: '...' })
```

Unlike the library API, the shell does not create Collections on first property access. Use `db.createCollection('users')` before writing to a new Collection. It prints `Collection 'users' created successfully` and persists the empty Collection name. Accessing a missing Collection, such as `db.userbbb.find({})`, reports an error instead of creating it.

`showVector(selector)` is a CLI-only helper. It finds Documents matching the Selector, then returns one item per matched Document per Vector Index: `{ _id, field, value, vector }`. `field` is the indexed field, `value` is that Document's field value, and `vector` is the stored embedding encoded as base64.

The shell also supports `show collections`, `help`, `exit`, `.exit`, and `quit`.

## Document CRUD

```js
await c.insert(doc)                                    // -> doc (with _id assigned)
await c.insertMany([doc, ...])                         // -> [doc, ...] (with _ids)
await c.find(query, { sort, limit, skip, projection })// -> [doc, ...]
await c.findOne(query, { projection })                // -> doc | null
await c.update(query, updateDoc, { upsert })           // first match -> { matchedCount, modifiedCount, upsertedId? }
await c.updateMany(query, updateDoc, { upsert })       // all matches -> { ... }
await c.remove(query)                                  // = deleteMany -> { deletedCount }
await c.deleteMany(query)                              // -> { deletedCount }
await c.count(query)                                   // -> number
```

- `insert` / `insertMany`: assign `_id` (ULID) when absent; throw `DuplicateKeyError` on `_id` collision.
- `find`: returns a Promise resolving to an array (no cursor in v1, ADR-0007). `sort` is `{ field: 1 | -1 }`; `projection` is `{ field: 1 }` (include) or `{ field: 0 }` (exclude).
- `findOne`: returns `null` when nothing matches.
- `update` / `updateMany`: `$set` supports dot-notation nested paths. `upsert: true` inserts when no match, returning `upsertedId`.

## Update Operators

| Operator | Behavior |
|----------|----------|
| `$set` | set a field (dot-notation supported) |
| `$unset` | remove a field |
| `$inc` | increment a number; error if the existing value isn't a number |
| `$push` | append to an array (creating it if absent) |

## Indexes

```js
await c.createIndex('age')                       // -> { name: 'age' }
await c.createIndex(['name', 'age'])             // -> { name: 'name__age' }
await c.createIndex('email', { unique: true })    // -> { name: 'email' }
await c.dropIndex('email')                        // -> { ok: true }
```

- Compound Index names are fields joined by `__`.
- Indexes are **ascending only**; a descending direction (`{ field: -1 }`) is not supported in v1.
- `unique: true` enforces uniqueness inside the Write Transaction (ADR-0006).
- `createIndex` back-fills existing Documents in one transaction.

## Vector Search (AI)

lightndb supports local AI semantic search via `node-llama-cpp` and `sqlite-vec`.

```js
await db.setEmbedding('./path/to/model.gguf');

// Create a vector index on a specific field
await c.createVectorIndex('description');

// Search within the collection
const results = await c.search('a query string', { limit: 5 });

// Search across the entire database (all collections)
const allResults = await db.search('a query string', { limit: 5 });
```

- `setEmbedding`: Initializes the Llama model and creates the embedding context.
- The Embedding Model path is stored in Database metadata. After reopening the same Database, `collection.search(...)`, `db.search(...)`, or `db.ensureEmbedding()` reloads that model automatically, so callers do not need to call `setEmbedding(...)` again.
- `createVectorIndex`: Back-fills embeddings for existing documents and sets up automatic syncing for future inserts/updates.
- `search`: Returns a list of matched documents ordered by similarity (nearest neighbors). Each result includes a `_distance` property.

## Errors

| Error | When |
|-------|------|
| `DuplicateKeyError` | `_id` collision or Unique Index violation |
| `MapFullError` | `mapSize` exhausted **and** auto-grow failed or hit a caller cap (rare — normally auto-grown, ADR-0008) |
| `Error` | any other failure; the Write Transaction is aborted |

## `db.close()`

Closes the Sub-databases and Environment. Idempotent.
