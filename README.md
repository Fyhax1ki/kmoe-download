# Kmoe Download

Kmoe 漫画下载 Chrome 扩展，支持批量下载漫画章节。

## 功能特性

- 批量选择章节下载
- 支持 MOBI 和 EPUB 格式
- 按分类分组显示章节
- 显示文件大小和下载进度
- 额度检查，超出额度时禁用下载
- 自动重试失败的下载

## 安装

1. 下载或克隆本项目
2. 打开 Chrome 浏览器，访问 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择本项目目录

## 使用方法

1. 访问 Kmoe 网站的漫画详情页
2. 点击页面上的「Kmoe-Download」按钮
3. 选择文件格式（MOBI/EPUB）
4. 勾选需要下载的章节
5. 点击「开始下载」

## 支持的网站

- kxx.moe
- kxo.moe
- mox.moe
- koz.moe
- kox.moe
- kzo.moe
- kzz.moe

## 项目结构

```
kmoe-download/
├── content/
│   ├── content.js      # 主要逻辑代码
│   └── content.css     # 样式文件
├── scripts/
│   └── page-bridge.js  # 页面数据桥接脚本
├── icons/
│   └── Kmoe BatchDL.png
└── manifest.json       # 扩展配置文件
```

## 技术说明

### 数据获取

扩展通过注入 `page-bridge.js` 脚本到页面上下文中，获取 `window.arr_voldata` 等变量，然后通过 `window.postMessage` 传递给 content script。

### 下载流程

1. 调用 `/getdownurl.php` API 获取下载链接
2. 使用 XMLHttpRequest 下载文件（避免 CORS 问题）
3. 下载完成后通过 Blob URL 触发浏览器保存

### 章节数据结构

```javascript
{
  id: string,       // 章节 ID
  category: string, // 分类名称
  name: string,     // 章节名称
  mobiSize: number, // MOBI 文件大小 (MB)
  epubSize: number  // EPUB 文件大小 (MB)
}
```

## 注意事项

- 下载速度受服务器限制，建议不要选择过多章节
- 429 错误会自动重试，最多 5 次
- 非会员用户不支持真正的批量下载，扩展会逐个下载

## 许可证

MIT License
