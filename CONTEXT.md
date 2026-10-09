# lightndb

A lightweight, schemaless, local JSON document database for Node.js, wrapping LMDB for storage and exposing a MongoDB-like query API.

## Language

**Database**:
A connection to a single LMDB environment on disk; the root object returned by `connect()`.
_Avoid_: store, instance, connection (when meaning the object)

**Collection**:
A named, schemaless container of Documents within a Database.
_Avoid_: table, bucket, store

**Document**:
A JSON object stored in a Collection. Every Document carries an `_id`.
_Avoid_: record, row, entity

**`_id`**:
The immutable, unique identifier of a Document within its Collection. Assigned on insert when absent.
_Avoid_: key, uuid, id (when meaning this field)

**Index**:
A secondary lookup structure over one or more fields of a Collection's Documents, kept in sync on every write.
_Avoid_: index entry, secondary index (when meaning the structure itself)

**Index Entry**:
A single key/value pair in an Index, mapping one indexed field value (or value tuple) to one `_id`.
_Avoid_: index row, posting

**Compound Index**:
An Index over more than one field, queried by leading-field prefix.
_Avoid_: composite index, multi-key index ("multi-key" means array-valued in MongoDB)

**Unique Index**:
An Index that forbids two Documents from sharing the same indexed value.
_Avoid_: constraint, unique key

**Selector**:
A MongoDB-like query object tested against a Document to decide whether it matches.
_Avoid_: query object, filter, matcher (when meaning the object)

**Operator**:
A reserved key beginning with `$` inside a Selector (e.g. `$gt`, `$in`) or an Update Document (e.g. `$set`).
_Avoid_: function, command, clause

**Update Document**:
An object describing how to modify matching Documents, using Operators like `$set`/`$inc`.
_Avoid_: patch, mutation, delta

**Query Planner**:
The logic that decides, for a given Selector, whether to use an Index or scan the whole Collection.
_Avoid_: optimizer

**Value Encoder**:
The transform from a field value to a byte sequence that sorts in the value's natural order.
_Avoid_: serializer (that is for whole Documents), codec

**Embedding Model**:
A local AI model (usually GGUF format) loaded via `node-llama-cpp` to generate dense vector embeddings from text fields.

**Vector Index**:
An index mapping a Document `_id` to its vector embedding, stored in a supplementary `better-sqlite3` database powered by `sqlite-vec`.

**Vector Search**:
A similarity search (`collection.search(text)`) that computes the embedding of the query and finds nearest neighbors in the Vector Index, returning the matched Documents.

## LMDB-backed terms (as used by lightndb)

**Environment**:
The on-disk LMDB store; the unit holding one or more Sub-databases and the memory map.
_Avoid_: env (in prose), store (collides with Database)

**Sub-database (DBI)**:
A named, independently sorted key-space inside an Environment.
_Avoid_: table, bucket

**Write Transaction**:
A single atomic, isolated unit of writes; at most one may be open on an Environment at a time.
_Avoid_: txn (in prose), unit of work

**MapFull**:
The condition where the Environment's preallocated size is exhausted.
_Avoid_: out of space, disk full
