# 个人插件平台：后续 Agent 开发交接

更新日期：2026-11-17。本文覆盖从 `61d1d4c` 之后的个人插件平台开发，包括本次 UI 调整与导出修复。

## 先确认项目与交付边界

- Git 根目录：`E:\0_work\trysomething\Awesome-Agent-Workflow`
- 开发工作目录：`E:\0_work\trysomething\Awesome-Agent-Workflow\desktop`
- 用户交接文档：`E:\0_work\trysomething\AAW-Desktop-项目文档`
- 分支为本地 `main`；用户要求小步迭代、本地提交，**不推送**。接手先执行 `git status --short --branch`，保留用户及其他 Agent 的已有修改。
- 主窗为 Tauri + React + Cordis；Electron 是个人工具、小窗和 CLI 的宿主，整个 AAW 没有迁移到 Electron。
- `tools` 是 AAW 内部 Cordis 插件；用户导入的每个工具是独立个人插件。小窗是统一功能启动器，还包含工作流、工具中心，后续可增加其他主窗功能。

## 代码究竟存在哪里

下列路径均相对 `desktop/`；它们是源码，而不是另外一份独立项目。

| 目录 / 文件 | 职责与修改入口 |
| --- | --- |
| `src/plugins/tools/` | 个人插件平台前端、安装记录、配置、导入导出，是工具中心需求的主要修改目录 |
| `src/plugins/tools/index.ts` | Cordis 插件生命周期、按账号隔离的安装库、保存设置及安装/更新/卸载服务 |
| `src/plugins/tools/service.ts`、`types.ts` | 对外服务及 ToolPackage / settingsSchema 数据契约，跨插件只引用公开入口 |
| `src/plugins/tools/runtime/package.ts` | 解析、规范化与验证 `.aaw-tool.json`，Electron 构建时复用这份契约 |
| `src/plugins/tools/runtime/projectArchive.ts` | 源码 ZIP 生成、导入、项目模板和 Node 构建脚本 |
| `src/plugins/tools/runtime/sourceFiles.ts` | 附加 UTF-8 源码文件、相对路径及文件数量/大小校验 |
| `src/plugins/tools/runtime/settings.ts` | 设置声明、默认值、用户值校验及安全注入脚本；UI 与 CLI 共用 |
| `src/plugins/tools/ui/ToolsPanel.tsx` | 工具中心页面状态、卡片、导入导出、调用宿主打开窗口 |
| `src/plugins/tools/ui/ToolDeveloper.tsx` | 本轮拆出的开发编辑区，只负责输入与操作回调，不自行安装或解析工具 |
| `src/plugins/tools/ui/ToolManagement.tsx` | 单插件管理、schema 表单、源码更新、卸载确认 |
| `src/plugins/tools/ui/tools.css` | 仅 `.aaw-tools` 范围的 UI 样式、字号和容器适配；不修改聊天区全局字号 |
| `src/plugins/tools/ui/sample.ts` | JSON 格式化示例；人类按钮与 AI action 使用同一个函数，支持缩进设置 |
| `src/plugins/tools/ui/workbench.tsx` | 在新标签页、工作台注册工具中心入口 |
| `tools-runtime/` | Electron 源码；小窗及 CLI 的主要修改目录，具体分工见下表 |
| `src-tauri/src/tools_runtime.rs` | 启动/定位 Electron、父进程桥接、白名单导航和 ZIP 文件写入 |
| `src-tauri/src/lib.rs` | 注册原生命令与启动器状态，在主程序启动时启动工具宿主 |
| `src-tauri/tauri.conf.json` | 开发前构建、发行前构建以及 Electron/工作流产物打包配置 |
| `src/plugins/host/` | 前端平台边界：`service.ts` 定义、`index.ts` 提供、`lifecycle/runtime.ts` 实现 Electron 打开/二进制写入/导航应答 |
| `src/plugins/host/window/dialogs.ts` | 文件打开/保存对话框；本轮改为静态导入 Tauri dialog，避免点击时才拉取失效开发缓存 |
| `src/plugins/host/storage/storage.ts` | 原生配置持久化，打开 Electron 前等待配置刷新 |
| `src/plugins/project/workspace/launcherContext.ts` | 小窗入口的项目选择、会话草稿创建/复用策略；通过 `project/service.ts` 暴露 |
| `src/plugins/workbench/navigation/launcher.ts` | 通用启动路由：等待贡献的 prepareGlobalOpen，然后打开面板 |
| `src/plugins/workbench/types.ts`、`index.ts` | PanelLauncher 准备契约、接收原生导航事件 |
| `src/plugins/workflow/ui/workbench.tsx` | AAW 工作流入口声明需要会话准备，继续复用既有工作流服务 |
| `src/bootstrap/bootstrap.ts`、`installDesktopWorkbench.ts` | 安装 tools 服务与工作台贡献；不要绕过既有装配顺序 |
| `vite.config.ts`、`playwright.config.ts` | 本轮隔离开发与视觉测试的依赖缓存，视觉服务器使用 visual mode |
| `package.json`、`package-lock.json` | fflate、Electron 与开发脚本依赖，修改依赖时同步锁文件 |

