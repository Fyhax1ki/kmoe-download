const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createElement(id, value) {
  return {
    id,
    value,
    textContent: '',
    listeners: {},
    addEventListener(type, handler) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(handler);
    },
    removeAttribute() {},
    dispatchEvent(type) {
      (this.listeners[type] || []).forEach((handler) => handler({ target: this }));
    }
  };
}

test('settings changes are saved automatically after debounce', async () => {
  const elements = {
    maxDownload: createElement('maxDownload', '2'),
    downloadDelay: createElement('downloadDelay', '2000'),
    maxRetry: createElement('maxRetry', '4'),
    downloadMode: createElement('downloadMode', 'xhr'),
    openAria2: createElement('openAria2', ''),
    openHistory: createElement('openHistory', ''),
    historyCount: createElement('historyCount', ''),
    saveStatus: createElement('saveStatus', '')
  };

  let domContentLoadedHandler;
  let savedSettings;
  const context = {
    console,
    setTimeout,
    clearTimeout,
    document: {
      addEventListener(type, handler) {
        if (type === 'DOMContentLoaded') domContentLoadedHandler = handler;
      },
      getElementById(id) {
        return elements[id];
      }
    },
    chrome: {
      storage: {
        local: {
          get(keys, callback) {
            callback({ kmoe_settings: {} });
          },
          set(value, callback) {
            savedSettings = value.kmoe_settings;
            if (callback) callback();
          }
        }
      },
      tabs: {
        create() {}
      },
      runtime: {
        getURL(file) {
          return file;
        },
        sendMessage() {
        }
      }
    }
  };

  vm.createContext(context);
  const settingsScript = fs.readFileSync(path.join(__dirname, '..', 'shared', 'settings.js'), 'utf8');
  const popupScript = fs.readFileSync(path.join(__dirname, '..', 'popup', 'popup.js'), 'utf8');
  vm.runInContext(settingsScript, context);
  vm.runInContext(popupScript, context);

  domContentLoadedHandler();
  savedSettings = undefined;
  elements.maxDownload.value = '3';
  elements.maxDownload.dispatchEvent('input');

  await new Promise((resolve) => setTimeout(resolve, 400));

  assert.deepEqual(JSON.parse(JSON.stringify(savedSettings)), {
    maxDownload: 3,
    maxDownloadByMode: {
      aria2: 3,
      xhr: 1
    },
    downloadDelay: 1500,
    maxRetry: 5,
    downloadMode: 'aria2',
    downloadFormat: '1',
    aria2: {
      rpcUrl: 'http://127.0.0.1:6800/jsonrpc',
      rpcToken: '',
      dir: '',
      split: 4,
      maxConnectionPerServer: 4
    }
  });
  assert.equal(elements.saveStatus.textContent, '已生效');
});
