# lightndb

A lightweight, schemaless, local JSON document database for Node.js, wrapping LMDB for high-performance key-value storage and exposing a MongoDB-like query API with built-in vector search support.

## Features

- **MongoDB-like API** — `insert`, `find`, `update`, `delete`, `createIndex`, `search`
- **High-performance storage** — Powered by LMDB (Lightning Memory-Mapped Database)
- **Secondary indexes** — Single-field and compound indexes with unique constraints
- **Vector search** — Semantic search via `sqlite-vec` and local embedding models (GGUF via `node-llama-cpp`)
- **Zero-config** — Single directory on disk, no server process
- **ACID transactions** — Full transactional writes with a single-writer mutex
- **Schemaless** — Store any JSON document, indexes adapt automatically
- **CLI shell** — Interactive REPL (`lightn`) for exploration and debugging

## Installation

```bash
npm install lightndb
```

> **Note:** `better-sqlite3` and `node-llama-cpp` are native dependencies. On Windows, you may need Python and Visual Studio Build Tools for compilation, or use the prebuilt binaries which are included.

## Quick Start

```javascript
const { connect } = require('lightndb');
const path = require('path');

// Connect to (or create) a database
const db = connect(path.join(__dirname, 'my-db'));

const users = await db.createCollection('users');

// Insert documents
await users.insertMany([
  { name: 'Ada', email: 'ada@example.com', active: true, score: 42 },
  { name: 'Grace', email: 'grace@example.com', active: true, score: 9000 },
  { name: 'Alan', email: 'alan@example.com', active: false, score: 10 }
]);

// Query with MongoDB-like selectors
const activeUsers = await users.find({ active: true });
const highScorers = await users.find({ score: { $gt: 100 } });
const ada = await users.findOne({ name: 'Ada' });

// Create indexes for faster queries
await users.createIndex('email', { unique: true });
await users.createIndex(['active', 'score']); // compound index

// Update documents
await users.updateOne({ name: 'Ada' }, { $set: { score: 100 } });
await users.updateMany({ active: false }, { $inc: { score: 1 } });

// Delete documents
await users.deleteOne({ name: 'Alan' });

// Close when done
db.close();
```

## Vector Search (Semantic Search)

lightndb supports vector search for semantic similarity queries. You'll need a GGUF embedding model (e.g., `nomic-embed-text`, `all-MiniLM-L6-v2`).

```javascript
const { connect } = require('lightndb');
const path = require('path');

const db = connect(path.join(__dirname, 'my-db'));

// Load a local embedding model (GGUF format)
await db.setEmbedding('./models/nomic-embed-text-v1.5.f16.gguf');

const docs = db.collection('documents');

// Create a vector index on a text field
await docs.createVectorIndex('content');

// Insert documents with text content
await docs.insertMany([
  { title: 'Intro to LMDB', content: 'LMDB is a fast key-value store...' },
  { title: 'Vector search basics', content: 'Vector search uses embeddings...' },
  { title: 'Node.js performance', content: 'V8 optimizations for speed...' }
]);

// Semantic search - finds documents by meaning, not keywords
const results = await docs.search('how to make database fast', { limit: 5 });
// Returns documents ranked by semantic similarity
```

### CLI Vector Search

```bash
lightn ./my-db
lightn> await db.setEmbedding('./models/nomic-embed-text-v1.5.f16.gguf')
lightn> await db.docs.createVectorIndex('content')
lightn> db.docs.search('database performance')
```

## CLI Shell

lightndb includes an interactive shell for database exploration:

```bash
# Start the shell
npx lightn ./path/to/db

# Or if installed globally
lightn ./path/to/db
```

### Shell Commands

```javascript
// Collection access
db.users.find({ active: true })
db.users.findOne({ name: 'Ada' })
db.users.insertOne({ name: 'New User', active: true })
db.users.insertMany([{ name: 'A' }, { name: 'B' }])
db.users.updateOne({ name: 'Ada' }, { $set: { score: 100 } })
db.users.updateMany({ active: true }, { $inc: { score: 1 } })
db.users.deleteOne({ name: 'Ada' })
db.users.deleteMany({ active: false })
db.users.count({ active: true })

// Indexes
await db.users.createIndex('email', { unique: true })
await db.users.createIndex(['name', 'age'])
await db.users.dropIndex('email')

// Vector search
await db.setEmbedding('./model.gguf')
await db.users.createVectorIndex('bio')
db.users.search('semantic query')

// Utilities
show collections
help
exit
```

