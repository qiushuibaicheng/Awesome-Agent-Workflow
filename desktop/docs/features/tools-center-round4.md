# 工具中心第四轮整改（2026-11-17）

四条反馈一次做完：开发指导要让人看得见、去掉多余的「开发模式」、已安装列表太占地方且导出文案有歧义、以及整体性能偏慢。本文记录改法、跨层接缝和验证证据，方便下一个接手的人接着改。

## 1. 开发指导从「装进技能目录」变成能打开的窗口

原来工具中心只有一个「安装规范」按钮：正文写进 AI 技能目录，人看不到内容，界面上就是一句「导入规范」。现在：

- 内容源统一到 `src/plugins/tools/runtime/guide.ts`。`toolGuide()` 给项目 `AGENTS.md`，`humanGuide()` 给人读的窗口，两者共用 `guideBody()`，所以「人读的」和「AI 读的」不会各说一套。
- `scripts/guide-render.mjs` 在构建期把 Markdown 渲成静态 HTML（标题、目录、表格、代码块、清单），`scripts/build-tools-runtime.mjs` 用 `guideEntry.ts` 取出正文，套 `tools-runtime/guide.html` 模板，写进 `dist/resources/app/guide.html`。**运行期不带 markdown 解析器**，打开即显示，脚本失败也不会白屏。
- 窗口是独立的 Electron `BrowserWindow`（`tools-runtime/main.mjs` 的 `openGuide()`），980×720、跟随主窗主题、目录用 `IntersectionObserver` 高亮、页内锚点不触发导航。
- 入口在工具中心顶部「开发指导 ↗」，走 `HostService.openToolsGuide()` → Tauri 命令 `tools_open_guide` → 复用**同一个**工具宿主进程并带 `--aaw-guide`。没有新增第二个 Electron 实例。

跨层清单（改这里时要一起动）：

| 层 | 文件 | 作用 |
|---|---|---|
| 内容 | `src/plugins/tools/runtime/guide.ts`、`guideEntry.ts` | 唯一正文源，构建期导出 Markdown |
| 构建 | `scripts/guide-render.mjs`、`scripts/build-tools-runtime.mjs` | 渲染并复制 `guide.html/css/js` 进 dist |
| 窗口 | `tools-runtime/guide.html`、`guide.css`、`guide.js`、`main.mjs` | 版式、目录、主题、单实例打开 |
| 宿主 | `src/plugins/host/service.ts`、`lifecycle/runtime.ts`、`index.ts` | 新增 `openToolsGuide()`，浏览器预览模式明确报错 |
| 原生 | `src-tauri/src/tools_runtime.rs`、`lib.rs` | `tools_open_guide` → `launch(..., Some("--aaw-guide"))` |
| 界面 | `src/plugins/tools/ui/ToolsPanel.tsx` | 顶部入口按钮 |

## 2. 去掉「开发模式」，「工具项目」改叫「制作工具」

既然一句话描述就能让 AI 建项目、写 `manifest.json` 和 `index.html`、自动回灌校验，再留一个手写 JSON 的编辑器就是两条路做同一件事。删掉 `ToolDeveloper.tsx` 与 `View.kind === "developer"`，三个页签收成两个；卡片菜单里的「编辑工具包」同步移除；`sample.ts`、`parseToolPackage()` 不再被面板引用。安装冲突文案里的「请在开发模式中更新」改成「请在管理页更新源码」。

目录不再只是一行灰色文字：`project.ts` 的 `listToolProjectSummaries()` 返回默认根目录，`ToolBuilder.tsx` / `ToolProjects.tsx` 里的路径做成等宽可复制文本。（本轮曾把它们做成调用 `files.openInFileManager` 的可点按钮；第六轮按产品决定回退，见 `tools-center-round6.md`——不再申请 opener 权限。）

## 3. 列表密度与导出文案

