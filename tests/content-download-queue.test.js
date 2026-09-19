const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createContentContext() {
  const requests = [];
  const runtimeMessages = [];

  function createNode() {
    return {
      style: {},
      dataset: {},
      children: [],
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      removeChild(child) {
        this.children = this.children.filter((item) => item !== child);
        return child;
      },
      remove() {},
      addEventListener() {},
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      set textContent(value) {
        this._textContent = value;
      },
      get textContent() {
        return this._textContent || '';
      },
      get firstChild() {
        return this.children[0] || null;
      }
    };
  }

  class FakeXMLHttpRequest {
    open(method, url) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name, value) {
      this.headers = this.headers || {};
      this.headers[name] = value;
    }

    send() {
      requests.push(this);
    }

    abort() {
      this.aborted = true;
      if (this.onabort) this.onabort();
    }
  }

  const context = {
    console,
    setTimeout,
    clearTimeout,
    XMLHttpRequest: FakeXMLHttpRequest,
    URL: {
      createObjectURL() {
        return 'blob:test';
      },
      revokeObjectURL() {}
    },
    Blob,
    MutationObserver: class {
      observe() {}
    },
    window: {
      __KMOE_DOWNLOAD_TEST__: true,
      location: { href: 'https://kox.moe/c/123.htm', origin: 'https://kox.moe' },
      addEventListener() {}
    },
    document: {
      cookie: 'sid=test',
      readyState: 'loading',
      head: createNode(),
      documentElement: createNode(),
      body: createNode(),
      createElement() {
        return createNode();
      },
      createTextNode(text) {
        return { textContent: text };
      },
      addEventListener() {},
      getElementById() {
        return null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      }
    },
    chrome: {
      runtime: {
        lastError: null,
        getURL(file) {
          return file;
        },
        sendMessage(message, callback) {
          runtimeMessages.push(message);
          if (message.type === 'KMOE_ARIA2_ADD_URI' && callback) {
            callback({ ok: true, gid: 'gid-' + runtimeMessages.length });
            return;
          }
          if (message.type === 'KMOE_ARIA2_TELL_STATUS' && callback) {
            callback({ ok: true, status: { status: 'complete', totalLength: '100', completedLength: '100', downloadSpeed: '0' } });
            return;
          }
          if (callback) callback({ ok: true });
        }
      },
      storage: {
        local: {
          get(keys, callback) {
            callback({ kmoe_settings: { maxDownload: 1, downloadDelay: 1500, maxRetry: 5, downloadMode: 'xhr' } });
          },
          set() {}
        },
        onChanged: {
          addListener() {}
        }
      }
    },
    __requests: requests,
    __runtimeMessages: runtimeMessages
  };
  context.window.window = context.window;
  context.globalThis = context;

  return context;
}

function loadContentScript(context) {
  const settingsScript = fs.readFileSync(path.join(__dirname, '..', 'shared', 'settings.js'), 'utf8');
  const contentScript = fs.readFileSync(path.join(__dirname, '..', 'content', 'content.js'), 'utf8');

  vm.createContext(context);
  vm.runInContext(settingsScript, context, { filename: 'shared/settings.js' });
  vm.runInContext(contentScript, context, { filename: 'content/content.js' });
}

function createItems() {
  return [
    {
      id: 1,
      bookId: '123',
      volId: 'v1',
      format: '1',
      filename: 'v1.mobi',
      downloadDir: 'Book',
      pageUrl: 'https://kox.moe/c/123.htm',
      status: 0,
      retryCount: 0
    },
    {
      id: 2,
      bookId: '123',
      volId: 'v2',
      format: '1',
      filename: 'v2.mobi',
      downloadDir: 'Book',
      pageUrl: 'https://kox.moe/c/123.htm',
      status: 0,
      retryCount: 0
    }
  ];
}

test('xhr queue requests only the active item download URL', () => {
  const context = createContentContext();
  loadContentScript(context);

  context.window.__kmoeTestHooks.setQueue(createItems());
  context.window.__kmoeTestHooks.setOptions({
    maxDownload: 1,
    downloadDelay: 0,
    maxRetry: 5,
    downloadMode: 'xhr'
  });

  context.window.__kmoeTestHooks.downloadRefresh();

  assert.equal(context.__requests.length, 1);
  assert.match(context.__requests[0].url, /v=v1/);
});

test('aria2 queue submits resolved items through aria2 RPC message', () => {
  const context = createContentContext();
  loadContentScript(context);

  context.window.__kmoeTestHooks.setQueue(createItems());
  context.window.__kmoeTestHooks.setOptions({
    maxDownload: 1,
    downloadDelay: 0,
    maxRetry: 5,
    downloadMode: 'aria2'
  });

  context.window.__kmoeTestHooks.downloadRefresh();
  context.__requests[0].responseText = JSON.stringify({ url: 'https://example.test/v1.mobi' });
  context.__requests[0].onload();

  assert.equal(context.__runtimeMessages[0].type, 'KMOE_ARIA2_ADD_URI');
  assert.equal(context.__runtimeMessages[0].payload.filename, 'v1.mobi');
  assert.equal(context.__runtimeMessages[0].payload.url, 'https://example.test/v1.mobi');
});

test('quota display uses GB when quota is at least one GB', () => {
  const context = createContentContext();
  loadContentScript(context);

  assert.equal(context.window.__kmoeTestHooks.formatQuotaSize(2048), '2.0GB');
});

test('quota display keeps detailed MB when quota is less than one GB', () => {
  const context = createContentContext();
  loadContentScript(context);

  assert.equal(context.window.__kmoeTestHooks.formatQuotaSize(768.25), '768.3MB');
});
