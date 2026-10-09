# Auto-grow `mapSize` on MapFull; hardcode `maxDbs`

lightndb does not require the user to size the Environment. `maxDbs` is an internal constant — lightndb uses a fixed 3 Sub-databases regardless of how many Collections or Indexes exist (they are key prefixes, not DBIs), so it never needs to grow. `mapSize` starts at a generous default (1 GiB) and auto-grows: on `MDB_MAP_FULL` at commit, lightndb aborts the transaction, drains all in-flight transactions via a brief stop-the-world barrier (write mutex plus read-only quiescence), calls `node-lmdb`'s `env.resize(current * 2)`, and retries. `node-lmdb` exposes `Env.resize(size)` for exactly this; its "no active transactions" precondition is satisfied by the barrier, and DBI handles remain valid across a resize.

## Considered Options

- Auto-grow via `env.resize()` (chosen) — no user sizing; transparent.
- Throw `MapFullError` and require the caller to reopen with a larger `mapSize` (rejected — poor UX for a "lightweight local" DB).
- Preallocate a huge fixed `mapSize` (rejected — wastes address space/disk and still fails eventually).

## Consequences

- Resize is a brief stop-the-world: reads and writes pause while outstanding transactions drain and the map grows. Rare, given a 1 GiB start and doubling policy.
- Windows caveat: `node-lmdb` notes that dynamic map growth on Windows uses a non-standard API and may degrade performance; the generous default and doubling policy minimize how often it triggers.
- An optional `mapSize` in `connect()` sets only the initial size. `MapFullError` is now a last resort (resize failure or a caller cap), not the normal path.