- 已安装列表从 `.tool-card` 大卡片换成 `.tool-row` 紧凑行，一行一个工具。视觉用例加了硬指标：**360×850 的右栏里至少能看到 7 行**，防止以后又把行高做大回去。
- 导出提示不再说「拖回工具中心」——拖拽导入从来没实现过，用户照做只会发现没反应。界面提示与 ZIP 内 `README.md` 都改成「在工具中心点「导入工具」选中这个 ZIP」；README 明确写「目前只支持导入压缩包这一种方式」。`ToolManagement.tsx` 的说明同步改掉。
- 顺手修了一条**过时的视觉断言**：测试还在断言 ZIP 里有 `scripts/build.mjs`，而导出包早已不需要 Node 构建脚本。现在断言反过来验证「没有构建脚本、README 说的是导入工具、且不再出现『拖』字」。

## 4. 性能

三处都是「重复读同一份大文件」或「无意义重建」：

1. **启动器目录快照**：`preferences.json` 里存着每个工具的完整 HTML，能到几 MB。原来一次 `catalog.read()` 里 owner 判断和 personal provider 各调一次 `getCatalog()`，等于读两遍、解析两遍。`launcher-registry.mjs` 加 1 秒 TTL 快照，同一动作内复用，短时间连续唤起也不重复解析；装完新工具最多晚 1 秒出现。
2. **主题顺带返回**：`catalog.mjs` 的 `appearanceOf()` 在 `getCatalog()` 里一起算出 theme，`tools:list` 直接带回页面，删掉 `launcher.js` 里为主题单发的那次 IPC（那会再读一遍同一个文件）。
3. **预览 iframe 只在内容变了才重建**：`ToolPreviewTab.tsx` 用 `version + html` 比对，AI 停下自动重读时若源码没变就不换 iframe，用户在预览里正在输入的内容不会被清掉。

基准（临时数据目录，8 个工具、每个 HTML 约 200 KB，`preferences.json` 1.53 MiB）：

| 场景 | 40 次耗时 |
|---|---|
| 直接读+解析目录（旧实现每次 `read()` 做 2 次，40 次 read ≈ 80 次；此处取 40 次作保守下界） | 371.2 ms（9.28 ms/次） |
| 连续 40 次 `catalog.read()`（新实现，TTL 内复用） | 2.5 ms（0.06 ms/次） |

保守说法：**单次唤起从两遍读盘降到一遍**（约 18.6 ms → 9.3 ms），1 秒内重复唤起的合成场景下约 151×。151× 是极限值，不是用户日常能感知的倍数；真正影响手感的是「连按两次快捷键不再等两次几 MB 的解析」。

## 5. 验证

| 项目 | 结果 |
|---|---|
| `tsc --noEmit` / ESLint（本轮改动文件） | 通过 |
| `vitest run tests/plugins/tools` | 72/72 |
| 全量 `vitest run --maxWorkers=4` | 271 文件 / 2038 测试，**0 错误**（默认并发下本机 fork worker 偶发「Timeout waiting for worker to respond」，与断言无关，降低并发即消失） |
| `npm run build`（tsc + vite） / `cargo check` | 通过（Rust 仅 1 条既有 deprecated 警告） |
| `npm run tools:build` / `tools:test` | 通过；guide 产物 9 分节 / 表格 / 代码块齐全 |
| 指导窗口真机（Playwright 驱动真实 Electron，`--aaw-guide`） | 窗口标题「工具开发指导」、9 条目录、正文 2455 字符、关闭按钮与主题均正常 |
| `npm run tools:verify-shortcut` | PASS（含录制期占住 Alt+Space、Ctrl+A 保存后确实注册、设置页开着仍可唤出/收回） |
| `playwright test tests/visual/tools.pw.ts` | 11/11 |

## 6. 留给实机确认

- 980×720 的指导窗口在 125% / 150% 缩放下的目录与代码区是否还舒服；
- 360px 右栏里紧凑行的「⋯」菜单展开后是否挡住相邻行；
- 连续按两次快捷键唤起的手感（性能改动只能靠真机体感，基准只是佐证）。
