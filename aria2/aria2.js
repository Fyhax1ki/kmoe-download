document.addEventListener('DOMContentLoaded', function () {
  loadSettings();
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  document.getElementById('testConnection').addEventListener('click', testConnection);
});

function readForm() {
  return KmoeSettings.normalizeAria2({
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
  KmoeSettings.loadSettings(function (settings) {
    fillForm(settings.aria2);
  });
}

function saveSettings(callback) {
  var aria2 = readForm();
  KmoeSettings.updateSettings({ aria2: aria2 }, function (settings) {
    showStatus('配置已保存', false);
    if (callback) callback(settings.aria2);
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
