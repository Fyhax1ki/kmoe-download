const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ZIP_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'zip.js'), 'utf8');

function loadZip() {
  const sandbox = { console, Blob, TextEncoder, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(ZIP_SOURCE, sandbox, { filename: 'shared/zip.js' });
  return sandbox.KmoeZip;
}

function u16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function findEocd(bytes) {
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (u32(bytes, i) === 0x06054b50) return i;
  }
  throw new Error('EOCD not found');
}

// Independent (test-side) reader for STORE-only archives.
function readZip(bytes) {
  const decoder = new TextDecoder();
  const eocd = findEocd(bytes);
  const count = u16(bytes, eocd + 10);
  const centralSize = u32(bytes, eocd + 12);
  const centralOffset = u32(bytes, eocd + 16);

  assert.equal(u16(bytes, eocd + 4), 0, 'disk number');
  assert.equal(u16(bytes, eocd + 6), 0, 'central directory disk');
  assert.equal(u16(bytes, eocd + 8), count, 'entries on this disk');
  assert.equal(eocd + 22 + u16(bytes, eocd + 20), bytes.length, 'no trailing data');

  const entries = [];
  let cursor = centralOffset;
  for (let i = 0; i < count; i++) {
    assert.equal(u32(bytes, cursor), 0x02014b50, 'central header signature');
    const flags = u16(bytes, cursor + 8);
    const method = u16(bytes, cursor + 10);
    const crc = u32(bytes, cursor + 16);
    const compressedSize = u32(bytes, cursor + 20);
    const size = u32(bytes, cursor + 24);
    const nameLength = u16(bytes, cursor + 28);
    const extraLength = u16(bytes, cursor + 30);
    const commentLength = u16(bytes, cursor + 32);
    const localOffset = u32(bytes, cursor + 42);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    assert.equal(flags & 0x0800, 0x0800, 'UTF-8 flag set for ' + name);
    assert.equal(method, 0, 'store method for ' + name);
    assert.equal(extraLength, 0, 'no extra field');

    assert.equal(u32(bytes, localOffset), 0x04034b50, 'local header signature for ' + name);
    assert.equal(u16(bytes, localOffset + 6), flags, 'flags match for ' + name);
    assert.equal(u32(bytes, localOffset + 14), crc, 'crc match for ' + name);
    const localNameLength = u16(bytes, localOffset + 26);
    const localExtraLength = u16(bytes, localOffset + 28);
    assert.equal(
      decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)),
      name,
      'local name matches'
    );

    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(dataStart, dataStart + size);
    entries.push({ name, crc, size, compressedSize, data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  assert.equal(cursor - centralOffset, centralSize, 'central directory size');
  assert.equal(centralOffset, entries.reduce((sum, entry) => sum + 30 + new TextEncoder().encode(entry.name).length + entry.size, 0), 'local headers are contiguous');

  return entries;
}

test('crc32 matches the reference value for "123456789"', () => {
  const Zip = loadZip();
  assert.equal(Zip.crc32('123456789'), 0xcbf43926);
  assert.equal(Zip.crc32(new Uint8Array(0)), 0);
});

test('crc32 is incremental and equivalent to the one-shot helper', () => {
  const Zip = loadZip();
  const bytes = new TextEncoder().encode('the quick brown fox jumps over the lazy dog');
  const split = 10;
  const state = Zip.crc32Update(Zip.crc32Start(), bytes.subarray(0, split));
  const incremental = Zip.crc32Finish(Zip.crc32Update(state, bytes.subarray(split)));
  assert.equal(incremental, Zip.crc32(bytes));
});

test('creates a valid STORE archive with UTF-8 names and original bytes', async () => {
  const Zip = loadZip();
  const payloads = [
    { name: '妄想老師/01 妄想老師 第01卷.epub', body: 'PK\u0003\u0004 fake epub bytes 01' },
    { name: '妄想老師/manifest.json', body: '{"series":"妄想老師"}' }
  ];

  const blob = await Zip.createZipBlob(payloads.map((item) => ({
    name: item.name,
    blob: new TextEncoder().encode(item.body)
  })), { date: new Date('2026-02-19T08:30:00Z') });

  assert.equal(blob.type, 'application/zip');

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const entries = readZip(bytes);

  assert.deepEqual(entries.map((entry) => entry.name), payloads.map((item) => item.name));
  entries.forEach((entry, index) => {
    assert.equal(new TextDecoder().decode(entry.data), payloads[index].body);
    assert.equal(entry.size, new TextEncoder().encode(payloads[index].body).length);
    assert.equal(entry.crc, Zip.crc32(new TextEncoder().encode(payloads[index].body)));
  });
});

test('keeps blob payloads disk-backed instead of copying them into the archive', async () => {
  const Zip = loadZip();
  const payload = new Blob([new Uint8Array([1, 2, 3, 4, 5])]);
  const blob = await Zip.createZipBlob([{ name: 'a.bin', blob: payload }], { date: new Date('2026-02-19T00:00:00Z') });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const entries = readZip(bytes);
  assert.equal(entries.length, 1);
  assert.deepEqual(Array.from(entries[0].data), [1, 2, 3, 4, 5]);
});

test('reports progress per entry', async () => {
  const Zip = loadZip();
  const seen = [];
  await Zip.createZipBlob([
    { name: 'one.txt', blob: new Uint8Array([1, 2, 3]) },
    { name: 'two.txt', blob: new Uint8Array([4, 5, 6]) }
  ], {
    date: new Date('2026-02-19T00:00:00Z'),
    onProgress: (index, total, name, loaded, size) => {
      seen.push({ index, total, name, loaded, size });
    }
  });

  assert.deepEqual(seen.filter((item) => item.index === 0).map((item) => item.name), ['one.txt']);
  assert.deepEqual(seen.filter((item) => item.index === 1).map((item) => item.name), ['two.txt']);
  assert.ok(seen.every((item) => item.total === 2));
  assert.ok(seen.every((item) => item.loaded === item.size));
});

test('supports an empty archive', async () => {
  const Zip = loadZip();
  const blob = await Zip.createZipBlob([], { date: new Date('2026-02-19T00:00:00Z') });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(bytes.length, 22);
  assert.deepEqual(readZip(bytes), []);
});

test('aborts when shouldAbort reports cancellation', async () => {
  const Zip = loadZip();
  await assert.rejects(
    () => Zip.createZipBlob(
      [{ name: 'a.epub', blob: new Blob([new Uint8Array(1024)]) }],
      { shouldAbort: () => true }
    ),
    /已取消导出/
  );
});

test('refuses entries beyond the ZIP32 limits', () => {
  const Zip = loadZip();
  const nameBytes = new Uint8Array(4);

  assert.throws(
    () => Zip.assertCapacity([{ name: 'huge', size: 0xffffffff + 1, nameBytes }]),
    /单个文件超过 4GiB/
  );
  assert.throws(
    () => Zip.assertCapacity([
      { name: 'a', size: 0xffffffff - 64, nameBytes },
      { name: 'b', size: 4096, nameBytes }
    ]),
    /导出总大小超过 4GiB/
  );
  assert.throws(
    () => Zip.assertCapacity(new Array(0x10000).fill({ name: 'a', size: 0, nameBytes })),
    /条目数量超过 ZIP32 上限/
  );
});
