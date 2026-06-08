/* Minimal ZIP writer (STORE / no compression).
 * PNG data is already compressed, so storing keeps files valid and small enough.
 * Produces a Blob for download. No external dependencies. */
(function (global) {
  "use strict";

  const CRC_TABLE = (function () {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function strToBytes(str) {
    return new TextEncoder().encode(str);
  }

  // DOS time/date for the zip entry (uses current local time).
  function dosDateTime(date) {
    const time =
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (Math.floor(date.getSeconds() / 2));
    const day =
      (((date.getFullYear() - 1980) & 0x7f) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate();
    return { time, date: day };
  }

  /**
   * @param {Array<{name:string, data:Uint8Array}>} files
   * @returns {Blob}
   */
  function createZip(files) {
    const now = new Date();
    const { time, date } = dosDateTime(now);
    const localParts = [];
    const central = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = strToBytes(file.name);
      const data = file.data;
      const crc = crc32(data);
      const size = data.length;

      // Local file header (30 bytes + name)
      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); // signature
      lv.setUint16(4, 20, true); // version needed
      lv.setUint16(6, 0, true); // flags
      lv.setUint16(8, 0, true); // method = store
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true); // compressed size
      lv.setUint32(22, size, true); // uncompressed size
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true); // extra len
      local.set(nameBytes, 30);

      localParts.push(local, data);

      // Central directory header (46 bytes + name)
      const cd = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true); // signature
      cv.setUint16(4, 20, true); // version made by
      cv.setUint16(6, 20, true); // version needed
      cv.setUint16(8, 0, true); // flags
      cv.setUint16(10, 0, true); // method
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true); // extra len
      cv.setUint16(32, 0, true); // comment len
      cv.setUint16(34, 0, true); // disk number
      cv.setUint16(36, 0, true); // internal attrs
      cv.setUint32(38, 0, true); // external attrs
      cv.setUint32(42, offset, true); // local header offset
      cd.set(nameBytes, 46);
      central.push(cd);

      offset += local.length + data.length;
    }

    const centralSize = central.reduce((s, c) => s + c.length, 0);
    const centralOffset = offset;

    // End of central directory record (22 bytes)
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralOffset, true);
    ev.setUint16(20, 0, true);

    return new Blob([...localParts, ...central, end], {
      type: "application/zip",
    });
  }

  global.ExpieZip = { createZip, crc32 };
})(window);
