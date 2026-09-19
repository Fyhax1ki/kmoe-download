var currentFormat = '1';
var historyData = {};

const RECORD_EXPIRE_HOURS = 48;
const KMOE_URL = 'https://kox.moe';
const DEFAULT_COVER = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 50 70%22%3E%3Crect fill=%22%23eee%22 width=%2250%22 height=%2270%22/%3E%3Ctext x=%2225%22 y=%2240%22 text-anchor=%22middle%22 fill=%22%23ccc%22 font-size=%2210%22%3E%E6%97%A0%E5%B0%81%E9%9D%A2%3C/text%3E%3C/svg%3E';

document.addEventListener('DOMContentLoaded', function() {
  loadHistory();

  document.getElementById('clearHistory').addEventListener('click', clearHistory);
  document.getElementById('exportHistory').addEventListener('click', exportHistory);
  document.getElementById('importHistory').addEventListener('click', function() {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', importHistory);

  document.querySelectorAll('.tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
      this.classList.add('active');
      currentFormat = this.dataset.format;
      renderBookList();
    });
  });
});

function loadHistory() {
  chrome.storage.local.get(['kmoe_download_records_v2'], function(result) {
    historyData = result.kmoe_download_records_v2 || {};
    updateCounts();
    renderBookList();
  });
}

function updateCounts() {
  var mobiCount = 0;
  var epubCount = 0;

  Object.keys(historyData).forEach(function(bookId) {
    var book = historyData[bookId];
    if (book.volumes) {
      Object.keys(book.volumes).forEach(function(volId) {
        var vol = book.volumes[volId];
        if (vol.formats['1']) mobiCount++;
        if (vol.formats['2']) epubCount++;
      });
    }
  });

  document.getElementById('mobiCount').textContent = '(' + mobiCount + ')';
  document.getElementById('epubCount').textContent = '(' + epubCount + ')';
}

