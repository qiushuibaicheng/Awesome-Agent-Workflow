# 工具中心第五轮：可读性、启动性能、以及"工具到底是什么"

四条界面反馈、一次性能追问，一次做完。本文记录改法、跨层接缝、性能根因与验证证据，方便下一位接手的人接着改。

## 1. 插件管理页：四张大卡片 → 分组设置页

右栏只有 360px，而每一节都是 `.management-card`：`22px` 内边距 + 边框 + 圆角 + 底色，标题、副标题、内容、按钮各占一行，一屏只放得下一节，找个「导出源码」要翻半天。

改成 `.mg-row` 两列：**左列 168px 是分组名与一句说明，右列是内容**，中间只用一条细线分隔；窄栏（容器 ≤560px）自动折成上下两块。元数据从两列 `<dl>` 改成一行一个键值的紧凑表；「无设置 / 无动作」从带图标的大空块压成一行浅色提示；hero 图标 56→44px、标题 21→18px。所有功能、按钮、`aria-labelledby`、表单 label 都保留，视觉用例 11/11 通过。

## 2. 三处延迟：底层原因**不完全一样**

用户明确问「这些性能问题的底层原因一样吗」。答案：**不一样，但同属"临到用时才创建"的懒初始化，而且 Rust ↔ 前端 ↔ Electron 三段是串行等的**。

| 场景 | 时间真正花在哪 | 性质 | 改法 |
|---|---|---|---|
| 第一次按 `Alt+Space` | 首次按键才 `new BrowserWindow` + Chromium 渲染进程 + `loadFile` + 首帧 | **一次性**冷启动，之后复用窗口就快 | 后台宿主一就绪就预热启动器窗口（隐藏），按键只剩 `show()` 和一次刷新 |
| 启动器里点「工具中心」 | Rust 桥接要等前端 `open()` 全部完成才 `window.show()`；而后台 WebView 的 JS 还会被 Chromium 节流 | **每次都发生** | 收到请求**立刻** show / unminimize / set_focus，再异步等 `launcher_reply` |
| 点「开发指导」 | 每次 `spawn` 一个完整 Electron 进程，只为让单实例锁把 `--aaw-guide` 转发给已经在跑的宿主 | **每次都发生**，量级最大（1~2 秒） | 宿主启动时建立**常驻命令通道**，Rust 直接写一行命令，不再起进程；文档窗口本身仍复用 |

所以：前两个是"第一次/每次才创建窗口与唤醒"，第三个是"每次都拉起整个进程"，不是一个量级；共同点是把初始化排在用户眼前，且跨进程链路串行等待。修法也统一成三个词：**预热、复用、提前唤醒**。

跨层接缝：

- `tools-runtime/main.mjs`：抽出 `ensureLauncher()` + `launcherReady/pendingShow`，只有 `--aaw-background` 常驻宿主预热小窗（带 `--aaw-guide` / `--aaw-open` 直接启动的实例不需要它，提前建反而抢焦点）。`applyIntent(command)` 把命令行参数、单实例转发、命令通道三处动作统一。`connectCommandChannel()` 用 `AAW_LAUNCHER_PORT/TOKEN` 连上桥并注册 `kind:"host"`，断线自动重连。
- `src-tauri/src/tools_runtime.rs`：`LauncherRoutes` 新增 `host: Mutex<Option<TcpStream>>`；bridge 线程识别 `kind:"host"` 把连接留下；新 `send_command()` 直接写意图，`launch()` 优先走它，写失败清掉死连接并**退回原来的 spawn 转发**（功能不会丢）。bridge 收到 `aaw/tools` 请求时先叫醒主窗口再 emit。
- `tools-runtime/catalog.mjs`：`preferences.json` 里存着每个工具的完整 HTML（可达几 MB），改成按 `mtimeMs/ctimeMs/size` 指纹缓存配置解析，取代上一轮的 1 秒 TTL 猜测——**装新工具、改主题、点固定立刻失效，连续唤起零解析**。`launcher-registry.mjs` 的目录快照也改成按同一指纹 + `launcher-settings.json` 指纹失效，保证「最近使用」排序仍然实时。
- 端到端验证脚本 `scripts/verify-tools-command-channel.cjs`（`npm run tools:verify-channel`）：起一个本地 TCP server 扮演桥，驱动真实 Electron 以 `--aaw-background` 启动，验证注册、预热、下发 `--aaw-guide` 开窗、二次下发不新建窗口、下发 `--aaw-launcher` 显示面板。

## 3. 「一个工具是什么」：从技术限制改成能力版图

原来只有两句「单页、自包含、无后端：一个 `index.html` 装下全部 HTML/CSS/JS」。用户对照 uTools 的插件觉得这把工具说得太简单，举了剪切板类工具为例——这个批评是对的：**那两行是技术约束，不是工具的定义**。

`guide.ts` 是同源正文（人读窗口 / 项目 `AGENTS.md` / AI 技能 `SKILL.md` 都从它生成），改一处即可：

