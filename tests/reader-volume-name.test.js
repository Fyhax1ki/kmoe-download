const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const READER_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'content', 'reader.js'), 'utf8');

// Minimal DOM good enough for the volume-name lookup: element nodes, tag names,
// inline attributes, parent/sibling links and descendant queries.
function createNode(tag, text, attrs) {
  return {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    children: [],
    _text: text || '',
    _attrs: attrs || {},
    get textContent() {
      return this._text + this.children.map((child) => child.textContent).join('');
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
    },
    querySelector(selector) {
      const found = this.querySelectorAll(selector);
      return found.length ? found[0] : null;
    },
    querySelectorAll(selector) {
      const want = String(selector).toUpperCase();
      const out = [];
      const walk = (node) => {
        node.children.forEach((child) => {
          if (child.tagName === want) out.push(child);
          walk(child);
        });
      };
      walk(this);
      return out;
    }
  };
}

function append(parent, child) {
  child.parentNode = parent;
  const previous = parent.children[parent.children.length - 1] || null;
  if (previous) {
    previous.nextSibling = child;
    child.previousSibling = previous;
  }
  parent.children.push(child);
  return child;
}

function loadReaderHooks() {
  const sandbox = {
    console,
    document: { readyState: 'loading', addEventListener() {} },
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    MutationObserver: function MutationObserver() {
      this.observe = () => {};
    }
  };
  vm.createContext(sandbox);
  sandbox.window = sandbox;
  // reader.js 会在加载时注册主世界桥的 message 监听器。
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.postMessage = () => {};
  sandbox.__KMOE_READER_TEST__ = true;
  vm.runInContext(READER_SOURCE, sandbox, { filename: 'content/reader.js' });
  return sandbox.__kmoeReaderTestHooks;
}

test('reader content script exposes its lookup helpers for tests', () => {
  const hooks = loadReaderHooks();
  assert.equal(typeof hooks.findVolumeName, 'function');
  assert.equal(hooks.squeeze('  a \n b  '), 'a b');
  assert.equal(hooks.cleanAnchorText({ textContent: '0% download_done' }), '');
});

test('reads the volume name from the cell, not from the cover overlay text', () => {
  const hooks = loadReaderHooks();

  // Picture layout: <td><a>(cover + "0% download_done")</a><div><font>name</font>...
  const cell = createNode('td');
  const anchor = append(cell, createNode('a'));
  const cover = append(anchor, createNode('div'));
  const overlay = append(cover, createNode('div'));
  append(overlay, createNode('span', '0% '));
  append(overlay, createNode('span', 'download_done'));

  const meta = append(cell, createNode('div'));
  append(meta, createNode('font', '妄想老師 - 卷13', { style: 'font-size:12px;' }));
  append(meta, createNode('font', '春輝', { class: 'color_gray font_size_s' }));

  assert.equal(hooks.findVolumeName(anchor), '妄想老師 - 卷13');
});

test('reads the volume name from the bold text in the neighbouring cell', () => {
  const hooks = loadReaderHooks();

  // Text layout: cover cell holds only the anchor, the name cell follows.
  const row = createNode('tr');
  const coverCell = append(row, createNode('td'));
  const anchor = append(coverCell, createNode('a'));
  append(anchor, createNode('div'));

  const nameCell = append(row, createNode('td'));
  const label = append(nameCell, createNode('font', '', { class: 'font_size_l' }));
  append(label, createNode('b', '花落紅 - 卷01'));

  assert.equal(hooks.findVolumeName(anchor), '花落紅 - 卷01');
});

test('falls back to the cleaned anchor text when nothing else is available', () => {
  const hooks = loadReaderHooks();
  const cell = createNode('td');
  const anchor = append(cell, createNode('a', '第 3 卷 下載完成'));

  assert.equal(hooks.findVolumeName(anchor), '第 3 卷 下載完成');
});

test('returns an empty name when the anchor only carries overlay markers', () => {
  const hooks = loadReaderHooks();
  const cell = createNode('td');
  const anchor = append(cell, createNode('a', '100% download_done'));

  assert.equal(hooks.findVolumeName(anchor), '');
});
