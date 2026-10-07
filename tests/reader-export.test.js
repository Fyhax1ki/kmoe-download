const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'reader-export.js'), 'utf8');

function loadExport() {
  // Evaluated in this realm so assertions can compare plain objects/arrays.
  vm.runInThisContext(SOURCE, { filename: 'shared/reader-export.js' });
  return globalThis.KmoeReaderExport;
}

const Export = loadExport();

function record(md5, overrides) {
  return Object.assign({
    file_md5: md5,
    vol_name: '第01卷',
    vol_series: '妄想老師',
    vol_author: '作者',
    vol_language: 'zh-TW',
    file_type: '2',
    islocal: 0,
    fileSize: 1024,
    hasCover: false,
    coverType: ''
  }, overrides || {});
}

test('parses the vol_open onclick used by the reader', () => {
  const parsed = Export.parseVolumeOnclick("javascript:vol_open('https://dl.example.com/a.epub','a1b2c3');");
  assert.deepEqual(parsed, { url: 'https://dl.example.com/a.epub', md5: 'a1b2c3' });

  assert.deepEqual(
    Export.parseVolumeOnclick("vol_open('https://x/y.epub?sign=1\\'2','md5value')"),
    { url: "https://x/y.epub?sign=1'2", md5: 'md5value' }
  );

  assert.deepEqual(
    Export.parseVolumeOnclick("vol_open(' \\'https://d/z.epub\\' ','f00d')"),
    { url: " 'https://d/z.epub' ", md5: 'f00d' }
  );
});

test('ignores onclick values that are not volume opens', () => {
  assert.equal(Export.parseVolumeOnclick(''), null);
  assert.equal(Export.parseVolumeOnclick(undefined), null);
  assert.equal(Export.parseVolumeOnclick("javascript:do_search('x');"), null);
  assert.equal(Export.parseVolumeOnclick("vol_open('url',   )"), null);
  assert.equal(Export.parseVolumeOnclick("vol_open(url, 'md5')"), null);
});

