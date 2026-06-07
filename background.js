(function () {
  'use strict';

  var STATE_KEY = 'kmoe_browser_download_state';
  var RECORDS_KEY = 'kmoe_download_records_v2';
  var RECORD_EXPIRE_HOURS = 48;
  var browserDownloadState = null;
  var pumpTimer = null;

  function defaultState() {
    return {
      active: false,
      tabId: null,
      items: [],
      maxDownload: 1,
      downloadDelay: 1500,
      maxRetry: 5
    };
  }

  function loadState(callback) {
    if (browserDownloadState) {
      callback(browserDownloadState);
      return;
    }

    chrome.storage.local.get([STATE_KEY], function (result) {
      browserDownloadState = result[STATE_KEY] || defaultState();
      callback(browserDownloadState);
    });
  }

  function saveState(state, callback) {
    browserDownloadState = state;
    chrome.storage.local.set({ [STATE_KEY]: state }, function () {
      if (callback) callback();
    });
  }

  function getCounts(state) {
    var counts = { queued: 0, downloading: 0, success: 0, fail: 0, canceled: 0 };
    state.items.forEach(function (item) {
      if (item.status === 0) counts.queued++;
      else if (item.status === 1) counts.downloading++;
      else if (item.status === 2) counts.success++;
      else if (item.status === 3) counts.fail++;
      else if (item.status === 4) counts.canceled++;
    });
    return counts;
  }

  function hasUnfinishedItems(state) {
    return state.items.some(function (item) {
      return item.status === 0 || item.status === 1;
    });
  }

  function sendToTab(tabId, message) {
    if (!tabId) return;
    chrome.tabs.sendMessage(tabId, message, function () {
      var err = chrome.runtime.lastError;
      if (err) {
        // The content script may be gone if the tab navigated or closed.
      }
    });
  }

  function sendStatusToTab(state) {
    sendToTab(state.tabId, {
      type: 'KMOE_DOWNLOAD_STATUS_CHANGED',
      state: {
        active: state.active,
        items: state.items,
        counts: getCounts(state)
      }
    });
  }

  function writeDownloadRecord(record) {
    if (!record || !record.bookId || !record.volId || !record.format) return;

    chrome.storage.local.get([RECORDS_KEY], function (result) {
      var downloadRecords = result[RECORDS_KEY] || {};
      var now = Date.now();
      var expireTime = RECORD_EXPIRE_HOURS * 60 * 60 * 1000;

      if (!downloadRecords[record.bookId]) {
        downloadRecords[record.bookId] = {
          title: record.title || '',
          cover: record.cover || '',
          url: record.pageUrl || '',
          volumes: {}
        };
      }

      if (!downloadRecords[record.bookId].volumes[record.volId]) {
        downloadRecords[record.bookId].volumes[record.volId] = {
          name: record.volName || '',
          formats: {}
        };
      }

      var existingTime = downloadRecords[record.bookId].volumes[record.volId].formats[record.format];
      if (!existingTime || (now - existingTime) > expireTime) {
        downloadRecords[record.bookId].volumes[record.volId].formats[record.format] = now;
      }

      chrome.storage.local.set({ [RECORDS_KEY]: downloadRecords });
    });
  }

  function startChromeDownload(state, item, callback) {
    chrome.downloads.download({
      url: item.url,
      filename: item.filename,
      conflictAction: 'uniquify',
      saveAs: false
    }, function (downloadId) {
      var err = chrome.runtime.lastError;
      if (err || !downloadId) {
        item.status = 3;
        item.statusText = err ? err.message : 'download_failed';
      } else {
        item.downloadId = downloadId;
        item.statusText = '已交给浏览器';
      }
      callback();
    });
  }

  function pumpBrowserQueue(delay) {
    if (pumpTimer) {
      clearTimeout(pumpTimer);
      pumpTimer = null;
    }

    pumpTimer = setTimeout(function () {
      loadState(function (state) {
        if (!state.active) return;

        var downloading = state.items.filter(function (item) {
          return item.status === 1;
        }).length;
        var capacity = Math.max(0, (state.maxDownload || 1) - downloading);
        var starters = state.items.filter(function (item) {
          return item.status === 0;
        }).slice(0, capacity);

        if (starters.length === 0) {
          state.active = hasUnfinishedItems(state);
          saveState(state, function () {
            sendStatusToTab(state);
          });
          return;
        }

        var pending = starters.length;
        starters.forEach(function (item) {
          item.status = 1;
          item.statusText = '已交给浏览器';
          startChromeDownload(state, item, function () {
            pending--;
            if (pending === 0) {
              saveState(state, function () {
                sendStatusToTab(state);
              });
            }
          });
        });
      });
    }, delay || 0);
  }

  function cancelBrowserQueue(sendResponse) {
    loadState(function (state) {
      var activeIds = [];
      state.items.forEach(function (item) {
        if (item.status === 1 && item.downloadId) {
          activeIds.push(item.downloadId);
        }
        if (item.status === 0 || item.status === 1) {
          item.cancelled = true;
          item.status = 4;
          item.statusText = '已取消';
        }
      });
      state.active = false;

      saveState(state, function () {
        activeIds.forEach(function (downloadId) {
          chrome.downloads.cancel(downloadId);
        });
        sendStatusToTab(state);
        if (sendResponse) sendResponse({ ok: true });
      });
    });
  }

  function handleDownloadChanged(delta) {
    if (!delta.state || !delta.state.current) return;

    loadState(function (state) {
      var item = state.items.find(function (entry) {
        return entry.downloadId === delta.id;
      });
      if (!item) return;

      var error = delta.error && delta.error.current ? delta.error.current : null;
      if (delta.state.current === 'complete') {
        writeDownloadRecord(item);
        item.status = 2;
        item.statusText = '完成';
      } else if (delta.state.current === 'interrupted') {
        if (error === 'USER_CANCELED') {
          item.cancelled = true;
          item.status = 4;
          item.statusText = '已取消';
        } else if (item.retryCount < state.maxRetry) {
          item.retryCount++;
          item.status = 0;
          item.downloadId = null;
          item.statusText = '';
        } else {
          item.status = 3;
          item.statusText = error || '失败';
        }
      }

      state.active = hasUnfinishedItems(state);
      saveState(state, function () {
        sendToTab(state.tabId, {
          type: 'KMOE_DOWNLOAD_CHANGED',
          itemId: item.id,
          downloadId: delta.id,
          state: delta.state.current,
          error: error,
          item: item
        });
        sendStatusToTab(state);
        if (state.active) {
          pumpBrowserQueue(state.downloadDelay || 0);
        }
      });
    });
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || !message.type) return false;

    if (message.type === 'KMOE_DOWNLOAD_BATCH_START') {
      var payload = message.payload || {};
      var tabId = sender.tab && sender.tab.id;
      loadState(function (existing) {
        var newItems = (payload.items || []).map(function (item) {
          item.status = 0;
          item.statusText = '';
          item.retryCount = item.retryCount || 0;
          item.downloadMode = 'browser';
          return item;
        });
        var retainedItems = existing.items.filter(function (item) {
          return item.status === 0 || item.status === 1 || item.status === 3;
        });
        var state = {
          active: true,
          tabId: tabId,
          items: retainedItems.concat(newItems),
          maxDownload: payload.maxDownload || existing.maxDownload || 1,
          downloadDelay: payload.downloadDelay || existing.downloadDelay || 1500,
          maxRetry: payload.maxRetry || existing.maxRetry || 5
        };

        saveState(state, function () {
          sendResponse({ ok: true, state: state });
          sendStatusToTab(state);
          pumpBrowserQueue(0);
        });
      });
      return true;
    }

    if (message.type === 'KMOE_DOWNLOAD_START') {
      var singlePayload = message.payload || {};
      singlePayload.status = 0;
      singlePayload.downloadMode = 'browser';
      loadState(function (existing) {
        var retainedItems = existing.items.filter(function (item) {
          return item.status === 0 || item.status === 1 || item.status === 3;
        });
        var singleState = {
          active: true,
          tabId: sender.tab && sender.tab.id,
          items: retainedItems.concat([singlePayload]),
          maxDownload: existing.maxDownload || 1,
          downloadDelay: existing.downloadDelay || 1500,
          maxRetry: existing.maxRetry || 5
        };
        saveState(singleState, function () {
          sendResponse({ ok: true });
          pumpBrowserQueue(0);
        });
      });
      return true;
    }

    if (message.type === 'KMOE_DOWNLOAD_CANCEL') {
      cancelBrowserQueue(sendResponse);
      return true;
    }

    if (message.type === 'KMOE_DOWNLOAD_STATUS') {
      loadState(function (state) {
        if (sender.tab && sender.tab.id) {
          state.tabId = sender.tab.id;
          saveState(state, function () {
            sendResponse({ ok: true, state: state, counts: getCounts(state) });
          });
        } else {
          sendResponse({ ok: true, state: state, counts: getCounts(state) });
        }
      });
      return true;
    }

    return false;
  });

  chrome.downloads.onChanged.addListener(handleDownloadChanged);
})();
