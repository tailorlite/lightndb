# Serialize Documents as UTF-8 JSON Buffers

Documents are stored via `putBinary(Buffer.from(JSON.stringify(doc), 'utf8'))` and read with `getBinary` + `JSON.parse(...toString('utf8'))`. This is about half the on-disk size of `node-lmdb`'s default string storage (UTF-16, 2 bytes/char) and adds no dependencies. MsgPack was rejected: it adds a dependency for a marginal size/speed gain over JSON, and JSON round-trips every JS value lightndb needs to support (Dates, nested objects, arrays, null).

## Considered Options

- UTF-8 JSON Buffer (chosen) — compact, dependency-free, full JS-value fidelity.
- UTF-16 JSON string via `putString` (rejected — 2x size).
- MsgPack / MessagePack (rejected — dependency for marginal gain, Date/Map handling friction).

## Consequences

`Date` values serialize as ISO strings in JSON and must be rehydrated by the caller on read (a known JSON limitation), unless lightndb adds a reviver; out of scope for v1.
