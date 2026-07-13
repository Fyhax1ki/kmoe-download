document.addEventListener('DOMContentLoaded', function () {
  loadSettings();
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  document.getElementById('testConnection').addEventListener('click', testConnection);
});

var DEFAULT_ARIA2 = {
  rpcUrl: 'http://127.0.0.1:6800/jsonrpc',
  rpcToken: '',
  dir: '',
  split: 4,
  maxConnectionPerServer: 4
};

function normalizeAria2(input) {
  var aria2 = input || {};
  var split = parseInt(aria2.split, 10);
  var maxConnectionPerServer = parseInt(aria2.maxConnectionPerServer, 10);

  if (!split || split < 1) split = DEFAULT_ARIA2.split;
  if (split > 16) split = 16;
  if (!maxConnectionPerServer || maxConnectionPerServer < 1) maxConnectionPerServer = DEFAULT_ARIA2.maxConnectionPerServer;
  if (maxConnectionPerServer > 16) maxConnectionPerServer = 16;

  return {
    rpcUrl: (aria2.rpcUrl || DEFAULT_ARIA2.rpcUrl).trim(),
    rpcToken: (aria2.rpcToken || '').trim(),
    dir: (aria2.dir || '').trim(),
    split: split,
    maxConnectionPerServer: maxConnectionPerServer
  };
}

function readForm() {
  return normalizeAria2({
    rpcUrl: document.getElementById('rpcUrl').value,
    rpcToken: document.getElementById('rpcToken').value,
    dir: document.getElementById('downloadDir').value,
    split: document.getElementById('split').value,
    maxConnectionPerServer: document.getElementById('maxConnectionPerServer').value
  });
}

function fillForm(aria2) {
  document.getElementById('rpcUrl').value = aria2.rpcUrl;
  document.getElementById('rpcToken').value = aria2.rpcToken;
  document.getElementById('downloadDir').value = aria2.dir;
  document.getElementById('split').value = aria2.split;
  document.getElementById('maxConnectionPerServer').value = aria2.maxConnectionPerServer;
}

function showStatus(text, isError) {
  var status = document.getElementById('status');
  status.textContent = text || '';
  status.classList.toggle('error', !!isError);
}

function loadSettings() {
  chrome.storage.local.get(['kmoe_settings'], function (result) {
    var settings = result.kmoe_settings || {};
    fillForm(normalizeAria2(settings.aria2));
  });
}

function saveSettings(callback) {
  var aria2 = readForm();
  chrome.storage.local.get(['kmoe_settings'], function (result) {
    var settings = result.kmoe_settings || {};
    settings.aria2 = aria2;
    chrome.storage.local.set({ kmoe_settings: settings }, function () {
      showStatus('配置已保存', false);
      if (callback) callback(aria2);
    });
  });
}

function testConnection() {
  saveSettings(function (aria2) {
    showStatus('正在测试连接...', false);
    chrome.runtime.sendMessage({
      type: 'KMOE_ARIA2_TEST',
      payload: { aria2: aria2 }
    }, function (response) {
      var err = chrome.runtime.lastError;
      if (err || !response || !response.ok) {
        showStatus('连接失败: ' + (err ? err.message : (response && response.error ? response.error : '未知错误')), true);
        return;
      }
      showStatus('连接成功，aria2 版本: ' + response.version, false);
    });
  });
}
