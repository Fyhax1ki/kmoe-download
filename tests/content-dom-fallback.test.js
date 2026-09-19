const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createNode(props) {
  const node = Object.assign({
    textContent: '',
    value: '',
    src: '',
    style: {},
    dataset: {},
    children: [],
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    insertBefore(child, referenceNode) {
      child.parentNode = this;
      const index = this.children.indexOf(referenceNode);
      if (index === -1) {
        this.children.push(child);
      } else {
        this.children.splice(index, 0, child);
      }
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child);
      return child;
    },
    remove() {},
    addEventListener(type, handler) {
      this.listeners = this.listeners || {};
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(handler);
    },
    dispatchEvent(type, event) {
      (this.listeners && this.listeners[type] || []).forEach((handler) => handler(event));
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    get firstChild() {
      return this.children[0] || null;
    },
    closest() {
      return null;
    }
  }, props || {});

  node.classList = {
    _set: new Set(String(node.className || '').split(/\s+/).filter(Boolean)),
    toggle(name, force) {
      if (force === true) this._set.add(name);
      else if (force === false) this._set.delete(name);
      else if (this._set.has(name)) this._set.delete(name);
      else this._set.add(name);
      node.className = Array.from(this._set).join(' ');
    },
    add(name) {
      this._set.add(name);
      node.className = Array.from(this._set).join(' ');
    },
    remove(name) {
      this._set.delete(name);
      node.className = Array.from(this._set).join(' ');
    },
    contains(name) {
      return this._set.has(name);
    }
  };
  node.setAttribute = function(name, value) {
    this.attrs = this.attrs || {};
    this.attrs[name] = String(value);
    if (name === 'aria-label') this.ariaLabel = String(value);
    if (name === 'aria-expanded') this.ariaExpanded = String(value);
  };
  node.getAttribute = function(name) {
    return (this.attrs && this.attrs[name]) || null;
  };
  node.offsetWidth = node.offsetWidth || 34;
  node.offsetHeight = node.offsetHeight || 28;
  node.getBoundingClientRect = node.getBoundingClientRect || function() {
    const left = parseFloat(this.style.left) || 0;
    const top = parseFloat(this.style.top) || 0;
    return { left, top, right: left + this.offsetWidth, bottom: top + this.offsetHeight, width: this.offsetWidth, height: this.offsetHeight };
  };
  return node;
}