### Electron 各模块

| 文件 | 责任 |
| --- | --- |
| `tools-runtime/main.mjs` | Electron 主进程、单实例、窗口尺寸、托盘、快捷键、IPC、父进程监控 |
| `tools-runtime/launcher.html` / `.css` / `.js` | 小窗展示、字号、搜索、固定、最近使用、设置及键盘交互 |
| `tools-runtime/launcher-registry.mjs` | Provider 注册、账号目录、固定、MRU、快捷键保存/冲突回滚 |
| `tools-runtime/preload.cjs` | 受控 renderer API；不要直接暴露 Node 或任意原生命令 |
| `tools-runtime/desktop-bridge.mjs` | 带令牌的本机路由连接，只开放允许的主窗入口 |
| `tools-runtime/catalog.mjs` | 从 AAW 配置读取当前账号插件、用户设置和最近使用 |
| `tools-runtime/runtime.mjs` | 沙箱工具窗口、配置注入、隐藏窗口执行 action |
| `tools-runtime/cli.mjs` | `list` / `describe` / `run` 命令及 JSON 输入输出 |
| `tools-runtime/aaw-tools.cmd` | Windows 发行版 CLI 包装器 |
| `tools-runtime/package.json` | Electron 应用入口元信息 |

### 构建与验证脚本

- `scripts/build-tools-runtime.mjs`：把 Electron 源码拷贝到产物目录，并把 TypeScript 工具契约打包为 `package-contract.mjs`。
- `scripts/tools-cli.mjs`：开发环境 CLI / 独立小窗入口。
- `scripts/test-tools-runtime.mjs`：真实 Electron CLI、配置及源码项目构建冒烟测试。
- `scripts/test-launcher.mjs`：Provider、账号隔离、MRU、固定、快捷键回滚测试。
- `scripts/test-launcher-ui.mjs`：真实 Electron 搜索/固定/尺寸/快捷键/打开工具测试，使用临时账号和独立 profile。
- `tests/plugins/tools/`：工具库、ZIP、配置和页面操作回归。
- `tests/plugins/project/launcherContext.test.ts`：无会话创建、已存在草稿复用、目录选择取消。
- `tests/plugins/workbench/launcher.test.ts`：贡献导航与生命周期。
- `tests/plugins/host/hostLifecycle.test.ts`：原生对话框和宿主生命周期。
- `tests/visual/toolsFixture.{html,tsx}`、`tools.pw.ts`：真实浏览器中的工具中心/开发/管理布局、交互及 ZIP 下载。
- `tests/architecture/`：跨插件依赖、统一控件、宿主边界等架构规则。

## 不要编辑构建产物

| 路径 | 含义 |
| --- | --- |
| `tools-runtime/dist/` | Electron 可运行分发目录；修改源码后用 `npm.cmd run tools:build` 重建，不能只改这里 |
| `src-tauri/target/debug/desktop.exe` | 本地原生调试程序，源文件在 `src-tauri/src/` |
| `dist/` | Vite 生产前端产物 |
| `node_modules/.cache/vite-development/` | 主开发服务器依赖缓存 |
| `node_modules/.cache/vite-visual/` | 视觉测试专用缓存，不能与开发服务器共用 |
| `node_modules/.cache/tools-*.png`、`launcher-compact.png` | 本地 UI 检查截图，不入版本库 |

## 用户插件数据不在源码目录