function renderBookList() {
  var listEl = document.getElementById('bookList');
  var books = [];

  Object.keys(historyData).forEach(function(bookId) {
    var book = historyData[bookId];
    var volumes = [];

    if (book.volumes) {
      Object.keys(book.volumes).forEach(function(volId) {
        var vol = book.volumes[volId];
        if (vol.formats[currentFormat]) {
          volumes.push({
            id: volId,
            name: vol.name || '未知卷',
            time: vol.formats[currentFormat]
          });
        }
      });
    }

    if (volumes.length > 0) {
      volumes.sort(function(a, b) { return b.time - a.time; });
      books.push({
        id: bookId,
        title: book.title || '未知漫画',
        cover: book.cover || '',
        description: book.description || '',
        url: book.url || '',
        volumes: volumes
      });
    }
  });

  if (books.length === 0) {
    clearChildren(listEl);
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    appendTextElement(empty, 'p', '', '暂无下载记录');
    appendTextElement(empty, 'p', 'hint', '下载漫画后会自动记录，48小时内重新下载不消耗额度');
    listEl.appendChild(empty);
    return;
  }

  clearChildren(listEl);
  books.forEach(function(book) {
    var bookUrl = normalizeHistoryUrl(book.url, book.id);
    var item = document.createElement('div');
    item.className = 'book-item';

    var header = document.createElement('div');
    header.className = 'book-header';
    header.dataset.url = bookUrl;

    var cover = document.createElement('img');
    cover.className = 'book-cover';
    cover.alt = '';
    cover.src = normalizeImageUrl(book.cover);
    header.appendChild(cover);

    var info = document.createElement('div');
    info.className = 'book-info';
    appendTextElement(info, 'div', 'book-title', book.title);
    appendTextElement(info, 'div', 'book-meta', book.volumes.length + ' 卷');
    header.appendChild(info);
    appendTextElement(header, 'div', 'book-toggle', '▶');
    item.appendChild(header);

    var volumeList = document.createElement('div');
    volumeList.className = 'volume-list';

    book.volumes.forEach(function(vol) {
      var isFree = isWithin48Hours(vol.time);
      var timeStr = formatTime(vol.time);
      var volumeItem = document.createElement('div');
      volumeItem.className = 'volume-item';
      volumeItem.dataset.url = bookUrl;
      appendTextElement(volumeItem, 'span', 'volume-name', vol.name);

      var volumeMeta = document.createElement('div');
      appendTextElement(volumeMeta, 'span', 'volume-time', timeStr);
      appendTextElement(volumeMeta, 'span', 'volume-status ' + (isFree ? 'free' : 'expired'), isFree ? '免费' : '已过期');
      volumeItem.appendChild(volumeMeta);
      volumeList.appendChild(volumeItem);
    });

    item.appendChild(volumeList);
    listEl.appendChild(item);
  });

  document.querySelectorAll('.book-header').forEach(function(header) {
    header.addEventListener('click', function(e) {
      var toggle = this.querySelector('.book-toggle');
      var volumeList = this.nextElementSibling;
      toggle.classList.toggle('expanded');
      volumeList.classList.toggle('show');
    });
  });

  document.querySelectorAll('.volume-item').forEach(function(item) {
    item.addEventListener('click', function() {
      var url = this.dataset.url;
      if (url) {
        chrome.tabs.create({ url: url });
      }
    });
  });
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

function normalizeHistoryUrl(url, bookId) {
  var fallback = KMOE_URL + '/c/' + encodeURIComponent(String(bookId || '')) + '.htm';
  var value = String(url || '').trim();
  if (!value) return fallback;

  try {
    var parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch (e) {}

  return fallback;
}

function normalizeImageUrl(url) {
  var value = String(url || '').trim();
  if (!value) return DEFAULT_COVER;

  try {
    var parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch (e) {
    if (/^data:image\/(?:png|gif|jpe?g|webp);/i.test(value)) return value;
  }

  return DEFAULT_COVER;
}

function isWithin48Hours(timestamp) {
  var now = Date.now();
  var expireTime = RECORD_EXPIRE_HOURS * 60 * 60 * 1000;
  return (now - timestamp) <= expireTime;
}

function formatTime(timestamp) {
  var date = new Date(timestamp);
  var month = String(date.getMonth() + 1).padStart(2, '0');
  var day = String(date.getDate()).padStart(2, '0');
  var hour = String(date.getHours()).padStart(2, '0');
  var minute = String(date.getMinutes()).padStart(2, '0');
  return month + '-' + day + ' ' + hour + ':' + minute;
}

function clearHistory() {
  if (!confirm('确定要清空所有下载记录吗？')) return;

  chrome.storage.local.set({ kmoe_download_records_v2: {} }, function() {
    historyData = {};
    updateCounts();
    renderBookList();
  });
}

function exportHistory() {
  chrome.storage.local.get(['kmoe_download_records_v2'], function(result) {
    var data = result.kmoe_download_records_v2 || {};
    var json = JSON.stringify(data, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'kmoe-download-history-' + formatDate(new Date()) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  });
}

function importHistory(e) {
  var file = e.target.files[0];
  if (!file) return;

  var reader = new FileReader();
  reader.onload = function(event) {
    try {
      var data = JSON.parse(event.target.result);
      if (typeof data !== 'object') {
        alert('无效的文件格式');
        return;
      }

      chrome.storage.local.get(['kmoe_download_records_v2'], function(result) {
        var existing = result.kmoe_download_records_v2 || {};
        var merged = mergeHistory(existing, data);

        chrome.storage.local.set({ kmoe_download_records_v2: merged }, function() {
          historyData = merged;
          updateCounts();
          renderBookList();
          alert('导入成功');
        });
      });
    } catch (err) {
      alert('文件解析失败: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function mergeHistory(existing, imported) {
  var merged = JSON.parse(JSON.stringify(existing));

  Object.keys(imported).forEach(function(bookId) {
    var book = imported[bookId];
    if (!merged[bookId]) {
      merged[bookId] = book;
    } else {
      ['title', 'cover', 'description', 'url'].forEach(function(field) {
        if (!merged[bookId][field] && book[field]) {
          merged[bookId][field] = book[field];
        }
      });
      if (book.volumes) {
        if (!merged[bookId].volumes) {
          merged[bookId].volumes = {};
        }
        Object.keys(book.volumes).forEach(function(volId) {
          var vol = book.volumes[volId];
          if (!merged[bookId].volumes[volId]) {
            merged[bookId].volumes[volId] = vol;
          } else if (vol.formats) {
            if (!merged[bookId].volumes[volId].formats) {
              merged[bookId].volumes[volId].formats = {};
            }
            Object.keys(vol.formats).forEach(function(format) {
              if (!merged[bookId].volumes[volId].formats[format] ||
                  vol.formats[format] > merged[bookId].volumes[volId].formats[format]) {
                merged[bookId].volumes[volId].formats[format] = vol.formats[format];
              }
            });
          }
        });
      }
    }
  });

  return merged;
}

function formatDate(date) {
  var year = date.getFullYear();
  var month = String(date.getMonth() + 1).padStart(2, '0');
  var day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}
