function encodeValue(val) {
  if (val === null || val === undefined) {
    return Buffer.from([0x01]);
  }
  
  if (typeof val === 'boolean') {
    return Buffer.from([0x02, val ? 0x01 : 0x00]);
  }
  
  if (typeof val === 'number') {
    const buf = Buffer.alloc(9);
    buf[0] = 0x03;
    buf.writeDoubleBE(val, 1);
    
    if (buf[1] & 0x80) {
      // Negative: flip all bits
      for (let i = 1; i < 9; i++) {
        buf[i] = ~buf[i];
      }
    } else {
      // Positive: set sign bit
      buf[1] |= 0x80;
    }
    return buf;
  }
  
  if (val instanceof Date) {
    const buf = Buffer.alloc(9);
    buf[0] = 0x04;
    // node doesn't have writeBigInt64BE in all environments, but modern node does.
    // ms since epoch
    buf.writeBigInt64BE(BigInt(val.getTime()), 1);
    // XOR highest bit
    buf[1] ^= 0x80;
    return buf;
  }
  
  if (typeof val === 'string') {
    const utf8 = Buffer.from(val, 'utf8');
    // We might need to escape 0x00 to 0x00 0xFF
    let zeros = 0;
    for (let i = 0; i < utf8.length; i++) {
      if (utf8[i] === 0x00) zeros++;
    }
    
    const buf = Buffer.alloc(1 + utf8.length + zeros + 1);
    buf[0] = 0x05;
    let ptr = 1;
    for (let i = 0; i < utf8.length; i++) {
      if (utf8[i] === 0x00) {
        buf[ptr++] = 0x00;
        buf[ptr++] = 0xFF;
      } else {
        buf[ptr++] = utf8[i];
      }
    }
    buf[ptr] = 0x00; // terminator
    return buf;
  }
  
  // fallback for unsupported types (e.g. object, array which should have been scalar-ized)
  return Buffer.from([0x01]);
}

module.exports = {
  encodeValue
};
