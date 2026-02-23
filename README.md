# Kmoe Download

一个基于 Chrome 扩展的章节批量下载工具，支持下载队列控制与历史记录管理。

Kmoe Download 是一个用于结构化章节下载的浏览器扩展项目，重点实现下载任务调度、并发控制与历史记录管理。

本项目主要用于浏览器扩展开发与下载流程控制实践。

---

## ✨ 功能特性

- 批量选择章节下载
- 任务队列调度机制
- 可配置并发数量控制
- 自动重试失败任务
- 下载记录持久化
- 独立历史记录页面管理
- 页面数据桥接

---

## 📦 安装方式

### 开发者模式加载

1. 克隆仓库：

   ```bash
   git clone https://github.com/Fyhax1ki/kmoe-download.git
   ```

2. 打开 Chrome 浏览器，进入：

   ```
   chrome://extensions/
   ```

3. 开启右上角「开发者模式」  
4. 点击「加载已解压的扩展程序」  
5. 选择项目根目录

---

## 🚀 使用方法

1. 打开支持的漫画详情页面  
2. 打开扩展弹窗  
3. 选择章节与下载参数  
4. 启动下载任务  
5. 在历史页面查看记录

所有下载任务均通过内部队列调度执行，避免瞬时请求过载。

---

## 🏗 项目结构

```
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

---

## 🧠 下载调度机制

- 基于任务队列顺序执行
- 支持并发数量控制
- 失败任务有限重试
- 下载状态记录与同步

---

## 🔒 设计原则

- 不绕过站点权限验证
- 不进行后台自动抓取
- 不暴露内部接口细节
- 下载行为仅在用户主动触发时执行
- 尽量减少对来源服务器的压力

---

## 🛠 开发说明

本项目为原生 Chrome Extension 结构，无需额外构建工具。

修改建议：

- 下载逻辑：`content/content.js`
- UI 交互：`popup/`
- 历史记录：`history/`
- 页面桥接：`scripts/page-bridge.js`
- 权限配置：`manifest.json`

---

## 📌 免责声明

本项目仅用于学习与技术研究用途。  
使用者需自行遵守相关网站的服务条款与法律规定。
