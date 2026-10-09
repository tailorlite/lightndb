Role: Expert Node.js Database Architect and Engineer

Task:
Build a lightweight, schemaless, local JSON database library named `lightndb` in Node.js. 
The library will wrap `lmdb` (using the `node-lmdb` npm package) for high-performance key-value storage, providing a MongoDB-like query interface and API surface.

---

### Key Requirements & API Surface

1. Initialization & Connection
   - Synchronous or asynchronous connection initialization accepting a directory path.
   - Example:
     ```javascript
     const lightndb = require('lightndb');
     const db = lightndb.connect('./path.db');
     ```

2. Collection Interface
   - Dynamic collection access using `db.collection('collection_name')`.
   - Schemaless design: Stores arbitrary JSON objects. Every document stored must automatically be assigned a unique `_id` field if not provided (e.g., using UUID v4 or ULID).

3. MongoDB-like API Operations
    Implement the following asynchronous methods on collections:
    - `insert(doc)` / `insertMany([doc1, doc2, ...])`: Inserts documents into LMDB and updates indexes.
   - `find(query)`: Returns a cursor or promise resolving to an array of matching documents.
   - `findOne(query)`: Returns the first matching document.
   - `update(query, updateDoc, options)` / `updateMany(...)`: Supports operators like `$set`, `$unset`, `$inc`, and `$push`.
    - `remove(query)` / `deleteMany(query)`: Deletes matching documents and cleans up their index entries.

4. CLI Shell
   - Provide a `lightn` CLI command.
   - Usage should be simple:
     ```bash
     lightn 'path/db'
     ```
   - Starting the command opens an interactive prompt:
     ```text
     lightn>
     ```
   - The prompt should support mongosh-like commands against the opened Database, including `db.collection('users').find({})`, `db.users.find({})`, `insertOne`, `insertMany`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `count`, `show collections`, `help`, and `exit`.
   - The prompt should support vector search commands after an Embedding Model and Vector Index have been configured: `db.users.search('text')`, `db.collection('users').search('text')`, and Database-wide `db.search('text')`.
   - The prompt should support a CLI-only vector inspection helper: `db.users.showVector(selector)` / `db.collection('users').showVector(selector)`. It finds Documents matching the Selector and returns `{ _id, field, value, vector }`, where `field` is the Vector Index field, `value` is the indexed field value, and `vector` is the stored embedding encoded as base64.
   - Once `db.setEmbedding(modelPath)` has been called for a Database, persist the Embedding Model path in Database metadata. Reopening the same Database should allow Vector Search without calling `setEmbedding(modelPath)` again; the Embedding Model should be reloaded lazily when Vector Search first needs it.
   - The CLI shell must not implicitly create a Collection when accessing a missing Collection with property syntax or `db.collection(name)`. For example, `db.userbbb.find({})` should report a mongosh-like missing Collection error instead of creating `userbbb`. New Collections are created explicitly with `db.createCollection(name)`.

5. MongoDB Query Engine Support
   Implement basic MongoDB query selector support:
   - Equality & primitive comparisons: `{ age: 30 }`
   - Comparison operators: `$gt`, `$gte`, `$lt`, `$lte`, `$ne`, `$in`, `$nin`
   - Logical operators: `$and`, `$or`, `$not`
   - Array/Nested field dot notation support: `{ 'profile.name': 'Alice' }`

6. Indexing Support
   Implement secondary indexing using separate LMDB sub-databases or key prefixes to allow fast lookups on indexed fields:
   - Single-field indexing: `user.createIndex('field')`
   - Compound indexing: `user.createIndex('field1', 'field2', ...)`
   - The query planner should check if an index exists for a query field before falling back to a full collection scan.

---

### Technical Architecture & Implementation Steps

1. Underlying LMDB Storage Model
   - Store documents under a dedicated namespace or sub-database: key = `${collection}:${_id}`, value = JSON stringified object (or binary encoded with MsgPack/Buffer).
   - Index keys should be structured for range scanning in LMDB, e.g., `idx:${collection}:${fieldsJoined}:${indexedValue}:${_id}`.

2. Code Base Structure
   Organize the codebase into modular components:
   - `Database.js`: Manages LMDB environment instances and collection instantiation.
   - `Collection.js`: Exposes document CRUD methods and handles index creation.
   - `QueryEngine.js`: Evaluates MongoDB query objects against JSON documents.
   - `IndexManager.js`: Handles building, updating, and querying secondary indexes on write/read operations.

3. Dependencies
   - Use `lmdb` (node-lmdb wrapper) as the core engine.
   - Minimal external dependencies for query evaluation (e.g., a lightweight matcher or a custom recursive matcher).

---

### Output Requirements
1. Provide a clean, modular, modern JavaScript (ES6+ / CommonJS or ESM) implementation.
2. Include JSDoc annotations for all core methods.
3. Include unit tests using standard test runners (e.g., Jest or Node test runner) demonstrating connection, creation of single and compound indexes, insertion, and query execution matching the MongoDB syntax.
