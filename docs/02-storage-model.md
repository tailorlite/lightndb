# Storage model

## Environment

`lightndb.connect(path, options?)` opens one LMDB Environment and a supplementary SQLite database for vector search.

Inside the provided `path` directory, the following files will be created:
- `data.mdb`: The main LMDB memory-mapped data file.
- `lock.mdb`: The LMDB concurrency lock file.
- `vectors.db`: The SQLite database storing vector embeddings (created automatically via `better-sqlite3`).

```
env.open({
  path,                                    // created with mkdirSync(recursive) if missing
  mapSize: options.mapSize ?? 1073741824,  // 1 GiB default; auto-grows on demand
  maxDbs: 10,                              // internal constant; lightndb uses 3 DBIs
});
```

- **`maxDbs` is an internal constant**, not a user option. lightndb uses a fixed 3 Sub-databases no matter how many Collections or Indexes exist (they are key prefixes, not DBIs), so `maxDbs` never needs to grow.
- **`mapSize` auto-grows.** It starts at 1 GiB (or the caller's `options.mapSize` override). On `MDB_MAP_FULL` at commit, lightndb aborts the transaction, drains all in-flight transactions, calls `env.resize(current * 2)`, and retries — DBI handles stay valid across the resize. See [concurrency](./05-concurrency-and-transactions.md) and [ADR-0008](./adr/0008-auto-grow-mapsize-on-mapfull.md). A `MapFullError` is now a last resort (resize failure or a caller cap), not the normal path.

## Sub-databases (DBIs)

All three are opened with `keyIsBuffer: true` so lightndb controls every key byte (required for correct Index ordering — `node-lmdb` exposes no custom comparator).

| DBI | Holds | Key | Value |
|-----|-------|-----|-------|
| `docs` | Documents | `coll\0_id` | UTF-8 JSON of the Document |
| `indexes` | Index entries | `coll\0idxName\0<encodedValues><_id>` | empty `Buffer` |
| `meta` | Collection/Index metadata | `collections\0coll` / `indexes\0coll\0idxName` | UTF-8 JSON metadata |

`\0` denotes the `0x00` byte. It is used as a namespace separator (e.g. separating the collection name from the index name). Within `<encodedValues>`, a FoundationDB-style Tuple encoding is used where fixed-width types don't need delimiters and variable-length strings are terminated by `0x00` (with internal `0x00` bytes escaped as `0x00 0xFF` to prevent collisions — see [indexing](./03-indexing.md)).

## Document serialization

```
put:  txn.putBinary(docsDbi, key, Buffer.from(JSON.stringify(doc), 'utf8'))
get:  JSON.parse(txn.getBinary(docsDbi, key).toString('utf8'))
```

UTF-8 JSON is roughly half the size of `node-lmdb`'s default UTF-16 string storage (ADR-0004). No external dependency.

## `_id`

- Generated as a **ULID** (26-char, lexicographically time-sortable) when absent (ADR-0003).
- Stored as the trailing segment of the `docs` key, so it is the primary sort order within a Collection.
- Uniqueness: an insert checks the `docs` key is absent before writing; a hit is a `DuplicateKeyError`.

## Namespacing

Everything is namespaced by Collection name as the leading key segment, so a single `docs` B-tree holds every Collection's Documents without collision. Listing a Collection's Documents is a cursor range-scan over the `coll\0` prefix (a `goToRange` plus prefix check).

## Metadata schema (`meta` Sub-database)

```
collections\0<coll>            -> { name, createdAt }            // created lazily on first access
indexes\0<coll>\0<idxName>     -> { fields: [...], unique: bool, createdAt }
```

Index names are derived from the field list joined by `__` (e.g. `name__age`). `meta` is the source of truth for "which Indexes exist"; `IndexManager` caches it in memory on `connect` and `createIndex`.
