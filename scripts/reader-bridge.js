(function () {
  'use strict';

  // 主世界（MAIN world）桥：koobone.com 阅读站。
  //
  // 为什么需要它：MV3 的内容脚本 CSP 会阻止隔离世界对带 inline 事件处理器或
  // javascript: 链接的元素调用 .click()（站点卷锚点两者都占），所以隔离世界既
  // 不能直接调页面全局的 vol_open，也不能用点击代理。本脚本由 manifest 的
  // content_scripts[].world = "MAIN" 声明式注入，运行在页面自己的世界里，
  // 可以正大光明地调用站点自己的 window.vol_open。
  //
  // 能力边界：只做两件事——回一个存活探测、替隔离世界调用站点的 vol_open。
  // 不读缓存、不写缓存、不发起任何网络请求（下载由站点自己的 vol_open 完成）。
  var SOURCE = 'kmoe-reader-bridge';

  function reply(id, ok, result, error) {
    window.postMessage({
      source: SOURCE,
      dir: 'from-page',
      id: id,
      ok: !!ok,
      result: result === undefined ? null : result,
      error: error ? String(error) : ''
    }, '*');
  }

  function volOpenType() {
    return typeof window.vol_open;
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;

    var data = event.data;
    if (!data || data.source !== SOURCE || data.dir !== 'to-page') return;

    var payload = data.payload || {};
    var id = data.id;

    if (data.cmd === 'PING') {
      reply(id, true, {
        volOpen: volOpenType() === 'function',
        readyState: document.readyState,
        href: String(location.href)
      });
      return;
    }

    if (data.cmd !== 'CACHE_VOLUME') {
      reply(id, false, null, '未知指令：' + data.cmd);
      return;
    }

    if (volOpenType() !== 'function') {
      reply(id, false, null, '站点尚未就绪（页面全局 vol_open 不可用）');
      return;
    }

    var md5 = String(payload.md5 || '');
    var url = String(payload.url || '');
    if (!md5 || !url) {
      reply(id, false, null, '缺少卷标识或下载地址');
      return;
    }

    try {
      // 与用户点击卷封面完全同一个入口；下载与写缓存都由站点自己完成。
      window.vol_open(url, md5);
    } catch (err) {
      reply(id, false, null, (err && err.message) || String(err));
      return;
    }

    reply(id, true, { md5: md5 });
  });
})();