- 定位改成「随叫随到、独立完成一件事的小程序：有界面、能从工具中心或启动器打开、也能被 AI 通过命令调用」。
- 新增**五类场景表**：文本与数据处理、剪切板与输入增强、计算与查阅、文件与小批处理、个人留存，每类给具体例子。
- 能力边界写明白：能读写剪切板、选文件、留存数据、按声明联网；**不能**常驻后台、装 npm 包、读任意路径、弹通知或调摄像头，以及为什么（一个 ZIP 要能在别人机器上直接装、直接跑）。
- 技术约束降格为「边界」，并强调人机共用同一个 `aawActions` 函数。

**不撒谎**：既然写了「剪切板历史」，就得让它真的做得出来。原来 session 层已允许 `clipboard-read` / `clipboard-sanitized-write`，但只靠 `navigator.clipboard` 需要用户手势，AI 在隐藏窗口里执行动作时拿不到。补上第五个运行时入口：

- `tool-preload.cjs` 暴露 `window.aawClipboard.readText() / writeText(text)`；
- `main.mjs` 的 `installToolIpc` 加两个 handler，走主进程 `clipboard`，校验来源必须是工具窗口、只处理纯文本、上限 1 MB；
- 指导里「四个入口」改「五个入口」，说明 `aawClipboard` 优先于 `navigator.clipboard`，自检清单加一条「用到剪切板时是用户主动触发的，不是打开就偷偷读」；
- `scripts/test-tools-runtime.mjs` 加跨进程探针：写入 → 另一个进程读回 → **把用户原来的剪切板内容写回去**。

## 4. 目录打不开 + 重复入口

- 报错 `opener.open_path not allowed. Permissions associated with this command: opener:allow-open-path`：`capabilities/default.json` 只有 `opener:default`，缺具体权限。补上 `opener:allow-open-path` 与 `opener:allow-reveal-item-in-dir`（两个标识符都在 `gen/schemas/desktop-schema.json` 里）。**注意 capability 是编译期烘焙进产物的，必须重新构建/打包桌面端才会生效。**
- 「新建工具」顶部按钮和「制作工具」页签是同一个界面，两个入口只会让人以为点了会去别的地方：**删掉顶部按钮**，页签改名 **「开发工具」**。相关文案全项目统一（`guide.ts` 的「从这里开始」、安装冲突提示、迁移提示、预览提示、`aiPrompt.ts` 注释、`personal-tools.md`、两处测试断言）。空状态里的 CTA 改成「开始做工具 →」，仍指向同一个页签。

## 5. 空状态：一次讲清价值，而不是"什么都没有"

- 已安装为空：原来是虚线框 + 一行灰字 + 两个按钮。改成柔和光晕 + **三步预期**（说清要做什么 → AI 写好并自动校验 → 验收后随时打开）+ 一句具体例子 + 明确主按钮 + 导入/指导的补充说明。
- 一并检查并统一了同类场景：项目列表空（图标 + 说明 + `manifest.json / index.html / AGENTS.md` 文件名提示）、搜索无结果（原因 + 「清空搜索」）、管理页「无设置 / 无动作」（一行浅色提示）。

## 6. 验证

| 项目 | 结果 |
|---|---|
| `tsc --noEmit` / 改动文件 ESLint | 通过 |
| 全量 `vitest run --maxWorkers=4` | 271 文件 / **2038 测试 0 错误** |
| `npm run build`（tsc + vite） / `cargo check` | 通过（Rust 仅 1 条既有 deprecated 警告） |
| `npm run tools:build` / `tools:test` | 通过（新增剪切板跨进程探针） |
| `playwright test tests/visual/tools.pw.ts` | **11/11**（360 / 740 / 1100 × 深 / 浅主题） |
| 指导文档窗口产物 | 9 分节 / 9 条目录 / 2 张表格，含 uTools 场景表与 `aawClipboard` |
| `npm run tools:verify-channel`（新） | **PASS**：注册、预热、命令开窗、窗口复用、命令唤起面板 |
| `npm run tools:verify-shortcut` | PASS：9 条硬断言全通过；两条 `Alt+Space` 断言见下方限制 |

## 7. 已知限制 / 留给实机确认

- **capability 不是热更新**：`opener:allow-open-path` 要重新构建或打包桌面端才生效；在旧产物上点目录仍会报权限错。
- **全局热键是机器级独占资源**：本机若已经跑着一个 AAW（`--aaw-background` 常驻宿主），验证实例连默认 `Alt+Space` 都注册不上，更不可能再临时占住它。`tools:verify-shortcut` 现在会明确打印 `SKIP` 并把这两条从判定里剔除，**干净环境会自动恢复严格断言**，其余 9 条不受影响。上一轮已在无占用环境验证过该行为。
- 命令通道断开时（宿主进程被杀 / 主窗口重启），Rust 会退回 spawn 转发，功能不丢但那一次会慢；Electron 侧 1.5 秒后自动重连。
- 指导窗口复用时沿用打开那一刻的主题；换了主题后关掉重开即可（本轮没有预热该窗口，避免多占一个常驻渲染进程）。
- 实机还需要看一眼：980×720 指导窗口在 125% / 150% 缩放下的表格与代码区；紧凑行「⋯」菜单是否遮挡相邻行。
