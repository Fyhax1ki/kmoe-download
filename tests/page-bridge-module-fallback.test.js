const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createNode(props) {
  return Object.assign({
    textContent: '',
    src: '',
    style: {},
    dataset: {},
    appendChild() {},
    remove() {},
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  }, props || {});
}

function createPageBridgeContext(options) {
  const messages = [];
  const moduleScripts = (options && options.moduleScripts) || [];
  const authorNodes = (options && options.authorNodes) || [];
  const intervalCallbacks = [];
  const listeners = {};
  const titleNode = createNode({ textContent: (options && options.titleText) || '默认标题' });
  const coverNode = createNode({ src: (options && options.coverSrc) || '' });
  const descNode = createNode((options && options.descriptionNode) || { textContent: (options && options.descriptionText) || '' });

  const context = {
    console,
    Array,
    Date,
    Error,
    JSON,
    Number,
    Object,
    String,
    parseFloat,
    parseInt,
    setInterval(callback) {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    },
    clearInterval() {},
    setTimeout,
    clearTimeout,
    MutationObserver: class {
      observe() {}
    },
    document: {
      title: (options && options.title) || '默认标题',
      documentElement: createNode(),
      querySelector(selector) {
        if (selector === '.text_bglight_big') return titleNode;
        if (selector === '.img_book') return coverNode;
        if (selector === '#div_desc_content') return descNode;
        return null;
      },
      querySelectorAll(selector) {
        if (selector === 'script[type="module"]') return moduleScripts;
        if (selector === "a[href*='list.php?s=']") return authorNodes;
        return [];
      }
    },
    window: {
      location: {
        href: 'https://kox.moe/c/123.htm',
        origin: 'https://kox.moe'
      },
      postMessage(message) {
        if (typeof message === 'string' && message.indexOf('KMOE_MANGA_DATA=') === 0) {
          messages.push({
            source: 'kmoe-download-page-bridge',
            type: 'MANGA_DATA',
            payload: JSON.parse(message.slice('KMOE_MANGA_DATA='.length))
          });
          return;
        }
        messages.push(message);
      },
      addEventListener(type, handler) {
        listeners[type] = handler;
      }
    }
  };

  context.window.window = context.window;
  context.__messages = messages;
  context.__intervalCallbacks = intervalCallbacks;
  context.__emitWindowMessage = function (data) {
    if (listeners.message) {
      listeners.message({ source: context.window, data: data });
    }
  };
  return context;
}

function loadPageBridge(context) {
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'page-bridge.js'), 'utf8');
  vm.runInContext(source, context);
}

test('page bridge falls back to module script values', () => {
  const context = createPageBridgeContext({
    moduleScripts: [
      createNode({
        textContent: `
          const bookid = '123';
          const arr_voldata = [
            [1, 0, 0, '分类A', 0, '章节一', 0, 0, 0, '12.5', 0, '8.1'],
            [2, 0, 0, '分类B', 0, '章节二', 0, 0, 0, '34', 0, '21.5']
          ];
          const u_def_file = '2';
          const str_down_url_prefix = \`/dl/\${bookid}/\`;
          const str_down_url_subfix = '/0/';
          const quota_now = 2048;
          const quota_used = 512;
        `
      })
    ],
    authorNodes: [
      createNode({ textContent: '作者甲', closest(selector) { return selector === '#txt_recbook' ? null : null; } }),
      createNode({ textContent: '作者乙', closest(selector) { return selector === '#txt_recbook' ? null : null; } }),
      createNode({ textContent: '再見了繪梨', closest(selector) { return selector === '#txt_recbook' ? createNode() : null; } })
    ],
    titleText: '模块标题',
    coverSrc: 'https://example.test/cover.jpg',
    descriptionNode: createNode({
      textContent: '模块简介作者同类推荐',
      childNodes: [
        { nodeType: 3, textContent: '模块简介' },
        { nodeType: 1, tagName: 'BR' },
        createNode({ textContent: '作者同类推荐' })
      ]
    })
  });

  loadPageBridge(context);

  assert.equal(context.__messages.length, 1);
  assert.equal(context.__messages[0].type, 'MANGA_DATA');
  assert.deepEqual(context.__messages[0].payload.bookId, '123');
  assert.equal(context.__messages[0].payload.arr.length, 2);
  assert.equal(context.__messages[0].payload.downPrefix, '/dl/123/');
  assert.equal(context.__messages[0].payload.downSuffix, '/0/');
  assert.equal(context.__messages[0].payload.fileFormat, 2);
  assert.equal(context.__messages[0].payload.quotaAvailable, 2048);
  assert.equal(context.__messages[0].payload.quotaUsed, 512);
  assert.equal(context.__messages[0].payload.description, '模块简介');
  assert.deepEqual(context.__messages[0].payload.author, ['作者甲', '作者乙']);
});

