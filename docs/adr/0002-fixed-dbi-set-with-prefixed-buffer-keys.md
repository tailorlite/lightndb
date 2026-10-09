# Use a fixed set of DBIs with prefixed buffer keys

lightndb stores all Documents in one `docs` Sub-database, all Index entries in one `indexes` Sub-database, and metadata in one `meta` Sub-database — all opened with `keyIsBuffer: true` — rather than opening a DBI per Collection or per Index. This is forced by LMDB: `maxDbs` is fixed when the Environment opens, but Collections and Indexes are created at runtime, so an unbounded number of DBIs is not possible. Keys are UTF-8 segments joined by a `0x00` byte, which cannot appear in UTF-8 text and so never collides with field names or data.

This deliberately deviates from the originating prompt's literal `${collection}:${_id}` key shape: `:` is a legal character in field names and values, so it is unsafe as a separator.

## Considered Options

- Fixed DBI set with `0x00`-prefixed buffer keys (chosen).
- One DBI per Collection / per Index (rejected: `maxDbs` fixed at open; runtime creation unbounded).
- Single DBI with `:`-prefixed string keys (rejected: separator collision, UTF-16 bloat, no byte-ordering control).

## Consequences

Dropping a Collection or Index means deleting a key range rather than dropping a DBI. All three Sub-databases use `keyIsBuffer`, so lightndb owns every key byte.
