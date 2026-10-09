#!/usr/bin/env node

const readline = require('readline');
const util = require('util');
const { connect } = require('../src/index.js');
const { resolvePath } = require('../src/query.js');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const FIND_RESULT = Symbol('lightndb.findResult');

class ShellCursor {
  constructor(collection, selector = {}) {
    this.collection = collection;
    this.selector = selector || {};
    this.options = {};
  }

  sort(sort) {
    this.options.sort = sort;
    return this;
  }

  limit(limit) {
    this.options.limit = limit;
    return this;
  }

  skip(skip) {
    this.options.skip = skip;
    return this;
  }

  project(projection) {
    this.options.projection = projection;
    return this;
  }

  projection(projection) {
    return this.project(projection);
  }

  async count() {
    return this.collection.count(this.selector);
  }

  async forEach(fn) {
    for (const doc of await this.toArray()) {
      await fn(doc);
    }
  }

  async pretty() {
    return this.toArray();
  }

  async toArray() {
    const results = await this.collection.find(this.selector, this.options);
    Object.defineProperty(results, FIND_RESULT, { value: true });
    return results;
  }

  then(resolve, reject) {
    return this.toArray().then(resolve, reject);
  }
}

function printHelp() {
  console.log(`lightn shell commands:
  db.collection('users').find({ active: true })
  db.users.find({ active: true })
  db.users.insertOne({ name: 'Ada' })
  db.users.insertMany([{ name: 'Ada' }, { name: 'Grace' }])
  db.users.updateOne({ name: 'Ada' }, { $set: { active: true } })
  db.users.updateMany({ active: true }, { $inc: { score: 1 } })
  db.users.deleteOne({ name: 'Ada' })
  db.users.deleteMany({ active: false })
  db.users.count({ active: true })
  await db.setEmbedding('./model.gguf')
  await db.users.createVectorIndex('bio')
  db.users.search('semantic query')
  db.collection('users').search('semantic query')
  db.search('semantic query')
  db.users.showVector({ _id: '...' })
  show collections
  help
  exit`);
}

function formatResult(value) {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  const output = util.inspect(value, {
    colors: process.stdout.isTTY,
    depth: null,
    maxArrayLength: null,
    breakLength: 100
  });
  if (Array.isArray(value) && value[FIND_RESULT]) {
    return `${output}\nTotal records found: ${value.length}`;
  }
  return output;
}

function createMissingCollectionError(name) {
  return new Error(`MongoServerError: Collection '${name}' does not exist`);
}

function vectorToBase64(vector) {
  if (Buffer.isBuffer(vector)) return vector.toString('base64');
  if (ArrayBuffer.isView(vector)) return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64');
  if (vector instanceof ArrayBuffer) return Buffer.from(vector).toString('base64');
  if (Array.isArray(vector)) return Buffer.from(new Float32Array(vector).buffer).toString('base64');
  return null;
}

async function showVector(collection, selector = {}) {
  if (collection.vectorIndexes.length === 0) {
    throw new Error('No vector indexes created on this collection');
  }

  const docs = await collection.find(selector);
  const results = [];

  for (const doc of docs) {
    for (const indexDef of collection.vectorIndexes) {
      const row = collection.db.sqlite
        .prepare(`SELECT vector FROM ${indexDef.tableName} WHERE id = ?`)
        .get(doc._id);
      const values = resolvePath(doc, indexDef.field);

      results.push({
        _id: doc._id,
        field: indexDef.field,
        value: values.length === 1 ? values[0] : values,
        vector: row ? vectorToBase64(row.vector) : null
      });
    }
  }

  return results;
}