function createContentContext() {
  const bookIdInput = createNode({ value: '31299' });
  const titleNode = createNode({ textContent: '假冒的孩子' });
  const coverNode = createNode({ src: 'https://example.test/cover.jpg' });
  const descNode = createNode({
    textContent: '美術大學學生由冬莉路懷抱著對家庭與自身繪畫能力的煩惱。作者同类推荐',
    childNodes: [
      { nodeType: 3, textContent: '美術大學學生由冬莉路懷抱著對家庭與自身繪畫能力的煩惱。' },
      { nodeType: 1, tagName: 'BR' },
      createNode({ textContent: '作者同类推荐' })
    ]
  });
  const authors = [
    createNode({ textContent: '川村拓', closest(selector) { return selector === '#txt_recbook' ? null : null; } }),
    createNode({ textContent: '再見了繪梨', closest(selector) { return selector === '#txt_recbook' ? createNode() : null; } })
  ];
  const moduleScript = createNode({
    type: 'module',
    textContent: `
      var bookid = "31299";
      var quota_now = "0";
      var quota_used = "3113";
      var str_urldomain = "https://kzo.moe";
    `
  });

  const row1 = createNode();
  row1.querySelector = function(selector) {
    if (selector === 'b') return createNode({ textContent: '第01巻' });
    return null;
  };
  row1.querySelectorAll = function(selector) {
    if (selector === 'input') return [createNode({ name: 'size_down_101', value: '15.2' })];
    return [];
  };

  const row2 = createNode();
  row2.querySelector = function(selector) {
    if (selector === 'b') return createNode({ textContent: '第02巻' });
    return null;
  };
  row2.querySelectorAll = function(selector) {
    if (selector === 'input') return [createNode({ name: 'size_down_102', value: '16.4' })];
    return [];
  };

  const chapterCheckboxes = [
    createNode({ value: '101', closest() { return row1; } }),
    createNode({ value: '102', closest() { return row2; } })
  ];
  let messageListener = null;

  const context = {
    console,
    Array,
    Date,
    Error,
    JSON,
    Number,
    Object,
    String,
    Set,
    Math,
    parseFloat,
    parseInt,
    setTimeout,
    clearTimeout,
    XMLHttpRequest: function() {},
    MutationObserver: class {
      observe() {}
    },
    window: {
      __KMOE_DOWNLOAD_TEST__: true,
      location: { href: 'https://bookof.moe/b/b5eddd.htm', origin: 'https://bookof.moe' },
      innerWidth: 1280,
      innerHeight: 800,
      localStorage: {
        _data: {},
        getItem(key) {
          return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null;
        },
        setItem(key, value) {
          this._data[key] = String(value);
        }
      },
      addEventListener(type, handler) {
        if (type === 'message') messageListener = handler;
        this.listeners = this.listeners || {};
        this.listeners[type] = this.listeners[type] || [];
        this.listeners[type].push(handler);
      }
    },
    document: {
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
      querySelector(selector) {
        if (selector === 'input[name="bookid"]') return bookIdInput;
        if (selector === '.text_bglight_big') return titleNode;
        if (selector === '.img_book') return coverNode;
        if (selector === '#div_desc_content') return descNode;
        return null;
      },
      querySelectorAll(selector) {
        if (selector === 'script[type="module"]') return [moduleScript];
        if (selector === 'input[name="checkbox_vol"]') return chapterCheckboxes;
        if (selector === "a[href*='list.php?s=']") return authors;
        return [];
      }
    },
    chrome: {
      runtime: {
        getURL(file) {
          return file;
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
    }
  };
  context.window.window = context.window;
  context.globalThis = context;
  context.__emitWindowMessage = function(data) {
    messageListener({ source: context.window, data: data });
  };
  return context;
}

function loadContentScript(context) {
  const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'shared', 'settings.js'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '..', 'content', 'content.js'), 'utf8');

  vm.createContext(context);
  vm.runInContext(settingsSource, context);
  vm.runInContext(source, context);
}

test('content script rebuilds book info from rendered page DOM when bridge data is missing', () => {
  const context = createContentContext();
  loadContentScript(context);

  const bookInfo = context.window.__kmoeTestHooks.collectBookInfoFromDocument();

  assert.equal(bookInfo.bookId, '31299');
  assert.equal(bookInfo.title, '假冒的孩子');
  assert.equal(bookInfo.cover, 'https://example.test/cover.jpg');
  assert.equal(bookInfo.description, '美術大學學生由冬莉路懷抱著對家庭與自身繪畫能力的煩惱。');
  assert.deepEqual(bookInfo.author, ['川村拓']);
  assert.equal(bookInfo.downPrefix, '/dl/31299/');
  assert.equal(bookInfo.downSuffix, '/0/');
  assert.equal(bookInfo.downloadOrigin, 'https://kzo.moe');
  assert.equal(bookInfo.quotaAvailable, 0);
  assert.equal(bookInfo.quotaUsed, 3113);
  assert.equal(bookInfo.arr.length, 2);
  assert.equal(bookInfo.arr[0].id, '101');
  assert.equal(bookInfo.arr[0].category, '章节');
  assert.equal(bookInfo.arr[0].name, '第01巻');
  assert.equal(bookInfo.arr[0].mobiSize, 15.2);
  assert.equal(bookInfo.arr[0].epubSize, 15.2);
});