## API Reference

### `connect(dbPath, options?)`

Creates a database connection.

```javascript
const db = connect('./my-db', {
  mapSize: 1073741824 // 1GB, default
});
```

### `db.createCollection(name)`

Creates or gets a collection.

```javascript
const users = await db.createCollection('users');
```

### `db.collection(name)`

Gets an existing collection (throws if not exists).

```javascript
const users = db.collection('users');
```

### `db.listCollections()`

Lists all collection names.

```javascript
const names = db.listCollections(); // ['users', 'posts', ...]
```

### `db.setEmbedding(modelPath)`

Loads a GGUF embedding model for vector search.

```javascript
await db.setEmbedding('./models/nomic-embed-text-v1.5.f16.gguf');
```

### `db.search(queryText, options?)`

Searches across all collections with vector indexes.

```javascript
const results = await db.search('meaning of life', { limit: 10 });
```

### Collection Methods

| Method | Description |
|--------|-------------|
| `insert(doc)` | Insert single document, returns doc with `_id` |
| `insertMany(docs)` | Insert multiple documents |
| `find(query, options?)` | Find all matching documents |
| `findOne(query, options?)` | Find first matching document |
| `update(query, updateDoc, options?)` | Update first match (options: `upsert`) |
| `updateMany(query, updateDoc, options?)` | Update all matches |
| `deleteOne(query)` | Delete first match |
| `deleteMany(query)` | Delete all matches |
| `remove(query)` | Alias for `deleteMany` |
| `count(query)` | Count matching documents |
| `createIndex(fieldOrFields, options?)` | Create index (`unique: true` for unique) |
| `dropIndex(name)` | Drop index by name |
| `createVectorIndex(field)` | Create vector index for semantic search |
| `search(queryText, options?)` | Semantic search on vector index |
| `showVector(selector?)` | Show vector embeddings for documents |

### Query Selectors

MongoDB-compatible query syntax:

```javascript
// Comparison
{ age: { $gt: 18, $lte: 65 } }
{ status: { $in: ['active', 'pending'] } }
{ tags: { $all: ['featured', 'tutorial'] } }

// Logical
{ $and: [{ active: true }, { score: { $gt: 100 } }] }
{ $or: [{ name: 'Ada' }, { name: 'Grace' }] }
{ $not: { age: { $lt: 18 } } }

// Existence
{ email: { $exists: true } }
{ nickname: { $exists: false } }

// Regex
{ name: { $regex: '^A', $options: 'i' } }

// Dot notation for nested fields
{ 'address.city': 'Seattle' }
{ 'scores.math': { $gt: 90 } }
```

### Find Options

```javascript
await users.find(query, {
  sort: { score: -1, name: 1 },  // -1 = desc, 1 = asc
  limit: 10,
  skip: 20,
  projection: { name: 1, email: 1, _id: 0 }  // include/exclude fields
});
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        lightndb                              │
├─────────────────────────────────────────────────────────────┤
│  Database (connect)                                          │
│  ├── Collections (createCollection, collection)              │
│  │   ├── Documents (CRUD)                                    │
│  │   ├── Indexes (createIndex, dropIndex)                    │
│  │   │   ├── Single-field indexes                            │
│  │   │   └── Compound indexes (prefix queries)               │
│  │   └── Vector Indexes (createVectorIndex, search)          │
│  │       └── Powered by sqlite-vec + node-llama-cpp          │
│  └── Storage                                                 │
│      ├── LMDB Environment (docs, indexes, meta DBIs)         │
│      └── SQLite (vectors.db for embeddings)                  │
└─────────────────────────────────────────────────────────────┘
```

See [docs/01-architecture.md](docs/01-architecture.md) for detailed architecture documentation.

## Documentation

- [Architecture](docs/01-architecture.md)
- [Storage Model](docs/02-storage-model.md)
- [Indexing](docs/03-indexing.md)
- [Query Engine](docs/04-query-engine.md)
- [Concurrency & Transactions](docs/05-concurrency-and-transactions.md)
- [API Reference](docs/06-api-reference.md)
- [ADRs](docs/adr/)

## Requirements

- Node.js 18+
- For vector search: GGUF embedding model (e.g., from [Hugging Face](https://huggingface.co/models?library=gguf&sort=downloads&search=nomic-embed))

## License

MIT