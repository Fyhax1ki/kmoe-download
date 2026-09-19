const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function captureAddUriOptions(settings, payload) {
  const requests = [];
  let messageListener = null;

  const context = {
    console,
    Date,
    Error,
    JSON,
    parseInt,
    String,
    Object,
    fetch: async function (url, init) {
      const request = JSON.parse(init.body);
      requests.push(request);
      let result = 'gid-1';
      if (request.method === 'aria2.changeGlobalOption') {
        result = 'OK';
      } else if (request.method === 'aria2.getGlobalOption') {
        result = { dir: 'C:\\Users\\panda\\Downloads' };
      }
      return {
        ok: true,
        text: async function () {
          return JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: result
          });
        }
      };
    },
    chrome: {
      storage: {
        local: {
          get: function (keys, callback) {
            callback({ kmoe_settings: settings || {} });
          }
        }
      },
      runtime: {
        onMessage: {
          addListener: function (listener) {
            messageListener = listener;
          }
        }
      }
    }
  };

  vm.createContext(context);
  const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'shared', 'settings.js'), 'utf8');
  vm.runInContext(settingsSource, context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  vm.runInContext(source, context);

  assert(messageListener, 'background message listener should be registered');

  const response = await new Promise(function (resolve) {
    messageListener({
      type: 'KMOE_ARIA2_ADD_URI',
      payload: Object.assign({
        url: 'https://example.test/file.epub',
        filename: 'chapter.epub',
        directory: '漫画标题',
        maxConcurrentDownloads: 1
      }, payload || {})
    }, null, resolve);
  });

  assert.strictEqual(response.ok, true);
  assert.strictEqual(response.gid, 'gid-1');
  return {
    requests: requests,
    options: requests[requests.length - 1].params[1]
  };
}

async function run() {
  const defaultDirResult = await captureAddUriOptions({
    aria2: { rpcUrl: 'http://127.0.0.1:6800/jsonrpc', dir: '' }
  });
  assert.deepStrictEqual(defaultDirResult.requests.map(function (request) {
    return request.method;
  }), [
    'aria2.changeGlobalOption',
    'aria2.getGlobalOption',
    'aria2.addUri'
  ]);
  assert.strictEqual(defaultDirResult.options.dir, 'C:\\Users\\panda\\Downloads\\漫画标题');

  const explicitDirResult = await captureAddUriOptions({
    aria2: { rpcUrl: 'http://127.0.0.1:6800/jsonrpc', dir: 'D:\\Downloads' }
  });
  assert.deepStrictEqual(explicitDirResult.requests.map(function (request) {
    return request.method;
  }), [
    'aria2.changeGlobalOption',
    'aria2.addUri'
  ]);
  assert.strictEqual(explicitDirResult.options.dir, 'D:\\Downloads\\漫画标题');
}

run().catch(function (err) {
  console.error(err);
  process.exit(1);
});