test('content script caches bridge payload sent as a string message', () => {
  const context = createContentContext();
  loadContentScript(context);

  context.__emitWindowMessage('KMOE_MANGA_DATA=' + JSON.stringify({
    bookId: '31299',
    arr: [{ id: '101', category: '章节', name: '第01巻', mobiSize: 15.2, epubSize: 15.2 }],
    title: '假冒的孩子',
    cover: 'https://example.test/cover.jpg',
    author: ['川村拓'],
    downPrefix: '/dl/31299/',
    downSuffix: '/0/',
    downloadOrigin: 'https://kzo.moe',
    fileFormat: 2,
    quotaAvailable: 1734,
    quotaUsed: 3113
  }));

  const cached = context.window.__kmoeTestHooks.getCachedBookInfo();
  assert.equal(cached.bookId, '31299');
  assert.equal(cached.arr.length, 1);
  assert.equal(cached.downloadOrigin, 'https://kzo.moe');
});

test('content script injects a floating entry with mobi and epub actions', () => {
  const context = createContentContext();
  context.document.readyState = 'complete';
  context.document.createElement = function(tagName) {
    return createNode({ tagName: String(tagName).toUpperCase() });
  };
  context.document.getElementById = function(id) {
    if (id === 'kmoe-download-floating') {
      return context.document.body.children.find((child) => child.id === id) || null;
    }
    return null;
  };

  loadContentScript(context);

  const launcher = context.document.body.children.find((child) => child.id === 'kmoe-download-floating');
  assert.ok(launcher);
  assert.equal(launcher.children[0].children[0].textContent, 'K');
  assert.equal(launcher.children[0].children[1].textContent, 'Batch DL');
  assert.deepEqual(launcher.children[1].children.map((child) => child.textContent), ['MOBI', 'EPUB']);
  assert.deepEqual(launcher.children[1].children.map((child) => child.dataset.format), ['1', '2']);
});

test('floating entry drag saves position without opening formats', () => {
  const context = createContentContext();
  context.document.readyState = 'complete';
  context.document.createElement = function(tagName) {
    return createNode({ tagName: String(tagName).toUpperCase() });
  };
  context.document.getElementById = function(id) {
    if (id === 'kmoe-download-floating') {
      return context.document.body.children.find((child) => child.id === id) || null;
    }
    return null;
  };

  loadContentScript(context);

  const launcher = context.document.body.children.find((child) => child.id === 'kmoe-download-floating');

  launcher.dispatchEvent('pointerdown', { button: 0, pointerId: 1, clientX: 1200, clientY: 300, preventDefault() {} });
  launcher.dispatchEvent('pointermove', { pointerId: 1, clientX: 200, clientY: 120, preventDefault() {} });
  launcher.dispatchEvent('pointerup', { pointerId: 1, preventDefault() {} });

  assert.equal(launcher.style.left, '230px');
  assert.equal(launcher.style.top, '124px');
  assert.equal(context.window.localStorage.getItem('kmoe_floating_entry_pos'), JSON.stringify({ left: 230, top: 124 }));
  assert.equal(context.window.__kmoeTestHooks.getFloatingSuppressClick(), true);
});

test('floating format click is not swallowed by a press without dragging', () => {
  const context = createContentContext();
  context.document.readyState = 'complete';
  context.document.createElement = function(tagName) {
    return createNode({ tagName: String(tagName).toUpperCase() });
  };
  context.document.getElementById = function(id) {
    if (id === 'kmoe-download-floating') {
      return context.document.body.children.find((child) => child.id === id) || null;
    }
    return null;
  };

  loadContentScript(context);

  const launcher = context.document.body.children.find((child) => child.id === 'kmoe-download-floating');
  const mobiBtn = launcher.children[1].children[0];
  let opened = false;
  const originalClick = mobiBtn.listeners.click[0];
  mobiBtn.listeners.click[0] = function(event) {
    event.preventDefault();
    if (context.window.__kmoeTestHooks.getFloatingSuppressClick()) return;
    opened = true;
  };

  launcher.dispatchEvent('pointerdown', { button: 0, pointerId: 1, clientX: 100, clientY: 100, preventDefault() {} });
  launcher.dispatchEvent('pointerup', { pointerId: 1, preventDefault() {} });
  assert.equal(context.window.__kmoeTestHooks.getFloatingSuppressClick(), false);
  mobiBtn.dispatchEvent('click', { preventDefault() {} });
  assert.equal(opened, true);
  originalClick;
});