Windows 默认根目录是 `%LOCALAPPDATA%\com.aaw.desktop`，本机展开为 `C:\Users\14993\AppData\Local\com.aaw.desktop`。

- `storage-location.json` 若存在，以其 `active` 配置确定实际数据位置。
- 实际数据位置下 `configuration/preferences.json`：当前登录身份和插件库。插件库键为 `aaw-desktop.personal-tools.v1`，按 `user:<id>` 分组；不要把此文件提交到 Git 或复制进交接文档。
- `configuration/tools-recent.json`：个人工具最近使用。
- 默认根目录 `launcher-settings.json`：本机快捷键、账号固定项与启动器 MRU。
- `launcher-profile/`：Electron 用户 profile，`EBWebView/` 是主窗 WebView 数据。
- 源码 ZIP 由用户选择保存目录，没有自动放进仓库。仅导出插件声明、默认配置和源码，不导出用户填写的配置值。

## 目前的产品规则

1. 卡片「打开」直接打开 Electron；「管理」打开主窗管理页。管理页支持源码 ZIP 导出、同 ID 更新、设置和卸载。
2. 小窗统一展示内置功能与个人插件；AAW 和工具中心 `trackRecent: false`，历史 MRU 同样忽略。用户固定的个人工具仍可出现在最近使用。
3. 全局快捷键默认 Alt+Space，可自定义；注册失败保留原快捷键，托盘仍可打开。
4. `prepareGlobalOpen` 返回项目路径或 null（取消）。项目服务负责选目录与会话；小窗 UI 不写项目/会话分支。
5. 无会话时同步创建草稿，异步连接 agent；连接失败保留草稿，不阻止面板导航。打开工作流不等于启动工作流任务。
6. `window.aawSettings` 和 `window.aawActions` 是个人插件的人机共用接口。设置保存后重新打开生效。
7. 当前个人工具为自包含 HTML / JS / CSS 沙箱，未开放 Node、任意文件、网络请求及 Electron API。团队、市场、签名分发尚未实现。

## 本轮 UI 和导出问题

用户截图中小窗搜索过大、开发按钮无充分内边距，开发区还继承了聊天字号。本轮搜索由 23px 改为 17px，小窗默认由 860×410 改为 800×360 DIP；图标 36px，标题/正文/辅助文字分级。工具中心使用局部字号 token，避免全局 20px 会话偏好把工具控件放大。新增 `ToolDeveloper` 将文件栏、编辑区、状态栏、说明及操作区分开。

用户提供的导出错误为 `Failed to fetch dynamically imported module: http://localhost:1420/node_modules/.vite/deps/@tauri-apps_plugin-dialog.js?...`。失败发生在对话框依赖加载，尚未写 ZIP。两台 Vite 服务器共用默认缓存是可见的风险来源：视觉测试可能使正在运行的主窗依赖 URL 失效。本轮按 mode 隔离缓存，并静态导入 `open/save`，同时保留取消提示、导出错误提示与进行中按钮禁用。视觉测试结束后，开发服务器新 dialog 模块 URL 实测返回 HTTP 200。

若旧窗口仍持有旧 URL，先保存未安装的工具源码，再关闭重开 AAW。修改 Electron 源码后还需重建并重启 Electron 宿主；仅 React 热更新不会更新已经运行的小窗主进程。

## 启动与验证

在 `desktop` 下执行：

```powershell
# 完整开发，自动构建工作流和 Electron，再启动 Vite / Tauri
npm.cmd run tauri dev

# 已有原生构建时：终端 1，保持运行
npm.cmd run tools:build
npm.cmd run dev

# 另一个终端，只在已有构建时使用
.\src-tauri\target\debug\desktop.exe
```

