const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createElement() {
  return {
    style: {},
    dataset: {},
    children: [],
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    remove() {},
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
}

function loadContentHooks() {
  const sandbox = {
    window: {
      __KMOE_DOWNLOAD_TEST__: true,
      location: { href: 'https://example.test/c/1.htm', origin: 'https://example.test' },
      addEventListener() {}
    },
    document: {
      readyState: 'loading',
      title: 'Test Book',
      head: createElement(),
      documentElement: createElement(),
      body: createElement(),
      createElement,
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
        getURL(value) {
          return value;
        },
        sendMessage() {}
      },
      storage: {
        local: {
          get(keys, callback) {
            callback({});
          },
          set() {}
        },
        onChanged: {
          addListener() {}
        }
      }
    },
    MutationObserver: function () {
      this.observe = function () {};
    },
    XMLHttpRequest: function () {},
    alert() {},
    console,
    setTimeout,
    clearTimeout,
    Set
  };
  sandbox.window.window = sandbox.window;
  sandbox.globalThis = sandbox;

  const settingsScript = fs.readFileSync(path.join(__dirname, '..', 'shared', 'settings.js'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '..', 'content', 'content.js'), 'utf8');
  vm.runInNewContext(settingsScript, sandbox, { filename: 'shared/settings.js' });
  vm.runInNewContext(script, sandbox, { filename: 'content/content.js' });
  return sandbox.window.__kmoeTestHooks;
}

test('quota validation blocks selected chapters that exceed available quota', () => {
  const hooks = loadContentHooks();
  const result = hooks.validateDownloadQuota({
    quotaAvailable: 5,
    arr: [
      { id: '1', mobiSize: 3, epubSize: 4 },
      { id: '2', mobiSize: 4, epubSize: 4 }
    ]
  }, [{ index: 0 }, { index: 1 }], '1', function () {
    return false;
  });

  assert.equal(result.ok, false);
  assert.equal(result.selectedSize, 7);
});

test('download URL response without a URL is a terminal failure instead of a fallback URL', () => {
  const hooks = loadContentHooks();
  const item = {
    bookId: 'book-1',
    volId: 'vol-1',
    format: '1',
    downloadOrigin: 'https://example.test',
    downPrefix: '/dl/book-1/',
    downSuffix: '/0/'
  };

  const result = hooks.resolveDownloadUrlResponse(item, {
    ok: false,
    msg: '额度不足'
  });

  assert.equal(result.ok, false);
  assert.equal(result.retryable, false);
  assert.match(result.error, /额度不足/);
  assert.equal(item.url, undefined);
});

test('quota display is omitted when the page does not provide quota data', () => {
  const hooks = loadContentHooks();

  assert.equal(hooks.getQuotaDisplayText({}), '');
});

test('quota display includes zero available quota', () => {
  const hooks = loadContentHooks();

  assert.equal(hooks.getQuotaDisplayText({ quotaAvailable: 0 }), '可用额度: 0.0MB');
});

test('book info updates mutate an existing panel model so quota reaches click handlers', () => {
  const hooks = loadContentHooks();
  const existing = {
    bookId: '36065',
    quotaAvailable: null,
    arr: [{ id: '1', mobiSize: 10 }]
  };

  const merged = hooks.mergeBookInfo(existing, {
    bookId: '36065',
    quotaAvailable: 0,
    arr: [{ id: '1', mobiSize: 10 }]
  });

  assert.equal(merged, existing);
  assert.equal(existing.quotaAvailable, 0);
  assert.equal(hooks.validateDownloadQuota(existing, [{ index: 0 }], '1', () => false).ok, false);
});

test('failure reasons are shown in Chinese for common network failures', () => {
  const hooks = loadContentHooks();

  assert.equal(hooks.formatFailureReason('network'), '网络连接失败');
  assert.equal(hooks.formatFailureReason('timeout'), '网络超时');
});

test('failed progress items include the failure reason', () => {
  const hooks = loadContentHooks();

  const text = hooks.getProgressItemText({
    status: 3,
    filename: 'chapter.mobi',
    statusText: '网络连接失败'
  });

  assert.match(text, /失败：网络连接失败/);
});

test('server quota failures are shown as progress item failures', () => {
  const hooks = loadContentHooks();

  const text = hooks.getProgressItemText({
    status: 3,
    filename: 'chapter.mobi',
    statusText: hooks.formatFailureReason('额度不足')
  });

  assert.match(text, /失败：额度不足/);
});