test('page bridge keeps legacy window values working', () => {
  const context = createPageBridgeContext({
    authorNodes: [createNode({ textContent: '旧作者' })],
    titleText: '旧标题',
    coverSrc: 'https://example.test/old-cover.jpg'
  });

  context.window.arr_voldata = [
    [1, 0, 0, '分类A', 0, '旧章节', 0, 0, 0, '10', 0, '6']
  ];
  context.window.bookid = 'legacy-1';
  context.window.str_down_url_prefix = '/legacy/';
  context.window.str_down_url_subfix = '/0/';
  context.window.u_def_file = '1';
  context.window.quota_now = 1024;
  context.window.quota_used = 128;

  loadPageBridge(context);

  assert.equal(context.__messages.length, 1);
  assert.equal(context.__messages[0].payload.bookId, 'legacy-1');
  assert.equal(context.__messages[0].payload.downPrefix, '/legacy/');
  assert.equal(context.__messages[0].payload.fileFormat, 1);
  assert.equal(context.__messages[0].payload.quotaAvailable, 1024);
  assert.equal(context.__messages[0].payload.quotaUsed, 128);
});

test('page bridge resolves values split across multiple module scripts', () => {
  const context = createPageBridgeContext({
    moduleScripts: [
      createNode({
        textContent: `
          const bookid = 'split-9';
          const arr_voldata = [
            [9, 0, 0, '分类C', 0, '分离章节', 0, 0, 0, '1', 0, '2']
          ];
        `
      }),
      createNode({
        textContent: `
          const str_down_url_prefix = \`/dl/\${bookid}/\`;
          const str_down_url_subfix = '/0/';
          const quota_now = 256;
          const quota_used = 16;
        `
      })
    ]
  });

  loadPageBridge(context);

  assert.equal(context.__messages.length, 1);
  assert.equal(context.__messages[0].payload.bookId, 'split-9');
  assert.equal(context.__messages[0].payload.downPrefix, '/dl/split-9/');
  assert.equal(context.__messages[0].payload.quotaAvailable, 256);
  assert.equal(context.__messages[0].payload.quotaUsed, 16);
});

test('page bridge rescans when module scripts appear later', () => {
  const moduleScripts = [];
  const context = createPageBridgeContext({
    moduleScripts: moduleScripts
  });

  loadPageBridge(context);

  assert.equal(context.__messages.length, 0);

  moduleScripts.push(
    createNode({
      textContent: `
        const bookid = 'late-1';
        const arr_voldata = [[1, 0, 0, '分类D', 0, '稍后出现', 0, 0, 0, '4', 0, '3']];
        const str_down_url_prefix = \`/dl/\${bookid}/\`;
      `
    })
  );

  context.__intervalCallbacks.forEach(function (callback) {
    callback();
  });

  assert.equal(context.__messages.length, 1);
  assert.equal(context.__messages[0].payload.bookId, 'late-1');
});

test('page bridge resends payload when quota changes but chapter count stays the same', () => {
  const moduleScript = createNode({
    textContent: `
      const bookid = 'quota-late';
      const arr_voldata = [[1, 0, 0, '分类D', 0, '章节', 0, 0, 0, '4', 0, '3']];
      const str_down_url_prefix = \`/dl/\${bookid}/\`;
    `
  });
  const context = createPageBridgeContext({
    moduleScripts: [moduleScript]
  });

  loadPageBridge(context);

  assert.equal(context.__messages.length, 1);
  assert.equal(context.__messages[0].payload.quotaAvailable, null);

  moduleScript.textContent = `
    const bookid = 'quota-late';
    const arr_voldata = [[1, 0, 0, '分类D', 0, '章节', 0, 0, 0, '4', 0, '3']];
    const str_down_url_prefix = \`/dl/\${bookid}/\`;
    const quota_now = "0";
    const quota_used = "3113";
  `;

  context.__intervalCallbacks.forEach(function (callback) {
    callback();
  });

  assert.equal(context.__messages.length, 2);
  assert.equal(context.__messages[1].payload.quotaAvailable, 0);
});

