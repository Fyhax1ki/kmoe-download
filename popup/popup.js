document.addEventListener('DOMContentLoaded', function() {
  loadSettings();
  loadHistoryCount();

  bindAutoSave();
  document.getElementById('openAria2').addEventListener('click', openAria2Config);
  document.getElementById('openHistory').addEventListener('click', openHistory);
});

var autoSaveTimer = null;

function loadSettings() {
  chrome.storage.local.get(['kmoe_settings'], function(result) {
    var settings = result.kmoe_settings || {
      maxDownload: 1,
      downloadDelay: 1500,
      maxRetry: 5,
      downloadMode: 'aria2'
    };

    document.getElementById('maxDownload').value = settings.maxDownload || 1;
    document.getElementById('downloadDelay').value = settings.downloadDelay || 1500;
    document.getElementById('maxRetry').value = settings.maxRetry || 5;
    var downloadMode = settings.downloadMode || 'aria2';
    if (downloadMode === 'browser') downloadMode = 'aria2';
    if (downloadMode !== 'aria2' && downloadMode !== 'xhr') downloadMode = 'aria2';
    document.getElementById('downloadMode').value = downloadMode;
  });
}

function bindAutoSave() {
  ['maxDownload', 'downloadDelay', 'maxRetry'].forEach(function(id) {
    document.getElementById(id).addEventListener('input', scheduleSaveSettings);
  });
  document.getElementById('downloadMode').addEventListener('change', scheduleSaveSettings);
}

function scheduleSaveSettings() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(saveSettings, 300);
}

function saveSettings() {
  var maxDownload = parseInt(document.getElementById('maxDownload').value);
  var downloadDelay = parseInt(document.getElementById('downloadDelay').value);
  var maxRetry = parseInt(document.getElementById('maxRetry').value);
  var downloadMode = document.getElementById('downloadMode').value;

  if (maxDownload < 1) maxDownload = 1;
  if (maxDownload > 3) maxDownload = 3;
  if (downloadDelay < 1500) downloadDelay = 1500;
  if (maxRetry < 1) maxRetry = 1;
  if (downloadMode === 'browser') downloadMode = 'aria2';
  if (downloadMode !== 'aria2' && downloadMode !== 'xhr') downloadMode = 'aria2';

  chrome.storage.local.get(['kmoe_settings'], function(result) {
    var settings = result.kmoe_settings || {};
    settings.maxDownload = maxDownload;
    settings.downloadDelay = downloadDelay;
    settings.maxRetry = maxRetry;
    settings.downloadMode = downloadMode;

    chrome.storage.local.set({ kmoe_settings: settings }, function() {
      var status = document.getElementById('saveStatus');
      status.textContent = '已生效';
      setTimeout(function() {
        status.textContent = '';
      }, 1500);
    });
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
