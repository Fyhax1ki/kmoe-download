(function() {
  'use strict';

  const SOURCE = 'kmoe-download-page-bridge';
  let cardVisible = false;
  let cachedBookInfo = null;

  function injectPageBridge() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('scripts/page-bridge.js');
    script.onload = function() {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    if (event.data && event.data.source === SOURCE && event.data.type === 'MANGA_DATA') {
      cachedBookInfo = event.data.payload;
    }
  });

  function createDownloadButton() {
    var mobiBtn = document.getElementById('bt_down_all_1_mobi');
    var epubBtn = document.getElementById('bt_down_all_1_epub');

    if (mobiBtn && !mobiBtn.parentNode.querySelector('.kmoe-download-btn')) {
      var mobiDownloadBtn = document.createElement('button');
      mobiDownloadBtn.type = 'button';
      mobiDownloadBtn.textContent = 'Kmoe-Download';
      mobiDownloadBtn.className = 'bt_sml_defa kmoe-download-btn';
      mobiDownloadBtn.style.cssText = 'width:120px;margin-right:4px;';
      mobiDownloadBtn.addEventListener('click', function(e) {
        e.preventDefault();
        toggleCard();
      });
      mobiBtn.parentNode.insertBefore(mobiDownloadBtn, mobiBtn);
    }

    if (epubBtn && !epubBtn.parentNode.querySelector('.kmoe-download-btn')) {
      var epubDownloadBtn = document.createElement('button');
      epubDownloadBtn.type = 'button';
      epubDownloadBtn.textContent = 'Kmoe-Download';
      epubDownloadBtn.className = 'bt_sml_defa kmoe-download-btn';
      epubDownloadBtn.style.cssText = 'width:120px;margin-right:4px;';
      epubDownloadBtn.addEventListener('click', function(e) {
        e.preventDefault();
        toggleCard();
      });
      epubBtn.parentNode.insertBefore(epubDownloadBtn, epubBtn);
    }

    return (mobiBtn || epubBtn);
  }

  function groupByCategory(arr) {
    const groups = {};
    arr.forEach(function(item, index) {
      const category = item.category || '其他';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push({ item: item, index: index });
    });
    return groups;
  }

  function renderChapterList(arr, format) {
    if (!arr || arr.length === 0) {
      return '<div class="kmoe-empty">暂无章节</div>';
    }

    const groups = groupByCategory(arr);
    let html = '';

    Object.keys(groups).forEach(function(category) {
      const items = groups[category];
      html += '<div class="kmoe-category-group">';
      html += '<div class="kmoe-category-header">';
      html += '<label class="kmoe-category-select-all">';
      html += '<input type="checkbox" class="kmoe-category-checkbox" data-category="' + category + '" checked>';
      html += '<span>' + category + '</span>';
      html += '</label>';
      html += '<span class="kmoe-category-count">' + items.length + ' 章</span>';
      html += '</div>';
      html += '<div class="kmoe-category-items">';

      items.forEach(function(entry) {
        const item = entry.item;
        const index = entry.index;
        const name = item.name || '第' + (index + 1) + '章';
        const size = format === '1' ? item.mobiSize : item.epubSize;
        const sizeText = size ? ' <span class="kmoe-chapter-size">(' + size + 'MB)</span>' : '';
        html += '<label class="kmoe-chapter-item">';
        html += '<input type="checkbox" class="kmoe-chapter-checkbox" data-index="' + index + '" data-category="' + category + '" checked>';
        html += '<span class="kmoe-chapter-name">' + name + sizeText + '</span>';
        html += '</label>';
      });

      html += '</div>';
      html += '</div>';
    });

    return html;
  }

  function createCard() {
    if (!cachedBookInfo) {
      alert('数据加载中，请稍后再试');
      return null;
    }

    const bookInfo = cachedBookInfo;
    const quotaText = bookInfo.quotaAvailable !== null ? '可用额度: ' + bookInfo.quotaAvailable + 'MB' : '';
    const card = document.createElement('div');
    card.id = 'kmoe-download-card';
    card.innerHTML = 
      '<div class="kmoe-card-header">' +
        '<span>Kmoe Download</span>' +
        '<button class="kmoe-card-close">&times;</button>' +
      '</div>' +
      '<div class="kmoe-card-body">' +
        '<div class="kmoe-book-info">' +
          '<img class="kmoe-book-cover" src="' + bookInfo.cover + '" alt="cover">' +
          '<div class="kmoe-book-meta">' +
            '<div class="kmoe-book-title">' + bookInfo.title + '</div>' +
            '<div class="kmoe-book-author">' + (bookInfo.author.join(', ') || '未知作者') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="kmoe-format-select">' +
          '<label>文件格式：</label>' +
          '<select id="kmoe-format">' +
            '<option value="1">MOBI</option>' +
            '<option value="2">EPUB</option>' +
          '</select>' +
          (quotaText ? '<span class="kmoe-quota-info">' + quotaText + '</span>' : '') +
        '</div>' +
        '<div class="kmoe-chapter-header">' +
          '<label class="kmoe-select-all">' +
            '<input type="checkbox" id="kmoe-select-all" checked>' +
            '<span>全选</span>' +
          '</label>' +
          '<span class="kmoe-chapter-count">已选 <span id="kmoe-selected-count">' + bookInfo.arr.length + '</span> / ' + bookInfo.arr.length + ' 章</span>' +
        '</div>' +
        '<div class="kmoe-chapter-list" id="kmoe-chapter-list">' +
          renderChapterList(bookInfo.arr, '1') +
        '</div>' +
        '<div class="kmoe-download-info">' +
          '<span>选中大小: <span id="kmoe-selected-size">0</span>MB</span>' +
        '</div>' +
        '<div class="kmoe-download-actions">' +
          '<button class="kmoe-download-btn" id="kmoe-start-download">开始下载</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(card);

    card.querySelector('.kmoe-card-close').addEventListener('click', hideCard);

    var selectAllCheckbox = card.querySelector('#kmoe-select-all');
    selectAllCheckbox.addEventListener('change', function() {
      var checkboxes = card.querySelectorAll('.kmoe-chapter-checkbox');
      var categoryCheckboxes = card.querySelectorAll('.kmoe-category-checkbox');
      checkboxes.forEach(function(cb) { cb.checked = selectAllCheckbox.checked; });
      categoryCheckboxes.forEach(function(cb) { cb.checked = selectAllCheckbox.checked; });
      updateSelectionInfo(bookInfo);
    });

    card.querySelector('.kmoe-chapter-list').addEventListener('change', function(e) {
      if (e.target.classList.contains('kmoe-category-checkbox')) {
        var category = e.target.dataset.category;
        var checkboxes = card.querySelectorAll('.kmoe-chapter-checkbox[data-category="' + category + '"]');
        checkboxes.forEach(function(cb) { cb.checked = e.target.checked; });
        updateSelectionInfo(bookInfo);
        updateGlobalSelectAll();
      } else if (e.target.classList.contains('kmoe-chapter-checkbox')) {
        updateSelectionInfo(bookInfo);
        updateGlobalSelectAll();
        updateCategorySelectAll(e.target.dataset.category);
      }
    });

    card.querySelector('#kmoe-format').addEventListener('change', function() {
      var format = this.value;
      var listEl = card.querySelector('#kmoe-chapter-list');
      listEl.innerHTML = renderChapterList(bookInfo.arr, format);
      updateSelectionInfo(bookInfo);
    });

    card.querySelector('#kmoe-start-download').addEventListener('click', function() {
      startDownload(bookInfo);
    });

    updateSelectionInfo(bookInfo);

    return card;
  }

  function updateGlobalSelectAll() {
    var card = document.getElementById('kmoe-download-card');
    if (!card) return;
    var checkboxes = card.querySelectorAll('.kmoe-chapter-checkbox');
    var allChecked = Array.from(checkboxes).every(function(cb) { return cb.checked; });
    var selectAllCheckbox = card.querySelector('#kmoe-select-all');
    if (selectAllCheckbox) {
      selectAllCheckbox.checked = allChecked;
    }
  }

  function updateCategorySelectAll(category) {
    var card = document.getElementById('kmoe-download-card');
    if (!card) return;
    var checkboxes = card.querySelectorAll('.kmoe-chapter-checkbox[data-category="' + category + '"]');
    var allChecked = Array.from(checkboxes).every(function(cb) { return cb.checked; });
    var categoryCheckbox = card.querySelector('.kmoe-category-checkbox[data-category="' + category + '"]');
    if (categoryCheckbox) {
      categoryCheckbox.checked = allChecked;
    }
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

    var totalSize = 0;
    checkboxes.forEach(function(cb) {
      var index = parseInt(cb.dataset.index);
      var item = bookInfo.arr[index];
      if (item) {
        var size = format === '1' ? item.mobiSize : item.epubSize;
        if (size) totalSize += size;
      }
    });

    var sizeEl = card.querySelector('#kmoe-selected-size');
    if (sizeEl) {
      sizeEl.textContent = totalSize.toFixed(1);
    }

    var downloadBtn = card.querySelector('#kmoe-start-download');
    if (downloadBtn) {
      var quotaAvailable = bookInfo.quotaAvailable;
      if (quotaAvailable !== null && totalSize > quotaAvailable) {
        downloadBtn.disabled = true;
        downloadBtn.classList.add('kmoe-download-btn-disabled');
        downloadBtn.textContent = '额度不足';
        downloadBtn.title = '选中大小超过可用额度';
      } else {
        downloadBtn.disabled = false;
        downloadBtn.classList.remove('kmoe-download-btn-disabled');
        downloadBtn.textContent = '开始下载';
        downloadBtn.title = '';
      }
    }
  }

  function getSelectedChapters() {
    var card = document.getElementById('kmoe-download-card');
    if (!card) return [];
    var checkboxes = card.querySelectorAll('.kmoe-chapter-checkbox:checked');
    return Array.from(checkboxes).map(function(cb) {
      return {
        index: parseInt(cb.dataset.index)
      };
    });
  }

  function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_').trim();
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
    setTimeout(function() {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function kbHttpDown(url, filename, onProgress, onComplete, onError) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    xhr.setRequestHeader('X-KM-FROM', 'kb_http_down');
    
    currentXhr = xhr;
    
    xhr.onprogress = function(e) {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded, e.total);
      }
    };
    
    xhr.onload = function() {
      currentXhr = null;
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
    
    xhr.onerror = function() {
      currentXhr = null;
      if (downloadCancelled) return;
      if (onError) onError('network');
    };
    
    xhr.onabort = function() {
      currentXhr = null;
    };
    
    xhr.send();
    return xhr;
  }

  function getDownloadUrl(bookId, volId, format, callback) {
    var s_url = '/getdownurl.php?b=' + bookId + '&v=' + volId + '&mobi=' + format + '&vip=0&json=1';
    var xhr = new XMLHttpRequest();
    xhr.open('GET', s_url);
    xhr.onload = function() {
      try {
        var rsp = JSON.parse(xhr.responseText);
        callback(rsp);
      } catch (e) {
        callback(null);
      }
    };
    xhr.onerror = function() {
      callback(null);
    };
    xhr.send();
  }

  var downloadQueue = [];
  var maxDownload = 1;
  var downloading = 0;
  var progressPanel = null;
  var downloadDelay = 1500;
  var downloadCancelled = false;
  var currentXhr = null;

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

    progressPanel.querySelector('.kmoe-progress-close').addEventListener('click', function() {
      progressPanel.style.display = 'none';
    });

    progressPanel.querySelector('#kmoe-cancel-download').addEventListener('click', function() {
      cancelDownload();
    });

    return progressPanel;
  }

  function cancelDownload() {
    downloadCancelled = true;
    
    if (currentXhr) {
      currentXhr.abort();
      currentXhr = null;
    }

    downloadQueue.forEach(function(item) {
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

    downloadQueue.forEach(function(item) {
      if (item.status === 0) numQueued++;
      else if (item.status === 1) numDownloading++;
      else if (item.status === 2) numSuccess++;
      else if (item.status === 3) numFail++;
    });

    var statsEl = document.getElementById('kmoe-progress-stats');
    if (statsEl) {
      statsEl.textContent = '等待: ' + numQueued + ' | 下载中: ' + numDownloading + ' | 完成: ' + numSuccess + ' | 失败: ' + numFail;
    }

    var bodyEl = document.getElementById('kmoe-progress-body');
    if (bodyEl) {
      var html = '';
      downloadQueue.forEach(function(item, index) {
        if (item.status === 1) {
          var percent = item.progress || 0;
          var speed = item.speed ? formatSpeed(item.speed) : '';
          html += '<div class="kmoe-progress-item">' +
            '<div class="kmoe-progress-name">' + item.filename + '</div>' +
            '<div class="kmoe-progress-bar">' +
              '<div class="kmoe-progress-fill" style="width:' + percent + '%"></div>' +
            '</div>' +
            '<div class="kmoe-progress-info">' + percent + '% ' + speed + '</div>' +
          '</div>';
        }
      });
      bodyEl.innerHTML = html;
    }
  }

  function formatSpeed(bytesPerSec) {
    if (bytesPerSec > 1048576) {
      return (bytesPerSec / 1048576).toFixed(1) + ' MB/s';
    } else {
      return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
    }
  }

  function downloadRefresh() {
    if (downloadCancelled) return;
    updateProgressPanel();
    if (downloading < maxDownload) {
      for (var i = 0; i < downloadQueue.length; i++) {
        var item = downloadQueue[i];
        if (item.status === 0 && downloading < maxDownload) {
          item.status = 1;
          downloading++;
          startDownloadItem(item, i);
        }
      }
    }
  }

  function startDownloadItem(item, index) {
    getDownloadUrl(item.bookId, item.volId, item.format, function(rsp) {
      var url;
      if (rsp && rsp.url) {
        url = rsp.url;
        item.filename = rsp.name || item.filename;
      } else {
        if (item.downPrefix && item.downSuffix) {
          url = item.downloadOrigin + item.downPrefix + item.volId + '/' + item.format + item.downSuffix;
        } else {
          url = item.downloadOrigin + '/dl/' + item.bookId + '/' + item.volId + '/' + item.format + '/0/';
        }
      }

      var startTime = Date.now();
      var lastLoaded = 0;

      kbHttpDown(url, item.filename, function(loaded, total) {
        var now = Date.now();
        var timeDiff = (now - startTime) / 1000;
        item.progress = total > 0 ? Math.round((loaded / total) * 100) : 0;
        item.speed = timeDiff > 0 ? (loaded - lastLoaded) / timeDiff : 0;
        lastLoaded = loaded;
        updateProgressPanel();
      }, function(blob, filename) {
        kbSaveAs(blob, filename);
        item.status = 2;
        downloading--;
        setTimeout(downloadRefresh, downloadDelay);
      }, function(err) {
        if (err === 429) {
          item.retryCount = item.retryCount || 0;
          if (item.retryCount < 5) {
            item.retryCount++;
            item.status = 0;
            setTimeout(function() {
              downloadRefresh();
            }, 5000 * item.retryCount);
          } else {
            item.status = 3;
          }
        } else {
          item.retryCount = item.retryCount || 0;
          if (item.retryCount < 3) {
            item.retryCount++;
            item.status = 0;
          } else {
            item.status = 3;
          }
        }
        downloading--;
        setTimeout(downloadRefresh, downloadDelay);
      });
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

    var card = document.getElementById('kmoe-download-card');
    var formatSelect = card.querySelector('#kmoe-format');
    var format = formatSelect.value;
    var formatExt = format === '1' ? 'mobi' : 'epub';

    var downloadOrigin = bookInfo.downloadOrigin || window.location.origin;
    var downPrefix = bookInfo.downPrefix || '';
    var downSuffix = bookInfo.downSuffix || '/0/';

    selected.forEach(function(chapter) {
      var chapterData = bookInfo.arr[chapter.index];
      var chapterName = chapterData.name || '第' + (chapter.index + 1) + '章';
      var filename = sanitizeFilename(chapterName) + '.' + formatExt;

      downloadQueue.push({
        bookId: bookInfo.bookId,
        volId: chapterData.id,
        format: format,
        filename: filename,
        downloadOrigin: downloadOrigin,
        downPrefix: downPrefix,
        downSuffix: downSuffix,
        status: 0,
        retryCount: 0
      });
    });

    createProgressPanel();
    progressPanel.style.display = 'block';
    downloadRefresh();
    hideCard();
  }

  function toggleCard() {
    var card = document.getElementById('kmoe-download-card');
    if (!card) {
      card = createCard();
      if (!card) return;
    }

    if (cardVisible) {
      hideCard();
    } else {
      showCard();
    }
  }

  function showCard() {
    var card = document.getElementById('kmoe-download-card');
    if (card) {
      card.style.display = 'block';
      cardVisible = true;
    }
  }

  function hideCard() {
    var card = document.getElementById('kmoe-download-card');
    if (card) {
      card.style.display = 'none';
      cardVisible = false;
    }
  }

  function observeDOM() {
    createDownloadButton();

    var observer = new MutationObserver(function(mutations, obs) {
      createDownloadButton();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  injectPageBridge();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeDOM);
  } else {
    observeDOM();
  }
})();