test('sanitizes path segments for the export directory structure', () => {
  assert.equal(Export.sanitizeSegment('妄想老師'), '妄想老師');
  assert.equal(Export.sanitizeSegment('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
  assert.equal(Export.sanitizeSegment('  trailing dots. .  '), 'trailing dots');
  assert.equal(Export.sanitizeSegment('..'), 'untitled');
  assert.equal(Export.sanitizeSegment('   '), 'untitled');
  assert.equal(Export.sanitizeSegment('', 'fallback-dir'), 'fallback-dir');
  assert.equal(Export.sanitizeSegment('CON'), 'CON_');
  assert.equal(Export.sanitizeSegment('lpt9'), 'lpt9_');
  assert.equal(Export.sanitizeSegment('x'.repeat(200)).length, Export.MAX_SEGMENT_LENGTH);
});

test('maps cached file types to export extensions', () => {
  assert.equal(Export.normalizeExtension('2'), 'epub');
  assert.equal(Export.normalizeExtension('1'), 'mobi');
  assert.equal(Export.normalizeExtension('EPUB'), 'epub');
  assert.equal(Export.normalizeExtension('.epub'), 'epub');
  assert.equal(Export.normalizeExtension('application/epub+zip'), 'epub');
  assert.equal(Export.normalizeExtension('application/pdf'), 'pdf');
  assert.equal(Export.normalizeExtension(''), 'epub');
  assert.equal(Export.normalizeExtension(null), 'epub');
  assert.equal(Export.coverExtension('image/png'), 'png');
  assert.equal(Export.coverExtension('image/webp'), 'webp');
  assert.equal(Export.coverExtension(''), 'jpg');
});

test('pads volume numbers and formats sizes', () => {
  assert.equal(Export.padNumber(1, 2), '01');
  assert.equal(Export.padNumber(12, 2), '12');
  assert.equal(Export.padNumber(3, 3), '003');
  assert.equal(Export.formatBytes(0), '0 B');
  assert.equal(Export.formatBytes(1024), '1.0 KiB');
  assert.equal(Export.formatBytes(1048576), '1.0 MiB');
  assert.equal(Export.formatBytes(1073741824), '1.00 GiB');
});

test('builds the series directory, volume filenames and the series prefix', () => {
  assert.equal(
    Export.buildVolumeFilename(1, 2, '妄想老師', '第01卷', 'epub'),
    '01 妄想老師 第01卷.epub'
  );
  // The series name is not duplicated when it is already part of the volume name.
  assert.equal(
    Export.buildVolumeFilename(2, 2, '妄想老師', '妄想老師 第02卷', 'epub'),
    '02 妄想老師 第02卷.epub'
  );
  const long = Export.buildVolumeFilename(1, 1, 'S', 'x'.repeat(400), 'epub');
  assert.ok(long.length <= Export.MAX_FILENAME_LENGTH, long.length + ' <= ' + Export.MAX_FILENAME_LENGTH);
  assert.ok(long.endsWith('.epub'));
});

test('separates cached volumes from missing ones while keeping list order', () => {
  const plan = Export.buildExportPlan({
    seriesHint: '妄想老師',
    volumes: [
      { md5: 'aaa', name: '第01卷' },
      { md5: 'bbb', name: '第02卷' },
      { md5: 'ccc', name: '第03卷' }
    ],
    cachedByMd5: {
      aaa: record('aaa'),
      ccc: record('ccc', { vol_name: '第03卷', fileSize: 2048 })
    }
  });

  assert.equal(plan.series, '妄想老師');
  assert.equal(plan.seriesDir, '妄想老師');
  assert.equal(plan.listedCount, 3);
  assert.equal(plan.exportedCount, 2);
  assert.equal(plan.missingCount, 1);
  assert.equal(plan.totalBytes, 3072);
  assert.equal(plan.totalSize, '3.0 KiB');

  assert.deepEqual(plan.items.map((item) => item.filename), [
    '01 妄想老師 第01卷.epub',
    '03 妄想老師 第03卷.epub'
  ]);
  assert.deepEqual(plan.missing.map((entry) => entry.label + ' ' + entry.name), ['02 第02卷']);
  assert.equal(plan.missing[0].md5, 'bbb');
  assert.ok(plan.notes.some((note) => note.indexOf('不会联网下载') !== -1 || note.indexOf('不会联网下载') !== -1));
});

test('falls back to the cached series name when the page hint is empty', () => {
  const plan = Export.buildExportPlan({
    seriesHint: '',
    volumes: [{ md5: 'aaa', name: '第01卷' }],
    cachedByMd5: { aaa: record('aaa', { vol_series: '花落紅' }) }
  });

  assert.equal(plan.series, '花落紅');
  assert.equal(plan.seriesDir, '花落紅');
  assert.ok(plan.notes.some((note) => note.indexOf('缓存记录') !== -1));
});

test('uses the fallback directory when no series name is known at all', () => {
  const plan = Export.buildExportPlan({
    seriesHint: '',
    volumes: [{ md5: 'aaa', name: '第01卷' }],
    cachedByMd5: {}
  });

  assert.equal(plan.seriesDir, Export.FALLBACK_SERIES_DIR);
  assert.equal(plan.exportedCount, 0);
  assert.equal(plan.missingCount, 1);
});

test('warns about mixed series and partially loaded lists', () => {
  const plan = Export.buildExportPlan({
    seriesHint: '妄想老師',
    totalHint: 15,
    volumes: [
      { md5: 'aaa', name: '第01卷' },
      { md5: 'bbb', name: '第02卷' }
    ],
    cachedByMd5: {
      aaa: record('aaa', { vol_series: '妄想老師' }),
      bbb: record('bbb', { vol_series: '花落紅' })
    }
  });

  assert.equal(plan.mixedSeries, true);
  assert.deepEqual(plan.seriesNames, ['妄想老師', '花落紅']);
  assert.ok(plan.notes.some((note) => note.indexOf('多个系列') !== -1));
  assert.ok(plan.notes.some((note) => note.indexOf('2 / 共 15 本') !== -1));
});

test('deduplicates repeated md5 entries and keeps same-named volumes distinct', () => {
  const plan = Export.buildExportPlan({
    seriesHint: 'S',
    volumes: [
      { md5: 'aaa', name: 'same' },
      { md5: 'aaa', name: 'same' },
      { md5: 'bbb', name: 'same' }
    ],
    cachedByMd5: {
      aaa: record('aaa', { vol_name: 'same', vol_series: 'S' }),
      bbb: record('bbb', { vol_name: 'same', vol_series: 'S' })
    }
  });

  // The same md5 listed twice is a single volume; the order prefix keeps
  // identical volume names apart on disk.
  assert.equal(plan.listedCount, 2);
  assert.deepEqual(plan.items.map((item) => item.filename), ['01 S same.epub', '02 S same.epub']);
});

test('picks the first available cover and keeps its own extension', () => {
  const plan = Export.buildExportPlan({
    seriesHint: 'S',
    volumes: [{ md5: 'aaa', name: 'a' }, { md5: 'bbb', name: 'b' }],
    cachedByMd5: {
      aaa: record('aaa', { vol_series: 'S', hasCover: false }),
      bbb: record('bbb', { vol_series: 'S', hasCover: true, coverType: 'image/png' })
    }
  });

  assert.deepEqual(plan.cover, { filename: 'cover.png', md5: 'bbb' });
});

test('supports a cached volume with a locally imported file', () => {
  const plan = Export.buildExportPlan({
    seriesHint: 'S',
    volumes: [{ md5: 'aaa', name: 'a' }],
    cachedByMd5: { aaa: record('aaa', { vol_series: 'S', islocal: 1 }) }
  });

  assert.equal(plan.items[0].local, true);
  assert.equal(Export.buildManifest(plan, {}).volumes[0].importedLocally, true);
});

test('builds a manifest that describes the archive contents', () => {
  const plan = Export.buildExportPlan({
    seriesHint: '妄想老師',
    volumes: [{ md5: 'aaa', name: '第01卷' }, { md5: 'bbb', name: '第02卷' }],
    cachedByMd5: { aaa: record('aaa') }
  });

  const manifest = Export.buildManifest(plan, {
    exportedAt: '2026-02-19T00:00:00.000Z',
    pageUrl: 'https://koobone.com/',
    pageTitle: 'KOOBONE',
    site: 'koobone.com'
  });

  assert.equal(manifest.series, '妄想老師');
  assert.equal(manifest.directory, '妄想老師');
  assert.equal(manifest.exportedAt, '2026-02-19T00:00:00.000Z');
  assert.deepEqual(manifest.stats, {
    listed: 2,
    exported: 1,
    missing: 1,
    totalBytes: 1024,
    totalSize: '1.0 KiB'
  });
  assert.deepEqual(manifest.volumes.map((volume) => volume.filename), ['01 妄想老師 第01卷.epub']);
  assert.deepEqual(manifest.missing.map((entry) => entry.md5), ['bbb']);
  assert.equal(manifest.source.site, 'koobone.com');
  assert.ok(manifest.generator.indexOf('Kmoe') !== -1);
});

test('builds a missing report that names every absent volume and md5', () => {
  const plan = Export.buildExportPlan({
    seriesHint: '妄想老師',
    volumes: [{ md5: 'aaa', name: '第01卷' }, { md5: 'bbb', name: '第02卷' }],
    cachedByMd5: { aaa: record('aaa') }
  });

  const text = Export.buildMissingReport(plan, { exportedAt: '2026-02-19T00:00:00.000Z' });

  assert.ok(text.indexOf('系列：妄想老師') !== -1);
  assert.ok(text.indexOf('已导出 1 卷') !== -1);
  assert.ok(text.indexOf('01 妄想老師 第01卷.epub') !== -1);
  assert.ok(text.indexOf('缓存中缺失 1 卷') !== -1);
  assert.ok(text.indexOf('第02卷') !== -1);
  assert.ok(text.indexOf('file_md5: bbb') !== -1);
  assert.ok(text.indexOf('不会联网下载') !== -1);
});

test('reports a fully cached series as complete', () => {
  const plan = Export.buildExportPlan({
    seriesHint: '花落紅',
    volumes: [{ md5: 'aaa', name: '第01卷' }],
    cachedByMd5: { aaa: record('aaa', { vol_series: '花落紅' }) }
  });

  const text = Export.buildMissingReport(plan, {});
  assert.ok(text.indexOf('缓存中缺失 0 卷') !== -1);
  assert.ok(text.indexOf('已全部导出') !== -1);
  assert.ok(text.indexOf('不会联网下载') === -1 || text.indexOf('已全部导出') !== -1);
});

test('extracts volume ordinals only from explicit volume markers', () => {
  assert.equal(Export.extractVolumeOrdinal('花落紅 - 卷01'), 1);
  assert.equal(Export.extractVolumeOrdinal('第12卷'), 12);
  assert.equal(Export.extractVolumeOrdinal('妄想老師 第 7 巻'), 7);
  assert.equal(Export.extractVolumeOrdinal('Vol.3'), 3);
  assert.equal(Export.extractVolumeOrdinal('volume 10'), 10);
  assert.equal(Export.extractVolumeOrdinal('Part 2'), 2);
  assert.equal(Export.extractVolumeOrdinal('2024 年刊'), null);
  assert.equal(Export.extractVolumeOrdinal('無卷號'), null);
  assert.equal(Export.extractVolumeOrdinal(''), null);
});

test('exports volumes in reading order when the page lists them out of order', () => {
  const plan = Export.buildExportPlan({
    seriesHint: '花落紅',
    volumes: [
      { md5: 'v1', name: '花落紅 - 卷01' },
      { md5: 'v4', name: '花落紅 - 卷04' },
      { md5: 'v3', name: '花落紅 - 卷03' },
      { md5: 'v2', name: '花落紅 - 卷02' }
    ],
    cachedByMd5: {
      v1: record('v1', { vol_name: '花落紅 - 卷01', vol_series: '花落紅' }),
      v2: record('v2', { vol_name: '花落紅 - 卷02', vol_series: '花落紅' }),
      v4: record('v4', { vol_name: '花落紅 - 卷04', vol_series: '花落紅' })
    }
  });

  assert.equal(plan.orderedBy, 'volume-number');
  assert.deepEqual(plan.items.map((item) => item.filename), [
    '01 花落紅 - 卷01.epub',
    '02 花落紅 - 卷02.epub',
    '04 花落紅 - 卷04.epub'
  ]);
  assert.deepEqual(plan.missing.map((entry) => entry.label + ' ' + entry.name), ['03 花落紅 - 卷03']);
  assert.equal(plan.items[0].listedOrder, 1);
  assert.equal(plan.items[1].listedOrder, 4);
  assert.equal(plan.missing[0].listedOrder, 3);
});

test('keeps the page order when volumes carry no usable numbering', () => {
  const plan = Export.buildExportPlan({
    seriesHint: 'S',
    volumes: [{ md5: 'b', name: '下集' }, { md5: 'a', name: '上集' }],
    cachedByMd5: {
      a: record('a', { vol_name: '上集', vol_series: 'S' }),
      b: record('b', { vol_name: '下集', vol_series: 'S' })
    }
  });

  assert.equal(plan.orderedBy, 'page-listing');
  assert.deepEqual(plan.items.map((item) => item.name), ['下集', '上集']);
});

test('keeps the page order when volume numbers are ambiguous', () => {
  const plan = Export.buildExportPlan({
    seriesHint: 'S',
    volumes: [{ md5: 'a', name: '卷01' }, { md5: 'b', name: '第01巻' }],
    cachedByMd5: {
      a: record('a', { vol_name: '卷01', vol_series: 'S' }),
      b: record('b', { vol_name: '第01巻', vol_series: 'S' })
    }
  });

  assert.equal(plan.orderedBy, 'page-listing');
  assert.deepEqual(plan.items.map((item) => item.name), ['卷01', '第01巻']);
});

test('numbers volumes with at least two digits', () => {
  const volumes = [];
  const cachedByMd5 = {};
  for (let i = 1; i <= 12; i++) {
    const md5 = 'md5-' + i;
    volumes.push({ md5, name: '第 ' + i + ' 卷' });
    cachedByMd5[md5] = record(md5, { vol_name: '第 ' + i + ' 卷', vol_series: 'S' });
  }

  const plan = Export.buildExportPlan({ seriesHint: 'S', volumes, cachedByMd5 });
  assert.equal(plan.items[0].label, '01');
  assert.equal(plan.items[11].label, '12');
  assert.ok(plan.items[11].filename.startsWith('12 '));
});

test('splits the series prefix the site renders in volume names', () => {
  assert.equal(Export.splitSeriesPrefix('花落紅 - 卷01'), '花落紅');
  assert.equal(Export.splitSeriesPrefix('異世界好色無雙錄 - 話056-057'), '異世界好色無雙錄');
  assert.equal(Export.splitSeriesPrefix('A - B - 卷01'), 'A - B');
  assert.equal(Export.splitSeriesPrefix('無分隔符'), '');
  assert.equal(Export.splitSeriesPrefix(''), '');
});

test('treats a series-filtered page as a single locked scope', () => {
  const volumes = [
    { md5: 'a', name: '花落紅 - 卷01' },
    { md5: 'b', name: '花落紅 - 卷02' }
  ];
  const grouping = Export.groupVolumesBySeries(volumes, { a: record('a', { vol_series: '花落紅' }) }, '花落紅');

  assert.equal(grouping.locked, true);
  assert.equal(grouping.groups.length, 1);
  assert.equal(grouping.groups[0].series, '花落紅');
  assert.equal(grouping.groups[0].volumes.length, 2);
  assert.equal(grouping.groups[0].cachedCount, 1);
});

test('splits the mixed library view into selectable series scopes', () => {
  const volumes = [
    { md5: 'm1', name: '妄想老師 - 卷13' },
    { md5: 'h1', name: '花落紅 - 卷01' },
    { md5: 'h2', name: '花落紅 - 卷02' },
    { md5: 'u1', name: '本地導入檔案' }
  ];
  const cachedByMd5 = {
    m1: record('m1', { vol_series: '妄想老師' }),
    h1: record('h1', { vol_series: '花落紅' })
  };

  const grouping = Export.groupVolumesBySeries(volumes, cachedByMd5, '');

  assert.equal(grouping.locked, false);
  // The series that owns cached volumes comes first: that is what the user reads.
  assert.deepEqual(grouping.groups.map((group) => group.series), ['妄想老師', '花落紅', Export.UNKNOWN_SERIES]);
  assert.deepEqual(grouping.groups.map((group) => group.cachedCount), [1, 1, 0]);
  assert.deepEqual(grouping.groups[1].volumes.map((volume) => volume.md5), ['h1', 'h2']);
  assert.equal(grouping.unattributedCount, 1);
});

test('trusts the cached series name over the rendered name prefix', () => {
  const volumes = [{ md5: 'x', name: '錯的前綴 - 卷01' }];
  const grouping = Export.groupVolumesBySeries(volumes, { x: record('x', { vol_series: '真系列' }) }, '');

  assert.deepEqual(grouping.groups.map((group) => group.series), ['真系列']);
});

test('lists archive entries in offline-reading order', () => {
  const plan = Export.buildExportPlan({
    seriesHint: '妄想老師',
    volumes: [{ md5: 'aaa', name: '第01卷' }, { md5: 'bbb', name: '第02卷' }],
    cachedByMd5: {
      aaa: record('aaa', { hasCover: true, coverType: 'image/jpeg' }),
      bbb: record('bbb', { vol_name: '第02卷' })
    }
  });

  assert.deepEqual(Export.buildEntryList(plan), [
    { path: '妄想老師/manifest.json', kind: 'manifest' },
    { path: '妄想老師/cover.jpg', kind: 'cover', md5: 'aaa' },
    { path: '妄想老師/01 妄想老師 第01卷.epub', kind: 'volume', md5: 'aaa' },
    { path: '妄想老師/02 妄想老師 第02卷.epub', kind: 'volume', md5: 'bbb' },
    { path: '妄想老師/MISSING.txt', kind: 'missing' }
  ]);
});

test('classifies the site messages seen while topping up the cache', () => {
  // 文案取自站点 zxfunc.js 的 aCodeMsg（站点是简繁混排）。
  const downloading = 'error_outline 正在将文档從服務器下載至本地緩存中... 請不要刷新頁面';
  assert.equal(Export.isTransientCacheMessage(downloading), true);
  assert.equal(Export.isFatalCacheFailure(downloading), false, 'the normal progress tip is not a failure');

  assert.equal(Export.isFatalCacheFailure('未登錄，請先登錄'), true);
  assert.equal(Export.isFatalCacheFailure('頁面數據過期，請刷新頁面後再操作'), true);
  assert.equal(Export.isFatalCacheFailure('空間不足，建議刪除部分文檔後再上傳'), true);
  assert.equal(Export.isFatalCacheFailure('写入存儲數據失敗，請更新至最新 Chrome 瀏覽器，或報告給管理員'), true);
  assert.equal(Export.isFatalCacheFailure('瀏覽器不支持本地存儲，請更新至最新 Chrome 瀏覽器後訪問本站'), true);
  assert.equal(Export.isFatalCacheFailure('打開本地存儲失敗，請退出「私密/無痕模式」，仍異常可報告管理員'), true);
  assert.equal(Export.isFatalCacheFailure('本地存儲功能無效，請退出「私密/無痕模式」或使用 Chrome 瀏覽器'), true);
  assert.equal(Export.isFatalCacheFailure('系統錯誤'), true);

  // 单卷网络失败 / 通用缓存失败不应中止整个任务，交给连续失败上限判断。
  assert.equal(Export.isFatalCacheFailure('讀取網絡數據錯誤，建議報告給網站管理員。'), false);
  assert.equal(Export.isFatalCacheFailure('緩存失敗，請檢查網絡狀況、本地存儲空間或重啟瀏覽器嘗試'), false);
  assert.equal(Export.isTransientCacheMessage(''), false);
  assert.equal(Export.isTransientCacheMessage('緩存失敗'), false);
});

test('summarises a cache run for the panel', () => {
  const completed = Export.buildCacheRunReport({ total: 12, okCount: 12, failed: [] });
  assert.match(completed, /缓存完成：成功 12 \/ 12 卷/);
  assert.match(completed, /未修改任何缓存结构/);

  const partial = Export.buildCacheRunReport({
    total: 12,
    okCount: 10,
    failed: [
      { name: '花落紅 - 卷11', reason: '讀取網絡數據錯誤' },
      { name: '花落紅 - 卷12', reason: '等待站点完成缓存超时（10 分钟）' }
    ]
  });
  assert.match(partial, /成功 10 \/ 12 卷/);
  assert.match(partial, /失败 2 卷/);
  assert.match(partial, /花落紅 - 卷11 — 讀取網絡數據錯誤/);

  const cancelled = Export.buildCacheRunReport({ total: 12, okCount: 3, cancelled: true, failed: [] });
  assert.match(cancelled, /已取消：成功缓存 3 \/ 12 卷/);

  const stopped = Export.buildCacheRunReport({ total: 12, okCount: 5, fatalReason: '空間不足', failed: [] });
  assert.match(stopped, /已停止：空間不足/);
  assert.match(stopped, /成功缓存 5 \/ 12 卷/);
});
