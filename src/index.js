const { open } = require('lmdb');
const { ulid } = require('ulid');
const fs = require('fs');
const path = require('path');
const DatabaseSq = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');
const { match, resolvePath } = require('./query.js');
const { encodeValue } = require('./encoding.js');

function updateDocument(doc, updateDoc) {
  let changed = false;

  if (updateDoc.$set) {
    for (const [k, v] of Object.entries(updateDoc.$set)) {
      if (doc[k] !== v) {
        doc[k] = v;
        changed = true;
      }
    }
  }
  if (updateDoc.$unset) {
    for (const k of Object.keys(updateDoc.$unset)) {
      if (doc.hasOwnProperty(k)) {
        delete doc[k];
        changed = true;
      }
    }
  }
  if (updateDoc.$inc) {
    for (const [k, v] of Object.entries(updateDoc.$inc)) {
      if (typeof doc[k] === 'number') {
        doc[k] += v;
        changed = true;
      } else if (doc[k] === undefined) {
        doc[k] = v;
        changed = true;
      } else {
        throw new Error(`$inc target is not a number: ${k}`);
      }
    }
  }
  if (updateDoc.$push) {
    for (const [k, v] of Object.entries(updateDoc.$push)) {
      if (!doc[k]) doc[k] = [];
      if (!Array.isArray(doc[k])) throw new Error(`$push target is not an array: ${k}`);
      doc[k].push(v);
      changed = true;
    }
  }

  return changed;
}

class Collection {
  constructor(name, db) {
    this.name = name;
    this.db = db;
    this.indexes = [];
    this.loadIndexes();
  }

  loadIndexes() {
    this.indexes = [];
    this.vectorIndexes = [];
    const prefix = Buffer.from(`indexes\0${this.name}\0`, 'utf8');
    for (const { key, value } of this.db.metaDbi.getRange({ start: prefix })) {
      if (key.length < prefix.length || !key.slice(0, prefix.length).equals(prefix)) break;
      this.indexes.push(JSON.parse(value.toString('utf8')));
    }

    const vecPrefix = Buffer.from(`vec_indexes\0${this.name}\0`, 'utf8');
    for (const { key, value } of this.db.metaDbi.getRange({ start: vecPrefix })) {
      if (key.length < vecPrefix.length || !key.slice(0, vecPrefix.length).equals(vecPrefix)) break;
      this.vectorIndexes.push(JSON.parse(value.toString('utf8')));
    }
  }

