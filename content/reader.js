(function () {
  'use strict';

  // 导出漫画 — koobone.com 阅读站专用内容脚本。
  //
  // 设计约束（见 README「导出漫画」一节）：
  //  1. 只读取当前网页已经产生的浏览器缓存（IndexedDB "KOOBONE" → book_vol）。
  //  2. 绝不联网下载、绝不访问站点缓存之外的浏览器数据。
  //  3. 只读，不写缓存、不改动阅读器状态，因此不会破坏现有阅读功能。
  //  4. 缓存不足以还原当前系列时，明确列出缺失卷，而不是偷偷重新下载。
  var Export = globalThis.KmoeReaderExport;
  var Zip = globalThis.KmoeZip;

  var DB_NAME = 'KOOBONE';
  var STORE_NAME = 'book_vol';
  var FLOATING_ID = 'kmoe-reader-floating';
  var CARD_ID = 'kmoe-export-card';
  var DRAG_THRESHOLD_PX = 5;
  var SCAN_INTERVAL_MS = 1500;
  var BRIDGE_SOURCE = 'kmoe-reader-bridge';
  // 补缓存：逐卷串行，卷间留间隔；单卷等待上限与连续失败上限用于及时停下来。
  var CACHE_LAUNCH_DELAY_MS = 1500;
  var CACHE_POLL_INTERVAL_MS = 800;
  var CACHE_VOLUME_TIMEOUT_MS = 10 * 60 * 1000;
  var CACHE_MAX_CONSECUTIVE_FAILURES = 3;
  var BRIDGE_TIMEOUT_MS = 10000;

  var cachedPlan = null;
  var cachedRecords = null;
  var cachedGrouping = null;
  var selectedSeriesIndex = 0;
  var cacheRun = null;
  var bridgeSeq = 0;
  var bridgePending = {};
  var bridgeState = 'unknown'; // unknown | ready | missing
  var exporting = false;
  var exportCancelled = false;
  var pendingRefresh = false;
  var lastSignature = '';

  // ---------------------------------------------------------------------------
  // 页面读取：当前系列 / 当前卷列表
  // ---------------------------------------------------------------------------

  function squeeze(text) {
    return String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  function textOf(node) {
    return node && node.textContent ? squeeze(node.textContent) : '';
  }

  // 卷名在版式里可能位于锚点内部的 <b>，也可能是锚点所在单元格里的 <font>。
  // 锚点自身的文本是封面叠加层（例如 “0% download_done”），不能优先使用。
  function nameFromScope(scope) {
    if (!scope || !scope.querySelector) return '';

    var fonts = scope.querySelectorAll('font');
    var i;
    for (i = 0; i < fonts.length; i++) {
      var style = String(fonts[i].getAttribute('style') || '');
      if (style.indexOf('font-size:12px') !== -1) {
        var sized = textOf(fonts[i]);
        if (sized) return sized;
      }
    }

    var bold = textOf(scope.querySelector('b'));
    if (bold) return bold;

    for (i = 0; i < fonts.length; i++) {
      var text = textOf(fonts[i]);
      if (text) return text;
    }

    return '';
  }

  function cleanAnchorText(anchor) {
    return squeeze(String(anchor.textContent || '')
      .replace(/\d+\s*%/g, '')
      .replace(/download_done|download|materialicon/gi, ''));
  }

  function findVolumeName(anchor) {
    var name = textOf(anchor.querySelector && anchor.querySelector('b'));
    if (name) return name;

    var node = anchor;
    for (var depth = 0; node && depth < 4; depth++) {
      name = nameFromScope(node.parentNode);
      if (name) return name;

      var sibling = node.nextSibling;
      while (sibling) {
        if (sibling.nodeType === 1) {
          name = nameFromScope(sibling);
          if (name) return name;
        }
        sibling = sibling.nextSibling;
      }

      sibling = node.previousSibling;
      while (sibling) {
        if (sibling.nodeType === 1) {
          name = nameFromScope(sibling);
          if (name) return name;
        }
        sibling = sibling.previousSibling;
      }

      node = node.parentNode;
    }

    return cleanAnchorText(anchor);
  }

  // 卷列表来自页面 DOM（站点在点击系列后用 vol_list.php 渲染）。
  function collectPageVolumes() {
    var anchors = document.querySelectorAll('[onclick*="vol_open"]');
    var volumes = [];
    var seen = {};

    Array.prototype.forEach.call(anchors, function (anchor) {
      var parsed = Export.parseVolumeOnclick(anchor.getAttribute('onclick'));
      if (!parsed || seen[parsed.md5]) return;
      seen[parsed.md5] = true;
      volumes.push({ md5: parsed.md5, url: parsed.url, name: findVolumeName(anchor) });
    });

    return volumes;
  }

  function getSeriesHint() {
    var input = document.getElementById('input_search');
    return input && input.value ? squeeze(input.value) : '';
  }

  // 站点把 vol_open 写在卷封面的 inline onclick 上，形如
  // javascript:vol_open('<带签名的下载地址>','<file_md5>')。
  // 地址带有时效签名，因此每次要用之前才从 DOM 现取，不复用计划里的旧值。
  function findVolumeOnclick(md5) {
    var anchors = document.querySelectorAll('[onclick*="vol_open"]');
    for (var i = 0; i < anchors.length; i++) {
      var parsed = Export.parseVolumeOnclick(anchors[i].getAttribute('onclick'));
      if (parsed && parsed.md5 === md5) return parsed;
    }
    return null;
  }

  function getTotalHint() {
    var candidates = ['div_page', 'div_divpage', 'div_listpage', 'div_pagebar'];
    for (var i = 0; i < candidates.length; i++) {
      var node = document.getElementById(candidates[i]);
      var match = node && node.textContent ? node.textContent.match(/共\s*(\d+)\s*本/) : null;
      if (match) return parseInt(match[1], 10);
    }
    return null;
  }

  // 站点在还有更多页时显示 #div_loading，最后一页改为显示 #div_listend。
  function isListComplete() {
    var loading = document.getElementById('div_loading');
    if (!loading) return true;
    return getComputedStyle(loading).display === 'none';
  }

  function pageSignature(volumes, seriesHint) {
    return seriesHint + '|' + volumes.length + '|' + volumes.map(function (volume) {
      return volume.md5;
    }).join(',');
  }

  // ---------------------------------------------------------------------------
  // 与主世界桥通信（scripts/reader-bridge.js）
  // ---------------------------------------------------------------------------

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;

    var data = event.data;
    if (!data || data.source !== BRIDGE_SOURCE || data.dir !== 'from-page') return;

    var pending = bridgePending[data.id];
    if (!pending) return;
    delete bridgePending[data.id];
    clearTimeout(pending.timer);

    if (data.ok) pending.callback(null, data.result || null);
    else pending.callback(new Error(data.error || '页面桥返回失败'));
  });

  function callBridge(cmd, payload, timeoutMs, callback) {
    var id = 'kmoe-' + (++bridgeSeq) + '-' + Date.now();
    var timer = setTimeout(function () {
      delete bridgePending[id];
      bridgeState = 'missing';
      callback(new Error('页面桥没有响应：请到扩展管理页重新加载扩展，然后刷新本页'));
    }, timeoutMs || BRIDGE_TIMEOUT_MS);

    bridgePending[id] = { callback: callback, timer: timer };
    window.postMessage({
      source: BRIDGE_SOURCE,
      dir: 'to-page',
      id: id,
      cmd: cmd,
      payload: payload || {}
    }, '*');
  }

  function pingBridge(callback) {
    callBridge('PING', {}, BRIDGE_TIMEOUT_MS, function (err, result) {
      bridgeState = !err && result && result.volOpen ? 'ready' : 'missing';
      if (callback) callback(bridgeState, err || null, result || null);
    });
  }

  // ---------------------------------------------------------------------------
  // 只读访问 IndexedDB 缓存
  // ---------------------------------------------------------------------------

  function hasStore(db) {
    var names = db.objectStoreNames;
    if (!names) return false;
    if (typeof names.contains === 'function') return names.contains(STORE_NAME);
    return Array.prototype.indexOf.call(names, STORE_NAME) !== -1;
  }

  // 只读、不创建、不删除、不升级站点的数据库：
  //  - 先确认 KOOBONE 已存在，并取得它的当前版本号；
  //  - 用该版本号打开（不会触发 upgrade，也就不会改动站点的 schema）；
  //  - 一旦站点要升级/删除数据库（Dexie 的 deleteDatabase/versionchange），
  //    立刻断开自己的连接，绝不阻塞它。
  // 站点自身的 Dexie 会在某些时机删除重建 KOOBONE，因此本脚本绝不调用
  //  indexedDB.open（无版本）或 deleteDatabase，避免留下空库或延长删除等待。
  function openCacheDb(callback) {
    if (typeof indexedDB === 'undefined' || typeof indexedDB.open !== 'function') {
      callback(new Error('当前浏览器不支持 IndexedDB，无法读取缓存'));
      return;
    }

    if (typeof indexedDB.databases !== 'function') {
      callback(new Error('当前浏览器无法检查本地缓存（缺少 indexedDB.databases），已放弃读取以免影响站点缓存'));
      return;
    }

    indexedDB.databases().then(function (list) {
      var info = (list || []).filter(function (item) {
        return item && item.name === DB_NAME;
      })[0];

      if (!info) {
        callback(new Error('尚未发现本地缓存（IndexedDB 中没有 ' + DB_NAME + '），请先在阅读器中打开该系列的任意一卷'));
        return;
      }

      var request;
      try {
        request = indexedDB.open(DB_NAME, info.version);
      } catch (err) {
        callback(err);
        return;
      }

      request.onupgradeneeded = function () {
        // 以当前版本号打开不会走到这里；万一走到也绝不写入任何内容。
      };
      request.onsuccess = function () {
        var db = request.result;
        db.onversionchange = function () {
          try { db.close(); } catch (closeErr) {}
        };

        if (!hasStore(db)) {
          try { db.close(); } catch (closeErr) {}
          callback(new Error('本地缓存结构异常（缺少 ' + STORE_NAME + ' 表），未做任何改动'));
          return;
        }

        callback(null, db);
      };
      request.onerror = function () {
        callback(request.error || new Error('打开缓存数据库失败'));
      };
      request.onblocked = function () {
        callback(new Error('缓存数据库被其他页面占用，请稍后重试'));
      };
    }).catch(function () {
      callback(new Error('无法检查本地缓存状态，已放弃读取以免影响站点缓存'));
    });
  }

  // 只按当前页面上列出的 file_md5 逐个 get()，不遍历、不扫描无关数据。
  function readCachedVolumes(md5List, callback) {
    openCacheDb(function (err, db) {
      if (err) {
        callback(err);
        return;
      }

      var result = {};
      var tx;
      var store;

      try {
        tx = db.transaction(STORE_NAME, 'readonly');
        store = tx.objectStore(STORE_NAME);
      } catch (e) {
        try { db.close(); } catch (closeErr) {}
        callback(new Error('缓存对象仓库 ' + STORE_NAME + ' 不可用'));
        return;
      }

      tx.oncomplete = function () {
        try { db.close(); } catch (closeErr) {}
        callback(null, result);
      };
      tx.onabort = tx.onerror = function () {
        try { db.close(); } catch (closeErr) {}
        callback(tx.error || new Error('读取缓存失败'));
      };

      if (!md5List.length) return;

      md5List.forEach(function (md5) {
        var request = store.get(md5);
        request.onsuccess = function () {
          var record = request.result;
          if (!record) return;
          var fileBlob = record.file_blob || null;
          var coverBlob = record.cover_blob || null;
          result[md5] = {
            file_md5: record.file_md5 || md5,
            vol_name: record.vol_name || '',
            vol_series: record.vol_series || '',
            vol_author: record.vol_author || '',
            vol_language: record.vol_language || '',
            file_type: record.file_type || '',
            islocal: record.islocal,
            fileSize: fileBlob && typeof fileBlob.size === 'number' ? fileBlob.size : 0,
            hasCover: !!(coverBlob && coverBlob.size > 0),
            coverType: coverBlob && coverBlob.type ? coverBlob.type : '',
            _fileBlob: fileBlob,
            _coverBlob: coverBlob
          };
        };
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 计划与导出
  // ---------------------------------------------------------------------------

  function buildPlan(volumes, seriesHint, records) {
    return Export.buildExportPlan({
      seriesHint: seriesHint,
      volumes: volumes,
      cachedByMd5: records,
      totalHint: getTotalHint(),
      listComplete: isListComplete()
    });
  }

  function exportMeta() {
    return {
      exportedAt: new Date().toISOString(),
      pageUrl: window.location.href,
      pageTitle: document.title,
      site: window.location.host
    };
  }

  function jsonBlob(value) {
    return new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  }

  function textBlob(text) {
    return new Blob([text], { type: 'text/plain;charset=utf-8' });
  }

  function buildZipEntries(plan, records) {
    var meta = exportMeta();
    var entries = [{
      name: plan.seriesDir + '/' + plan.manifestFilename,
      blob: jsonBlob(Export.buildManifest(plan, meta))
    }];

    if (plan.cover) {
      var coverRecord = records[plan.cover.md5];
      if (coverRecord && coverRecord._coverBlob) {
        entries.push({
          name: plan.seriesDir + '/' + plan.cover.filename,
          blob: coverRecord._coverBlob
        });
      }
    }

    plan.items.forEach(function (item) {
      var record = records[item.md5];
      if (!record || !record._fileBlob) return;
      entries.push({
        name: plan.seriesDir + '/' + item.filename,
        blob: record._fileBlob
      });
    });

    entries.push({
      name: plan.seriesDir + '/' + plan.missingFilename,
      blob: textBlob(Export.buildMissingReport(plan, meta))
    });

    return entries;
  }

  function saveBlobAs(blob, filename) {
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 10 * 60 * 1000);
  }

  // ---------------------------------------------------------------------------
  // 界面
  // ---------------------------------------------------------------------------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clampPosition(node, left, top) {
    var margin = 8;
    var maxLeft = Math.max(margin, window.innerWidth - (node.offsetWidth || 120) - margin);
    var maxTop = Math.max(margin, window.innerHeight - (node.offsetHeight || 40) - margin);
    return {
      left: Math.min(Math.max(left, margin), maxLeft),
      top: Math.min(Math.max(top, margin), maxTop)
    };
  }

  // 拖拽结束后浏览器会补一次 click，这一次要忽略（否则拖完会误触打开面板）。
  // 标记挂在面板元素自己身上，而不是共享变量：
  //  - 拖「面板」不会把「悬浮入口」的点击一起抑制掉；
  //  - 标记只消费一次，不会永久生效。
  function clearDragClick(panel) {
    if (panel && panel.dataset) delete panel.dataset.kmoeDragged;
  }

  function markDragClick(panel) {
    if (panel && panel.dataset) panel.dataset.kmoeDragged = '1';
  }

  function consumeDragClick(panel) {
    if (!panel || !panel.dataset || panel.dataset.kmoeDragged !== '1') return false;
    clearDragClick(panel);
    return true;
  }

  function makeDraggable(panel, handle) {
    if (!panel || !handle || panel.dataset.kmoeDrag === '1') return;
    panel.dataset.kmoeDrag = '1';

    var dragging = false;
    var moved = false;
    var startX = 0;
    var startY = 0;
    var offsetX = 0;
    var offsetY = 0;
    var pointerId = null;

    handle.addEventListener('pointerdown', function (event) {
      if (event.button !== undefined && event.button !== 0) return;
      // 任何一次新的按下都先清掉上次拖拽留下的抑制标记。
      // 按钮上的 pointerdown 会在下面提前 return，若不先清理，
      // 「拖过一次之后再点按钮」就会被永久忽略。
      clearDragClick(panel);
      if (event.target && event.target.closest && event.target.closest('button, a, input, select, textarea')) return;
      var rect = panel.getBoundingClientRect();
      dragging = true;
      moved = false;
      pointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
      startX = event.clientX;
      startY = event.clientY;
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
    });

    handle.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      if (pointerId !== null && event.pointerId !== pointerId) return;
      var dx = event.clientX - startX;
      var dy = event.clientY - startY;
      if (!moved && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
        moved = true;
        panel.classList.add('is-dragging');
        if (handle.setPointerCapture && pointerId !== null) {
          try { handle.setPointerCapture(pointerId); } catch (err) {}
        }
      }
      if (!moved) return;
      var next = clampPosition(panel, event.clientX - offsetX, event.clientY - offsetY);
      panel.style.left = next.left + 'px';
      panel.style.top = next.top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      event.preventDefault();
    });

    function stop() {
      if (!dragging) return;
      dragging = false;
      pointerId = null;
      panel.classList.remove('is-dragging');
      if (moved) markDragClick(panel);
    }

    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  function ensureFloatingEntry() {
    if (document.getElementById(FLOATING_ID)) return;

    var launcher = el('div');
    launcher.id = FLOATING_ID;

    var title = el('div', 'kmoe-rf-title');
    title.appendChild(el('span', 'kmoe-rf-mark', 'K'));
    title.appendChild(el('span', 'kmoe-rf-title-text', 'Kmoe 导出'));
    launcher.appendChild(title);

    var button = el('button', 'kmoe-rf-button', '导出漫画');
    button.type = 'button';
    button.title = '从浏览器缓存导出当前系列';
    button.addEventListener('click', function (event) {
      event.preventDefault();
      // 拖拽结束后浏览器会补一次 click，这一次忽略；标记只消费一次且只属于本元素，
      // 所以不会把之后真正的点击也吃掉。
      if (consumeDragClick(launcher)) return;
      openCard();
    });
    launcher.appendChild(button);

    makeDraggable(launcher, launcher);
    document.body.appendChild(launcher);
  }

  function removeFloatingEntry() {
    var launcher = document.getElementById(FLOATING_ID);
    if (launcher) launcher.remove();
    var card = document.getElementById(CARD_ID);
    if (card) card.style.display = 'none';
  }

  function createCard() {
    var card = el('div');
    card.id = CARD_ID;

    var header = el('div', 'kmoe-ec-header');
    header.appendChild(el('span', 'kmoe-ec-title', 'Kmoe Download · 导出漫画'));
    var close = el('button', 'kmoe-ec-close', '×');
    close.type = 'button';
    header.appendChild(close);
    card.appendChild(header);

    var body = el('div', 'kmoe-ec-body');

    var summary = el('div', 'kmoe-ec-summary');
    summary.appendChild(el('div', 'kmoe-ec-series', ''));
    summary.appendChild(el('div', 'kmoe-ec-stats', ''));
    summary.appendChild(el('div', 'kmoe-ec-source', ''));
    body.appendChild(summary);

    var notes = el('div', 'kmoe-ec-notes');
    body.appendChild(notes);

    var scope = el('div', 'kmoe-ec-scope');
    scope.id = 'kmoe-ec-scope';
    scope.style.display = 'none';
    scope.appendChild(el('label', 'kmoe-ec-scope-label', '导出系列：'));
    var seriesSelect = document.createElement('select');
    seriesSelect.id = 'kmoe-ec-series-select';
    seriesSelect.addEventListener('change', function () {
      selectedSeriesIndex = parseInt(seriesSelect.value, 10) || 0;
      applySelectedGroup();
    });
    scope.appendChild(seriesSelect);
    body.appendChild(scope);

    var list = el('div', 'kmoe-ec-list');
    body.appendChild(list);

    var progress = el('div', 'kmoe-ec-progress');
    var bar = el('div', 'kmoe-ec-progress-bar');
    var fill = el('div', 'kmoe-ec-progress-fill');
    bar.appendChild(fill);
    progress.appendChild(bar);
    progress.appendChild(el('div', 'kmoe-ec-progress-text', ''));
    body.appendChild(progress);

    var report = el('div', 'kmoe-ec-report');
    body.appendChild(report);

    card.appendChild(body);

    var actions = el('div', 'kmoe-ec-actions');
    var refresh = el('button', 'kmoe-ec-btn kmoe-ec-btn-ghost', '刷新缓存');
    refresh.type = 'button';
    refresh.id = 'kmoe-ec-refresh';
    var cancel = el('button', 'kmoe-ec-btn kmoe-ec-btn-ghost', '取消');
    cancel.type = 'button';
    cancel.id = 'kmoe-ec-cancel';
    cancel.style.display = 'none';
    var cache = el('button', 'kmoe-ec-btn kmoe-ec-btn-cache', '一键缓存未缓存卷');
    cache.type = 'button';
    cache.id = 'kmoe-ec-cache';
    cache.title = '只处理未缓存的卷；已缓存的会跳过';
    var start = el('button', 'kmoe-ec-btn kmoe-ec-btn-primary', '开始导出');
    start.type = 'button';
    start.id = 'kmoe-ec-start';
    actions.appendChild(refresh);
    actions.appendChild(cancel);
    actions.appendChild(cache);
    actions.appendChild(start);
    card.appendChild(actions);

    close.addEventListener('click', function () {
      card.style.display = 'none';
    });
    refresh.addEventListener('click', function () {
      refreshPlan();
    });
    cancel.addEventListener('click', function () {
      if (cacheRun) {
        cacheRun.cancelled = true;
        setProgress(0, '正在取消…');
        return;
      }
      if (!exporting) return;
      exportCancelled = true;
      setProgress(0, '正在取消…');
    });
    cache.addEventListener('click', startCacheRun);
    start.addEventListener('click', startExport);

    document.body.appendChild(card);
    makeDraggable(card, header);
    return card;
  }

  function setRefreshHint(pending) {
    var button = document.getElementById('kmoe-ec-refresh');
    if (!button) return;
    button.textContent = pending ? '刷新缓存（列表已更新）' : '刷新缓存';
    button.classList.toggle('kmoe-ec-btn-attention', !!pending);
  }

  function cardEl(selector) {
    var card = document.getElementById(CARD_ID);
    return card ? card.querySelector(selector) : null;
  }

  function setProgress(percent, text) {
    var fill = cardEl('.kmoe-ec-progress-fill');
    if (fill) fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
    var label = cardEl('.kmoe-ec-progress-text');
    if (label && text !== undefined) label.textContent = text;
  }

  function setReport(text) {
    var report = cardEl('.kmoe-ec-report');
    if (report) report.textContent = text || '';
  }

  function renderPlan(plan, error) {
    var seriesEl = cardEl('.kmoe-ec-series');
    var statsEl = cardEl('.kmoe-ec-stats');
    var sourceEl = cardEl('.kmoe-ec-source');
    var notesEl = cardEl('.kmoe-ec-notes');
    var listEl = cardEl('.kmoe-ec-list');
    var startBtn = cardEl('#kmoe-ec-start');
    var cacheBtn = cardEl('#kmoe-ec-cache');
    var refreshBtn = cardEl('#kmoe-ec-refresh');
    var cancelBtn = cardEl('#kmoe-ec-cancel');
    var busy = !!cacheRun || exporting;

    if (listEl) listEl.textContent = '';
    if (notesEl) notesEl.textContent = '';

    if (error) {
      if (seriesEl) seriesEl.textContent = '无法读取缓存';
      if (statsEl) statsEl.textContent = error.message || String(error);
      if (sourceEl) sourceEl.textContent = '';
      if (startBtn) startBtn.disabled = true;
      if (cacheBtn) cacheBtn.disabled = true;
      return;
    }

    if (seriesEl) seriesEl.textContent = plan.series || plan.seriesDir;
    if (statsEl) {
      statsEl.textContent = '总卷数 ' + plan.listedCount +
        ' · 已缓存 ' + plan.exportedCount +
        ' · 未缓存 ' + plan.missingCount +
        ' · 缓存体积 ' + plan.totalSize;
    }
    if (sourceEl) sourceEl.textContent = '只读取浏览器缓存，导出过程不联网' + (plan.scopeLabel ? ' · ' + plan.scopeLabel : '');

    plan.notes.forEach(function (note) {
      if (notesEl) notesEl.appendChild(el('div', 'kmoe-ec-note', '· ' + note));
    });
    if (bridgeState === 'missing') {
      if (notesEl) {
        notesEl.appendChild(el('div', 'kmoe-ec-note',
          '· 一键缓存不可用：主世界桥未加载。请到扩展管理页重新加载扩展，然后刷新本页。'));
      }
    }

    if (listEl) {
      plan.items.forEach(function (item) {
        var row = el('div', 'kmoe-ec-item kmoe-ec-item-cached');
        row.appendChild(el('span', 'kmoe-ec-item-flag', '已缓存'));
        row.appendChild(el('span', 'kmoe-ec-item-name', item.filename));
        row.appendChild(el('span', 'kmoe-ec-item-size', Export.formatBytes(item.sizeBytes)));
        listEl.appendChild(row);
      });
      plan.missing.forEach(function (entry) {
        var row = el('div', 'kmoe-ec-item kmoe-ec-item-missing');
        row.appendChild(el('span', 'kmoe-ec-item-flag', '未缓存'));
        row.appendChild(el('span', 'kmoe-ec-item-name', entry.label + ' ' + entry.name));
        row.appendChild(el('span', 'kmoe-ec-item-size', '未缓存'));
        listEl.appendChild(row);
      });
      if (!plan.items.length && !plan.missing.length) {
        listEl.appendChild(el('div', 'kmoe-ec-empty', '未检测到卷列表，请先打开一个系列'));
      }
    }

    if (startBtn) {
      startBtn.disabled = busy || plan.exportedCount === 0;
      startBtn.textContent = plan.exportedCount === 0 ? '没有可导出的缓存' : '开始导出 (' + plan.exportedCount + ' 卷)';
    }
    if (cacheBtn) {
      var blocked = bridgeState === 'missing';
      cacheBtn.disabled = busy || blocked || plan.missingCount === 0;
      if (plan.missingCount === 0) cacheBtn.textContent = '没有未缓存的卷';
      else if (cacheRun) cacheBtn.textContent = '正在缓存 ' + Math.min(cacheRun.index + 1, cacheRun.total) + ' / ' + cacheRun.total;
      else if (blocked) cacheBtn.textContent = '一键缓存不可用';
      else cacheBtn.textContent = '一键缓存未缓存卷 (' + plan.missingCount + ' 卷)';
    }
    if (refreshBtn) refreshBtn.disabled = busy;
    var seriesSelect = cardEl('#kmoe-ec-series-select');
    if (seriesSelect) seriesSelect.disabled = busy;
    if (cancelBtn) cancelBtn.style.display = busy ? '' : 'none';
  }

  function renderScope(grouping) {
    var scope = document.getElementById('kmoe-ec-scope');
    var select = document.getElementById('kmoe-ec-series-select');
    if (!scope || !select) return;

    var groups = grouping.groups || [];
    if (grouping.locked || groups.length <= 1) {
      scope.style.display = 'none';
      select.textContent = '';
      return;
    }

    scope.style.display = '';
    select.textContent = '';
    groups.forEach(function (group, index) {
      var option = document.createElement('option');
      option.value = String(index);
      option.textContent = group.series + '（' + group.volumes.length + ' 卷，已缓存 ' + group.cachedCount + '）';
      select.appendChild(option);
    });
    select.value = String(selectedSeriesIndex);
  }

  function applySelectedGroup() {
    if (!cachedGrouping) return;
    var group = cachedGrouping.groups[selectedSeriesIndex];
    if (!group) return;

    cachedPlan = buildPlan(group.volumes, group.series, cachedRecords);
    cachedPlan.scopeLabel = cachedGrouping.locked
      ? '范围：' + group.series + '（当前系列 ' + group.volumes.length + ' 卷）'
      : '范围：' + group.series + '（当前列表共 ' + cachedGrouping.groups.length + ' 个系列，仅导出所选系列）';
    renderPlan(cachedPlan, null);
  }

  // 只在用户主动刷新（打开面板或点击“刷新缓存”）时重建计划，避免面板在页面
  // 增量渲染时逐次重排导致按钮跳动。
  function refreshPlan() {
    if (exporting) return;
    var volumes = collectPageVolumes();
    var seriesHint = getSeriesHint();
    lastSignature = pageSignature(volumes, seriesHint);

    if (!volumes.length) {
      removeFloatingEntry();
      cachedGrouping = null;
      cachedPlan = null;
      cachedRecords = null;
      renderPlan(null, new Error('当前页面没有检测到卷列表：请先点击一个系列进入书目列表'));
      return;
    }

    ensureFloatingEntry();

    readCachedVolumes(volumes.map(function (volume) { return volume.md5; }), function (err, records) {
      if (err) {
        cachedGrouping = null;
        cachedPlan = null;
        cachedRecords = null;
        renderPlan(null, err);
        return;
      }

      cachedRecords = records;
      cachedGrouping = Export.groupVolumesBySeries(volumes, records, seriesHint);
      selectedSeriesIndex = 0;
      renderScope(cachedGrouping);
      applySelectedGroup();

      pendingRefresh = false;
      setRefreshHint(false);
    });
  }

  function openCard() {
    // 面板元素如果被页面重渲染移除，这里重建，避免“点了没反应”。
    var card = document.getElementById(CARD_ID);
    if (!card) card = createCard();
    if (!card) return;
    card.style.display = 'flex';
    setReport('');
    setProgress(0, '');
    pendingRefresh = false;
    setRefreshHint(false);
    renderPlan(null, new Error('正在读取浏览器缓存…'));
    // 先探一下主世界桥，决定「一键缓存」是否可用（扩展未重新加载时会不可用）。
    pingBridge(function () {
      var current = document.getElementById(CARD_ID);
      if (!current || current.style.display === 'none') return;
      if (cachedPlan) renderPlan(cachedPlan, null);
    });
    refreshPlan();
  }

  function startExport() {
    if (exporting || cacheRun) return;
    if (!cachedPlan || !cachedRecords) {
      setReport('请先刷新缓存清单');
      return;
    }

    var plan = cachedPlan;
    var records = cachedRecords;
    if (!plan.exportedCount) {
      setReport('当前系列在浏览器缓存中没有可导出的内容。\n\n缺失卷：\n' +
        plan.missing.map(function (entry) {
          return '  ' + entry.label + ' ' + entry.name + ' (file_md5: ' + entry.md5 + ')';
        }).join('\n') +
        '\n\n导出过程不会联网下载，请先在阅读器中打开这些卷后再重新导出。');
      return;
    }

    exporting = true;
    exportCancelled = false;

    var startBtn = cardEl('#kmoe-ec-start');
    var cancelBtn = cardEl('#kmoe-ec-cancel');
    var cacheBtn = cardEl('#kmoe-ec-cache');
    var refreshBtn = cardEl('#kmoe-ec-refresh');
    if (startBtn) startBtn.disabled = true;
    if (cacheBtn) cacheBtn.disabled = true;
    if (refreshBtn) refreshBtn.disabled = true;
    if (cancelBtn) cancelBtn.style.display = '';

    setReport('');
    setProgress(0, '正在统计缓存数据…');

    var entries = buildZipEntries(plan, records);
    var totalBytes = entries.reduce(function (sum, entry) {
      return sum + (entry.blob && entry.blob.size ? entry.blob.size : 0);
    }, 0);
    var baseBytes = 0;

    Zip.createZipBlob(entries, {
      shouldAbort: function () { return exportCancelled; },
      onProgress: function (index, total, name, loaded, entryTotal) {
        var done = baseBytes + loaded;
        var percent = totalBytes > 0 ? (done / totalBytes) * 100 : 0;
        setProgress(percent, '打包中 (' + (index + 1) + '/' + total + ')：' + name);
        if (loaded >= entryTotal) baseBytes += entryTotal;
      }
    }).then(function (zipBlob) {
      if (exportCancelled) throw new Error('已取消');

      var filename = plan.seriesDir + '.zip';
      setProgress(100, '正在保存 ' + filename + '（' + Export.formatBytes(zipBlob.size) + '）…');
      saveBlobAs(zipBlob, filename);

      var lines = [];
      lines.push('导出完成：' + filename);
      lines.push('系列：' + (plan.series || plan.seriesDir));
      lines.push('已导出 ' + plan.exportedCount + ' 卷，压缩包 ' + Export.formatBytes(zipBlob.size) +
        '（缓存体积 ' + plan.totalSize + '）');
      if (plan.missingCount) {
        lines.push('');
        lines.push('缓存中缺失 ' + plan.missingCount + ' 卷（未重新下载）：');
        plan.missing.forEach(function (entry) {
          lines.push('  ' + entry.label + ' ' + entry.name + ' (file_md5: ' + entry.md5 + ')');
        });
      } else {
        lines.push('当前列表已全部导出，无缺失卷。');
      }
      if (plan.notes.length) {
        lines.push('');
        plan.notes.forEach(function (note) {
          lines.push('说明：' + note);
        });
      }
      setReport(lines.join('\n'));

      exporting = false;
      renderPlan(plan, null);
      var cancelBtnAfter = cardEl('#kmoe-ec-cancel');
      if (cancelBtnAfter) cancelBtnAfter.style.display = 'none';
    }).catch(function (err) {
      exporting = false;
      var cancelBtnAfter = cardEl('#kmoe-ec-cancel');
      if (cancelBtnAfter) cancelBtnAfter.style.display = 'none';
      if (exportCancelled) {
        setProgress(0, '');
        setReport('已取消导出，未产生任何文件。');
        renderPlan(plan, null);
        return;
      }
      setProgress(0, '');
      setReport('导出失败：' + (err && err.message ? err.message : String(err)));
      renderPlan(plan, null);
    });
  }

  // ---------------------------------------------------------------------------
  // 一键缓存：只处理未缓存的卷，完全复用站点自身的缓存流程
  // ---------------------------------------------------------------------------

  function actionMessage() {
    var box = document.getElementById('action_msg');
    if (!box) return '';
    if (getComputedStyle(box).display === 'none') return '';
    return squeeze(box.textContent).replace(/^error_outline\s*/, '');
  }

  // 站点设置里可以选「缓存后自动打开」，那会把阅读器弹出来；补缓存时替它关掉。
  function dismissReaderIfOpened() {
    var pageView = document.getElementById('view_page');
    var lineView = document.getElementById('view_line');
    var opened = (pageView && getComputedStyle(pageView).display !== 'none') ||
      (lineView && getComputedStyle(lineView).display !== 'none');
    if (!opened) return;
    var close = document.querySelector('[onclick*="do_view_close"]');
    if (close) close.click();
  }

  function volumeProgressValue(md5) {
    var bar = document.getElementById('div_progress_' + md5);
    if (!bar) return null;
    var value = parseInt(bar.value, 10);
    return Number.isFinite(value) ? value : null;
  }

  function cacheProgressText(current, percent) {
    var text = '正在缓存 ' + current + ' / ' + cacheRun.total;
    if (percent !== null && percent !== undefined) text += '（' + percent + '%）';
    return text;
  }

  function startCacheRun() {
    if (cacheRun || exporting) return;

    if (!cachedPlan || !cachedRecords) {
      setReport('请先刷新缓存清单');
      return;
    }
    if (bridgeState !== 'ready') {
      setReport('一键缓存不可用：主世界桥未响应。请到扩展管理页重新加载扩展，然后刷新本页。');
      return;
    }

    var missing = cachedPlan.missing.slice();
    if (!missing.length) {
      setReport('当前列表没有未缓存的卷。');
      return;
    }

    var preview = missing.slice(0, 10).map(function (item) {
      return '  ' + item.label + ' ' + item.name;
    });
    if (missing.length > preview.length) {
      preview.push('  … 其余 ' + (missing.length - preview.length) + ' 卷');
    }

    var lines = [];
    lines.push('将缓存 ' + missing.length + ' 卷（已缓存的 ' + cachedPlan.exportedCount + ' 卷会跳过）：');
    lines.push(preview.join('\n'));
    lines.push('');
    lines.push('这会按站点自身的流程逐卷下载并写入本地缓存，会消耗流量与时间，可随时取消。');
    if (!window.confirm(lines.join('\n'))) return;

    cacheRun = {
      queue: missing,
      index: 0,
      total: missing.length,
      okCount: 0,
      failed: [],
      cancelled: false,
      consecutiveFailures: 0,
      fatalReason: ''
    };

    setReport('');
    runNextVolume();
  }

  function runNextVolume() {
    if (!cacheRun) return;
    if (cacheRun.cancelled) {
      finishCacheRun();
      return;
    }

    var item = cacheRun.queue[cacheRun.index];
    if (!item) {
      finishCacheRun();
      return;
    }

    // 下载地址带时效签名，每次现取；取不到就说明列表已被重渲染。
    var target = findVolumeOnclick(item.md5);
    if (!target) {
      cacheRun.failed.push({ name: item.name, md5: item.md5, reason: '页面上已找不到该卷入口，请刷新缓存清单后重试' });
      cacheRun.index++;
      cacheRun.consecutiveFailures++;
      scheduleNextVolume();
      return;
    }

    setProgress((cacheRun.index / cacheRun.total) * 100, cacheProgressText(cacheRun.index + 1, null));
    renderPlan(cachedPlan, null);

    var beforeMessage = actionMessage();

    callBridge('CACHE_VOLUME', { md5: item.md5, url: target.url }, BRIDGE_TIMEOUT_MS, function (err) {
      if (!cacheRun) return;
      if (cacheRun.cancelled) {
        finishCacheRun();
        return;
      }
      if (err) {
        recordCacheFailure(item, err.message || String(err));
        return;
      }
      waitForVolumeCached(item.md5, beforeMessage, function (waitErr) {
        if (!cacheRun) return;
        if (waitErr === 'cancelled') {
          finishCacheRun();
          return;
        }
        if (waitErr) {
          recordCacheFailure(item, waitErr.message || String(waitErr));
          return;
        }
        cacheRun.okCount++;
        cacheRun.consecutiveFailures = 0;
        cacheRun.index++;
        scheduleNextVolume();
      });
    });
  }

  function recordCacheFailure(item, reason) {
    cacheRun.failed.push({ name: item.name, md5: item.md5, reason: reason });
    cacheRun.consecutiveFailures++;
    cacheRun.index++;

    if (Export.isFatalCacheFailure(reason) || cacheRun.consecutiveFailures >= CACHE_MAX_CONSECUTIVE_FAILURES) {
      cacheRun.fatalReason = reason;
      finishCacheRun();
      return;
    }
    scheduleNextVolume();
  }

  function scheduleNextVolume() {
    if (!cacheRun) return;
    if (cacheRun.cancelled) {
      finishCacheRun();
      return;
    }
    var next = cacheRun.queue[cacheRun.index];
    setProgress((cacheRun.index / cacheRun.total) * 100, next ? '等待下一卷：' + next.name : '收尾中…');
    setTimeout(runNextVolume, CACHE_LAUNCH_DELAY_MS);
  }

  // 完成判据以 IndexedDB 里真的出现该卷为准（站点 db_insert 成功后才算缓存完成）。
  function waitForVolumeCached(md5, beforeMessage, callback) {
    var deadline = Date.now() + CACHE_VOLUME_TIMEOUT_MS;

    function poll() {
      if (!cacheRun || cacheRun.cancelled) {
        callback('cancelled');
        return;
      }

      dismissReaderIfOpened();

      readCachedVolumes([md5], function (err, records) {
        if (!cacheRun || cacheRun.cancelled) {
          callback('cancelled');
          return;
        }

        if (!err && records && records[md5]) {
          callback(null);
          return;
        }

        var message = actionMessage();
        if (message && message !== beforeMessage && !Export.isTransientCacheMessage(message)) {
          callback(new Error(message));
          return;
        }

        if (Date.now() > deadline) {
          callback(new Error('等待站点完成缓存超时（' + Math.round(CACHE_VOLUME_TIMEOUT_MS / 60000) + ' 分钟）'));
          return;
        }

        setProgress((cacheRun.index / cacheRun.total) * 100,
          cacheProgressText(cacheRun.index + 1, volumeProgressValue(md5)));
        setTimeout(poll, CACHE_POLL_INTERVAL_MS);
      });
    }

    poll();
  }

  function finishCacheRun() {
    var run = cacheRun;
    cacheRun = null;
    if (!run) return;

    setProgress(100, run.cancelled ? '已取消' : '缓存结束');
    setReport(Export.buildCacheRunReport(run) + '\n\n已重新检查缓存状态（若列表有新加载的卷，请再点一次刷新缓存）。');

    refreshPlan();
  }

  // ---------------------------------------------------------------------------
  // 启动
  // ---------------------------------------------------------------------------

  if (window.__KMOE_READER_TEST__) {
    window.__kmoeReaderTestHooks = {
      squeeze: squeeze,
      cleanAnchorText: cleanAnchorText,
      nameFromScope: nameFromScope,
      findVolumeName: findVolumeName
    };
  }

  function scan() {
    var volumes = collectPageVolumes();
    var signature = pageSignature(volumes, getSeriesHint());
    var changed = signature !== lastSignature;
    lastSignature = signature;

    if (!volumes.length) {
      if (changed) removeFloatingEntry();
      return;
    }

    // 每次扫描都确保入口存在：元素被页面重渲染移除时能自愈。
    ensureFloatingEntry();

    if (!changed) return;

    // 站点会增量渲染卷列表。面板只在用户点击“刷新缓存”时重建，
    // 否则每次页面变动都重渲染会让面板跳动、干扰操作。
    if (cacheRun || exporting || pendingRefresh) return;

    var card = document.getElementById(CARD_ID);
    if (card && card.style.display !== 'none') {
      pendingRefresh = true;
      setRefreshHint(true);
    }
  }

  function boot() {
    if (!Export || !Zip) return;
    scan();
    setInterval(scan, SCAN_INTERVAL_MS);

    var pending = null;
    var observer = new MutationObserver(function () {
      if (pending) return;
      pending = setTimeout(function () {
        pending = null;
        scan();
      }, 500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
