(function () {
  'use strict';

  if (typeof importScripts === 'function' && !globalThis.KmoeSettings) {
    importScripts('shared/settings.js');
  }

  var Settings = globalThis.KmoeSettings;

  function loadAria2Settings(callback) {
    Settings.loadSettings(function (settings) {
      callback(settings.aria2);
    });
  }

  function aria2Rpc(aria2, method, params, callback) {
    aria2 = Settings.normalizeAria2(aria2);
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

  function sanitizeDirectoryName(name) {
    name = String(name || '').replace(/[<>:"/\\|?*]/g, '_').trim();
    if (!name || name === '.' || name === '..') return '';
    return name;
  }

  function joinAria2Dir(baseDir, subDir) {
    subDir = sanitizeDirectoryName(subDir);
    if (!subDir) return baseDir || '';
    if (!baseDir) return '';

    var separator = baseDir.indexOf('\\') !== -1 ? '\\' : '/';
    return baseDir.replace(/[\\/]+$/, '') + separator + subDir;
  }

  function resolveAria2Dir(aria2, payload, callback) {
    var subDir = sanitizeDirectoryName(payload.directory);
    if (!subDir) {
      callback(null, aria2.dir || '');
      return;
    }

    if (aria2.dir) {
      callback(null, joinAria2Dir(aria2.dir, subDir));
      return;
    }

    aria2Rpc(aria2, 'aria2.getGlobalOption', [], function (err, options) {
      var globalDir;
      if (err) {
        callback(err);
        return;
      }

      globalDir = options && options.dir ? String(options.dir).trim() : '';
      if (!globalDir || globalDir === '.') {
        callback(new Error('aria2 默认下载目录为空，请在 aria2 或扩展 aria2 配置中设置下载目录'));
        return;
      }

      callback(null, joinAria2Dir(globalDir, subDir));
    });
  }

  function getAria2Options(aria2, payload, dir) {
    var options = {
      out: payload.filename || undefined,
      split: String(aria2.split),
      'max-connection-per-server': String(aria2.maxConnectionPerServer),
      referer: payload.referer || payload.pageUrl || undefined,
      header: []
    };

    if (dir) {
      options.dir = dir;
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

        resolveAria2Dir(aria2, payload, function (dirErr, dir) {
          if (dirErr) {
            sendResponse({ ok: false, error: dirErr.message });
            return;
          }

          aria2Rpc(aria2, 'aria2.addUri', [[payload.url], getAria2Options(aria2, payload, dir)], function (err, gid) {
            if (err) {
              sendResponse({ ok: false, error: err.message });
              return;
            }
            sendResponse({ ok: true, gid: gid });
          });
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
    var aria2 = Settings.normalizeAria2(payload.aria2);
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
