# Kmoe Download

一个面向 Kmoe 同系漫画站点的 Chrome 扩展，用于在漫画详情页批量下载章节，并管理下载记录、重试与并发设置。

这个项目不是通用网页下载器，它只适配当前仓库中已经写死在 `manifest.json` 和页面脚本里的站点结构。

## 支持的网站

当前版本仅针对以下域名生效：

- `https://kxx.moe/*`
- `https://kxo.moe/*`
- `https://mox.moe/*`
- `https://koz.moe/*`
- `https://kox.moe/*`
- `https://kzo.moe/*`
- `https://kzz.moe/*`
- 对应的 `http://` 版本也已包含在扩展权限中

这些域名本质上是同一套页面结构的镜像或同系站点。扩展依赖它们页面中已有的漫画数据变量与下载入口，因此不能直接用于其他漫画网站。

## 支持的页面类型

扩展主要针对这些站点中的漫画详情页，例如：

```text
https://kox.moe/c/12345.htm
```

在这类页面上，扩展会读取站点前端已暴露的数据，例如：

- `window.arr_voldata`
- `window.bookid`
- `window.str_down_url_prefix` / `window.str_down_url_pre`
- `window.str_down_url_subfix` / `window.str_down_url_suffix`
- `window.down_domain` / `window.str_down_domain`

同时，页面里还需要存在站点原本的下载按钮节点，当前脚本会在以下按钮附近插入 `Kmoe-Download` 按钮：

- `#bt_down_all_1_mobi`
- `#bt_down_all_1_epub`

如果目标网站没有这套变量、按钮或 URL 结构，这个扩展就不会正常工作。

## 主要功能

- 批量勾选章节下载
- 按分类分组显示章节
- 支持 `MOBI` / `EPUB`
- 下载队列与并发控制
- 失败自动重试
- 48 小时下载记录缓存
- 独立历史记录页面

## 安装方式

### 开发者模式加载

1. 克隆仓库

```bash
git clone https://github.com/Fyhax1ki/kmoe-download.git
```

2. 打开 Chrome，进入 `chrome://extensions/`
3. 开启右上角“开发者模式”
4. 点击“加载已解压的扩展程序”
5. 选择当前项目根目录

## 使用方法

1. 打开上述支持域名中的漫画详情页
2. 等待页面加载出章节与站点原生下载按钮
3. 点击页面上的 `Kmoe-Download`
4. 选择章节、格式与下载参数
5. 启动下载任务
6. 在扩展历史页查看记录

所有下载任务都会进入内部队列，按设定的并发数和延迟顺序执行，以减少瞬时请求压力。

## 项目结构

```text
kmoe-download/
├── manifest.json
├── content/
│   ├── content.js
│   └── content.css
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── history/
│   ├── history.html
│   └── history.js
├── scripts/
│   └── page-bridge.js
└── icons/
```

## 关键适配点

- `manifest.json`
  站点白名单与内容脚本注入范围
- `scripts/page-bridge.js`
  从页面上下文读取漫画、章节、额度和下载域名信息
- `content/content.js`
  插入下载按钮、渲染选择面板、执行下载队列
- `history/history.js`
  展示 48 小时内的下载记录

如果你要新增其他网站支持，通常至少要一起修改：

- `manifest.json` 中的域名匹配规则
- `scripts/page-bridge.js` 中的数据提取逻辑
- `content/content.js` 中的按钮选择器与下载 URL 拼接逻辑

## 说明与限制

- 该项目默认假设目标站点使用 Kmoe 同系前端结构
- 不会绕过站点登录、额度或权限限制
- 不适配任意第三方漫画站
- 仅建议用于学习浏览器扩展与下载流程控制

## 免责声明

本项目仅用于学习与技术研究。使用者需自行遵守目标网站的服务条款、版权要求与相关法律规定。
