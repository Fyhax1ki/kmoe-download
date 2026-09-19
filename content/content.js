(function () {
  'use strict';

  const SOURCE = 'kmoe-download-page-bridge';
  const MESSAGE_PREFIX = 'KMOE_MANGA_DATA=';
  const RECORD_EXPIRE_HOURS = 48;
  const DOWNLOAD_URL_TIMEOUT_MS = 30000;
  const DOWNLOAD_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
  const DOWNLOAD_STALL_TIMEOUT_MS = 90000;
  const Settings = globalThis.KmoeSettings;
  const FLOATING_POS_KEY = 'kmoe_floating_entry_pos';
  const FLOATING_DRAG_THRESHOLD_PX = 5;
  let cachedBookInfo = null;
  var downloadRecords = {};
  var preferredDownloadFormat = Settings.DEFAULT_DOWNLOAD_FORMAT;
  var floatingSuppressClick = false;

  function injectPageBridge() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('scripts/page-bridge.js');
    script.onload = function () {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  function parseBridgePayload(data) {
    if (data && data.source === SOURCE && data.type === 'MANGA_DATA') {
      return data.payload;
    }

    if (typeof data === 'string' && data.indexOf(MESSAGE_PREFIX) === 0) {
      try {
        return JSON.parse(data.slice(MESSAGE_PREFIX.length));
      } catch (e) {
        return null;
      }
    }

    return null;
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var payload = parseBridgePayload(event.data);
    if (payload) {
      cachedBookInfo = mergeBookInfo(cachedBookInfo, payload);
      refreshCardBookInfo(cachedBookInfo);
    }
  });

  function mergeBookInfo(existing, incoming) {
    if (!incoming) return existing || null;
    if (!existing || (existing.bookId && incoming.bookId && String(existing.bookId) !== String(incoming.bookId))) {
      return incoming;
    }

    Object.keys(incoming).forEach(function (key) {
      if (typeof incoming[key] !== 'undefined') {
        existing[key] = incoming[key];
      }
    });
    return existing;
  }

  function loadDownloadRecords(callback) {
    chrome.storage.local.get(['kmoe_download_records_v2'], function (result) {
      downloadRecords = result.kmoe_download_records_v2 || {};
      cleanExpiredRecords();
      if (callback) callback();
    });
  }

  function saveDownloadRecords() {
    chrome.storage.local.set({ kmoe_download_records_v2: downloadRecords });
  }

  function cleanExpiredRecords() {
    var now = Date.now();
    var expireTime = RECORD_EXPIRE_HOURS * 60 * 60 * 1000;

    Object.keys(downloadRecords).forEach(function (bookId) {
      var book = downloadRecords[bookId];
      if (book.volumes) {
        Object.keys(book.volumes).forEach(function (volId) {
          var vol = book.volumes[volId];
          if (vol.formats) {
            Object.keys(vol.formats).forEach(function (format) {
              if (now - vol.formats[format] > expireTime) {
                delete vol.formats[format];
              }
            });
            if (Object.keys(vol.formats).length === 0) {
              delete book.volumes[volId];
            }
          }
        });
        if (Object.keys(book.volumes).length === 0) {
          delete downloadRecords[bookId];
        }
      }
    });
    saveDownloadRecords();
  }

  function addDownloadRecord(bookId, volId, format, volName, meta) {
    meta = meta || {};
    if (!downloadRecords[bookId]) {
      downloadRecords[bookId] = {
        title: meta.title || (cachedBookInfo ? cachedBookInfo.title : ''),
        cover: meta.cover || (cachedBookInfo ? cachedBookInfo.cover : ''),
        description: meta.description || (cachedBookInfo ? cachedBookInfo.description : ''),
        url: meta.url || window.location.href,
        volumes: {}
      };
    } else {
      if (!downloadRecords[bookId].title && meta.title) {
        downloadRecords[bookId].title = meta.title;
      }
      if (!downloadRecords[bookId].cover && meta.cover) {
        downloadRecords[bookId].cover = meta.cover;
      }
      if (!downloadRecords[bookId].description && meta.description) {
        downloadRecords[bookId].description = meta.description;
      }
      if (!downloadRecords[bookId].url && meta.url) {
        downloadRecords[bookId].url = meta.url;
      }
    }
    if (!downloadRecords[bookId].volumes[volId]) {
      downloadRecords[bookId].volumes[volId] = {
        name: volName || '',
        formats: {}
      };
    }

    var existingTime = downloadRecords[bookId].volumes[volId].formats[format];
    var now = Date.now();
    var expireTime = RECORD_EXPIRE_HOURS * 60 * 60 * 1000;

    if (!existingTime || (now - existingTime) > expireTime) {
      downloadRecords[bookId].volumes[volId].formats[format] = now;
      saveDownloadRecords();
    }
  }

  function saveResolvedDownloadRecord(item) {
    if (!item || item.downloadRecordSaved) return;
    addDownloadRecord(item.bookId, item.volId, item.format, item.volName, {
      title: item.bookTitle || '',
      cover: item.bookCover || '',
      description: item.bookDescription || '',
      url: item.pageUrl || window.location.href
    });
    item.downloadRecordSaved = true;
  }

  function isDownloaded(bookId, volId, format) {
    if (!downloadRecords[bookId] || !downloadRecords[bookId].volumes[volId]) return false;
    var vol = downloadRecords[bookId].volumes[volId];
    if (!vol.formats || !vol.formats[format]) return false;
    var now = Date.now();
    var expireTime = RECORD_EXPIRE_HOURS * 60 * 60 * 1000;
    return (now - vol.formats[format]) <= expireTime;
  }

  function queryFirst(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var node = document.querySelector(selectors[i]);
      if (node) return node;
    }
    return null;
  }

  function findDownloadButtonAnchor() {
    return document.getElementById('bt_down_all_1_mobi') ||
      document.getElementById('bt_down_all_1_epub') ||
      queryFirst([
        '[id^="bt_down_all_"]',
        '[id*="down_all"][id*="mobi"]',
        '[id*="down_all"][id*="epub"]',
        'button[onclick*="down_all"]',
        'input[onclick*="down_all"]',
        'a[onclick*="down_all"]'
      ]);
  }

  function findChapterCheckboxAnchor() {
    return document.getElementById('checkbox_all_1001') ||
      queryFirst([
        'input[type="checkbox"][id^="checkbox_all_"]',
        'input[name="checkbox_all"]',
        'input[type="checkbox"][name="checkbox_vol"]'
      ]);
  }

  function shouldShowFloatingDownloadEntry() {
    return !!(findDownloadButtonAnchor() || findChapterCheckboxAnchor() || findRenderedBookId());
  }

  function createFloatingFormatButton(format, label) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'kmoe-floating-format-btn kmoe-floating-format-' + label.toLowerCase();
    button.textContent = label;
    button.title = '下载 ' + label;
    button.dataset.format = format;
    button.addEventListener('click', function (e) {
      e.preventDefault();
      if (floatingSuppressClick) return;
      openCardWithFormat(format);
    });
    return button;
  }

  function createDownloadButton() {
    if (document.getElementById('kmoe-download-floating')) return true;
    if (!shouldShowFloatingDownloadEntry()) return false;

    var launcher = document.createElement('div');
    launcher.id = 'kmoe-download-floating';

    var title = document.createElement('div');
    title.className = 'kmoe-floating-title';
    var mark = document.createElement('span');
    mark.className = 'kmoe-floating-mark';
    mark.textContent = 'K';
    title.appendChild(mark);
    var titleText = document.createElement('span');
    titleText.className = 'kmoe-floating-title-text';
    titleText.textContent = 'Batch DL';
    title.appendChild(titleText);
    launcher.appendChild(title);

    var actions = document.createElement('div');
    actions.className = 'kmoe-floating-actions';
    actions.appendChild(createFloatingFormatButton('1', 'MOBI'));
    actions.appendChild(createFloatingFormatButton('2', 'EPUB'));
    launcher.appendChild(actions);

    bindFloatingEntry(launcher);
    document.body.appendChild(launcher);
    restoreFloatingEntryPosition(launcher);
    return true;
  }

  function getFloatingStorage() {
    try {
      if (window.localStorage) return window.localStorage;
    } catch (e) {}
    return null;
  }

  function readFloatingEntryPosition() {
    var storage = getFloatingStorage();
    if (!storage) return null;
    try {
      var raw = storage.getItem(FLOATING_POS_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function writeFloatingEntryPosition(left, top) {
    var storage = getFloatingStorage();
    if (!storage) return;
    try {
      storage.setItem(FLOATING_POS_KEY, JSON.stringify({ left: left, top: top }));
    } catch (e) {}
  }

  function clampFloatingEntryPosition(launcher, left, top) {
    var margin = 8;
    var width = launcher.offsetWidth || 36;
    var height = launcher.offsetHeight || 36;
    var maxLeft = Math.max(margin, window.innerWidth - width - margin);
    var maxTop = Math.max(margin, window.innerHeight - height - margin);
    return {
      left: Math.min(Math.max(left, margin), maxLeft),
      top: Math.min(Math.max(top, margin), maxTop)
    };
  }

  function applyFloatingEntryPosition(launcher, left, top) {
    var clamped = clampFloatingEntryPosition(launcher, left, top);
    launcher.style.left = clamped.left + 'px';
    launcher.style.top = clamped.top + 'px';
    launcher.style.right = 'auto';
    launcher.style.bottom = 'auto';
    return clamped;
  }

  function restoreFloatingEntryPosition(launcher) {
    var saved = readFloatingEntryPosition();
    var left;
    var top;
    if (saved) {
      left = saved.left;
      top = saved.top;
    } else {
      left = window.innerWidth - (launcher.offsetWidth || 36) - 16;
      top = Math.round(window.innerHeight * 0.38);
    }
    applyFloatingEntryPosition(launcher, left, top);
  }

  function keepFloatingEntryInViewport() {
    var launcher = document.getElementById('kmoe-download-floating');
    if (!launcher) return;
    var rect = launcher.getBoundingClientRect();
    applyFloatingEntryPosition(launcher, rect.left, rect.top);
  }

  function bindFloatingEntry(launcher) {
    var dragging = false;
    var moved = false;
    var startX = 0;
    var startY = 0;
    var offsetX = 0;
    var offsetY = 0;
    var activePointerId = null;

    function finishDrag(event) {
      if (activePointerId === null) return;
      if (event && event.pointerId !== undefined && event.pointerId !== activePointerId) return;
      if (launcher.releasePointerCapture && activePointerId !== null) {
        try {
          launcher.releasePointerCapture(activePointerId);
        } catch (e) {}
      }
      dragging = false;
      activePointerId = null;
      launcher.classList.remove('is-dragging');
      if (moved) {
        var rect = launcher.getBoundingClientRect();
        var clamped = applyFloatingEntryPosition(launcher, rect.left, rect.top);
        writeFloatingEntryPosition(clamped.left, clamped.top);
        floatingSuppressClick = true;
      }
    }

    launcher.addEventListener('pointerdown', function (event) {
      if (event.button !== undefined && event.button !== 0) return;
      var point = event;
      var rect = launcher.getBoundingClientRect();
      dragging = false;
      moved = false;
      floatingSuppressClick = false;
      activePointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
      startX = point.clientX;
      startY = point.clientY;
      offsetX = point.clientX - rect.left;
      offsetY = point.clientY - rect.top;
    });

    launcher.addEventListener('pointermove', function (event) {
      if (activePointerId !== null && event.pointerId !== activePointerId) return;
      if (activePointerId === null) return;
      var dx = event.clientX - startX;
      var dy = event.clientY - startY;
      if (!moved && (Math.abs(dx) > FLOATING_DRAG_THRESHOLD_PX || Math.abs(dy) > FLOATING_DRAG_THRESHOLD_PX)) {
        moved = true;
        dragging = true;
        launcher.classList.add('is-dragging');
        if (launcher.setPointerCapture && activePointerId !== null) {
          try {
            launcher.setPointerCapture(activePointerId);
          } catch (e) {}
        }
      }
      if (!moved) return;
      applyFloatingEntryPosition(launcher, event.clientX - offsetX, event.clientY - offsetY);
      event.preventDefault();
    });

    launcher.addEventListener('pointerup', finishDrag);
    launcher.addEventListener('pointercancel', finishDrag);

    window.addEventListener('resize', keepFloatingEntryInViewport);
    window.addEventListener('scroll', keepFloatingEntryInViewport, true);
  }

  function groupByCategory(arr) {
    const groups = {};
    arr.forEach(function (item, index) {
      const category = item.category || '其他';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push({ item: item, index: index });
    });
    return groups;
  }

  function clearChildren(node) {
    while (node && node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function appendTextElement(parent, tagName, className, text) {
    var el = document.createElement(tagName);
    if (className) el.className = className;
    el.textContent = text || '';
    parent.appendChild(el);
    return el;
  }

  function setSafeImageSrc(img, src) {
    var value = String(src || '').trim();
    if (/^https?:/i.test(value) || /^data:image\/(?:png|gif|jpe?g|webp);/i.test(value)) {
      img.src = value;
    } else {
      img.removeAttribute('src');
    }
  }

  function appendChapterList(container, arr, format, bookId) {
    clearChildren(container);
    if (!arr || arr.length === 0) {
      appendTextElement(container, 'div', 'kmoe-empty', '暂无章节');
      return;
    }

    const groups = groupByCategory(arr);

    Object.keys(groups).forEach(function (category) {
      const items = groups[category];
      var group = document.createElement('div');
      group.className = 'kmoe-category-group';

      var header = document.createElement('div');
      header.className = 'kmoe-category-header';

      var selectAllLabel = document.createElement('label');
      selectAllLabel.className = 'kmoe-category-select-all';

      var categoryCheckbox = document.createElement('input');
      categoryCheckbox.type = 'checkbox';
      categoryCheckbox.className = 'kmoe-category-checkbox';
      categoryCheckbox.dataset.category = category;
      categoryCheckbox.checked = true;
      selectAllLabel.appendChild(categoryCheckbox);

      appendTextElement(selectAllLabel, 'span', '', category);
      header.appendChild(selectAllLabel);
      appendTextElement(header, 'span', 'kmoe-category-count', items.length + ' 章');
      group.appendChild(header);

      var itemList = document.createElement('div');
      itemList.className = 'kmoe-category-items';

      items.forEach(function (entry) {
        const item = entry.item;
        const index = entry.index;
        const name = item.name || '第' + (index + 1) + '章';
        const size = format === '1' ? item.mobiSize : item.epubSize;
        const downloaded = isDownloaded(bookId, item.id, format);

        var label = document.createElement('label');
        label.className = 'kmoe-chapter-item' + (downloaded ? ' kmoe-already-downloaded' : '');

        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'kmoe-chapter-checkbox';
        checkbox.dataset.index = String(index);
        checkbox.dataset.category = category;
        checkbox.checked = true;
        label.appendChild(checkbox);

        var nameEl = document.createElement('span');
        nameEl.className = 'kmoe-chapter-name';
        nameEl.appendChild(document.createTextNode(name));
        if (size) {
          nameEl.appendChild(document.createTextNode(' '));
          appendTextElement(nameEl, 'span', 'kmoe-chapter-size', '(' + size + 'MB)');
        }
        if (downloaded) {
          nameEl.appendChild(document.createTextNode(' '));
          appendTextElement(nameEl, 'span', 'kmoe-downloaded-mark', '✓');
        }
        label.appendChild(nameEl);
        itemList.appendChild(label);
      });

      group.appendChild(itemList);
      container.appendChild(group);
    });
  }

  function formatQuotaSize(sizeMb) {
    if (sizeMb >= 1024) {
      return (sizeMb / 1024).toFixed(1) + 'GB';
    }
    return sizeMb.toFixed(1) + 'MB';
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (ch) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[ch];
    });
  }

  function normalizeQuotaAvailable(bookInfo) {
    if (!bookInfo || bookInfo.quotaAvailable === null || typeof bookInfo.quotaAvailable === 'undefined') {
      return null;
    }
    var quotaAvailable = Number(bookInfo.quotaAvailable);
    return Number.isFinite(quotaAvailable) ? quotaAvailable : null;
  }

  function getChapterDownloadSize(chapter, format) {
    if (!chapter) return 0;
    var size = format === '1' ? chapter.mobiSize : chapter.epubSize;
    size = Number(size);
    return Number.isFinite(size) && size > 0 ? size : 0;
  }

  function calculateSelectedDownloadSize(bookInfo, selected, format, downloadedChecker) {
    var totalSize = 0;
    var chapters = bookInfo && Array.isArray(bookInfo.arr) ? bookInfo.arr : [];
    var checker = downloadedChecker || isDownloaded;
    var bookId = bookInfo && bookInfo.bookId ? bookInfo.bookId : '';

    selected.forEach(function (chapter) {
      var chapterData = chapters[chapter.index];
      if (!chapterData) return;
      if (checker(bookId, chapterData.id, format)) return;
      totalSize += getChapterDownloadSize(chapterData, format);
    });

    return totalSize;
  }

  function validateDownloadQuota(bookInfo, selected, format, downloadedChecker) {
    var selectedSize = calculateSelectedDownloadSize(bookInfo, selected, format, downloadedChecker);
    var quotaAvailable = normalizeQuotaAvailable(bookInfo);

    if (quotaAvailable !== null && selectedSize > quotaAvailable + 0.5) {
      return {
        ok: false,
        selectedSize: selectedSize,
        quotaAvailable: quotaAvailable,
        reason: '额度不足'
      };
    }

    return {
      ok: true,
      selectedSize: selectedSize,
      quotaAvailable: quotaAvailable,
      reason: ''
    };
  }

  function getQuotaDisplayText(bookInfo) {
    var quotaAvailable = normalizeQuotaAvailable(bookInfo);
    return quotaAvailable === null ? '' : '可用额度: ' + formatQuotaSize(quotaAvailable);
  }

  function updateQuotaInfoElement(card, bookInfo) {
    if (!card) return;
    var quotaEls = card.querySelectorAll('.kmoe-quota-info');
    if (!quotaEls.length) return;
    var quotaText = getQuotaDisplayText(bookInfo);
    quotaEls.forEach(function (quotaEl) {
      quotaEl.textContent = quotaText;
      quotaEl.style.display = quotaText ? '' : 'none';
    });
  }

  function refreshCardBookInfo(bookInfo) {
    var card = document.getElementById('kmoe-download-card');
    if (!card || !bookInfo) return;
    updateQuotaInfoElement(card, bookInfo);
    updateSelectionInfo(bookInfo);
  }

  function getTrimmedText(selector) {
    var node = document.querySelector(selector);
    return node && node.textContent ? node.textContent.trim() : '';
  }

  function collectAuthorNames() {
    return Array.from(document.querySelectorAll("a[href*='list.php?s=']")).map(function (el) {
      if (el.closest && el.closest('#txt_recbook')) return '';
      return el.textContent ? el.textContent.trim() : '';
    }).filter(Boolean);
  }

  function collectDescriptionText() {
    var node = document.querySelector('#div_desc_content');
    if (!node) return '';
    if (node.childNodes && node.childNodes.length) {
      return Array.from(node.childNodes).map(function (child) {
        if (child.nodeType === 3) return child.textContent || '';
        if (child.nodeType === 1 && String(child.tagName || '').toUpperCase() === 'BR') return '\n';
        return '';
      }).join('').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').trim();
    }
    var text = typeof node.innerText === 'string' ? node.innerText : node.textContent;
    return text ? text.trim() : '';
  }

  function parseModuleLiteral(raw) {
    if (typeof raw !== 'string') return undefined;
    raw = raw.trim();
    if ((raw[0] === '"' && raw[raw.length - 1] === '"') || (raw[0] === "'" && raw[raw.length - 1] === "'")) {
      return raw.slice(1, -1);
    }
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
    return undefined;
  }

  function findModuleVariable(name) {
    var scripts = Array.from(document.querySelectorAll('script[type="module"]'));
    var pattern = new RegExp('(?:var|let|const)\\s+' + name + '\\s*=\\s*([^;]+)');
    for (var i = 0; i < scripts.length; i++) {
      var text = scripts[i].textContent || '';
      var match = text.match(pattern);
      if (match) {
        return parseModuleLiteral(match[1]);
      }
    }
    return undefined;
  }

  function collectModuleFallbackInfo() {
    var quotaAvailable = findModuleVariable('quota_now');
    var quotaUsed = findModuleVariable('quota_used');
    var downloadOrigin = findModuleVariable('str_urldomain') ||
      findModuleVariable('down_domain') ||
      findModuleVariable('str_down_domain') ||
      findModuleVariable('str_down_host');

    return {
      quotaAvailable: typeof quotaAvailable === 'undefined' ? null : Number(quotaAvailable),
      quotaUsed: typeof quotaUsed === 'undefined' ? null : Number(quotaUsed),
      downloadOrigin: downloadOrigin || window.location.origin
    };
  }

  function findRenderedBookId() {
    var input = document.querySelector('input[name="bookid"]') ||
      document.querySelector('input[name="push_bookid"]') ||
      document.querySelector('input[name="follow_bookid"]');
    if (input && input.value) return input.value;

    var match = window.location.pathname.match(/\/c\/(\d+)\.htm/i);
    return match ? match[1] : '';
  }

  function findChapterSize(row, volId) {
    var expectedName = 'size_down_' + volId;
    var input = findInputByName(row, expectedName) || findInputByName(document, expectedName);

    var size = input && input.value ? parseFloat(input.value) : null;
    return size && size > 0 ? size : null;
  }

  function findInputByName(root, name) {
    if (!root || !root.querySelectorAll) return null;
    return Array.from(root.querySelectorAll('input')).find(function (input) {
      return input.name === name;
    }) || null;
  }

  function collectBookInfoFromDocument() {
    var bookId = findRenderedBookId();
    if (!bookId) return null;

    var chapterInputs = Array.from(document.querySelectorAll('input[name="checkbox_vol"]'));
    var chapters = [];

    chapterInputs.forEach(function (input) {
      var volId = input.value;
      if (!volId) return;

      var row = input.closest ? input.closest('tr') : null;
      var nameNode = row ? row.querySelector('b') : null;
      var name = nameNode && nameNode.textContent ? nameNode.textContent.trim() : '';
      var size = findChapterSize(row, volId);

      chapters.push({
        id: volId,
        category: '章节',
        name: name || '第' + (chapters.length + 1) + '章',
        mobiSize: size,
        epubSize: size
      });
    });

    if (!chapters.length) return null;

    var coverNode = document.querySelector('.img_book');
    var moduleInfo = collectModuleFallbackInfo();
    return {
      bookId: bookId,
      arr: chapters,
      title: getTrimmedText('.text_bglight_big') || document.title,
      cover: coverNode && coverNode.src ? coverNode.src : '',
      description: collectDescriptionText(),
      author: collectAuthorNames(),
      downPrefix: '/dl/' + bookId + '/',
      downSuffix: '/0/',
      downloadOrigin: moduleInfo.downloadOrigin,
      fileFormat: null,
      quotaAvailable: moduleInfo.quotaAvailable,
      quotaUsed: moduleInfo.quotaUsed
    };
  }

  function normalizeDownloadFormat(format) {
    return Settings.normalizeDownloadFormat(format);
  }

  function getPreferredDownloadFormat() {
    return normalizeDownloadFormat(preferredDownloadFormat);
  }

  function savePreferredDownloadFormat(format) {
    preferredDownloadFormat = normalizeDownloadFormat(format);
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

    try {
      chrome.storage.local.get(['kmoe_settings'], function (result) {
        try {
          var settings = result && result.kmoe_settings ? result.kmoe_settings : {};
          settings.downloadFormat = preferredDownloadFormat;
          chrome.storage.local.set({ kmoe_settings: settings });
        } catch (err) {
          console.warn('Kmoe 默认格式保存失败:', err);
        }
      });
    } catch (err) {
      console.warn('Kmoe 默认格式保存失败:', err);
    }
  }

  function applyCardFormat(card, format) {
    if (!card) return;
    var normalizedFormat = normalizeDownloadFormat(format);
    var formatSelect = card.querySelector('#kmoe-format');
    if (!formatSelect) return;

    formatSelect.value = normalizedFormat;
    if (!cachedBookInfo) return;

    var listEl = card.querySelector('#kmoe-chapter-list');
    if (listEl) {
      appendChapterList(listEl, cachedBookInfo.arr, normalizedFormat, cachedBookInfo.bookId);
      updateSelectionInfo(cachedBookInfo);
    }
  }

  function openCardWithFormat(format) {
    var normalizedFormat = normalizeDownloadFormat(format);
    savePreferredDownloadFormat(normalizedFormat);

    var card = document.getElementById('kmoe-download-card');
    if (!card) {
      card = createCard();
      if (!card) return;
    }

    applyCardFormat(card, normalizedFormat);
    showCard();
  }

  function createCard() {
    if (!cachedBookInfo) {
      cachedBookInfo = collectBookInfoFromDocument();
      if (!cachedBookInfo) {
        alert('数据加载中，请稍后再试');
        return null;
      }
    }

    const bookInfo = cachedBookInfo;
    const initialFormat = getPreferredDownloadFormat();
    const card = document.createElement('div');
    card.id = 'kmoe-download-card';

    var header = document.createElement('div');
    header.className = 'kmoe-card-header';
    appendTextElement(header, 'span', '', 'Kmoe Download');
    var closeButton = document.createElement('button');
    closeButton.className = 'kmoe-card-close';
    closeButton.type = 'button';
    closeButton.textContent = '×';
    header.appendChild(closeButton);
    card.appendChild(header);

    var body = document.createElement('div');
    body.className = 'kmoe-card-body';

    var bookInfoEl = document.createElement('div');
    bookInfoEl.className = 'kmoe-book-info';
    var cover = document.createElement('img');
    cover.className = 'kmoe-book-cover';
    cover.alt = 'cover';
    setSafeImageSrc(cover, bookInfo.cover);
    bookInfoEl.appendChild(cover);

    var meta = document.createElement('div');
    meta.className = 'kmoe-book-meta';
    appendTextElement(meta, 'div', 'kmoe-book-title', bookInfo.title || '');
    var authors = Array.isArray(bookInfo.author) ? bookInfo.author : [];
    appendTextElement(meta, 'div', 'kmoe-book-author', authors.join(', ') || '未知作者');
    var description = appendTextElement(meta, 'div', 'kmoe-book-description', bookInfo.description || '');
    description.title = bookInfo.description || '';
    bookInfoEl.appendChild(meta);
    body.appendChild(bookInfoEl);

    var formatRow = document.createElement('div');
    formatRow.className = 'kmoe-format-select';
    var formatLabel = document.createElement('label');
    formatLabel.textContent = '文件格式：';
    formatRow.appendChild(formatLabel);
    var formatSelect = document.createElement('select');
    formatSelect.id = 'kmoe-format';
    [['1', 'MOBI'], ['2', 'EPUB']].forEach(function (optionData) {
      var option = document.createElement('option');
      option.value = optionData[0];
      option.textContent = optionData[1];
      formatSelect.appendChild(option);
    });
    formatRow.appendChild(formatSelect);
    body.appendChild(formatRow);

    var chapterHeader = document.createElement('div');
    chapterHeader.className = 'kmoe-chapter-header';
    var selectAllLabel = document.createElement('label');
    selectAllLabel.className = 'kmoe-select-all';
    var selectAllInput = document.createElement('input');
    selectAllInput.type = 'checkbox';
    selectAllInput.id = 'kmoe-select-all';
    selectAllInput.checked = true;
    selectAllLabel.appendChild(selectAllInput);
    appendTextElement(selectAllLabel, 'span', '', '全选');
    chapterHeader.appendChild(selectAllLabel);

    var summary = document.createElement('div');
    summary.className = 'kmoe-chapter-summary';
    appendTextElement(summary, 'span', 'kmoe-quota-info', '');
    var count = document.createElement('span');
    count.className = 'kmoe-chapter-count';
    count.appendChild(document.createTextNode('已选 '));
    var selectedCount = appendTextElement(count, 'span', '', String(bookInfo.arr.length));
    selectedCount.id = 'kmoe-selected-count';
    count.appendChild(document.createTextNode(' / ' + bookInfo.arr.length + ' 章'));
    summary.appendChild(count);
    chapterHeader.appendChild(summary);
    body.appendChild(chapterHeader);

    var chapterList = document.createElement('div');
    chapterList.className = 'kmoe-chapter-list';
    chapterList.id = 'kmoe-chapter-list';
    appendChapterList(chapterList, bookInfo.arr, initialFormat, bookInfo.bookId);
    body.appendChild(chapterList);

    var downloadInfo = document.createElement('div');
    downloadInfo.className = 'kmoe-download-info';
    var sizeText = document.createElement('span');
    sizeText.appendChild(document.createTextNode('选中大小: '));
    var selectedSize = appendTextElement(sizeText, 'span', '', '0');
    selectedSize.id = 'kmoe-selected-size';
    sizeText.appendChild(document.createTextNode('MB'));
    downloadInfo.appendChild(sizeText);
    body.appendChild(downloadInfo);

    var actions = document.createElement('div');
    actions.className = 'kmoe-download-actions';
    var startButton = document.createElement('button');
    startButton.className = 'kmoe-download-btn';
    startButton.id = 'kmoe-start-download';
    startButton.type = 'button';
    startButton.textContent = '开始下载';
    actions.appendChild(startButton);
    body.appendChild(actions);
    card.appendChild(body);

    document.body.appendChild(card);

    if (formatSelect) {
      formatSelect.value = initialFormat;
    }
    updateQuotaInfoElement(card, bookInfo);

    card.querySelector('.kmoe-card-close').addEventListener('click', hideCard);
    makePanelDraggable(card, card.querySelector('.kmoe-card-header'));

    var selectAllCheckbox = card.querySelector('#kmoe-select-all');
    selectAllCheckbox.addEventListener('change', function () {
      var checkboxes = card.querySelectorAll('.kmoe-chapter-checkbox');
      var categoryCheckboxes = card.querySelectorAll('.kmoe-category-checkbox');
      checkboxes.forEach(function (cb) { cb.checked = selectAllCheckbox.checked; });
      categoryCheckboxes.forEach(function (cb) { cb.checked = selectAllCheckbox.checked; });
      updateSelectionInfo(bookInfo);
    });

    card.querySelector('.kmoe-chapter-list').addEventListener('change', function (e) {
      if (e.target.classList.contains('kmoe-category-checkbox')) {
        var category = e.target.dataset.category;
        getChapterCheckboxesByCategory(card, category).forEach(function (cb) { cb.checked = e.target.checked; });
        updateSelectionInfo(bookInfo);
        updateGlobalSelectAll();
      } else if (e.target.classList.contains('kmoe-chapter-checkbox')) {
        updateSelectionInfo(bookInfo);
        updateGlobalSelectAll();
        updateCategorySelectAll(e.target.dataset.category);
      }
    });

    card.querySelector('#kmoe-format').addEventListener('change', function () {
      var format = this.value;
      savePreferredDownloadFormat(format);
      var listEl = card.querySelector('#kmoe-chapter-list');
      appendChapterList(listEl, bookInfo.arr, format, bookInfo.bookId);
      updateSelectionInfo(bookInfo);
    });

    card.querySelector('#kmoe-start-download').addEventListener('click', function () {
      startDownload(bookInfo);
    });

    updateSelectionInfo(bookInfo);

    return card;
  }

  function updateGlobalSelectAll() {
    var card = document.getElementById('kmoe-download-card');
    if (!card) return;
    var checkboxes = card.querySelectorAll('.kmoe-chapter-checkbox');
    var allChecked = Array.from(checkboxes).every(function (cb) { return cb.checked; });
    var selectAllCheckbox = card.querySelector('#kmoe-select-all');
    if (selectAllCheckbox) {
      selectAllCheckbox.checked = allChecked;
    }
  }

  function updateCategorySelectAll(category) {
    var card = document.getElementById('kmoe-download-card');
    if (!card) return;
    var checkboxes = getChapterCheckboxesByCategory(card, category);
    var allChecked = Array.from(checkboxes).every(function (cb) { return cb.checked; });
    var categoryCheckbox = Array.from(card.querySelectorAll('.kmoe-category-checkbox')).find(function (cb) {
      return cb.dataset.category === category;
    });
    if (categoryCheckbox) {
      categoryCheckbox.checked = allChecked;
    }
  }

  function getChapterCheckboxesByCategory(card, category) {
    return Array.from(card.querySelectorAll('.kmoe-chapter-checkbox')).filter(function (cb) {
      return cb.dataset.category === category;
    });
  }

  function updateSelectionInfo(bookInfo) {
    var card = document.getElementById('kmoe-download-card');
    if (!card) return;

    var formatSelect = card.querySelector('#kmoe-format');
    var format = formatSelect ? formatSelect.value : '1';

    var checkboxes = card.querySelectorAll('.kmoe-chapter-checkbox:checked');
    var countEl = card.querySelector('#kmoe-selected-count');
    if (countEl) {
      countEl.textContent = checkboxes.length;
    }

    var selected = Array.from(checkboxes).map(function (cb) {
      return {
        index: parseInt(cb.dataset.index)
      };
    });
    var totalSize = calculateSelectedDownloadSize(bookInfo, selected, format);

    var sizeEl = card.querySelector('#kmoe-selected-size');
    if (sizeEl) {
      sizeEl.textContent = totalSize.toFixed(1);
    }

    var downloadBtn = card.querySelector('#kmoe-start-download');
    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.classList.remove('kmoe-download-btn-disabled');
      downloadBtn.textContent = '开始下载';
      downloadBtn.title = '';
    }
  }

  function getSelectedChapters() {
    var card = document.getElementById('kmoe-download-card');
    if (!card) return [];
    var checkboxes = card.querySelectorAll('.kmoe-chapter-checkbox:checked');
    return Array.from(checkboxes).map(function (cb) {
      return {
        index: parseInt(cb.dataset.index)
      };
    });
  }

  function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_').trim();
  }

  function buildMangaDirectoryName(bookInfo) {
    var title = bookInfo && bookInfo.title ? sanitizeFilename(bookInfo.title) : '';
    if (title) return title;
    var bookId = bookInfo && bookInfo.bookId ? bookInfo.bookId : 'unknown';
    return 'book-' + sanitizeFilename(String(bookId));
  }

  function buildDownloadPath(directory, filename) {
    return directory ? directory + '/' + filename : filename;
  }

  function makePanelDraggable(panel, handle) {
    if (!panel || !handle || panel.dataset.kmoeDraggable === '1') return;
    panel.dataset.kmoeDraggable = '1';

    var dragging = false;
    var offsetX = 0;
    var offsetY = 0;
    var activePointerId = null;

    function getPoint(event) {
      return event;
    }

    function moveTo(clientX, clientY) {
      panel.style.left = (clientX - offsetX) + 'px';
      panel.style.top = (clientY - offsetY) + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.transform = 'none';
    }

    function startDrag(event) {
      if (event.button !== undefined && event.button !== 0) return;
      if (event.target && event.target.closest && event.target.closest('button, input, select, textarea, a, label, .kmoe-chapter-list')) return;

      var point = getPoint(event);
      var rect = panel.getBoundingClientRect();
      dragging = true;
      activePointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
      offsetX = point.clientX - rect.left;
      offsetY = point.clientY - rect.top;
      moveTo(point.clientX, point.clientY);
      if (handle.setPointerCapture && activePointerId !== null) {
        try {
          handle.setPointerCapture(activePointerId);
        } catch (e) {}
      }
      event.preventDefault();
    }

    function onDrag(event) {
      if (!dragging) return;
      if (activePointerId !== null && event.pointerId !== activePointerId) return;
      var point = getPoint(event);
      moveTo(point.clientX, point.clientY);
      event.preventDefault();
    }

    function stopDrag(event) {
      if (!dragging) return;
      if (activePointerId !== null && event && event.pointerId !== activePointerId) return;
      if (handle.releasePointerCapture && activePointerId !== null) {
        try {
          handle.releasePointerCapture(activePointerId);
        } catch (e) {}
      }
      dragging = false;
      activePointerId = null;
    }

    handle.addEventListener('pointerdown', startDrag);
    handle.addEventListener('pointermove', onDrag);
    handle.addEventListener('pointerup', stopDrag);
    handle.addEventListener('pointercancel', stopDrag);
  }

  function kbSaveAs(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function kbHttpDown(url, filename, onProgress, onComplete, onError) {
    var xhr = new XMLHttpRequest();
    var finished = false;
    var stallTimer = null;

    function clearStallTimer() {
      if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
    }

    function fail(reason) {
      if (finished) return;
      finished = true;
      clearStallTimer();
      activeXhrs.delete(xhr);
      if (downloadCancelled) return;
      if (onError) onError(reason);
    }

    function armStallTimer() {
      clearStallTimer();
      stallTimer = setTimeout(function () {
        if (finished) return;
        xhr.abort();
        fail('timeout');
      }, DOWNLOAD_STALL_TIMEOUT_MS);
    }

    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    xhr.timeout = DOWNLOAD_REQUEST_TIMEOUT_MS;
    xhr.setRequestHeader('X-KM-FROM', 'kb_http_down');

    activeXhrs.add(xhr);
    armStallTimer();

    xhr.onprogress = function (e) {
      armStallTimer();
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded, e.total);
      }
    };

    xhr.onload = function () {
      if (finished) return;
      finished = true;
      clearStallTimer();
      activeXhrs.delete(xhr);
      if (downloadCancelled) return;
      if (xhr.status === 200) {
        if (onComplete) {
          onComplete(xhr.response, filename);
        } else {
          kbSaveAs(xhr.response, filename);
        }
      } else {
        if (onError) onError(xhr.status);
      }
    };

    xhr.onerror = function () {
      fail('network');
    };

    xhr.ontimeout = function () {
      fail('timeout');
    };

    xhr.onabort = function () {
      clearStallTimer();
      activeXhrs.delete(xhr);
    };

    xhr.send();
    return xhr;
  }

  function getDownloadUrl(bookId, volId, format, callback) {
    var s_url = '/getdownurl.php?b=' + bookId + '&v=' + volId + '&mobi=' + format + '&vip=0&json=1';
    var xhr = new XMLHttpRequest();
    xhr.open('GET', s_url);
    xhr.timeout = DOWNLOAD_URL_TIMEOUT_MS;
    xhr.onload = function () {
      try {
        var rsp = JSON.parse(xhr.responseText);
        callback(rsp);
      } catch (e) {
        callback(null);
      }
    };
    xhr.onerror = function () {
      callback(null);
    };
    xhr.ontimeout = function () {
      callback(null);
    };
    xhr.send();
  }

  var downloadQueue = [];
  var maxDownload = 1;
  var downloading = 0;
  var progressPanel = null;
  var downloadDelay = 1500;
  var maxRetry = 5;
  var downloadMode = 'aria2';
  var downloadCancelled = false;
  var activeXhrs = new Set();
  var activeAria2Downloads = {};
  var activeAria2PollTimers = {};
  var nextDownloadItemId = 1;

  function getSettingsMaxDownload(settings, mode) {
    return Settings.normalizeMaxDownloadByMode(settings)[mode];
  }

  function getEffectiveMaxDownload() {
    var limit = Settings.normalizeMaxDownload(maxDownload, downloadMode);
    if (downloadQueue.length > 0) {
      limit = Math.min(limit, downloadQueue.length);
    }
    return limit;
  }

  function loadSettings() {
    Settings.loadSettings(function (settings) {
      downloadMode = Settings.normalizeDownloadMode(settings.downloadMode);
      maxDownload = getSettingsMaxDownload(settings, downloadMode);
      downloadDelay = settings.downloadDelay || 1500;
      maxRetry = settings.maxRetry || 5;
      preferredDownloadFormat = normalizeDownloadFormat(settings.downloadFormat);
    });
  }

  function createProgressPanel() {
    if (progressPanel) return progressPanel;

    progressPanel = document.createElement('div');
    progressPanel.id = 'kmoe-progress-panel';
    progressPanel.innerHTML =
      '<div class="kmoe-progress-header">' +
      '<span>下载进度</span>' +
      '<div class="kmoe-progress-actions">' +
      '<button class="kmoe-progress-cancel" id="kmoe-cancel-download">取消</button>' +
      '<button class="kmoe-progress-close">&times;</button>' +
      '</div>' +
      '</div>' +
      '<div class="kmoe-progress-body" id="kmoe-progress-body"></div>' +
      '<div class="kmoe-progress-footer">' +
      '<span id="kmoe-progress-stats">等待: 0 | 完成: 0 | 失败: 0</span>' +
      '</div>';
    document.body.appendChild(progressPanel);

    progressPanel.querySelector('.kmoe-progress-close').addEventListener('click', function () {
      progressPanel.style.display = 'none';
    });
    makePanelDraggable(progressPanel, progressPanel.querySelector('.kmoe-progress-header'));

    progressPanel.querySelector('#kmoe-cancel-download').addEventListener('click', function () {
      cancelDownload();
    });

    return progressPanel;
  }

  function cancelDownload() {
    downloadCancelled = true;

    activeXhrs.forEach(function (xhr) {
      xhr.abort();
    });
    activeXhrs.clear();

    if (downloadMode === 'aria2') {
      Object.keys(activeAria2Downloads).forEach(function (gid) {
        chrome.runtime.sendMessage({
          type: 'KMOE_ARIA2_CANCEL',
          payload: { gid: gid }
        });
      });
    }
    Object.keys(activeAria2PollTimers).forEach(function (gid) {
      clearTimeout(activeAria2PollTimers[gid]);
    });
    activeAria2Downloads = {};
    activeAria2PollTimers = {};

    downloadQueue.forEach(function (item) {
      if (item.status === 0 || item.status === 1) {
        item.status = 4;
      }
    });

    downloading = 0;
    updateProgressPanel();

    var statsEl = document.getElementById('kmoe-progress-stats');
    if (statsEl) {
      statsEl.textContent = '已取消';
    }
  }

  function updateProgressPanel() {
    if (!progressPanel) return;

    var numQueued = 0;
    var numSuccess = 0;
    var numFail = 0;
    var numDownloading = 0;

    downloadQueue.forEach(function (item) {
      if (item.status === 0) numQueued++;
      else if (item.status === 1) numDownloading++;
      else if (item.status === 2) numSuccess++;
      else if (item.status === 3) numFail++;
    });

    var statsEl = document.getElementById('kmoe-progress-stats');
    if (statsEl) {
      statsEl.textContent = '等待: ' + numQueued + ' | 下载中: ' + numDownloading + '/' + getEffectiveMaxDownload() + ' | 完成: ' + numSuccess + ' | 失败: ' + numFail;
    }

    var bodyEl = document.getElementById('kmoe-progress-body');
    if (bodyEl) {
      clearChildren(bodyEl);
      downloadQueue.forEach(function (item, index) {
        if (item.status === 1 || item.status === 3) {
          bodyEl.appendChild(createProgressItem(item));
        }
      });
    }
  }

  function formatSpeed(bytesPerSec) {
    if (bytesPerSec > 1048576) {
      return (bytesPerSec / 1048576).toFixed(1) + ' MB/s';
    } else {
      return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
    }
  }

  function formatFailureReason(err) {
    if (err === 429 || String(err) === '429') return '请求过于频繁，请稍后重试';
    var reason = err ? String(err) : '下载失败';
    var lower = reason.toLowerCase();

    if (lower === 'network' || lower.indexOf('network') >= 0 || lower.indexOf('failed to fetch') >= 0) {
      return '网络连接失败';
    }
    if (lower === 'timeout' || lower.indexOf('timeout') >= 0) {
      return '网络超时';
    }
    if (lower.indexOf('connection refused') >= 0 || lower.indexOf('econnrefused') >= 0) {
      return '连接失败';
    }

    return reason;
  }

  function getProgressItemText(item) {
    var isFailed = item.status === 3;
    var percent = item.progress || 0;
    var speed = item.speed ? formatSpeed(item.speed) : '';
    return isFailed
      ? '失败：' + (item.statusText || '下载失败')
      : (item.statusText || (item.status === 0 ? '等待后台下载' : (percent + '% ' + speed)));
  }

  function createProgressItem(item) {
    var isFailed = item.status === 3;
    var percent = Math.max(0, Math.min(100, Number(item.progress) || 0));
    var info = getProgressItemText(item);
    var itemClass = 'kmoe-progress-item' + (isFailed ? ' kmoe-progress-item-failed' : '');

    var row = document.createElement('div');
    row.className = itemClass;
    appendTextElement(row, 'div', 'kmoe-progress-name', item.filename || '');
    var bar = document.createElement('div');
    bar.className = 'kmoe-progress-bar';
    var fill = document.createElement('div');
    fill.className = 'kmoe-progress-fill';
    fill.style.width = percent + '%';
    bar.appendChild(fill);
    row.appendChild(bar);
    appendTextElement(row, 'div', 'kmoe-progress-info', info);
    return row;
  }

  function renderProgressItem(item) {
    return createProgressItem(item).outerHTML;
  }

  function downloadRefresh() {
    if (downloadCancelled) return;
    updateProgressPanel();
    var effectiveMaxDownload = getEffectiveMaxDownload();
    if (downloading < effectiveMaxDownload) {
      for (var i = 0; i < downloadQueue.length; i++) {
        var item = downloadQueue[i];
        if (item.status === 0 && downloading < effectiveMaxDownload) {
          item.status = 1;
          downloading++;
          startDownloadItem(item, i);
        }
      }
    }
  }

  function resolveDownloadUrl(item, callback) {
    getDownloadUrl(item.bookId, item.volId, item.format, function (rsp) {
      if (downloadCancelled || item.status === 4) {
        callback(null);
        return;
      }

      var result = resolveDownloadUrlResponse(item, rsp);
      if (!result.ok) {
        callback(result);
        return;
      }
      saveResolvedDownloadRecord(item);
      callback(item);
    });
  }

  function getDownloadUrlErrorMessage(rsp) {
    if (!rsp || typeof rsp !== 'object') return '下载链接解析失败';
    var fields = ['msg', 'message', 'error', 'errmsg', 'reason', 'info'];
    for (var i = 0; i < fields.length; i++) {
      var value = rsp[fields[i]];
      if (value) return String(value);
    }
    return '下载链接解析失败';
  }

  function resolveDownloadUrlResponse(item, rsp) {
    if (!rsp) {
      return {
        ok: false,
        retryable: true,
        error: '下载链接解析失败'
      };
    }

    if (!rsp.url) {
      return {
        ok: false,
        retryable: false,
        error: getDownloadUrlErrorMessage(rsp)
      };
    }

    item.url = rsp.url;
    if (rsp.name) {
      item.filename = sanitizeFilename(rsp.name);
      item.downloadPath = buildDownloadPath(item.downloadDir, item.filename);
    }
    return {
      ok: true,
      item: item
    };
  }

  function finishDownloadItem(item) {
    if (downloadCancelled || item.status === 4) return;
    if (item.gid) {
      delete activeAria2Downloads[item.gid];
      if (activeAria2PollTimers[item.gid]) {
        clearTimeout(activeAria2PollTimers[item.gid]);
        delete activeAria2PollTimers[item.gid];
      }
    }
    item.progress = 100;
    item.statusText = '完成';
    saveResolvedDownloadRecord(item);
    item.status = 2;
    downloading--;
    setTimeout(downloadRefresh, downloadDelay);
    updateProgressPanel();
  }

  function failDownloadItem(item, err, options) {
    if (downloadCancelled || item.status === 4) return;
    options = options || {};
    if (item.gid) {
      delete activeAria2Downloads[item.gid];
      if (activeAria2PollTimers[item.gid]) {
        clearTimeout(activeAria2PollTimers[item.gid]);
        delete activeAria2PollTimers[item.gid];
      }
      item.gid = null;
    }

    item.retryCount = item.retryCount || 0;
    var reason = formatFailureReason(err);
    if (options.retryable === false) {
      item.status = 3;
      item.statusText = reason;
    } else if (item.retryCount < maxRetry) {
      item.retryCount++;
      item.status = 0;
      item.statusText = '等待重试：' + reason;
    } else {
      item.status = 3;
      item.statusText = reason;
    }

    downloading--;
    var retryDelay = err === 429 ? 5000 * item.retryCount : downloadDelay;
    setTimeout(downloadRefresh, retryDelay);
    updateProgressPanel();
  }

  function startXhrDownload(item, url) {
    item.downloadMode = 'xhr';
    var lastProgressTime = Date.now();
    var lastLoaded = 0;

    kbHttpDown(url, item.filename, function (loaded, total) {
      var now = Date.now();
      var timeDiff = (now - lastProgressTime) / 1000;
      item.progress = total > 0 ? Math.round((loaded / total) * 100) : 0;
      item.speed = timeDiff > 0 ? (loaded - lastLoaded) / timeDiff : 0;
      item.statusText = '';
      lastProgressTime = now;
      lastLoaded = loaded;
      updateProgressPanel();
    }, function (blob, filename) {
      kbSaveAs(blob, filename);
      finishDownloadItem(item);
    }, function (err) {
      failDownloadItem(item, err);
    });
  }

  function getAria2Headers() {
    var headers = ['X-KM-FROM: kb_http_down'];
    return headers;
  }

  function pollAria2Download(item) {
    if (!item || !item.gid || downloadCancelled || item.status === 4) return;

    chrome.runtime.sendMessage({
      type: 'KMOE_ARIA2_TELL_STATUS',
      payload: { gid: item.gid }
    }, function (response) {
      var err = chrome.runtime.lastError;
      if (downloadCancelled || item.status === 4) return;

      if (err || !response || !response.ok) {
        failDownloadItem(item, err ? err.message : (response && response.error));
        return;
      }

      var status = response.status || {};
      var total = parseInt(status.totalLength || '0', 10);
      var completed = parseInt(status.completedLength || '0', 10);
      item.progress = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : item.progress || 0;
      item.speed = parseInt(status.downloadSpeed || '0', 10);

      if (status.status === 'complete') {
        finishDownloadItem(item);
        return;
      }
      if (status.status === 'error') {
        failDownloadItem(item, status.errorMessage || status.errorCode || 'aria2 下载失败');
        return;
      }
      if (status.status === 'removed') {
        failDownloadItem(item, 'aria2 任务已移除');
        return;
      }

      if (status.status === 'waiting') {
        item.statusText = 'aria2 等待中';
      } else if (status.status === 'paused') {
        item.statusText = 'aria2 已暂停';
      } else {
        item.statusText = '';
      }
      updateProgressPanel();

      activeAria2PollTimers[item.gid] = setTimeout(function () {
        pollAria2Download(item);
      }, 1000);
    });
  }

  function startAria2Download(item, url) {
    item.downloadMode = 'aria2';
    item.progress = 0;
    item.speed = 0;
    item.statusText = '提交到 aria2';
    updateProgressPanel();

    chrome.runtime.sendMessage({
      type: 'KMOE_ARIA2_ADD_URI',
      payload: {
        url: url,
        filename: item.filename,
        directory: item.downloadDir,
        maxConcurrentDownloads: getEffectiveMaxDownload(),
        cookie: document.cookie || '',
        headers: getAria2Headers(),
        referer: window.location.href,
        pageUrl: item.pageUrl
      }
    }, function (response) {
      var err = chrome.runtime.lastError;
      if (downloadCancelled || item.status === 4) return;

      if (err || !response || !response.ok) {
        failDownloadItem(item, err ? err.message : (response && response.error));
        return;
      }

      item.gid = response.gid;
      activeAria2Downloads[item.gid] = item.id;
      item.statusText = 'aria2 下载中';
      updateProgressPanel();
      pollAria2Download(item);
    });
  }

  function startDownloadItem(item, index) {
    resolveDownloadUrl(item, function (resolvedItem) {
      if (!resolvedItem || resolvedItem.ok === false) {
        var errorReason = resolvedItem && resolvedItem.error ? resolvedItem.error : '下载链接解析失败';
        failDownloadItem(item, errorReason, {
          retryable: resolvedItem ? resolvedItem.retryable !== false : true
        });
        return;
      }
      if (downloadMode === 'aria2') {
        startAria2Download(item, item.url);
      } else {
        startXhrDownload(item, item.url);
      }
    });
  }

  function startDownload(bookInfo) {
    var selected = getSelectedChapters();
    if (selected.length === 0) {
      alert('请至少选择一个章节');
      return;
    }

    downloadCancelled = false;
    downloadQueue = [];
    downloading = 0;
    activeXhrs.clear();
    Object.keys(activeAria2PollTimers).forEach(function (gid) {
      clearTimeout(activeAria2PollTimers[gid]);
    });
    activeAria2Downloads = {};
    activeAria2PollTimers = {};

    var card = document.getElementById('kmoe-download-card');
    if (!card) {
      alert('下载面板不存在，请重新打开下载面板');
      return;
    }
    var formatSelect = card.querySelector('#kmoe-format');
    if (!formatSelect) {
      alert('请选择文件格式');
      return;
    }
    var format = formatSelect.value;
    var formatExt = format === '1' ? 'mobi' : 'epub';

    var downloadOrigin = bookInfo.downloadOrigin || window.location.origin;
    var downPrefix = bookInfo.downPrefix || '';
    var downSuffix = bookInfo.downSuffix || '/0/';
    var chapters = Array.isArray(bookInfo.arr) ? bookInfo.arr : [];
    var downloadDir = buildMangaDirectoryName(bookInfo);

    selected.forEach(function (chapter) {
      var chapterData = chapters[chapter.index];
      if (!chapterData || !chapterData.id) return;
      var chapterName = chapterData.name || '第' + (chapter.index + 1) + '章';
      var filename = sanitizeFilename(chapterName) + '.' + formatExt;
      var downloadPath = buildDownloadPath(downloadDir, filename);

      downloadQueue.push({
        id: nextDownloadItemId++,
        bookId: bookInfo.bookId,
        bookTitle: bookInfo.title || '',
        bookCover: bookInfo.cover || '',
        bookDescription: bookInfo.description || '',
        pageUrl: window.location.href,
        volId: chapterData.id,
        volName: chapterName,
        format: format,
        filename: filename,
        downloadDir: downloadDir,
        downloadPath: downloadPath,
        downloadOrigin: downloadOrigin,
        downPrefix: downPrefix,
        downSuffix: downSuffix,
        status: 0,
        retryCount: 0
      });
    });

    if (downloadQueue.length === 0) {
      alert('未找到可下载章节，请刷新页面后重试');
      return;
    }

    createProgressPanel();
    progressPanel.style.display = 'block';
    downloadMode = Settings.normalizeDownloadMode(downloadMode);
    downloadRefresh();
    hideCard();
  }

  function showCard() {
    var card = document.getElementById('kmoe-download-card');
    if (card) {
      card.style.display = 'block';
    }
  }

  function hideCard() {
    var card = document.getElementById('kmoe-download-card');
    if (card) {
      card.style.display = 'none';
    }
  }

  function observeDOM() {
    createDownloadButton();

    var observer = new MutationObserver(function (mutations, obs) {
      createDownloadButton();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  injectPageBridge();
  loadDownloadRecords();
  loadSettings();
  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName === 'local' && changes.kmoe_settings) {
      var settings = changes.kmoe_settings.newValue || {};

      settings = Settings.normalizeSettings(settings);
      downloadMode = Settings.normalizeDownloadMode(settings.downloadMode);
      maxDownload = getSettingsMaxDownload(settings, downloadMode);
      downloadDelay = settings.downloadDelay || 1500;
      maxRetry = settings.maxRetry || 5;
      preferredDownloadFormat = normalizeDownloadFormat(settings.downloadFormat);

      console.log('Kmoe 设置已热更新:', settings);
    }
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeDOM);
  } else {
    observeDOM();
  }

  if (window.__KMOE_DOWNLOAD_TEST__) {
    window.__kmoeTestHooks = {
      mergeBookInfo: mergeBookInfo,
      collectBookInfoFromDocument: collectBookInfoFromDocument,
      getCachedBookInfo: function () { return cachedBookInfo; },
      setQueue: function (items) { downloadQueue = items; },
      getQueue: function () { return downloadQueue; },
      setOptions: function (options) {
        maxDownload = options.maxDownload;
        downloadDelay = options.downloadDelay || 0;
        maxRetry = options.maxRetry || 0;
        downloadMode = Settings.normalizeDownloadMode(options.downloadMode);
        downloadCancelled = false;
        downloading = 0;
      },
      downloadRefresh: downloadRefresh,
      validateDownloadQuota: validateDownloadQuota,
      getQuotaDisplayText: getQuotaDisplayText,
      formatQuotaSize: formatQuotaSize,
      formatFailureReason: formatFailureReason,
      getProgressItemText: getProgressItemText,
     renderProgressItem: renderProgressItem,
      resolveDownloadUrlResponse: resolveDownloadUrlResponse,
      getFloatingSuppressClick: function () { return floatingSuppressClick; }
    };
  }
})();

