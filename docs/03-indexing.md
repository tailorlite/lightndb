# Indexing

Indexes live in the single `indexes` Sub-database, namespaced per Collection and per Index name (ADR-0002). Each Index is a set of `0x00`-delimited buffer keys that LMDB keeps sorted, enabling both equality lookup and range scans. All Indexes are **ascending** — descending-direction Indexes are out of scope for v1 (kept simple).

## Index key format

```
<collection>\0<indexName>\0<enc(field1)><enc(field2)>...<_id>
```

The value is an empty `Buffer`; the `_id` in the key makes every entry unique (so non-unique Indexes work without `dupSort`). Note that `<collection>` and `<indexName>` are separated by `0x00`, and the tuple-encoded values naturally concatenate without extra delimiters.

`createIndex(fieldOrFields, { unique })`:

- `fieldOrFields` is a field name or an array of names (all ascending; no `{ field: -1 }` direction in v1).
- `name` defaults to fields joined by `__`.
- Stored in `meta`; existing Documents are back-filled in one Write Transaction.

## Value Encoder

Each indexed value is encoded using a FoundationDB-style tuple encoding where fixed-width types do not use trailing delimiters. This ensures byte order matches value order. This is forced by `node-lmdb` having no custom key comparator (ADR-0005).

| Type | Tag | Payload | Ordering |
|------|-----|---------|----------|
| null / missing | `0x01` | — | lowest |
| boolean | `0x02` | `0x00` false / `0x01` true | false < true |
| number | `0x03` | 8-byte float64, sign-bit logic | numeric |
| date | `0x04` | 8-byte int64 ms, sign-bit flipped | chronological |
| string | `0x05` | UTF-8 bytes terminated by `0x00` (escaped) | lexicographic (code-unit) |

**float64 sign logic:** if the sign bit is set, bitwise-NOT all 64 bits; otherwise set the sign bit. This makes the big-endian byte sequence sort in numeric order, negatives first.

**int64 date logic:** XOR the highest bit (the sign bit) for all numbers. This shifts the entire two's complement domain continuously so that chronological order is preserved when compared as raw bytes.

**String escaping:** To prevent a `0x00` byte inside a string from being confused with the terminator, any `0x00` byte within the UTF-8 string payload is escaped as `0x00 0xFF`. The true terminator remains a single `0x00`. Because `0xFF` sorts after all other bytes, this preserves the correct lexicographical sort order.

**Cross-type ordering** follows the tag order above (null < boolean < number < date < string). This approximates but does not exactly match MongoDB's full BSON type order; mixed-type ranges on one field are uncommon and documented as a best-effort path.

## Compound Indexes

A Compound Index over `[f1, f2]` encodes `enc(f1)` then `enc(f2)` then `_id`. It is usable by the Query Planner only when the Selector constrains a **leading prefix** of the fields (e.g. `{ f1: x, f2: { $gt: y } }` uses it; `{ f2: x }` does not).

## Multi-value (array) fields

If an indexed field holds an array, one Index entry is written **per scalar element** (MongoDB "multi-key" semantics). A Document matches on that field if any element matches. Indexing arrays/objects *as single values* is not supported — only their scalar elements.

## Unique Indexes

For a Unique Index, before writing the entry for value `v` and `_id`, the planner scans the prefix `<coll>\0<idx>\0<enc(v)>\0`; if any key has that prefix, another Document already holds `v` → `DuplicateKeyError` and the Write Transaction aborts. The single-writer model makes this check race-free (ADR-0006).

## Maintenance on writes (all inside one Write Transaction)

- **insert:** write the Document, then for each Index compute the field value(s), encode, and put each entry (uniqueness check first).
- **update:** load the old Document; for each Index whose fields changed, delete the old entries and write the new ones (only touched Indexes are reconciled).
- **remove / deleteMany:** for each deleted Document, recompute its Index entries from the (in-memory) Document and delete them.

## Query Planner (index selection)

1. Walk the Selector; collect top-level field constraints (equality or `$gt`/`$gte`/`$lt`/`$lte`/`$in`) and `$and` branches.
2. Pick the best Index: prefer a single-field Index on an equality field; a Compound Index is usable only on a leading-equality prefix.
3. If an Index is chosen, compute a start key (and optional end key) and range-scan the `indexes` Sub-database; collect `_id`s; fetch each Document; **post-filter** with the full `QueryEngine` (the Index may be non-selective or cover only part of the Selector).
4. If no Index is usable, full-scan the `docs` Sub-database over the `coll\0` prefix and filter.

The planner is deliberately simple in v1; it always post-filters, so results are correct regardless of Index choice — only speed varies.
