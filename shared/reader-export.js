(function (root) {
  'use strict';

  // Pure, side-effect free helpers for the "导出漫画" feature of the koobone.com
  // reader. Everything here works on plain data so it can be unit tested and so
  // the content script stays a thin shell around it.
  //
  // 导出只保留漫画源文件：只有 EPUB 会进入压缩包，manifest / 封面 / 缺失报告
  // 这些附加产物都已移除（缺失信息只在面板上提示）。
  var VOL_ONCLICK_RE = /vol_open\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)/;
  var RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  var MAX_SEGMENT_LENGTH = 80;
  var MAX_FILENAME_LENGTH = 120;
  var FALLBACK_SERIES_DIR = 'manga-export';
  var UNKNOWN_SERIES = '未知系列';
  var SERIES_SEPARATOR = ' - ';
  // 导出只保留漫画源文件本身：只有真正的 EPUB 才会进入压缩包。
  var EXPORT_EXTENSION = 'epub';

  var EXTENSION_ALIASES = {
    '1': 'mobi',
    '2': 'epub',
    '3': 'azw3',
    'application/epub+zip': 'epub',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'application/x-mobipocket-ebook': 'mobi',
    'application/x-zip-compressed': 'zip'
  };

  function normalizeText(value) {
    if (value === undefined || value === null) return '';
    return String(value).replace(/\s+/g, ' ').trim();
  }

  function toFiniteNumber(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function unescapeQuoted(value) {
    return String(value).replace(/\\(['"\\/])/g, '$1');
  }

  function parseVolumeOnclick(onclick) {
    var text = String(onclick || '');
    var match = text.match(VOL_ONCLICK_RE);
    if (!match) return null;

    var md5 = normalizeText(unescapeQuoted(match[2]));
    if (!md5) return null;

    return {
      url: unescapeQuoted(match[1]),
      md5: md5
    };
  }

  function sanitizeSegment(name, fallback) {
    var value = String(name === undefined || name === null ? '' : name);
    value = value.replace(/[\u0000-\u001f\u007f]/g, ' ');
    value = value.replace(/[<>:"/\\|?*]/g, '_');
    value = value.replace(/\s+/g, ' ').trim();
    value = value.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');

    if (value.length > MAX_SEGMENT_LENGTH) {
      value = value.slice(0, MAX_SEGMENT_LENGTH).replace(/[\uD800-\uDBFF]$/, '').replace(/[.\s]+$/, '');
    }

    if (!value) return String(fallback || 'untitled');
    if (RESERVED_NAMES.test(value)) return value + '_';
    return value;
  }

  function normalizeExtension(fileType) {
    var raw = normalizeText(fileType).toLowerCase();
    if (!raw) return 'epub';
    if (EXTENSION_ALIASES[raw]) return EXTENSION_ALIASES[raw];

    raw = raw.replace(/^\./, '');
    if (raw.indexOf('epub') !== -1) return 'epub';
    if (raw.indexOf('pdf') !== -1) return 'pdf';
    if (raw.indexOf('zip') !== -1) return 'zip';
    if (/^[a-z0-9]{1,5}$/.test(raw)) return raw;
    return 'epub';
  }

  function padNumber(value, width) {
    var text = String(Math.max(0, parseInt(value, 10) || 0));
    var size = Math.max(1, parseInt(width, 10) || 1);
    while (text.length < size) text = '0' + text;
    return text;
  }

  function formatBytes(bytes) {
    var value = toFiniteNumber(bytes);
    if (value <= 0) return '0 B';
    if (value >= 1073741824) return (value / 1073741824).toFixed(2) + ' GiB';
    if (value >= 1048576) return (value / 1048576).toFixed(1) + ' MiB';
    if (value >= 1024) return (value / 1024).toFixed(1) + ' KiB';
    return value + ' B';
  }

  function buildVolumeFilename(order, width, series, volName, ext) {
    var label = padNumber(order, width);
    var base = normalizeText(volName) || ('第 ' + label + ' 卷');
    var seriesName = normalizeText(series);
    if (seriesName && base.indexOf(seriesName) === -1) {
      base = seriesName + ' ' + base;
    }

    var suffix = '.' + ext;
    var room = MAX_FILENAME_LENGTH - label.length - 1 - suffix.length;
    var safe = sanitizeSegment(base, 'vol-' + label);
    if (safe.length > room && room > 8) {
      safe = safe.slice(0, room).replace(/[\uD800-\uDBFF]$/, '').replace(/[.\s]+$/, '');
    }

    return label + ' ' + safe + suffix;
  }

  // 站点把卷名渲染成「<系列> - <卷>」。缓存记录里的 vol_series 是权威值，
  // 这里的前缀拆分只是为没有缓存记录的卷提供一个可归类的名字。
  function splitSeriesPrefix(name) {
    var text = normalizeText(name);
    var index = text.lastIndexOf(SERIES_SEPARATOR);
    if (index <= 0) return '';
    return text.slice(0, index).trim();
  }

  // 把一个页面上列出的卷集合拆分为若干系列分组。
  // 有 seriesHint（站点按系列筛选时写入 input_search）时列表已经是单一系列。
  function groupVolumesBySeries(volumes, cachedByMd5, seriesHint) {
    var list = (Array.isArray(volumes) ? volumes : []).filter(function (volume) {
      return volume && normalizeText(volume.md5);
    });
    var hint = normalizeText(seriesHint);

    if (hint) {
      return {
        locked: true,
        groups: [{ series: hint, volumes: list, cachedCount: countCached(list, cachedByMd5) }],
        unattributedCount: 0
      };
    }

    var order = [];
    var bySeries = {};

    list.forEach(function (volume) {
      var md5 = normalizeText(volume.md5);
      var record = (cachedByMd5 || {})[md5];
      var series = record ? normalizeText(record.vol_series) : '';
      if (!series) series = splitSeriesPrefix(volume.name);
      if (!series) series = UNKNOWN_SERIES;

      if (!bySeries[series]) {
        bySeries[series] = { series: series, volumes: [], cachedCount: 0 };
        order.push(series);
      }

      bySeries[series].volumes.push(volume);
      if (record) bySeries[series].cachedCount++;
    });

    // 有缓存的系列排前面：那通常就是用户正在读的那一部。
    var groups = order.map(function (series) { return bySeries[series]; });
    groups.sort(function (a, b) {
      return b.cachedCount - a.cachedCount || order.indexOf(a.series) - order.indexOf(b.series);
    });

    return {
      locked: false,
      groups: groups,
      unattributedCount: bySeries[UNKNOWN_SERIES] ? bySeries[UNKNOWN_SERIES].volumes.length : 0
    };
  }

  function countCached(volumes, cachedByMd5) {
    return volumes.reduce(function (sum, volume) {
      return sum + ((cachedByMd5 || {})[normalizeText(volume.md5)] ? 1 : 0);
    }, 0);
  }

  // 站点缓存的瞬时提示（m104），等待缓存时不应被当成失败。
  var CACHE_TRANSIENT_PATTERNS = [/正在将文档/, /正在將文檔/, /請不要刷新頁面/, /请不要刷新页面/];
  // 出现这些提示时继续跑下去没有意义。文案对齐站点 zxfunc.js 的 aCodeMsg
  // （站点是简繁混排，两种写法都要盖）。
  // 注：e420「緩存失敗」故意不在此列——它也可能是单卷网络失败，
  // 那种情况应该让「连续失败上限」去决定何时停下来。
  var CACHE_FATAL_PATTERNS = [
    /未登錄|未登录/,
    /頁面數據過期|页面数据过期/,
    /空間不足|空间不足/,
    /不支持本地存儲|不支持本地存储/,
    /打開本地存儲失敗|打开本地存储失败/,
    /本地存儲功能無效|本地存储功能无效/,
    /存儲數據失敗|存储数据失败/,
    /系統錯誤|系统错误/
  ];

  function matchesAny(patterns, text) {
    var value = normalizeText(text);
    if (!value) return false;
    return patterns.some(function (pattern) { return pattern.test(value); });
  }

  function isTransientCacheMessage(text) {
    return matchesAny(CACHE_TRANSIENT_PATTERNS, text);
  }

  function isFatalCacheFailure(text) {
    return matchesAny(CACHE_FATAL_PATTERNS, text);
  }

  // run: { total, okCount, failed: [{ name, reason }], cancelled, fatalReason }
  function buildCacheRunReport(run) {
    run = run || {};
    var total = toFiniteNumber(run.total);
    var okCount = toFiniteNumber(run.okCount);
    var failed = Array.isArray(run.failed) ? run.failed : [];
    var lines = [];

    if (run.cancelled) {
      lines.push('已取消：成功缓存 ' + okCount + ' / ' + total + ' 卷。');
    } else if (run.fatalReason) {
      lines.push('已停止：' + run.fatalReason);
      lines.push('成功缓存 ' + okCount + ' / ' + total + ' 卷。');
    } else {
      lines.push('缓存完成：成功 ' + okCount + ' / ' + total + ' 卷。');
    }

    if (failed.length) {
      lines.push('');
      lines.push('失败 ' + failed.length + ' 卷：');
      failed.forEach(function (item) {
        lines.push('  ' + (item.name || item.md5 || '') + ' — ' + (item.reason || '未知原因'));
      });
    }

    lines.push('');
    lines.push('说明：下载与写缓存都由站点自身的流程完成，扩展只是触发了它的入口，未修改任何缓存结构。');
    return lines.join('\n');
  }

  // input: {
  //   seriesHint: string,             // series name shown by the page, when known
  //   volumes: [{ md5, name, size }],  // volumes currently listed on the page, in order
  //   cachedByMd5: { md5: record },    // records fetched from IndexedDB (current series only)
  //   totalHint: number|null,          // total volume count reported by the page
  //   listComplete: boolean            // whether the page list covers the whole series
  // }
  var ORDINAL_PATTERNS = [
    /第\s*0*(\d+)\s*[卷巻册冊集回話话章]/,
    /[卷巻]\s*0*(\d+)/,
    /\bvol(?:ume)?\.?\s*0*(\d+)\b/i,
    /\bpart\s*0*(\d+)\b/i
  ];

  // Only explicit volume markers are trusted; a bare number in a title is not.
  function extractVolumeOrdinal(name) {
    var text = normalizeText(name);
    if (!text) return null;

    for (var i = 0; i < ORDINAL_PATTERNS.length; i++) {
      var match = text.match(ORDINAL_PATTERNS[i]);
      if (match) {
        var value = parseInt(match[1], 10);
        if (Number.isFinite(value)) return value;
      }
    }

    return null;
  }

  // Volumes are listed in whatever order the site currently uses (for example by
  // reading time). When every listed volume carries a number, export them in
  // reading order; otherwise keep the page order untouched.
  function sortVolumesByOrdinal(entries) {
    if (entries.length < 2) return { entries: entries.slice(), orderedBy: 'page-listing' };

    var decorated = [];
    var seen = {};

    for (var i = 0; i < entries.length; i++) {
      var ordinal = extractVolumeOrdinal(entries[i].name);
      if (ordinal === null || seen[ordinal]) {
        return { entries: entries.slice(), orderedBy: 'page-listing' };
      }
      seen[ordinal] = true;
      decorated.push({ entry: entries[i], ordinal: ordinal, position: i });
    }

    decorated.sort(function (a, b) {
      return a.ordinal === b.ordinal ? a.position - b.position : a.ordinal - b.ordinal;
    });

    return {
      entries: decorated.map(function (item) { return item.entry; }),
      orderedBy: 'volume-number'
    };
  }

  function buildExportPlan(input) {
    input = input || {};

    var fallbackSeriesDir = input.seriesDirFallback || FALLBACK_SERIES_DIR;
    var seriesHint = normalizeText(input.seriesHint);
    var cachedMap = input.cachedByMd5 || {};
    var totalHint = Number.isFinite(Number(input.totalHint)) && Number(input.totalHint) > 0
      ? Number(input.totalHint)
      : null;
    var listComplete = input.listComplete === undefined ? true : !!input.listComplete;

    var ordered = [];
    var seen = {};
    (Array.isArray(input.volumes) ? input.volumes : []).forEach(function (volume) {
      if (!volume) return;
      var md5 = normalizeText(volume.md5);
      if (!md5 || seen[md5]) return;
      seen[md5] = true;
      ordered.push({
        md5: md5,
        pageName: normalizeText(volume.name),
        pageSize: toFiniteNumber(volume.size)
      });
    });

    var seriesNames = [];
    // Resolve every listed entry first so ordering can look at the final names.
    var resolved = ordered.map(function (entry, position) {
      var record = cachedMap[entry.md5];
      var recordSeries = record ? normalizeText(record.vol_series) : '';
      if (recordSeries && seriesNames.indexOf(recordSeries) === -1) seriesNames.push(recordSeries);

      return {
        md5: entry.md5,
        listedOrder: position + 1,
        cached: !!record,
        name: (record ? normalizeText(record.vol_name) : '') || entry.pageName,
        record: record || null,
        pageSize: entry.pageSize
      };
    });

    resolved.forEach(function (entry) {
      if (!entry.name) entry.name = '第 ' + entry.listedOrder + ' 卷';
    });

    var sorting = sortVolumesByOrdinal(resolved);
    // Two digits minimum so filenames sort naturally in every file manager.
    var width = Math.max(2, String(Math.max(resolved.length, totalHint || 0)).length);
    var items = [];
    var missing = [];
    var skipped = [];
    var totalBytes = 0;

    sorting.entries.forEach(function (entry, position) {
      var order = position + 1;
      var label = padNumber(order, width);
      var record = entry.record;

      if (!record) {
        missing.push({
          order: order,
          label: label,
          md5: entry.md5,
          name: entry.name,
          listedOrder: entry.listedOrder
        });
        return;
      }

      var fileType = normalizeText(record.file_type);
      var ext = normalizeExtension(fileType);
      var sizeBytes = toFiniteNumber(record.fileSize) || toFiniteNumber(record.file_blob_size) || entry.pageSize;
      var series = normalizeText(record.vol_series) || seriesHint;

      // 「只保存 EPUB 源文件」：缓存里的其它格式不进压缩包，也不做任何转换。
      if (ext !== EXPORT_EXTENSION) {
        skipped.push({
          order: order,
          label: label,
          listedOrder: entry.listedOrder,
          md5: entry.md5,
          name: entry.name,
          ext: ext,
          fileType: fileType,
          sizeBytes: sizeBytes
        });
        return;
      }

      totalBytes += sizeBytes;
      items.push({
        order: order,
        label: label,
        listedOrder: entry.listedOrder,
        md5: entry.md5,
        name: entry.name,
        filename: buildVolumeFilename(order, width, series, entry.name, ext),
        ext: ext,
        sizeBytes: sizeBytes
      });
    });

    var resolvedSeries = seriesHint || seriesNames[0] || '';
    var seriesDir = sanitizeSegment(resolvedSeries, fallbackSeriesDir);

    var notes = [];
    if (!seriesHint && seriesNames.length === 1) {
      notes.push('系列名取自缓存记录：' + seriesNames[0]);
    }
    if (seriesNames.length > 1) {
      notes.push('当前列表包含多个系列（' + seriesNames.join('、') + '），已按列表顺序合并导出。');
    }
    if (totalHint !== null && totalHint > ordered.length) {
      notes.push('当前列表只加载了 ' + ordered.length + ' / 共 ' + totalHint + ' 本，缺失报告仅覆盖已加载部分。');
    } else if (!listComplete) {
      notes.push('当前列表可能未加载完整，缺失报告仅覆盖已加载部分。');
    }
    if (missing.length) {
      notes.push('缺失卷在浏览器缓存中不存在；导出过程不会联网下载，请先在阅读器中打开这些卷再重新导出。');
    }
    if (skipped.length) {
      var skippedExts = [];
      skipped.forEach(function (entry) {
        if (skippedExts.indexOf(entry.ext) === -1) skippedExts.push(entry.ext);
      });
      notes.push('缓存中有 ' + skipped.length + ' 卷不是 EPUB（' + skippedExts.join('、') +
        '），按「只保存 EPUB 源文件」跳过，未写入压缩包。');
    }

    return {
      series: resolvedSeries,
      seriesDir: seriesDir,
      listedCount: ordered.length,
      items: items,
      missing: missing,
      skipped: skipped,
      exportedCount: items.length,
      missingCount: missing.length,
      skippedCount: skipped.length,
      totalBytes: totalBytes,
      totalSize: formatBytes(totalBytes),
      totalHint: totalHint,
      listComplete: listComplete,
      orderedBy: sorting.orderedBy,
      seriesNames: seriesNames,
      mixedSeries: seriesNames.length > 1,
      notes: notes
    };
  }

  var api = {
    FALLBACK_SERIES_DIR: FALLBACK_SERIES_DIR,
    MAX_SEGMENT_LENGTH: MAX_SEGMENT_LENGTH,
    MAX_FILENAME_LENGTH: MAX_FILENAME_LENGTH,
    UNKNOWN_SERIES: UNKNOWN_SERIES,
    normalizeText: normalizeText,
    parseVolumeOnclick: parseVolumeOnclick,
    sanitizeSegment: sanitizeSegment,
    normalizeExtension: normalizeExtension,
    padNumber: padNumber,
    formatBytes: formatBytes,
    isTransientCacheMessage: isTransientCacheMessage,
    isFatalCacheFailure: isFatalCacheFailure,
    buildCacheRunReport: buildCacheRunReport,
    buildVolumeFilename: buildVolumeFilename,
    extractVolumeOrdinal: extractVolumeOrdinal,
    splitSeriesPrefix: splitSeriesPrefix,
    groupVolumesBySeries: groupVolumesBySeries,
    buildExportPlan: buildExportPlan
  };

  root.KmoeReaderExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