  async createVectorIndex(field) {
    await this.db.ensureEmbedding();
    if (!this.db.embeddingContext) {
      throw new Error('Embedding model not set. Call db.setEmbedding(modelPath) first.');
    }
    
    const dim = this.db.embeddingModel.embeddingVectorSize || 1536;
    const name = field;
    const tableName = `vec_${this.name}_${name}`;

    const indexDef = {
      name,
      field,
      dim,
      tableName,
      createdAt: Date.now()
    };

    // Ensure SQLite table exists
    this.db.sqlite.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING vec0(id TEXT PRIMARY KEY, vector float[${dim}])`);

    await this.db.writeMutex(async () => {
      await this.db.env.transaction(async () => {
        const metaKey = Buffer.from(`vec_indexes\0${this.name}\0${name}`, 'utf8');
        if (this.db.metaDbi.get(metaKey)) return;

        await this.db.metaDbi.put(metaKey, Buffer.from(JSON.stringify(indexDef), 'utf8'));
        this.vectorIndexes.push(indexDef);

        // Backfill needs to happen sequentially and without holding the mutex ideally, 
        // but for simplicity in v1, we generate embeddings while holding it. 
        // A real system might split this up.
      });
    });

    // Backfill outside of the main transaction to avoid long LMDB locks
    const docsToEmbed = [];
    const prefix = Buffer.from(`${this.name}\0`, 'utf8');
    for (const { key, value } of this.db.docsDbi.getRange({ start: prefix })) {
      if (key.length < prefix.length || !key.slice(0, prefix.length).equals(prefix)) break;
      const doc = JSON.parse(value.toString('utf8'));
      if (typeof doc[field] === 'string') {
        docsToEmbed.push(doc);
      }
    }

    if (docsToEmbed.length > 0) {
      const stmt = this.db.sqlite.prepare(`INSERT OR REPLACE INTO ${tableName} (id, vector) VALUES (?, ?)`);
      for (const doc of docsToEmbed) {
        const emb = await this.db.getEmbedding(doc[field]);
        if (emb) {
          stmt.run(doc._id, emb);
        }
      }
    }

    return { name };
  }

  async search(queryText, options = {}) {
    await this.db.ensureEmbedding();
    if (!this.db.embeddingContext) throw new Error('Embedding model not set');
    if (this.vectorIndexes.length === 0) throw new Error('No vector indexes created on this collection');
    
    const indexesToSearch = options.vectorIndex
      ? this.vectorIndexes.filter(idx => idx.name === options.vectorIndex || idx.field === options.vectorIndex)
      : this.vectorIndexes;

    if (indexesToSearch.length === 0) throw new Error(`Vector index '${options.vectorIndex}' not found`);

    const emb = await this.db.getEmbedding(queryText);
    if (!emb) return [];

    const limit = options.limit || 10;
    const idToDistance = new Map();

    for (const vecIdx of indexesToSearch) {
      const stmt = this.db.sqlite.prepare(`
        SELECT id, distance
        FROM ${vecIdx.tableName}
        WHERE vector MATCH ?
        ORDER BY distance
        LIMIT ?
      `);
      
      const rows = stmt.all(emb, limit);
      for (const row of rows) {
        if (!idToDistance.has(row.id) || row.distance < idToDistance.get(row.id)) {
          idToDistance.set(row.id, row.distance);
        }
      }
    }

    const sortedIds = Array.from(idToDistance.entries())
      .sort((a, b) => a[1] - b[1])
      .slice(0, limit);

    const results = [];
    for (const [id, distance] of sortedIds) {
      const key = Buffer.from(`${this.name}\0${id}`, 'utf8');
      const val = this.db.docsDbi.get(key);
      if (val) {
        const doc = JSON.parse(val.toString('utf8'));
        doc._distance = distance;
        results.push(doc);
      }
    }
    return results;
  }
  async createIndex(fieldOrFields, options = {}) {
    const fields = Array.isArray(fieldOrFields) ? fieldOrFields : [fieldOrFields];
    const name = options.name || fields.join('__');
    const indexDef = {
      name,
      fields,
      unique: !!options.unique,
      createdAt: Date.now()
    };

    await this.db.writeMutex(async () => {
      await this.db.env.transaction(async () => {
        const metaKey = Buffer.from(`indexes\0${this.name}\0${name}`, 'utf8');
        if (this.db.metaDbi.get(metaKey)) return; // already exists

        await this.db.metaDbi.put(metaKey, Buffer.from(JSON.stringify(indexDef), 'utf8'));
        this.indexes.push(indexDef);

        // backfill
        const prefix = Buffer.from(`${this.name}\0`, 'utf8');
        for (const { key, value } of this.db.docsDbi.getRange({ start: prefix })) {
          if (key.length < prefix.length || !key.slice(0, prefix.length).equals(prefix)) break;
          const doc = JSON.parse(value.toString('utf8'));
          await this._addDocToIndexes(doc, [indexDef]);
        }
      });
    });

    return { name };
  }

  async dropIndex(name) {
    await this.db.writeMutex(async () => {
      await this.db.env.transaction(async () => {
        const metaKey = Buffer.from(`indexes\0${this.name}\0${name}`, 'utf8');
        if (!this.db.metaDbi.get(metaKey)) return;

        await this.db.metaDbi.remove(metaKey);
        this.indexes = this.indexes.filter(idx => idx.name !== name);

        // remove index entries
        const idxPrefix = Buffer.from(`${this.name}\0${name}\0`, 'utf8');
        for (const { key } of this.db.indexesDbi.getRange({ start: idxPrefix })) {
          if (key.length < idxPrefix.length || !key.slice(0, idxPrefix.length).equals(idxPrefix)) break;
          await this.db.indexesDbi.remove(key);
        }
      });
    });
    return { ok: true };
  }

  _computeIndexKeys(doc, indexDef) {
    const keys = [];
    const _idBuf = Buffer.from(doc._id, 'utf8');

    // cartesian product of values for multi-key (array) fields
    // simplified for v1: if any field is an array, we generate multiple keys
    const fieldValues = indexDef.fields.map(f => {
      const vals = resolvePath(doc, f);
      return vals.length === 0 ? [null] : vals;
    });

    // Generate cartesian product of field values
    const combine = (arrs, i = 0) => {
      if (i === arrs.length) return [[]];
      const rest = combine(arrs, i + 1);
      const res = [];
      for (const val of arrs[i]) {
        for (const r of rest) {
          res.push([val, ...r]);
        }
      }
      return res;
    };

    const tuples = combine(fieldValues);

    for (const tuple of tuples) {
      const parts = [Buffer.from(`${this.name}\0${indexDef.name}\0`, 'utf8')];
      for (const val of tuple) {
        parts.push(encodeValue(val));
      }
      const prefixBuf = Buffer.concat(parts);
      const fullKeyBuf = Buffer.concat([prefixBuf, _idBuf]);
      keys.push({ prefixBuf, fullKeyBuf });
    }

    return keys;
  }

  async _addDocToIndexes(doc, indexes = this.indexes) {
    for (const idx of indexes) {
      const keys = this._computeIndexKeys(doc, idx);
      for (const { prefixBuf, fullKeyBuf } of keys) {
        if (idx.unique) {
          // Check for existing entries with same prefix
          for (const { key: existingKey } of this.db.indexesDbi.getRange({ start: prefixBuf })) {
            if (existingKey.length >= prefixBuf.length && existingKey.slice(0, prefixBuf.length).equals(prefixBuf)) {
              // check if it's the same document
              const idStart = existingKey.length - Buffer.from(doc._id, 'utf8').length;
              const existingId = existingKey.slice(idStart).toString('utf8');
              if (existingId !== doc._id) {
                const err = new Error('DuplicateKeyError');
                err.name = 'DuplicateKeyError';
                throw err;
              }
            } else {
              break;
            }
          }
        }
        await this.db.indexesDbi.put(fullKeyBuf, Buffer.alloc(0));
      }
    }
  }

  async _removeDocFromIndexes(doc) {
    for (const idx of this.indexes) {
      const keys = this._computeIndexKeys(doc, idx);
      for (const { fullKeyBuf } of keys) {
        await this.db.indexesDbi.remove(fullKeyBuf);
      }
    }
  }

  async _syncVectorIndexes(doc, isDelete = false) {
    for (const vecIdx of this.vectorIndexes) {
      if (isDelete) {
        this.db.sqlite.prepare(`DELETE FROM ${vecIdx.tableName} WHERE id = ?`).run(doc._id);
        continue;
      }

      const text = doc[vecIdx.field];
      if (typeof text === 'string') {
        const emb = await this.db.getEmbedding(text);
        if (emb) {
          this.db.sqlite.prepare(`INSERT OR REPLACE INTO ${vecIdx.tableName} (id, vector) VALUES (?, ?)`).run(doc._id, emb);
        }
      } else {
        this.db.sqlite.prepare(`DELETE FROM ${vecIdx.tableName} WHERE id = ?`).run(doc._id);
      }
    }
  }

  async insert(doc) {
    const _id = doc._id || ulid();
    const newDoc = { ...doc, _id };
    
    // Compute embeddings before acquiring the LMDB lock
    const embeddings = {};
    for (const vecIdx of this.vectorIndexes) {
      const text = newDoc[vecIdx.field];
      if (typeof text === 'string') {
        embeddings[vecIdx.tableName] = await this.db.getEmbedding(text);
      }
    }

    await this.db.writeMutex(async () => {
      const key = Buffer.from(`${this.name}\0${_id}`, 'utf8');
      if (this.db.docsDbi.get(key) !== undefined) {
        const err = new Error('DuplicateKeyError');
        err.name = 'DuplicateKeyError';
        throw err;
      }
      await this._addDocToIndexes(newDoc);
      await this.db.docsDbi.put(key, Buffer.from(JSON.stringify(newDoc), 'utf8'));
      
      // Write to sqlite
      for (const vecIdx of this.vectorIndexes) {
        const emb = embeddings[vecIdx.tableName];
        if (emb) {
          this.db.sqlite.prepare(`INSERT OR REPLACE INTO ${vecIdx.tableName} (id, vector) VALUES (?, ?)`).run(_id, emb);
        }
      }
    });

    return newDoc;
  }

  async insertMany(docs) {
    const results = [];
    const precomputed = [];
    for (const doc of docs) {
      const _id = doc._id || ulid();
      const newDoc = { ...doc, _id };
      const embeddings = {};
      for (const vecIdx of this.vectorIndexes) {
        const text = newDoc[vecIdx.field];
        if (typeof text === 'string') {
          embeddings[vecIdx.tableName] = await this.db.getEmbedding(text);
        }
      }
      precomputed.push({ newDoc, embeddings });
    }

    await this.db.writeMutex(async () => {
      await this.db.env.transaction(async () => {
        for (const { newDoc, embeddings } of precomputed) {
          const _id = newDoc._id;
          const key = Buffer.from(`${this.name}\0${_id}`, 'utf8');
          if (this.db.docsDbi.get(key) !== undefined) {
            const err = new Error('DuplicateKeyError');
            err.name = 'DuplicateKeyError';
            throw err;
          }
          await this._addDocToIndexes(newDoc);
          await this.db.docsDbi.put(key, Buffer.from(JSON.stringify(newDoc), 'utf8'));
          
          for (const vecIdx of this.vectorIndexes) {
            const emb = embeddings[vecIdx.tableName];
            if (emb) {
              this.db.sqlite.prepare(`INSERT OR REPLACE INTO ${vecIdx.tableName} (id, vector) VALUES (?, ?)`).run(_id, emb);
            }
          }
          results.push(newDoc);
        }
      });
    });
    return results;
  }

  async findOne(query, options = {}) {
    if (query._id && Object.keys(query).length === 1) {
      const key = Buffer.from(`${this.name}\0${query._id}`, 'utf8');
      const val = this.db.docsDbi.get(key);
      if (val) {
        let doc = JSON.parse(val.toString('utf8'));
        if (options.projection) {
          const isInclude = Object.values(options.projection).some(v => v === 1);
          if (isInclude) {
            const p = { _id: doc._id };
            for (const k of Object.keys(options.projection)) {
              if (options.projection[k] === 1 && doc[k] !== undefined) p[k] = doc[k];
            }
            doc = p;
          } else {
            for (const k of Object.keys(options.projection)) {
              if (options.projection[k] === 0) delete doc[k];
            }
          }
        }
        return doc;
      }
      return null;
    }
    
    const docs = await this.find(query, { ...options, limit: 1 });
    return docs.length > 0 ? docs[0] : null;
  }

  async find(query, options = {}) {
    const results = [];
    const prefix = Buffer.from(`${this.name}\0`, 'utf8');
    
    // In v1, we can do a full scan, but query planner would pick an index here.
    // For simplicity, sticking to full scan as fallback is valid per spec.
    for (const { key, value } of this.db.docsDbi.getRange({ start: prefix })) {
      if (key.length < prefix.length || !key.slice(0, prefix.length).equals(prefix)) break;
      const doc = JSON.parse(value.toString('utf8'));
      if (match(doc, query)) {
        results.push(doc);
      }
    }

    if (options.sort) {
      const keys = Object.keys(options.sort);
      results.sort((a, b) => {
        for (const k of keys) {
          const dir = options.sort[k];
          const va = a[k];
          const vb = b[k];
          if (va < vb) return -1 * dir;
          if (va > vb) return 1 * dir;
        }
        return 0;
      });
    }

    let start = 0;
    let end = results.length;

    if (options.skip) {
      start = options.skip;
    }
    if (options.limit) {
      end = start + options.limit;
    }
    
    let sliced = results.slice(start, end);

    if (options.projection) {
      const isInclude = Object.values(options.projection).some(v => v === 1);
      sliced = sliced.map(doc => {
        if (isInclude) {
          const p = { _id: doc._id };
          for (const k of Object.keys(options.projection)) {
            if (options.projection[k] === 1 && doc[k] !== undefined) p[k] = doc[k];
          }
          return p;
        } else {
          const p = { ...doc };
          for (const k of Object.keys(options.projection)) {
            if (options.projection[k] === 0) delete p[k];
          }
          return p;
        }
      });
    }

    return sliced;
  }

  async update(query, updateDoc, options = {}) {
    let matchedCount = 0;
    let modifiedCount = 0;
    let upsertedId = null;

    await this.db.writeMutex(async () => {
      await this.db.env.transaction(async () => {
        const prefix = Buffer.from(`${this.name}\0`, 'utf8');
        let matched = false;
        for (const { key, value } of this.db.docsDbi.getRange({ start: prefix })) {
          if (key.length < prefix.length || !key.slice(0, prefix.length).equals(prefix)) break;
          const oldDoc = JSON.parse(value.toString('utf8'));
          const doc = JSON.parse(value.toString('utf8'));
          if (match(doc, query)) {
            matched = true;
            matchedCount++;
            
            const changed = updateDocument(doc, updateDoc);

            if (changed) {
              modifiedCount++;
              await this._removeDocFromIndexes(oldDoc);
              await this._addDocToIndexes(doc);
              await this.db.docsDbi.put(key, Buffer.from(JSON.stringify(doc), 'utf8'));
            }
            break; // update first match only
          }
        }

        if (!matched && options.upsert) {
          const _id = query._id || ulid();
          const newDoc = { ...query, _id };
          if (updateDoc.$set) {
            Object.assign(newDoc, updateDoc.$set);
          }
          const key = Buffer.from(`${this.name}\0${_id}`, 'utf8');
          await this._addDocToIndexes(newDoc);
          await this.db.docsDbi.put(key, Buffer.from(JSON.stringify(newDoc), 'utf8'));
          upsertedId = _id;
        }
      });
    });

    return { matchedCount, modifiedCount, upsertedId };
  }

  async updateMany(query, updateDoc, options = {}) {
    let matchedCount = 0;
    let modifiedCount = 0;
    let upsertedId = null;

    await this.db.writeMutex(async () => {
      await this.db.env.transaction(async () => {
        const prefix = Buffer.from(`${this.name}\0`, 'utf8');
        let matched = false;
        for (const { key, value } of this.db.docsDbi.getRange({ start: prefix })) {
          if (key.length < prefix.length || !key.slice(0, prefix.length).equals(prefix)) break;
          const oldDoc = JSON.parse(value.toString('utf8'));
          const doc = JSON.parse(value.toString('utf8'));
          if (match(doc, query)) {
            matched = true;
            matchedCount++;
            
            const changed = updateDocument(doc, updateDoc);

            if (changed) {
              modifiedCount++;
              await this._removeDocFromIndexes(oldDoc);
              await this._addDocToIndexes(doc);
              await this.db.docsDbi.put(key, Buffer.from(JSON.stringify(doc), 'utf8'));
            }
          }
        }

        if (!matched && options.upsert) {
          const _id = query._id || ulid();
          const newDoc = { ...query, _id };
          updateDocument(newDoc, updateDoc);
          const key = Buffer.from(`${this.name}\0${_id}`, 'utf8');
          await this._addDocToIndexes(newDoc);
          await this.db.docsDbi.put(key, Buffer.from(JSON.stringify(newDoc), 'utf8'));
          upsertedId = _id;
        }
      });
    });

    return { matchedCount, modifiedCount, upsertedId };
  }

  async remove(query) {
    return this.deleteMany(query);
  }

  async deleteOne(query) {
    let deletedCount = 0;
    await this.db.writeMutex(async () => {
      await this.db.env.transaction(async () => {
        const prefix = Buffer.from(`${this.name}\0`, 'utf8');
        for (const { key, value } of this.db.docsDbi.getRange({ start: prefix })) {
          if (key.length < prefix.length || !key.slice(0, prefix.length).equals(prefix)) break;
          const doc = JSON.parse(value.toString('utf8'));
          if (match(doc, query)) {
            await this._removeDocFromIndexes(doc);
            await this.db.docsDbi.remove(key);
            deletedCount = 1;
            break;
          }
        }
      });
    });
    return { deletedCount };
  }

  async deleteMany(query) {
    let deletedCount = 0;
    await this.db.writeMutex(async () => {
      await this.db.env.transaction(async () => {
        const prefix = Buffer.from(`${this.name}\0`, 'utf8');
        for (const { key, value } of this.db.docsDbi.getRange({ start: prefix })) {
          if (key.length < prefix.length || !key.slice(0, prefix.length).equals(prefix)) break;
          const doc = JSON.parse(value.toString('utf8'));
          if (match(doc, query)) {
            await this._removeDocFromIndexes(doc);
            await this.db.docsDbi.remove(key);
            deletedCount++;
          }
        }
      });
    });
    return { deletedCount };
  }

  async count(query) {
    let count = 0;
    const prefix = Buffer.from(`${this.name}\0`, 'utf8');
    for (const { key, value } of this.db.docsDbi.getRange({ start: prefix })) {
      if (key.length < prefix.length || !key.slice(0, prefix.length).equals(prefix)) break;
      const doc = JSON.parse(value.toString('utf8'));
      if (match(doc, query)) {
        count++;
      }
    }
    return count;
  }
}

class Database {
  constructor(env, docsDbi, indexesDbi, metaDbi, sqlite) {
    this.env = env;
    this.docsDbi = docsDbi;
    this.indexesDbi = indexesDbi;
    this.metaDbi = metaDbi;
    this.sqlite = sqlite;
    this.collections = new Map();
    this.writePromise = Promise.resolve();
    this.llama = null;
    this.embeddingModel = null;
    this.embeddingContext = null;
  }

  async setEmbedding(modelPath) {
    const { getLlama } = await import('node-llama-cpp');
    this.llama = await getLlama();
    this.embeddingModel = await this.llama.loadModel({ modelPath });
    this.embeddingContext = await this.embeddingModel.createEmbeddingContext();

    await this.writeMutex(async () => {
      await this.metaDbi.put(Buffer.from('embedding_model_path', 'utf8'), Buffer.from(modelPath, 'utf8'));
    });
  }

  getEmbeddingModelPath() {
    const value = this.metaDbi.get(Buffer.from('embedding_model_path', 'utf8'));
    return value ? value.toString('utf8') : null;
  }

  async ensureEmbedding() {
    if (this.embeddingContext) return;
    const modelPath = this.getEmbeddingModelPath();
    if (!modelPath) return;

    const { getLlama } = await import('node-llama-cpp');
    this.llama = await getLlama();
    this.embeddingModel = await this.llama.loadModel({ modelPath });
    this.embeddingContext = await this.embeddingModel.createEmbeddingContext();
  }

  async getEmbedding(text) {
    if (!this.embeddingContext) return null;
    const embedding = await this.embeddingContext.getEmbeddingFor(text);
    return new Float32Array(embedding.vector);
  }

  async search(queryText, options = {}) {
    await this.ensureEmbedding();
    if (!this.embeddingContext) throw new Error('Embedding model not set');
    const emb = await this.getEmbedding(queryText);
    if (!emb) return [];

    for (const name of this.listCollections()) {
      this.collection(name);
    }

    let combined = [];
    for (const c of this.collections.values()) {
      if (c.vectorIndexes.length > 0) {
        const res = await c.search(queryText, options);
        combined = combined.concat(res);
      }
    }
    
    combined.sort((a, b) => a._distance - b._distance);
    if (options.limit) {
      combined = combined.slice(0, options.limit);
    }
    return combined;
  }

  async writeMutex(fn) {
    const next = this.writePromise.then(fn);
    this.writePromise = next.catch(() => {});
    return next;
  }

  collection(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Collection(name, this));
    }
    return this.collections.get(name);
  }

  async createCollection(name) {
    await this.writeMutex(async () => {
      const metaKey = Buffer.from(`collections\0${name}`, 'utf8');
      if (!this.metaDbi.get(metaKey)) {
        await this.metaDbi.put(metaKey, Buffer.alloc(0));
      }
    });

    return this.collection(name);
  }

  listCollections() {
    const names = new Set(this.collections.keys());

    const collectionPrefix = Buffer.from('collections\0', 'utf8');
    for (const { key } of this.metaDbi.getRange({ start: collectionPrefix })) {
      if (key.length < collectionPrefix.length || !key.slice(0, collectionPrefix.length).equals(collectionPrefix)) break;
      const name = key.slice(collectionPrefix.length).toString('utf8');
      if (name) names.add(name);
    }

    for (const { key } of this.docsDbi.getRange({ start: Buffer.alloc(0) })) {
      const [name] = key.toString('utf8').split('\0');
      if (name) names.add(name);
    }

    for (const { key } of this.metaDbi.getRange({ start: Buffer.alloc(0) })) {
      const parts = key.toString('utf8').split('\0');
      if ((parts[0] === 'indexes' || parts[0] === 'vec_indexes') && parts[1]) {
        names.add(parts[1]);
      }
    }

    return Array.from(names).sort();
  }

  close() {
    this.env.close();
    this.sqlite.close();
  }
}

function connect(dbPath, options = {}) {
  if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(dbPath, { recursive: true });
  }

  const env = open({
    path: dbPath,
    mapSize: options.mapSize || 1073741824,
    maxDbs: 10
  });

  const docsDbi = env.openDB({ name: 'docs', keyEncoding: 'binary', encoding: 'binary' });
  const indexesDbi = env.openDB({ name: 'indexes', keyEncoding: 'binary', encoding: 'binary' });
  const metaDbi = env.openDB({ name: 'meta', keyEncoding: 'binary', encoding: 'binary' });

  const sqlitePath = path.join(dbPath, 'vectors.db');
  const sqlite = new DatabaseSq(sqlitePath);
  sqliteVec.load(sqlite);

  return new Database(env, docsDbi, indexesDbi, metaDbi, sqlite);
}

module.exports = { connect };
