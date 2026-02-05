# Open

## 定位
Open 是一款便携式网页链接打开方式管理器，用于在接管网页链接或 HTML 文件后，为用户提供浏览器与配置文件选择。
当前仅支持 Windows。

## 结构
- `src/main/index.js` 主进程入口，负责单实例、协议处理与窗口生命周期
- `src/main/config.js` 本地配置读写与合并
- `src/main/browsers.js` 浏览器检测、配置文件扫描、启动参数构建（由 JSON 驱动）
- `src/main/associations.js` 协议与文件类型注册
- `src/main/windows-browser.js` Windows 浏览器注册与清理
- `src/main/windows.js` 设置窗口与选择器窗口管理
- `src/renderer/settings.html` 设置页 UI
- `src/renderer/settings.js` 设置页逻辑
- `src/renderer/chooser.html` 浏览器选择器 UI
- `src/renderer/chooser.js` 选择器逻辑
- `src/renderer/main.css` 共享样式
- `locales` 多语言文案

## 行为要点
- 启动后直接显示设置页面
- 选择器窗口置顶，失焦即关闭
- 关闭窗口即退出进程
- 退出仅关闭进程，不清理注册
- 打开方式窗口默认可配置：输入框显示链接/搜索/隐藏，配置文件列表列数可设

## UI 规范
- 字体大小仅使用 14 16 18 20
- 间距使用 5 10 12 15 20 30
- 不使用阴影
- 统一使用 12px 8px 圆角
- 1x1 按钮使用 50% 圆角
- 窗口使用 Windows 11 的 mica 效果

## 便携模式
- 用户数据保存在 `OpenData` 目录
- 生产环境优先使用可执行文件所在目录
- 开发环境使用当前工作目录

## 浏览器检测与配置文件
- 所有内置浏览器规则来自 `src/main/browsers.json`
- 默认支持 Edge, Edge Beta, Edge Dev, Edge Canary, Chrome, Chrome Beta, Chrome Dev, Chrome Canary, Firefox, Brave, Vivaldi, Chromium
- 浏览器列表默认仅展示已检测到的浏览器
- 系统浏览器：只读规则、不可编辑；启用/禁用状态保存在 `systemBrowsers`
- 自定义浏览器：规则保存于 `customBrowsers`，可编辑
- 内置浏览器不会写入配置文件（保存时自动剔除）
- Chooser 的 Tabs 使用浏览器 exe 图标显示（不显示文字）；未检测到则显示浏览器图标
- 配置文件删除后会记录到 `excludedProfiles`，后续扫描不会再显示

## 调试模式
- 设置页可开启调试模式以展示全部浏览器
- 也可使用环境变量 `OPEN_DEBUG` 或 `OPEN_DEBUG_MODE` 强制开启

## 环境变量与路径
- Windows 使用 `ProgramFiles`, `ProgramFiles(x86)`, `LOCALAPPDATA`, `APPDATA`

## 协议与文件关联
- 运行时注册 HTTP, HTTPS 协议
- Windows 通过注册表加入系统浏览器列表

## i18n
- 文案位于 `locales`，优先英文，英文为回退
- 支持语言：`zh-CN` / `zh-TW` / `en-US`（设置页可切换语言）

## 开发测试
- `npm install`: 安装依赖
- `npm start`：启动设置页面
- `npm run link`：用测试链接拉起 chooser
- `npm run file`：用测试 HTML 文件拉起 chooser
- 设置页调试模式提供：测试链接打开 / 测试文件打开

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=fohog/Open&type=date&legend=top-left)](https://www.star-history.com/#fohog/Open&type=date&legend=top-left)
