var currentFormat = '1';
var historyData = {};

const RECORD_EXPIRE_HOURS = 48;
const KMOE_URL = 'https://kox.moe';

document.addEventListener('DOMContentLoaded', function() {
  loadHistory();

  document.getElementById('clearHistory').addEventListener('click', clearHistory);

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
        url: book.url || '',
        volumes: volumes
      });
    }
  });

  if (books.length === 0) {
    listEl.innerHTML = '<div class="empty-state">' +
      '<p>暂无下载记录</p>' +
      '<p class="hint">下载漫画后会自动记录，48小时内重新下载不消耗额度</p>' +
    '</div>';
    return;
  }

  var html = '';
  books.forEach(function(book) {
   var bookUrl = book.url || (KMOE_URL + '/c/' + book.id + '.htm');
    html += '<div class="book-item">' +
      '<div class="book-header" data-url="' + bookUrl + '">' +
        '<img class="book-cover" src="' + (book.cover || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 70"><rect fill="%23eee" width="50" height="70"/><text x="25" y="40" text-anchor="middle" fill="%23ccc" font-size="10">无封面</text></svg>') + '" alt="">' +
        '<div class="book-info">' +
          '<div class="book-title">' + book.title + '</div>' +
          '<div class="book-meta">' + book.volumes.length + ' 卷</div>' +
        '</div>' +
        '<div class="book-toggle">▶</div>' +
      '</div>' +
      '<div class="volume-list">';

    book.volumes.forEach(function(vol) {
      var isFree = isWithin48Hours(vol.time);
      var timeStr = formatTime(vol.time);
      var statusHtml = isFree 
        ? '<span class="volume-status free">免费</span>' 
        : '<span class="volume-status expired">已过期</span>';

      html += '<div class="volume-item" data-url="' + bookUrl + '">' +
        '<span class="volume-name">' + vol.name + '</span>' +
        '<div>' +
          '<span class="volume-time">' + timeStr + '</span>' +
          statusHtml +
        '</div>' +
      '</div>';
    });

    html += '</div></div>';
  });

  listEl.innerHTML = html;

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
