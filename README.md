# Open

Open 是一个 Windows 下的便携式“打开方式路由器”。  
它接管网页链接或 HTML 文件后，可以先弹出选择器，让你选择浏览器和配置文件再打开。

## 快速构建与使用

### 环境要求
- Windows
- Node.js 18+

### 快速运行
```bash
npm install
npm start
```

> 注意：使用此方式启动的 Open 无法正常接管网页链接，你必须使用打包版本，仅用于测试目的；

### 打包
```bash
npm run pack
```

打包输出在 `dist` 目录。

## 简单教程
1. 启动后先进入设置页，按欢迎向导走完基础配置。
2. 在“设置默认浏览器”里点击“添加 Open”，再打开系统默认应用页完成默认关联。
3. 在“浏览器”里点击“扫描已安装浏览器”，确认启用你常用的浏览器。
4. 需要的话在“浏览器”中新增自定义浏览器，并用“验证规则”检查可启动性、配置文件和头像检测结果。
5. 用 `npm run link` 或设置页里的测试按钮验证 chooser 是否正常弹出。

## 核心特性
- 链接/HTML 文件统一路由到浏览器选择器
- 浏览器配置文件选择与搜索
- 自定义浏览器规则（可视化编辑 + 预验证）
- 配置文件管理（打开、重命名、复制、删除、会话内撤销）
- 多语言界面（`zh-CN` / `zh-TW` / `en-US`）
- 便携数据目录（`OpenData`）

## 便携模式
- 用户数据保存在 `OpenData` 目录
- 生产环境优先使用可执行文件所在目录
- 开发环境使用当前工作目录

## 浏览器检测与配置文件
- 所有内置浏览器规则来自 `src/main/browsers.json`
- 默认支持：Edge/Chrome/Firefox/Brave/Vivaldi/Chromium（含多个通道）
- 系统浏览器规则只读，启用状态保存在 `systemBrowsers`
- 自定义浏览器规则保存在 `customBrowsers`
- 配置文件删除后写入 `excludedProfiles`，后续扫描默认不再显示

## 开发测试命令
- `npm start`：启动设置页
- `npm run link`：用测试链接拉起 chooser
- `npm run file`：用测试 HTML 文件拉起 chooser

## 项目结构
- `src/main/index.js`：主进程入口（单实例、协议处理、窗口生命周期）
- `src/main/config.js`：配置读写与合并
- `src/main/browsers.js`：浏览器检测、配置文件扫描、启动参数构建
- `src/main/windows-browser.js`：Windows 浏览器注册/清理
- `src/renderer/settings.*`：设置页 UI 与逻辑
- `src/renderer/chooser.*`：选择器 UI 与逻辑
- `src/renderer/manager.*`：配置文件管理视图
- `locales/*`：多语言文案

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=fohog/Open&type=date&legend=top-left)](https://www.star-history.com/#fohog/Open&type=date&legend=top-left)
