document.addEventListener('DOMContentLoaded', function() {
  loadSettings();
  loadHistoryCount();

  bindAutoSave();
  document.getElementById('openAria2').addEventListener('click', openAria2Config);
  document.getElementById('openHistory').addEventListener('click', openHistory);
});

var autoSaveTimer = null;
var maxDownloadByMode = {
  aria2: 1,
  xhr: 1
};
var currentDownloadMode = 'aria2';

function syncCurrentMaxDownload() {
  var input = document.getElementById('maxDownload');
  maxDownloadByMode[currentDownloadMode] = KmoeSettings.normalizeMaxDownload(input.value, currentDownloadMode);
  input.value = maxDownloadByMode[currentDownloadMode];
}

function updateMaxDownloadControl() {
  var input = document.getElementById('maxDownload');
  var mode = KmoeSettings.normalizeDownloadMode(document.getElementById('downloadMode').value);

  if (mode === 'xhr') {
    input.max = String(KmoeSettings.XHR_MAX_DOWNLOAD);
    input.title = '直接下载模式最多并发 ' + KmoeSettings.XHR_MAX_DOWNLOAD + ' 个';
    input.value = KmoeSettings.normalizeMaxDownload(input.value, mode);
  } else {
    input.removeAttribute('max');
    input.title = 'aria2 模式会同步设置 aria2 的同时下载任务数';
  }
}

function loadSettings() {
  KmoeSettings.loadSettings(function(settings) {
    var downloadMode = KmoeSettings.normalizeDownloadMode(settings.downloadMode);
    maxDownloadByMode = KmoeSettings.normalizeMaxDownloadByMode(settings);
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
    currentDownloadMode = KmoeSettings.normalizeDownloadMode(document.getElementById('downloadMode').value);
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
  var downloadMode = KmoeSettings.normalizeDownloadMode(document.getElementById('downloadMode').value);

  currentDownloadMode = downloadMode;
  maxDownload = KmoeSettings.normalizeMaxDownload(maxDownload, downloadMode);
  maxDownloadByMode[downloadMode] = maxDownload;
  if (downloadDelay < 1500) downloadDelay = 1500;
  if (maxRetry < 1) maxRetry = 1;

  KmoeSettings.updateSettings({
    maxDownload: maxDownload,
    maxDownloadByMode: {
      aria2: KmoeSettings.normalizeMaxDownload(maxDownloadByMode.aria2, 'aria2'),
      xhr: KmoeSettings.normalizeMaxDownload(maxDownloadByMode.xhr, 'xhr')
    },
    downloadDelay: downloadDelay,
    maxRetry: maxRetry,
    downloadMode: downloadMode
  }, function(settings) {
    applyAria2Options(settings);
    var status = document.getElementById('saveStatus');
    status.textContent = '已生效';
    setTimeout(function() {
      status.textContent = '';
    }, 1500);
  });
}

function applyAria2Options(settings) {
  if (KmoeSettings.normalizeDownloadMode(settings.downloadMode) !== 'aria2') return;
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