function createShellCollection(collection) {
  const aliases = {
    find: (selector = {}) => new ShellCursor(collection, selector),
    showVector: (selector = {}) => showVector(collection, selector),
    search: async (queryText, options = {}) => {
      const results = await collection.search(queryText, options);
      Object.defineProperty(results, FIND_RESULT, { value: true });
      return results;
    },
    insertOne: collection.insert.bind(collection),
    updateOne: collection.update.bind(collection),
    deleteOne: collection.deleteOne.bind(collection),
    countDocuments: collection.count.bind(collection),
    remove: collection.remove.bind(collection)
  };

  return new Proxy(collection, {
    get(target, prop) {
      if (prop in aliases) return aliases[prop];
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function createShellDatabase(database) {
  const collectionCache = new Map();
  const knownCollections = new Set(database.listCollections());

  async function createCollection(name) {
    if (!knownCollections.has(name)) {
      await database.createCollection(name);
      knownCollections.add(name);
    }
    collectionCache.set(name, createShellCollection(database.collection(name)));
    return `Collection '${name}' created successfully`;
  }

  function collection(name) {
    if (!knownCollections.has(name)) {
      throw createMissingCollectionError(name);
    }

    if (!collectionCache.has(name)) {
      collectionCache.set(name, createShellCollection(database.collection(name)));
    }
    knownCollections.add(name);
    return collectionCache.get(name);
  }

  return new Proxy(database, {
    get(target, prop) {
      if (prop === 'collection') return collection;
      if (prop === 'getCollection') return collection;
      if (prop === 'createCollection') return createCollection;
      if (prop === 'getCollectionNames') return target.listCollections.bind(target);
      if (prop === 'search') return async (queryText, options = {}) => {
        const results = await target.search(queryText, options);
        Object.defineProperty(results, FIND_RESULT, { value: true });
        return results;
      };
      if (prop === 'help') return printHelp;
      if (prop in target || typeof prop === 'symbol') {
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return collection(prop);
    }
  });
}

async function evaluate(input, db) {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  if (trimmed === 'help' || trimmed === '.help') {
    printHelp();
    return undefined;
  }

  if (trimmed === 'show collections') {
    return db.getCollectionNames().join('\n');
  }

  try {
    return await new AsyncFunction('db', 'print', `"use strict"; return (${trimmed});`)(db, console.log);
  } catch (expressionError) {
    if (!(expressionError instanceof SyntaxError)) {
      throw expressionError;
    }

    try {
      return await new AsyncFunction('db', 'print', `"use strict"; ${trimmed}`)(db, console.log);
    } catch (statementError) {
      statementError.message = `${statementError.message}\n${expressionError.message}`;
      throw statementError;
    }
  }
}

async function main(argv = process.argv) {
  const dbPath = argv[2];
  if (!dbPath) {
    console.error('Usage: lightn <path/db>');
    process.exitCode = 1;
    return;
  }

  const database = connect(dbPath);
  const db = createShellDatabase(database);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'lightn> ',
    terminal: process.stdin.isTTY && process.stdout.isTTY
  });

  const close = () => {
    rl.close();
  };

  let inputClosed = false;
  let exitRequested = false;
  let queue = Promise.resolve();

  async function handleLine(line) {
    if (exitRequested) return;

    const trimmed = line.trim();
    if (trimmed === 'exit' || trimmed === '.exit' || trimmed === 'quit') {
      exitRequested = true;
      return;
    }

    try {
      const result = await evaluate(line, db);
      const output = formatResult(result);
      if (output) console.log(output);
    } catch (error) {
      console.error(error.message);
    }
  }

  process.once('SIGINT', close);
  process.once('SIGTERM', close);

  rl.prompt();
  rl.on('line', (line) => {
    rl.pause();
    queue = queue
      .then(async () => {
        await handleLine(line);
      })
      .finally(() => {
        if (exitRequested) {
          rl.close();
        } else if (!inputClosed) {
          rl.prompt();
          rl.resume();
        }
      });
  });

  rl.on('close', () => {
    inputClosed = true;
    queue.finally(() => {
      database.close();
    });
  });
}

if (require.main === module) {
  main();
}

module.exports = { ShellCursor, createShellDatabase, evaluate, formatResult, main };
