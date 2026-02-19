document.addEventListener('DOMContentLoaded', function() {
  loadSettings();
  loadHistoryCount();

  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('openHistory').addEventListener('click', openHistory);
});

function loadSettings() {
  chrome.storage.local.get(['kmoe_settings'], function(result) {
    var settings = result.kmoe_settings || {
      maxDownload: 1,
      downloadDelay: 1500,
      maxRetry: 5
    };

    document.getElementById('maxDownload').value = settings.maxDownload || 1;
    document.getElementById('downloadDelay').value = settings.downloadDelay || 1500;
    document.getElementById('maxRetry').value = settings.maxRetry || 5;
  });
}

function saveSettings() {
  var maxDownload = parseInt(document.getElementById('maxDownload').value);
  var downloadDelay = parseInt(document.getElementById('downloadDelay').value);
  var maxRetry = parseInt(document.getElementById('maxRetry').value);

  if (maxDownload < 1) maxDownload = 1;
  if (maxDownload > 3) maxDownload = 3;
  if (downloadDelay < 1500) downloadDelay = 1500;
  if (maxRetry < 1) maxRetry = 1;

  var settings = {
    maxDownload: maxDownload,
    downloadDelay: downloadDelay,
    maxRetry: maxRetry
  };

  chrome.storage.local.set({ kmoe_settings: settings }, function() {
    var status = document.getElementById('saveStatus');
    status.textContent = '已保存';
    setTimeout(function() {
      status.textContent = '';
    }, 1500);
  });
}

function loadHistoryCount() {
  chrome.storage.local.get(['kmoe_download_records_v2'], function(result) {
    var records = result.kmoe_download_records_v2 || {};
    var count = 0;
    Object.keys(records).forEach(function(bookId) {
      var book = records[bookId];
      if (book.volumes) {
        Object.keys(book.volumes).forEach(function(volId) {
          var vol = book.volumes[volId];
          if (vol.formats) {
            count += Object.keys(vol.formats).length;
          }
        });
      }
    });
    document.getElementById('historyCount').textContent = count;
  });
}

function openHistory() {
  chrome.tabs.create({ url: chrome.runtime.getURL('history/history.html') });
}
