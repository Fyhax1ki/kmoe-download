(function (root) {
  'use strict';

  // Minimal ZIP writer, STORE (no compression) only.
  // Written from scratch so the extension needs no external dependency and never
  // re-encodes already compressed payloads (EPUB files are ZIP containers already).
  var ZIP32_MAX = 0xffffffff;
  var MAX_ENTRY_COUNT = 0xffff;
  var LOCAL_HEADER_SIZE = 30;
  var CENTRAL_HEADER_SIZE = 46;
  var END_OF_CENTRAL_SIZE = 22;
  var FLAG_UTF8 = 0x0800;
  var ABORT_MESSAGE = '已取消导出';
  var METHOD_STORE = 0;
  var VERSION_NEEDED = 20;
  // 0x031E == "made by UNIX, version 3.0"; low unix mode 0100644 (rw-r--r--)
  var VERSION_MADE_BY = 0x031e;
  var EXTERNAL_ATTRS = 0x81a40000;

  var CRC_TABLE = (function buildCrcTable() {    var table = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c;
    }
    return table;
  })();

  function crc32Start() {
    return 0xffffffff;
  }

  function crc32Update(state, bytes) {
    var crc = state;
    for (var i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return crc >>> 0;
  }

  function crc32Finish(state) {
    return (state ^ 0xffffffff) >>> 0;
  }

  function crc32(bytes) {
    return crc32Finish(crc32Update(crc32Start(), toBytes(bytes)));
  }

  function isByteView(value) {
    return !!value && typeof value === 'object' &&
      typeof value.byteLength === 'number' &&
      typeof value.byteOffset === 'number' &&
      typeof value.length === 'number';
  }

  function toBytes(value) {
    if (!value) return new Uint8Array(0);
    if (typeof value === 'string') return utf8Bytes(value);
    // Typed arrays are accepted from any realm, so cross-realm views (tests,
    // sandboxes) behave the same as local ones.
    if (isByteView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength);
    }
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value.buffer instanceof ArrayBuffer) {
      return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength);
    }
    return new Uint8Array(value);
  }

  function utf8Bytes(text) {
    text = String(text === undefined || text === null ? '' : text);
    if (typeof TextEncoder === 'function') {
      return new TextEncoder().encode(text);
    }
    // Fallback for environments without TextEncoder (old test shims).
    var encoded = unescape(encodeURIComponent(text));
    var bytes = new Uint8Array(encoded.length);
    for (var i = 0; i < encoded.length; i++) {
      bytes[i] = encoded.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  function dosDateTime(date) {
    var value = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
    var year = value.getFullYear();
    if (year < 1980) year = 1980;
    if (year > 2107) year = 2107;
    return {
      time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate()
    };
  }

  function createBuffer(size) {
    return new DataView(new ArrayBuffer(size));
  }

  function writeU16(view, offset, value) {
    view.setUint16(offset, value & 0xffff, true);
  }

  function writeU32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function buildLocalHeader(entry) {
    var view = createBuffer(LOCAL_HEADER_SIZE);
    writeU32(view, 0, 0x04034b50);
    writeU16(view, 4, VERSION_NEEDED);
    writeU16(view, 6, FLAG_UTF8);
    writeU16(view, 8, METHOD_STORE);
    writeU16(view, 10, entry.dosTime);
    writeU16(view, 12, entry.dosDate);
    writeU32(view, 14, entry.crc);
    writeU32(view, 18, entry.size);
    writeU32(view, 22, entry.size);
    writeU16(view, 26, entry.nameBytes.length);
    writeU16(view, 28, 0);
    return new Uint8Array(view.buffer);
  }

  function buildCentralHeader(entry) {
    var view = createBuffer(CENTRAL_HEADER_SIZE);
    writeU32(view, 0, 0x02014b50);
    writeU16(view, 4, VERSION_MADE_BY);
    writeU16(view, 6, VERSION_NEEDED);
    writeU16(view, 8, FLAG_UTF8);
    writeU16(view, 10, METHOD_STORE);
    writeU16(view, 12, entry.dosTime);
    writeU16(view, 14, entry.dosDate);
    writeU32(view, 16, entry.crc);
    writeU32(view, 20, entry.size);
    writeU32(view, 24, entry.size);
    writeU16(view, 28, entry.nameBytes.length);
    writeU16(view, 30, 0);
    writeU16(view, 32, 0);
    writeU16(view, 34, 0);
    writeU16(view, 36, 0);
    writeU32(view, 38, EXTERNAL_ATTRS);
    writeU32(view, 42, entry.offset);
    return new Uint8Array(view.buffer);
  }

  function buildEndOfCentralDirectory(entryCount, centralSize, centralOffset) {
    var view = createBuffer(END_OF_CENTRAL_SIZE);
    writeU32(view, 0, 0x06054b50);
    writeU16(view, 4, 0);
    writeU16(view, 6, 0);
    writeU16(view, 8, entryCount);
    writeU16(view, 10, entryCount);
    writeU32(view, 12, centralSize);
    writeU32(view, 16, centralOffset);
    writeU16(view, 20, 0);
    return new Uint8Array(view.buffer);
  }

  // Reads the blob once (streaming when possible) to obtain its CRC32 and length
  // without materializing the whole payload in memory.
  function measureBlob(blob, onProgress, shouldAbort) {
    if (!blob || typeof blob.size !== 'number') {
      return Promise.resolve({ crc: 0, size: 0 });
    }

    var size = blob.size;
    if (size === 0) {
      return Promise.resolve({ crc: 0, size: 0 });
    }

    if (typeof blob.stream === 'function' && typeof Blob === 'function') {
      var reader = blob.stream().getReader();
      var loaded = 0;

      function pump(state) {
        if (shouldAbort && shouldAbort()) {
          return Promise.reject(new Error(ABORT_MESSAGE));
        }
        return reader.read().then(function (result) {
          if (result.done) {
            return { crc: crc32Finish(state), size: loaded };
          }
          var chunk = toBytes(result.value);
          var next = crc32Update(state, chunk);
          loaded += chunk.length;
          if (onProgress) onProgress(loaded, size);
          return pump(next);
        });
      }

      return pump(crc32Start());
    }

    return blob.arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer);
      if (onProgress) onProgress(bytes.length, size);
      return { crc: crc32Finish(crc32Update(crc32Start(), bytes)), size: bytes.length };
    });
  }

  function assertZip32Capacity(entries) {
    if (entries.length > MAX_ENTRY_COUNT) {
      throw new Error('条目数量超过 ZIP32 上限（' + MAX_ENTRY_COUNT + '），当前 ' + entries.length + ' 条');
    }

    var total = 0;
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (entry.size > ZIP32_MAX) {
        throw new Error('单个文件超过 4GiB，ZIP32 无法承载：' + entry.name);
      }
      total += entry.size + LOCAL_HEADER_SIZE + entry.nameBytes.length;
      if (total > ZIP32_MAX) {
        throw new Error('导出总大小超过 4GiB，ZIP32 无法承载，请分批导出');
      }
    }
  }

  // entries: [{ name: string, blob: Blob|Uint8Array, date?: Date }]
  // Returns a Blob whose parts reference the source blobs directly, so large
  // payloads stay disk-backed instead of being copied into JS memory.
  function createZipBlob(entries, options) {
    options = options || {};
    var list = (entries || []).filter(function (entry) {
      return entry && entry.name;
    });

    var onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    var shouldAbort = typeof options.shouldAbort === 'function' ? options.shouldAbort : null;
    var prepared = [];

    return list.reduce(function (chain, entry, index) {
      return chain.then(function () {
        if (shouldAbort && shouldAbort()) {
          throw new Error(ABORT_MESSAGE);
        }
        var blob = entry.blob;
        var payload = isByteView(blob) ? toBytes(blob) : null;
        var measured;
        if (payload) {
          if (onProgress) onProgress(index, list.length, entry.name, payload.length, payload.length);
          measured = Promise.resolve({
            crc: crc32Finish(crc32Update(crc32Start(), payload)),
            size: payload.length
          });
        } else {
          measured = measureBlob(blob, function (loaded, total) {
            if (onProgress) onProgress(index, list.length, entry.name, loaded, total);
          }, shouldAbort);
        }

        return measured.then(function (info) {
          var date = dosDateTime(entry.date || options.date);
          var record = {
            name: String(entry.name),
            nameBytes: utf8Bytes(entry.name),
            crc: info.crc,
            size: info.size,
            blob: payload || blob,
            dosTime: date.time,
            dosDate: date.date
          };

          if (record.nameBytes.length > 0xffff) {
            throw new Error('文件名过长：' + record.name);
          }
          prepared.push(record);
        });
      });
    }, Promise.resolve()).then(function () {
      assertZip32Capacity(prepared);

      var parts = [];
      var offset = 0;
      prepared.forEach(function (record) {
        record.offset = offset;
        var header = buildLocalHeader(record);
        parts.push(header, record.nameBytes);
        if (record.blob) parts.push(record.blob);
        offset += header.length + record.nameBytes.length + record.size;
      });

      var centralOffset = offset;
      prepared.forEach(function (record) {
        var header = buildCentralHeader(record);
        parts.push(header, record.nameBytes);
        offset += header.length + record.nameBytes.length;
      });

      parts.push(buildEndOfCentralDirectory(prepared.length, offset - centralOffset, centralOffset));
      return new Blob(parts, { type: 'application/zip' });
    });
  }

  root.KmoeZip = {
    ZIP32_MAX: ZIP32_MAX,
    MAX_ENTRY_COUNT: MAX_ENTRY_COUNT,
    ABORT_MESSAGE: ABORT_MESSAGE,
    crc32: crc32,
    crc32Start: crc32Start,
    crc32Update: crc32Update,
    crc32Finish: crc32Finish,
    utf8Bytes: utf8Bytes,
    measureBlob: measureBlob,
    assertCapacity: assertZip32Capacity,
    createZipBlob: createZipBlob
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