不要同时启动两份 1420 开发服务器。若 Rust MSVC 环境缺失，使用本机 Visual Studio Build Tools 的开发者终端；之前已通过 Windows debug 构建。本轮前端和 Electron UI 变更不需要改 Rust。

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run tools:build
node --test scripts/test-launcher.mjs
npm.cmd run tools:test
node scripts/test-launcher-ui.mjs
npx.cmd playwright test tests/visual/tools.pw.ts
```

浏览器视觉测试通过不等于原生文件对话框已人工验收。当前 Windows 自动化接口曾反复报 `foreground window did not report a process id`，不得把无法执行的原生点击记为通过。本机截图同时存在 `icode program not found`，这是 agent 环境问题；插件界面可以使用，但真实 agent 会话和工作流执行仍需要有效的 agent 安装及配置。

## 下一位 Agent 的工作顺序

先读本文、`personal-tools.md`、`unified-launcher.md` 以及外部文档中的最新操作记录；检查 Git 状态与当前进程，再定位用户问题所属层。界面改动优先复用统一控件并用局部 CSS；新增功能通过服务契约和贡献扩展；修复后执行相关检查、查看截图，记录未验证项，再小步本地提交。不得清理用户安装库、登录态或源码草稿来使测试通过。

用户已要求每小时从设计者视角巡检，普通可逆实现选择按推荐方案执行；持续记录到外部 `16-设计巡检与操作日志.md`。调度由 Codex 自动化管理，状态以自动化配置为准，不能把文档视为任务已创建的证据。

## 本轮本地提交与验证

- `c4a714c`：隔离 Vite 缓存、提前加载原生文件对话框。
- `fe3f5b7`：小窗紧凑排版、开发区组件与字号、导出反馈及验证。
- TypeScript、改动范围 ESLint、Vite 构建通过。相关 Vitest 15 个文件 / 53 项通过；视觉检查 7 项通过（含真实浏览器 ZIP 下载和重新解析）；Electron UI、CLI、注册表 3 项测试通过。
- 每小时巡检自动化已创建并为 ACTIVE，ID 为 `aaw`；执行与操作日志见外部 16 号文档。

## 累计变更文件清单

相对 Git 根目录，基线 `61d1d4c`。此列表只列个人插件平台迭代改动，后续新增文件应同步更新。

```text
desktop/README.md
desktop/docs/architecture/cordis-plugin-dependencies.md
desktop/docs/architecture/cordis-plugin-dependencies.mmd
desktop/docs/features/personal-tools.md
desktop/docs/features/plugin-platform-handoff.md
desktop/docs/features/unified-launcher.md
desktop/package-lock.json
desktop/package.json
desktop/playwright.config.ts
desktop/scripts/build-tools-runtime.mjs
desktop/scripts/test-launcher-ui.mjs
desktop/scripts/test-launcher.mjs
desktop/scripts/test-tools-runtime.mjs
desktop/scripts/tools-cli.mjs
desktop/src-tauri/src/lib.rs
desktop/src-tauri/src/tools_runtime.rs
desktop/src-tauri/tauri.conf.json
desktop/src/bootstrap/bootstrap.ts
desktop/src/bootstrap/installDesktopWorkbench.ts
desktop/src/plugins/host/index.ts
desktop/src/plugins/host/lifecycle/runtime.ts
desktop/src/plugins/host/service.ts
desktop/src/plugins/host/storage/storage.ts
desktop/src/plugins/host/window/dialogs.ts
desktop/src/plugins/project/service.ts
desktop/src/plugins/project/workspace/launcherContext.ts
desktop/src/plugins/tools/index.ts
desktop/src/plugins/tools/runtime/package.ts
desktop/src/plugins/tools/runtime/projectArchive.ts
desktop/src/plugins/tools/runtime/settings.ts
desktop/src/plugins/tools/runtime/sourceFiles.ts
desktop/src/plugins/tools/service.ts
desktop/src/plugins/tools/types.ts
desktop/src/plugins/tools/ui/ToolDeveloper.tsx
desktop/src/plugins/tools/ui/ToolManagement.tsx
desktop/src/plugins/tools/ui/ToolsPanel.tsx
desktop/src/plugins/tools/ui/sample.ts
desktop/src/plugins/tools/ui/tools.css
desktop/src/plugins/tools/ui/workbench.tsx
desktop/src/plugins/workbench/index.ts
desktop/src/plugins/workbench/navigation/launcher.ts
desktop/src/plugins/workbench/types.ts
desktop/src/plugins/workflow/ui/workbench.tsx
desktop/tests/architecture/cordisArchitecture.test.ts
desktop/tests/plugins/project/launcherContext.test.ts
desktop/tests/plugins/tools/ToolsPanel.test.tsx
desktop/tests/plugins/tools/projectArchive.test.ts
desktop/tests/plugins/tools/tools.test.ts
desktop/tests/plugins/workbench/launcher.test.ts
desktop/tests/visual/tools.pw.ts
desktop/tests/visual/toolsFixture.html
desktop/tests/visual/toolsFixture.tsx
desktop/tools-runtime/aaw-tools.cmd
desktop/tools-runtime/catalog.mjs
desktop/tools-runtime/cli.mjs
desktop/tools-runtime/desktop-bridge.mjs
desktop/tools-runtime/launcher-registry.mjs
desktop/tools-runtime/launcher.css
desktop/tools-runtime/launcher.html
desktop/tools-runtime/launcher.js
desktop/tools-runtime/main.mjs
desktop/tools-runtime/package.json
desktop/tools-runtime/preload.cjs
desktop/tools-runtime/runtime.mjs
desktop/vite.config.ts
```

## 2026-11-17 01:51 巡检修复：源码模板大小写冲突

源码导出合并 README、package.json、scripts/build.mjs 模板时，按不区分大小写判断作者是否已经提供对应文件；已有作者文件优先且保留原路径和内容。避免有效的 readme.md / PACKAGE.JSON 等与自动模板形成 Windows 重复路径，导致导出的 ZIP 无法重新导入。回归覆盖导出、重新导入、再次导出，不修改真实用户安装库。

## 2026-11-17 02:51 巡检修复：管理页未保存设置保护

ToolManagement 的返回、编辑工具包、已选择文件的更新源码共用 requestAction 待确认动作。设置有修改时先提示并聚焦“继续编辑”，取消保留输入，只有明确放弃后执行原动作；没有修改时直接执行。不能把用户选文件等同于同意丢弃当前设置。打开插件、导出等不离开管理页的操作不增加无关确认。

## 2026-11-17 10:14 巡检修复：Windows 源码文件名校验

共享 safeSourcePath 补齐对 `< > " | ? *` 的拒绝；JSON sourceFiles 和 ZIP 导入同时适用，避免导出 Windows 无法正常解压的文件名。中文、空格、括号和加号等合法名称继续支持。回归覆盖两条导入路径及合法中文文件名往返。

