# 工具中心第六轮：回退权限、目录改文本、预装示例工具

> 产品决定：**不为了「打开文件夹」扩张桌面端权限**。第五轮为修 `opener.open_path not allowed` 加的两条 capability 整体回退；目录在 UI 上退回为**信息**，不再是操作。

## 1. 改了什么

| 诉求 | 做法 |
|---|---|
| 不要改权限层 | `src-tauri/capabilities/default.json` 删回 `opener:allow-open-path`、`opener:allow-reveal-item-in-dir`，只剩 `opener:default` |
| 文件夹改成文本、但要美观 | 新增 `ui/ToolPath.tsx`：文件夹图标 + 等宽路径胶囊 + 纯前端复制按钮（`CopyButton`，走浏览器剪贴板 API）。完整路径放 `data-hint`（跟随主题，项目禁用原生 `title`），窄栏省略但可复制 |
| 删掉打不开的按钮 | `ToolBuilder.tsx`（3 处）、`ToolProjects.tsx`（2 处）全部换成 `ToolPath`；`workshop.ts` 删除 `openDir()` / `openProjectsRoot()` 及其类型声明；`stalled` 交接块从「打开目录自己改」改为「按这个路径自己改」，保留「我改完了，重新校验」 |
| 预装一两个插件 | 新增 `runtime/examples.ts`：`JSON 格式化`（复用 `ui/sample.ts`，带 number 设置 + 1 动作）与 `随手记`（boolean/select 设置 + 3 动作，用 `aawStore` 留存、`aawClipboard` 复制）。空状态新增「载入示例工具」按钮；另提供 `npm run tools:seed` 给当前登录账号预装 |

## 2. 权限层现状与一处已知遗留

- `capabilities/default.json` 恢复到第五轮之前的状态，**编译产物必须重新构建**才真正去掉那两条权限：开发态重跑 `npm run tauri dev`，发布态重新 `tauri build`。
- **判据**是 build script 生成的 `target/debug/build/desktop/*/out/capabilities.json` 里 `default.permissions` 不含这两项。**不要**用 `grep "allow-open-path" desktop.exe` 判断：二进制里带的是 `acl-manifests.json`（所有可用权限的定义表）与「Permissions associated with this command…」错误消息文本，无论是否启用都搜得到。本轮重新编译后实测：resolved `capabilities.json` 两项均无，`acl-manifests.json` 仍有——权限确实已回退。
- `src/plugins/host/filesystem/documentFiles.ts` 的 `openInFileManager()` 仍是通用能力，`src/plugins/documents/ui/FileTree.tsx` 的「在文件管理器中打开」菜单也还在用。**它一直缺这两条权限**（不是本轮引入），回退后点它仍会报权限错。产品本轮明确不扩权限，所以没有动 documents 插件；后续要么把那个菜单也改成路径文本，要么单独评审是否值得为它开权限。这是留给下一个 Agent 的明确接缝，别误以为是本轮改坏了。

## 3. 示例工具的接缝（重要）

- **单一数据源**：`src/plugins/tools/runtime/examples.ts` 是纯数据 + 类型注解，Node 22 可直接 import（type stripping）。UI 的「载入示例工具」和 `scripts/seed-example-tools.mjs` 共用同一份定义，不会出现「界面里的示例和数据里的不一样」。
- **不是特权数据**：示例走和导入 ZIP 完全一样的 `service.install(tool, true)` 路径，可改设置、导出、卸载；卸载完空状态里还能再载入一次。不自动写用户配置、不破坏空状态。
- **id 命名**：设置项与动作 id 用小写 + 短横（`auto-copy`、`copy-last`），不能用驼峰——`readToolPackage` 会直接丢掉整份工具。`window.aawActions` 的 key 必须与 action id 完全一致，否则 AI 调用时找不到实现。
- **预装脚本**：`npm run tools:seed` 读 `%LOCALAPPDATA%/com.aaw.desktop/configuration/preferences.json`（尊重 `storage-location.json` 的 `active` 与 `AAW_TOOLS_DATA_ROOT`），按当前登录账号的 `user:<id>` **只增不覆盖**，写前备份 `preferences.json.bak-<时间戳>`，原子替换。**必须先退出 AAW 再运行**——应用内存里有配置快照，退出时会回写并覆盖外部改动。
- 想换一批示例：只改 `examples.ts`；想改文案/按钮：只改 `ToolsPanel.tsx` 的 `EmptyLibrary`；`toolsFixture.tsx` 的 `install` 已真实写状态，视觉用例 `loading example tools fills the library` 会守住这条链路。

## 4. 验证证据（本轮）

- `npx tsc --noEmit`、ESLint（本轮全部改动文件）、`npm run build`、`cargo check` 均通过（仅 `diagnostics.rs:431` 既有 deprecated 警告）。
- 全量 `vitest --maxWorkers=4`：271 文件 / 2036 测试 / 0 失败；工具插件 12 文件 / 70 测试。
- `npx playwright test tests/visual/tools.pw.ts`：14/14。新增「载入示例工具」用例、空状态 360/1100px、stalled 360/740px 真实渲染截图，确认无横向溢出、路径文本可读、三个按钮层次清晰。
- 示例工具都通过 `validateToolPackage` 与 `runToolRules`（`package=OK rules=CLEAN`）；`tools-cli.mjs list` 在临时数据目录里能读出两个工具，证明 Electron 启动器侧的 `readToolPackage` 也接受它们。
- `tools:seed` 在临时目录验证幂等：第一次装入 2 个，第二次输出「已经装好了」且不改文件。

## 5. 复现「有插件」的效果

```
# 1) 退出 AAW 桌面客户端（避免配置被内存快照覆盖）
npm run tools:seed
# 2) 重新 npm run tauri dev（同时让权限回退生效）
# 3) 工具中心 → 已安装：应看到「JSON 格式化」「随手记」两行
```

也可以不跑脚本：打开工具中心，空状态里点「载入示例工具」，效果相同。
