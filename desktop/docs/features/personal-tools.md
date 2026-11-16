# 个人工具开发手册

## 在 AAW 中运行

登录 AAW Desktop 并进入项目，从右侧「新标签页」打开「工具」。选择「开发模式」，载入「JSON 格式化」示例。点击「运行预览」执行工具，返回编辑器后可安装或更新。关闭开发模式后，仍可从已安装列表打开工具。

可以一次导入多个 `.aaw-tool.json` 文件。每个工具单独导出，导出文件可以在另一台支持此格式的 AAW Desktop 上安装。导入遇到相同 ID 会提示冲突。更新已有工具时，在开发模式中编辑并保存同一 ID。

按 **Alt + 空格** 呼出 AAW 启动器。小窗采用搜索栏、「最近使用」和「已固定」的图标网格布局，提供「全部功能」，支持方向键选择、回车打开、Esc 返回或隐藏。鼠标移到入口上点击星标可固定或取消固定。点击右上角 AAW 图标或底部快捷键，输入自定义组合键并保存，即刻生效且重启保留；冲突时会保留原快捷键，也可以从系统托盘打开小窗。快捷键偏好保存在本机，当前版本不再使用 `AAW_TOOLS_SHORTCUT` 环境变量。

小窗和 CLI 读取 AAW Desktop 当前登录账号的本地安装清单。小窗是统一功能入口，已经接入个人工具、AAW 工作流和工具中心。个人工具打开独立的 Electron 窗口，内置入口打开主窗当前项目对应的面板；未选择项目时提示先选项目。小窗成功打开后记录最近使用，固定顺序独立于最近使用排序。主窗工具中心也提供「打开启动器」和「在 Electron 打开」。架构及扩展约定见 [统一启动器架构](unified-launcher.md)。

## 给 AI 开发助手的约定

将操作拆成明确的 JSON 输入、业务函数与 JSON 输出。将函数注册到 `window.aawActions[actionId]`，调用同一个函数处理按钮事件和 CLI 请求。函数可返回 Promise，应自己校验输入。将 DOM 操作留在界面代码中，确保函数在隐藏窗口中也能正常执行。

每个工具提交一个 UTF-8 JSON 文件，建议使用 `.aaw-tool.json` 后缀，大小上限为 512 KB。所需字段如下。

| 字段 | 约定 |
| --- | --- |
| `schemaVersion` | 数字 `1` |
| `id` | 稳定 ID，最多 64 个字符，首字符为小写英文字母或数字，其余可用小写英文字母、数字、点和短横线 |
| `name` | 工具显示名，最多 60 个字符 |
| `version` | 三段数字，例如 `1.0.0` |
| `html` | 包含界面及内联 JavaScript、CSS 的 HTML 字符串 |
| `actions` | 可选。每个动作包含唯一的 `id`、用途 `description` 和用于描述参数的 JSON Schema `inputSchema` |

右侧面板的内嵌视图和开发预览使用 Tauri WebView。独立工具窗口和 CLI 使用 Electron 沙箱渲染器，采用相同的 HTML 和 JavaScript。将所需 JS 和 CSS 内联到 HTML，图片可使用数据 URL。工具可以使用浏览器界面能力。宿主未开放本地文件、网络请求、Node.js、Electron API 或跨工具存储。使用 `type="button"` 与事件监听执行操作。[Electron 沙箱与上下文隔离](https://www.electronjs.org/docs/latest/tutorial/security/)

## 最小示例

```json
{
  "schemaVersion": 1,
  "id": "uppercase",
  "name": "转换为大写",
  "version": "1.0.0",
  "actions": [
    {
      "id": "uppercase",
      "description": "把输入文本转换成大写",
      "inputSchema": { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] }
    }
  ],
  "html": "<label for='input'>输入文本</label><textarea id='input'></textarea><button type='button' id='run'>转换</button><output id='result' aria-live='polite'></output><script>function uppercase({text}) { return text.toUpperCase(); } window.aawActions = { uppercase }; const input = document.getElementById('input'); const result = document.getElementById('result'); document.getElementById('run').addEventListener('click', () => { result.textContent = uppercase({text: input.value}); });</script>"
}
```

将示例粘贴到「工具包源码」，运行预览，输入 `Hello AAW` 并点击「转换」，结果应为 `HELLO AAW`。安装后再从工具列表打开一次，导出并检查文件中的 ID、版本及源码。

## AI CLI

从 `desktop` 目录执行，三条命令分别列出个人工具、读取动作契约、调用动作。

```powershell
npm --silent run tools -- list
npm --silent run tools -- describe uppercase
'{"text":"Hello AAW"}' | npm --silent run tools -- run uppercase uppercase
```

成功结果为 `{"ok":true,"result":"HELLO AAW"}`，失败返回 `{"ok":false,"error":"..."}`，退出码为 1。输入与输出上限为 512 KB，动作执行上限为 8 秒。也可以向 `run` 传 `--input-file=<文件路径>`。Windows 安装版使用安装目录下的 `tools-runtime\aaw-tools.cmd`，按相同参数格式传入文件路径。

旧工具依旧可以从界面打开。若要让旧版「JSON 格式化」可被 CLI 调用，在开发模式重新载入示例并更新，然后运行 `describe json-formatter` 查看 `format` 动作。

## 桌面宿主开发

在 `desktop` 目录执行 `npm run tauri dev` 构建 Electron 工具宿主并启动原生开发版。已有调试构建时，先运行 `npm run tools:build`，再启动 Vite（`npm run dev`）和 `src-tauri/target/debug/desktop.exe`。单独调试小窗可用 `npm run tools:launcher`。改动 Electron 源码后重新构建并重启宿主，Windows 实机 CLI 冒烟测试使用 `npm run tools:test`。

启动器回归检查：构建后运行 `node --test scripts/test-launcher.mjs`；Windows Electron 界面验证运行 `node scripts/test-launcher-ui.mjs`。后者使用临时账号数据与独立 profile，覆盖搜索、固定、长列表、小尺寸布局和快捷键冲突。
