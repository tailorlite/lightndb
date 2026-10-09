# Generate `_id` as ULID

New Documents get a ULID (26-char, lexicographically time-sortable) when no `_id` is supplied. Because LMDB orders keys by raw bytes and the Document key ends in `_id`, time-sortable IDs cluster recent inserts together in the B-tree, improving write locality and enabling cheap chronological scans. UUID v4 was rejected because its randomness fragments the tree and gives no ordering benefit. The format is hard to reverse once data exists on disk.

## Considered Options

- ULID (chosen) — time-sortable, lexicographic, no dependency beyond a small generator.
- UUID v4 (rejected) — random, fragments the B-tree, no ordering benefit.
- MongoDB-style ObjectID (rejected) — also sortable but heavier format; ULID is simpler.

## Consequences

Document keys sort by creation time, so unindexed full scans return newest-first by default. `_id` values must remain valid as a trailing key segment (no `0x00`).
