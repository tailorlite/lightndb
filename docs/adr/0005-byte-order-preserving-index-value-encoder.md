# Encode Index values with a byte-order-preserving scheme

Index keys carry each indexed value through an encoder whose output sorts in the value's natural order, so `$gt`/`$lt` ranges can be served by a cursor range scan. This is forced: `node-lmdb` exposes no custom key comparator, so correct range ordering must be encoded into the bytes themselves. We use a FoundationDB-style tuple encoding where each field is encoded as a type tag plus a type-specific payload (null < boolean < number < date < string). Fixed-width types (number, date) do not use delimiters; variable-length types (string) are terminated by a `0x00` byte.

## Considered Options

- Byte-order-preserving tuple-style encoder (chosen).
- Equality-only Indexes with no range support (rejected — prompt requires `$gt`/`$lt`).
- Numeric values stored as zero-padded decimal strings (rejected — fragile, no float support).

## Consequences

Exact cross-type ordering approximates but does not match MongoDB's full BSON type order (documented). String values containing U+0000 are fully supported by escaping them as `0x00 0xFF` to keep the `0x00` terminator unambiguous while preserving sort order. Numbers encode as 8-byte float64 (with sign-bit logic to preserve order), so integers and floats share one ordering. Dates encode as 8-byte int64 with the sign bit flipped to preserve two's complement ordering.