此项收紧已有校验：此前导入且包含上述非法文件名的包，重新解析时会被判为无效；没有自动改名或迁移、删除用户数据。若遇到这类旧包，应保留备份，在源码中修正文件名及引用后重新导入。Electron 使用构建后的 package-contract.mjs；本轮未覆盖正在运行的产物或重启主窗，下次启动完整开发流程时会重建契约。

## 2026-11-17 11:18 巡检修复：新增运行时模块遗漏打包

在 1e4bed3 / e1f9f8d / 830920b 后检查发现 launcher-registry.mjs 已依赖 tone.mjs，而旧构建白名单不复制它。scripts/build-tools-runtime.mjs 现在自动复制 tools-runtime 顶层的 mjs/cjs/js/html/css 文件与 package.json，仍单独生成 package-contract.mjs、复制图标和 Windows 包装器；不复制 dist 子目录。

构建支持可选环境变量 AAW_TOOLS_BUILD_DIR 指定独立产物目录（默认仍是 tools-runtime/dist），供验证全新构建且避免覆盖正在使用的产物。此次在临时目录实测旧规则构建成功但 import registry 报 ERR_MODULE_NOT_FOUND，修复后新 registry 加载和实际 Electron --aaw-cli help 均通过。检查新功能时不能把旧 dist 测试通过视为新源码验收。

近期其他本地提交新增入口：tools-runtime/tone.mjs 为启动器颜色/图标规则；src/plugins/tools/ui/mark.ts 为工具中心镜像规则；ui/aiPrompt.ts 提供 AI 提示词与输出提取。它们来自本轮之前的本地提交，本轮保留其实现，未修改 UI。

## 2026-11-17 14:28 未解决：账号目录映射冲突

复现基线345e62c。runtime/project.ts 的 toolOwnerSegment 把不同字符统一替换为下划线，映射不是一对一：alice@example.com 与 alice_example.com 都变成 alice_example.com。在不访问真实磁盘的内存IO中，以前者创建 private-tool 后，listToolProjects(owner=后者) 返回了前者的项目路径。现有 project.test.ts 10项通过，未覆盖这类账号。Windows目录大小写不敏感也是后续编码设计需要覆盖的条件。

