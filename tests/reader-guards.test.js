const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
// Guard tests inspect code, not prose: comments may legitimately name the APIs
// the implementation is forbidden to call.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const readerSource = fs.readFileSync(path.join(ROOT, 'content', 'reader.js'), 'utf8');
const zipSource = fs.readFileSync(path.join(ROOT, 'shared', 'zip.js'), 'utf8');
const exportSource = fs.readFileSync(path.join(ROOT, 'shared', 'reader-export.js'), 'utf8');
const readerCode = stripComments(readerSource);
const zipCode = stripComments(zipSource);
const exportCode = stripComments(exportSource);
const bridgeSource = fs.readFileSync(path.join(ROOT, 'scripts', 'reader-bridge.js'), 'utf8');
const bridgeCode = stripComments(bridgeSource);
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

test('the export code path never performs a network request', () => {
  [readerCode, zipCode, exportCode, bridgeCode].forEach((source, index) => {
    const name = ['content/reader.js', 'shared/zip.js', 'shared/reader-export.js', 'scripts/reader-bridge.js'][index];
    assert.equal(/\bfetch\s*\(/.test(source), false, name + ' must not call fetch()');
    assert.equal(/XMLHttpRequest/.test(source), false, name + ' must not use XMLHttpRequest');
    assert.equal(/sendBeacon/.test(source), false, name + ' must not call sendBeacon');
    assert.equal(/new\s+WebSocket/.test(source), false, name + ' must not open a WebSocket');
    assert.equal(/new\s+EventSource/.test(source), false, name + ' must not open an EventSource');
  });
});

test('the cache database is opened read only', () => {
  assert.ok(readerCode.indexOf("transaction(STORE_NAME, 'readonly')") !== -1);
  assert.equal(/readwrite/.test(readerCode), false, 'content/reader.js must not open a write transaction');
  assert.ok(readerCode.indexOf('store.get(md5)') !== -1, 'records are read one key at a time');
  assert.equal(/store\.(getAll|openCursor|openKeyCursor)\s*\(/.test(readerCode), false, 'the store is never scanned');
  assert.equal(/store\.(add|put|delete|clear)\s*\(/.test(readerCode), false, 'the cache is never modified');
});

test('reads the site database without ever creating, upgrading or deleting it', () => {
  // A cache clear is the user's decision, never the extension's.
  assert.equal(/deleteDatabase/.test(readerCode), false, 'must never call deleteDatabase');
  assert.ok(
    /indexedDB\.open\(DB_NAME, info\.version\)/.test(readerCode),
    'opens the database at the version reported by indexedDB.databases()'
  );
  assert.equal(
    /indexedDB\.open\(DB_NAME\)/.test(readerCode),
    false,
    'never opens without a version, which would silently create an empty database'
  );
  assert.ok(/onversionchange/.test(readerCode), 'disconnects when the site upgrades or deletes the database');
  assert.ok(
    /typeof indexedDB\.databases !== 'function'/.test(readerCode),
    'refuses to touch the database when it cannot check it first'
  );
});

test('does not rely on DOMStringList.indexOf, which browsers do not implement', () => {
  assert.equal(/objectStoreNames\.indexOf/.test(readerCode), false);
  assert.ok(/names\.contains\(STORE_NAME\)/.test(readerCode));
  assert.ok(/Array\.prototype\.indexOf\.call\(names, STORE_NAME\)/.test(readerCode));
});

test('the isolated world never touches page globals or inline handlers', () => {
  // MV3 内容脚本 CSP 会阻止隔离世界 click() 带 inline 处理器/javascript: 链接的元素，
  // 所以缓存必须由主世界桥代劳。
  assert.equal(
    /window\.vol_open/.test(readerCode),
    false,
    'content/reader.js must not try to call the page global vol_open'
  );
  assert.ok(/window\.postMessage\(/.test(readerCode), 'the isolated world talks to the bridge instead');
  assert.ok(/CACHE_VOLUME/.test(readerCode));
});

test('the main world bridge only proxies the site cache entry point', () => {
  assert.ok(/window\.vol_open\(url, md5\)/.test(bridgeCode), 'calls the site vol_open');
  assert.equal(
    /chrome\./.test(bridgeCode),
    false,
    'a MAIN world script has no access to extension APIs'
  );
  assert.equal(/indexedDB/.test(bridgeCode), false, 'the bridge must not read or write the cache itself');
  assert.equal(/\.click\(\)/.test(bridgeCode), false, 'no click proxying is needed once vol_open is reachable');
});

test('manifest wires the koobone reader without touching the kmoe entry points', () => {
  assert.ok(manifest.host_permissions.indexOf('https://koobone.com/*') !== -1);

  const kooboneEntries = manifest.content_scripts.filter((entry) => entry.matches.indexOf('https://koobone.com/*') !== -1);
  assert.equal(kooboneEntries.length, 2, 'one isolated entry plus one MAIN world entry');

  const isolated = kooboneEntries.find((entry) => !entry.world);
  assert.ok(isolated, 'isolated entry exists');
  assert.deepEqual(isolated.js, ['shared/zip.js', 'shared/reader-export.js', 'content/reader.js']);
  assert.deepEqual(isolated.css, ['content/reader.css']);

  const mainWorld = kooboneEntries.find((entry) => entry.world === 'MAIN');
  assert.ok(mainWorld, 'MAIN world entry exists');
  assert.deepEqual(mainWorld.js, ['scripts/reader-bridge.js']);
  assert.equal(mainWorld.run_at, 'document_start', 'bridge listens before the content script runs');

  const kmoe = manifest.content_scripts.find((entry) => entry.matches.indexOf('https://mox.moe/*') !== -1);
  assert.deepEqual(kmoe.js, ['shared/settings.js', 'content/content.js']);
  assert.deepEqual(kmoe.css, ['content/content.css']);

  const resources = manifest.web_accessible_resources[0].resources;
  assert.equal(resources.indexOf('scripts/page-bridge.js') !== -1, true, 'kmoe page bridge untouched');
});
