(function (root) {
  'use strict';

  var STORAGE_KEY = 'kmoe_settings';
  var XHR_MAX_DOWNLOAD = 3;
  var DEFAULT_DOWNLOAD_FORMAT = '1';
  var DEFAULT_ARIA2 = {
    rpcUrl: 'http://127.0.0.1:6800/jsonrpc',
    rpcToken: '',
    dir: '',
    split: 4,
    maxConnectionPerServer: 4
  };

  function normalizeDownloadMode(mode) {
    if (mode === 'browser') return 'aria2';
    if (mode === 'xhr') return 'xhr';
    return 'aria2';
  }

  function normalizeDownloadFormat(format) {
    return format === '2' ? '2' : DEFAULT_DOWNLOAD_FORMAT;
  }

  function normalizeMaxDownload(value, mode) {
    var normalized = parseInt(value, 10);
    if (!normalized || normalized < 1) normalized = 1;
    if (normalizeDownloadMode(mode) === 'xhr' && normalized > XHR_MAX_DOWNLOAD) normalized = XHR_MAX_DOWNLOAD;
    return normalized;
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

  function normalizeSettings(input) {
    var settings = Object.assign({}, input || {});
    var downloadMode = normalizeDownloadMode(settings.downloadMode);
    var maxDownloadByMode = normalizeMaxDownloadByMode(settings);

    settings.downloadMode = downloadMode;
    settings.maxDownloadByMode = maxDownloadByMode;
    settings.maxDownload = normalizeMaxDownload(settings.maxDownload || maxDownloadByMode[downloadMode], downloadMode);
    settings.downloadDelay = Math.max(parseInt(settings.downloadDelay, 10) || 1500, 1500);
    settings.maxRetry = Math.max(parseInt(settings.maxRetry, 10) || 5, 1);
    settings.downloadFormat = normalizeDownloadFormat(settings.downloadFormat);
    settings.aria2 = normalizeAria2(settings.aria2);
    return settings;
  }

  function loadSettings(callback) {
    chrome.storage.local.get([STORAGE_KEY], function (result) {
      callback(normalizeSettings(result[STORAGE_KEY] || {}), result[STORAGE_KEY] || {});
    });
  }

  function updateSettings(patch, callback) {
    chrome.storage.local.get([STORAGE_KEY], function (result) {
      var merged = Object.assign({}, result[STORAGE_KEY] || {}, patch || {});
      var settings = normalizeSettings(merged);
      chrome.storage.local.set({ kmoe_settings: settings }, function () {
        if (callback) callback(settings);
      });
    });
  }

  root.KmoeSettings = {
    STORAGE_KEY: STORAGE_KEY,
    XHR_MAX_DOWNLOAD: XHR_MAX_DOWNLOAD,
    DEFAULT_DOWNLOAD_FORMAT: DEFAULT_DOWNLOAD_FORMAT,
    DEFAULT_ARIA2: DEFAULT_ARIA2,
    normalizeDownloadMode: normalizeDownloadMode,
    normalizeDownloadFormat: normalizeDownloadFormat,
    normalizeMaxDownload: normalizeMaxDownload,
    normalizeMaxDownloadByMode: normalizeMaxDownloadByMode,
    normalizeAria2: normalizeAria2,
    normalizeSettings: normalizeSettings,
    loadSettings: loadSettings,
    updateSettings: updateSettings
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