tools-runtime/tool-storage.mjs 的 ownerSegment 使用相同替换规则，因此持久化数据目录也具有同名映射问题（本轮仅静态核对该处，没有对真实存储做跨账号实验）。本轮没有证据表明本机真实账号已受影响，也没有读取真实工具数据来判断。

推荐修复边界：项目源码与工具持久化共同使用稳定、不会因替换/大小写丢失身份信息的目录键，并覆盖特殊字符和大小写账号的隔离回归；迁移需要保留原目录和备份。已有冲突目录无法从目录名恢复唯一归属，不可把内容自动复制给两个账号或按当前登录账号抢占；这部分需明确归属后迁移。仅替换函数会使旧数据暂时不可见，不可称为无损修复。

状态：已复现，未修复。后续Agent优先处理此项；本轮未更名、搬移、覆盖或删除用户目录。

## 2026-11-17 16:28 修复：内存文件适配器写入卡死

runtime/io.ts 的 memoryToolIO.writeTextFile 向上补齐父目录时，循环必须比较当前子目录和父目录；不能一直和原文件路径比较。原实现在相对路径到达 tools 后，parentOf(tools)仍是tools，循环不终止。已在独立Node进程中复现2秒超时，修复后项目创建/改名和工具升级回滚的相关18项测试通过。

新增 tests/plugins/tools/io.test.ts 覆盖相对工具路径、目录枚举、裸文件名与Windows/POSIX绝对路径终止。本修复仅影响内存适配器（测试与无宿主预览），不改变真实宿主文件写入；账号目录冲突仍是独立未解决问题。

## 2026-11-17 18:26 修复：异步版本回退跨账号执行

src/plugins/tools/index.ts 的 rollback 在首次await之前记住发起用户；备份队列等待结束和备份读取结束后，分别检查当前用户是否仍相同。切换/退出登录即抛出可展示的取消提示，不安装任何备份。工坊已有错误处理会显示此提示。

tests/plugins/tools/tools.test.ts 覆盖等待队列和读取文件两个时间窗口，确认两个账号的同名工具均保持原版本。修复前可复现A发起回退、立即切B，B从2.1.0错误回退到2.0.0。本项不改变账号目录编码，不能替代14:28记录的目录碰撞修复。

## 2026-11-17 20:28 修复：源码ZIP边界往返

runtime/projectArchive.ts 添加自动README前，按实际重导入的JSON校验文件数与字节数；若会超过64个sourceFiles或512 KB工具包上限，仅省略生成的说明，保留全部作者文件、HTML与清单。普通小包仍生成README，作者自己提供的README继续优先且不会被删除。

导入没有附加文件的源码ZIP时，不额外写入空sourceFiles字段，避免恰好512 KB的合法包因无意义元数据超过上限。projectArchive.test.ts新增64文件、接近字节上限和精确字节上限三种往返回归。未放宽原有导入限制，不影响账号目录编码；已知账号目录碰撞仍待单独解决。

## 2026-11-17 21:31 修复：快捷键输入框的键盘陷阱

launcher.js 捕获快捷键时，保留普通Tab/Shift+Tab的焦点导航和普通Enter的表单提交；其余组合键继续按原规则捕获。原实现无条件preventDefault，使输入框无法用Tab离开，并把Enter误报为不支持的快捷键主键。

launcherPage.test.ts增加事件默认行为回归。无头Edge加载真实小窗HTML/JS/CSS，实测输入组合键后Tab到保存按钮、Shift+Tab返回、Enter提交，模拟IPC仅收到一次新快捷键。未注册真实快捷键、未改主窗；运行中Electron需后续构建/重启加载新脚本。

## 2026-11-17 23:33 修复：备用快捷键别名与自身冲突

最新快捷键控制器位于 tools-runtime/shortcut.mjs，配套类型声明 shortcut.d.mts，注册表再导出接口。启动备用组合与用户输入统一走 normalizeShortcut 后再注册、保存和比较，避免 Ctrl+Alt+Space 与 Control+Alt+Space 被误判为两组键而重复注册。

launcherShortcut.test.ts 的注册模拟按标准化结果识别同一热键，新增默认键冲突后选用备用键、再次保存同一备用键的回归；原实现会误报被其他程序占用。本轮不修改录制让位/恢复时机，也未注册真实系统快捷键。