test('page bridge reads arr_voldata from push calls in module script', () => {
  const context = createPageBridgeContext({
    moduleScripts: [
      createNode({
        textContent: `
          const bookid = 'push-7';
          const arr_voldata = new Array();
          arr_voldata.push([7, 0, 0, '分类E', 0, '推入章节', 0, 0, 0, '9.5', 0, '4.2']);
          const str_down_url_prefix = \`/dl/\${bookid}/\`;
          const str_down_url_subfix = '/0/';
        `
      })
    ]
  });

  loadPageBridge(context);

  assert.equal(context.__messages.length, 1);
  assert.equal(context.__messages[0].payload.bookId, 'push-7');
  assert.equal(context.__messages[0].payload.arr.length, 1);
  assert.equal(context.__messages[0].payload.arr[0].name, '推入章节');
});

test('page bridge parses real page module var style', () => {
  const context = createPageBridgeContext({
    moduleScripts: [
      createNode({
        textContent: `
import { km_set_view, kb_http_get } from '/zzcomm.js?t4';
import { tips_close, data_book } from '/zzfunc.js?t4';

var int_tabdisp = 1;
var arr_voldata = new Array();

var uin     = "10667441";
var ulevel  = parseInt( "3" );
var is_vip  = parseInt( "1" );
var u_def_file  = parseInt( "2" );
var use_downview= parseInt( "1" );

var bookid  = "31299";
var str_down_url_prefix = "/dl/"+ bookid + "/";
var str_down_url_subfix = "/0/";
var str_book_url_prefix = "/c/";
var str_book_url_subfix = ".htm";

var bookstatus = "完結";
var is_jpn  = "0";
var is_eng  = "0";
var is_hd   = "0";
var is_color= "0";
var is_r18  = parseInt( "0" );
var is_blocked     = "0";
var is_internal    = "0";
var is_watermark   = "0";
var device_mailto  = "319914667_T4P4R2@kindle.com";
var can_do_follow  = "1";
var can_do_fav     = parseInt( "1" );
var need_vphone    = parseInt( "0" );
var quota_now      = "1734";
var quota_used     = "3113";
var comm_page_now  = 1;
var comm_page_order= 1;
var str_urldomain  = "https://kzo.moe";

arr_voldata.push([101, 0, 0, '単行本', 0, '第01巻', 0, 0, 0, '15.2', 0, '11.8']);
arr_voldata.push([102, 0, 0, '単行本', 0, '第02巻', 0, 0, 0, '16.0', 0, '12.1']);
`
      })
    ],
    authorNodes: [createNode({ textContent: '作者A' })],
    titleText: '真实页面标题',
    coverSrc: 'https://example.test/real-cover.jpg'
  });

  loadPageBridge(context);

  assert.equal(context.__messages.length, 1);
  assert.equal(context.__messages[0].payload.bookId, '31299');
  assert.equal(context.__messages[0].payload.arr.length, 2);
  assert.equal(context.__messages[0].payload.arr[0].name, '第01巻');
  assert.equal(context.__messages[0].payload.downPrefix, '/dl/31299/');
  assert.equal(context.__messages[0].payload.downSuffix, '/0/');
  assert.equal(context.__messages[0].payload.downloadOrigin, 'https://kzo.moe');
  assert.equal(context.__messages[0].payload.fileFormat, 2);
  assert.equal(context.__messages[0].payload.quotaAvailable, 1734);
  assert.equal(context.__messages[0].payload.quotaUsed, 3113);
});

test('page bridge collects chapter data from real page volinfo messages', () => {
  const context = createPageBridgeContext({
    moduleScripts: [
      createNode({
        textContent: `
var arr_voldata = new Array();
var bookid  = "31299";
var str_down_url_prefix = "/dl/"+ bookid + "/";
var str_down_url_subfix = "/0/";
var u_def_file  = parseInt( "2" );
var quota_now      = "1734";
var quota_used     = "3113";
var str_urldomain  = "https://kzo.moe";
`
      })
    ],
    titleText: '假冒的孩子',
    coverSrc: 'https://example.test/cover.jpg'
  });

  loadPageBridge(context);

  assert.equal(context.__messages.length, 0);

  context.__emitWindowMessage('volinfo=101,0,0,単行本,0,第01巻,0,200,0,15.2,0,11.8,狀態,完成,2026,2026');

  assert.equal(context.__messages.length, 1);
  assert.equal(context.__messages[0].payload.bookId, '31299');
  assert.equal(context.__messages[0].payload.arr.length, 1);
  assert.equal(context.__messages[0].payload.arr[0].id, '101');
  assert.equal(context.__messages[0].payload.arr[0].name, '第01巻');
  assert.equal(context.__messages[0].payload.downPrefix, '/dl/31299/');
  assert.equal(context.__messages[0].payload.downloadOrigin, 'https://kzo.moe');
});
