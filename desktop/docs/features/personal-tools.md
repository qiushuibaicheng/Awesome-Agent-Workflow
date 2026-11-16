# 个人工具开发手册

## 在 AAW 中运行

登录 AAW Desktop 并进入项目，从右侧「新标签页」打开「工具」。选择「开发模式」，载入「JSON 格式化」示例。点击「运行预览」执行工具，返回编辑器后可安装或更新。关闭开发模式后，仍可从已安装列表打开工具。

可以一次导入多个 `.aaw-tool.json` 文件。每个工具单独导出，导出文件可以在另一台支持此格式的 AAW Desktop 上安装。导入遇到相同 ID 会提示冲突。更新已有工具时，在开发模式中编辑并保存同一 ID。

按 **Ctrl + Alt + 空格** 呼出工具小窗，支持按名称或 ID 搜索、方向键选择、回车打开、Esc 隐藏。个人工具按最近打开时间排序，打开后会显示独立的 Electron 工具窗口。主窗工具页也提供「打开小窗」和「在 Electron 打开」。快捷键发生冲突时，可以用托盘菜单打开，并在启动宿主前设置环境变量 `AAW_TOOLS_SHORTCUT` 更换组合键。

小窗和 CLI 读取 AAW Desktop 当前登录账号的本地安装清单。小窗的启动项由来源提供，个人工具是当前已接入的来源。未来 AAW 工作流可以增加自己的启动项并委托主窗导航。

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
