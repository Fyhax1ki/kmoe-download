(function () {
  'use strict';

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

  function loadAria2Settings(callback) {
    chrome.storage.local.get(['kmoe_settings'], function (result) {
      var settings = result.kmoe_settings || {};
      callback(normalizeAria2(settings.aria2));
    });
  }

  function aria2Rpc(aria2, method, params, callback) {
    aria2 = normalizeAria2(aria2);
    params = params || [];
    if (aria2.rpcToken) {
      params = ['token:' + aria2.rpcToken].concat(params);
    }

    fetch(aria2.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: method,
        params: params
      })
    }).then(function (response) {
      return response.text().then(function (text) {
        var data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (e) {
          throw new Error('aria2 返回了无效 JSON');
        }
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        if (!data) {
          throw new Error('aria2 无响应');
        }
        if (data.error) {
          throw new Error(data.error.message || data.error.code || 'aria2 RPC 错误');
        }
        return data.result;
      });
    }).then(function (result) {
      callback(null, result);
    }).catch(function (err) {
      callback(err);
    });
  }

  function getAria2Options(aria2, payload) {
    var options = {
      out: payload.filename || undefined,
      split: String(aria2.split),
      'max-connection-per-server': String(aria2.maxConnectionPerServer),
      referer: payload.referer || payload.pageUrl || undefined,
      header: []
    };

    if (aria2.dir) {
      options.dir = aria2.dir;
    }
    if (payload.cookie) {
      options.header.push('Cookie: ' + payload.cookie);
    }
    if (payload.headers && payload.headers.length) {
      payload.headers.forEach(function (header) {
        if (header) options.header.push(header);
      });
    }
    if (options.header.length === 0) {
      delete options.header;
    }

    Object.keys(options).forEach(function (key) {
      if (options[key] === undefined || options[key] === '') {
        delete options[key];
      }
    });
    return options;
  }

  function normalizeMaxConcurrentDownloads(value) {
    var maxConcurrentDownloads = parseInt(value, 10);
    if (!maxConcurrentDownloads || maxConcurrentDownloads < 1) maxConcurrentDownloads = 1;
    return maxConcurrentDownloads;
  }

  function applyAria2GlobalOptions(aria2, payload, callback) {
    var maxConcurrentDownloads = normalizeMaxConcurrentDownloads(payload.maxConcurrentDownloads);
    aria2Rpc(aria2, 'aria2.changeGlobalOption', [{
      'max-concurrent-downloads': String(maxConcurrentDownloads)
    }], callback);
  }

  function handleAria2Add(message, sendResponse) {
    var payload = message.payload || {};
    loadAria2Settings(function (aria2) {
      applyAria2GlobalOptions(aria2, payload, function (optionErr) {
        if (optionErr) {
          sendResponse({ ok: false, error: optionErr.message });
          return;
        }

        aria2Rpc(aria2, 'aria2.addUri', [[payload.url], getAria2Options(aria2, payload)], function (err, gid) {
          if (err) {
            sendResponse({ ok: false, error: err.message });
            return;
          }
          sendResponse({ ok: true, gid: gid });
        });
      });
    });
  }

  function handleAria2ApplyOptions(message, sendResponse) {
    var payload = message.payload || {};
    loadAria2Settings(function (aria2) {
      applyAria2GlobalOptions(aria2, payload, function (err) {
        if (err) {
          sendResponse({ ok: false, error: err.message });
          return;
        }
        sendResponse({ ok: true });
      });
    });
  }

  function handleAria2TellStatus(message, sendResponse) {
    var payload = message.payload || {};
    loadAria2Settings(function (aria2) {
      aria2Rpc(aria2, 'aria2.tellStatus', [
        payload.gid,
        ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'errorCode', 'errorMessage']
      ], function (err, status) {
        if (err) {
          sendResponse({ ok: false, error: err.message });
          return;
        }
        sendResponse({ ok: true, status: status });
      });
    });
  }

  function handleAria2Cancel(message, sendResponse) {
    var payload = message.payload || {};
    loadAria2Settings(function (aria2) {
      aria2Rpc(aria2, 'aria2.forceRemove', [payload.gid], function (err) {
        if (err) {
          sendResponse({ ok: false, error: err.message });
          return;
        }
        sendResponse({ ok: true });
      });
    });
  }

  function handleAria2Test(message, sendResponse) {
    var payload = message.payload || {};
    var aria2 = normalizeAria2(payload.aria2);
    aria2Rpc(aria2, 'aria2.getVersion', [], function (err, result) {
      if (err) {
        sendResponse({ ok: false, error: err.message });
        return;
      }
      sendResponse({ ok: true, version: result && result.version ? result.version : 'unknown' });
    });
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || !message.type) return false;

    if (message.type === 'KMOE_ARIA2_ADD_URI') {
      handleAria2Add(message, sendResponse);
      return true;
    }

    if (message.type === 'KMOE_ARIA2_APPLY_OPTIONS') {
      handleAria2ApplyOptions(message, sendResponse);
      return true;
    }

    if (message.type === 'KMOE_ARIA2_TELL_STATUS') {
      handleAria2TellStatus(message, sendResponse);
      return true;
    }

    if (message.type === 'KMOE_ARIA2_CANCEL') {
      handleAria2Cancel(message, sendResponse);
      return true;
    }

    if (message.type === 'KMOE_ARIA2_TEST') {
      handleAria2Test(message, sendResponse);
      return true;
    }

    return false;
  });
})();
