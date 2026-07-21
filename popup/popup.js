document.addEventListener('DOMContentLoaded', function() {
  loadSettings();
  loadHistoryCount();

  bindAutoSave();
  document.getElementById('openAria2').addEventListener('click', openAria2Config);
  document.getElementById('openHistory').addEventListener('click', openHistory);
});

var autoSaveTimer = null;
var XHR_MAX_DOWNLOAD = 3;
var maxDownloadByMode = {
  aria2: 1,
  xhr: 1
};
var currentDownloadMode = 'aria2';

function normalizeDownloadMode(mode) {
  if (mode === 'browser') return 'aria2';
  if (mode === 'xhr') return 'xhr';
  return 'aria2';
}

function normalizeMaxDownload(value, mode) {
  var maxDownload = parseInt(value, 10);
  if (!maxDownload || maxDownload < 1) maxDownload = 1;
  if (mode === 'xhr' && maxDownload > XHR_MAX_DOWNLOAD) maxDownload = XHR_MAX_DOWNLOAD;
  return maxDownload;
}

function normalizeMaxDownloadByMode(settings) {
  settings = settings || {};
  var stored = settings.maxDownloadByMode || {};
  var fallback = settings.maxDownload || 1;

  return {
    aria2: normalizeMaxDownload(stored.aria2 || fallback, 'aria2'),
    xhr: normalizeMaxDownload(stored.xhr || fallback, 'xhr')
  };
}

function syncCurrentMaxDownload() {
  var input = document.getElementById('maxDownload');
  maxDownloadByMode[currentDownloadMode] = normalizeMaxDownload(input.value, currentDownloadMode);
  input.value = maxDownloadByMode[currentDownloadMode];
}

function updateMaxDownloadControl() {
  var input = document.getElementById('maxDownload');
  var mode = normalizeDownloadMode(document.getElementById('downloadMode').value);

  if (mode === 'xhr') {
    input.max = String(XHR_MAX_DOWNLOAD);
    input.title = '直接下载模式最多并发 ' + XHR_MAX_DOWNLOAD + ' 个';
    input.value = normalizeMaxDownload(input.value, mode);
  } else {
    input.removeAttribute('max');
    input.title = 'aria2 模式会同步设置 aria2 的同时下载任务数';
  }
}

function loadSettings() {
  chrome.storage.local.get(['kmoe_settings'], function(result) {
    var settings = result.kmoe_settings || {
      maxDownload: 1,
      downloadDelay: 1500,
      maxRetry: 5,
      downloadMode: 'aria2'
    };

    var downloadMode = normalizeDownloadMode(settings.downloadMode);
    maxDownloadByMode = normalizeMaxDownloadByMode(settings);
    currentDownloadMode = downloadMode;
    document.getElementById('downloadMode').value = downloadMode;
    document.getElementById('maxDownload').value = maxDownloadByMode[downloadMode];
    document.getElementById('downloadDelay').value = settings.downloadDelay || 1500;
    document.getElementById('maxRetry').value = settings.maxRetry || 5;
    updateMaxDownloadControl();
  });
}

function bindAutoSave() {
  ['maxDownload', 'downloadDelay', 'maxRetry'].forEach(function(id) {
    document.getElementById(id).addEventListener('input', scheduleSaveSettings);
  });
  document.getElementById('downloadMode').addEventListener('change', function () {
    syncCurrentMaxDownload();
    currentDownloadMode = normalizeDownloadMode(document.getElementById('downloadMode').value);
    document.getElementById('maxDownload').value = maxDownloadByMode[currentDownloadMode];
    updateMaxDownloadControl();
    scheduleSaveSettings();
  });
}

function scheduleSaveSettings() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(saveSettings, 300);
}

function saveSettings() {
  var maxDownload = parseInt(document.getElementById('maxDownload').value);
  var downloadDelay = parseInt(document.getElementById('downloadDelay').value);
  var maxRetry = parseInt(document.getElementById('maxRetry').value);
  var downloadMode = normalizeDownloadMode(document.getElementById('downloadMode').value);

  currentDownloadMode = downloadMode;
  maxDownload = normalizeMaxDownload(maxDownload, downloadMode);
  maxDownloadByMode[downloadMode] = maxDownload;
  if (downloadDelay < 1500) downloadDelay = 1500;
  if (maxRetry < 1) maxRetry = 1;

  chrome.storage.local.get(['kmoe_settings'], function(result) {
    var settings = result.kmoe_settings || {};
    settings.maxDownload = maxDownload;
    settings.maxDownloadByMode = {
      aria2: normalizeMaxDownload(maxDownloadByMode.aria2, 'aria2'),
      xhr: normalizeMaxDownload(maxDownloadByMode.xhr, 'xhr')
    };
    settings.downloadDelay = downloadDelay;
    settings.maxRetry = maxRetry;
    settings.downloadMode = downloadMode;

    chrome.storage.local.set({ kmoe_settings: settings }, function() {
      applyAria2Options(settings);
      var status = document.getElementById('saveStatus');
      status.textContent = '已生效';
      setTimeout(function() {
        status.textContent = '';
      }, 1500);
    });
  });
}

function applyAria2Options(settings) {
  if (normalizeDownloadMode(settings.downloadMode) !== 'aria2') return;
  if (!chrome.runtime || !chrome.runtime.sendMessage) return;

  chrome.runtime.sendMessage({
    type: 'KMOE_ARIA2_APPLY_OPTIONS',
    payload: {
      maxConcurrentDownloads: settings.maxDownloadByMode.aria2 || settings.maxDownload
    }
  });
}

function loadHistoryCount() {
  chrome.storage.local.get(['kmoe_download_records_v2'], function(result) {
    var records = result.kmoe_download_records_v2 || {};
    var count = 0;
    Object.keys(records).forEach(function(bookId) {
      var book = records[bookId];
      if (!book || !book.volumes || Object.keys(book.volumes).length === 0) return;
      count ++;
    });
    document.getElementById('historyCount').textContent = count;
  });
}

function openHistory() {
  chrome.tabs.create({ url: chrome.runtime.getURL('history/history.html') });
}

function openAria2Config() {
  chrome.tabs.create({ url: chrome.runtime.getURL('aria2/aria2.html') });
}
