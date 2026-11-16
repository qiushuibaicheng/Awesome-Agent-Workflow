# 个人工具开发手册

## 在 AAW 中运行

登录 AAW Desktop 并进入项目，从右侧「新标签页」打开「工具」。选择「开发模式」，载入「JSON 格式化」示例。点击「运行预览」执行工具，返回编辑器后可安装或更新。关闭开发模式后，仍可从已安装列表打开工具。

可以一次导入多个 `.aaw-tool.json` 文件。每个工具单独导出，导出文件可以在另一台支持此格式的 AAW Desktop 上安装。导入遇到相同 ID 会提示冲突。更新已有工具时，在开发模式中编辑并保存同一 ID。

## 给 AI 开发助手的约定

将用户希望完成的操作拆成明确的输入、业务函数和结果。用 JavaScript 实现纯业务函数，再用界面事件读取输入、调用函数和显示结果。将 DOM 操作留在界面代码中，方便将来为同一个函数接入 CLI。当前宿主可从界面执行工具，CLI、Electron 专用 API 和系统级能力尚未接入。

每个工具提交一个 UTF-8 JSON 文件，建议使用 `.aaw-tool.json` 后缀，大小上限为 512 KB。所需字段如下。

| 字段 | 约定 |
| --- | --- |
| `schemaVersion` | 数字 `1` |
| `id` | 稳定 ID，最多 64 个字符，首字符为小写英文字母或数字，其余可用小写英文字母、数字、点和短横线 |
| `name` | 工具显示名，最多 60 个字符 |
| `version` | 三段数字，例如 `1.0.0` |
| `html` | 包含界面及内联 JavaScript、CSS 的 HTML 字符串 |

界面运行在现有 Tauri WebView 的隔离 iframe 中。把所需的 JS 和 CSS 内联到 HTML，图片资源可使用数据 URL。工具使用浏览器界面能力，宿主目前没有开放本地文件、Node.js、Electron API 或跨工具存储。用 `type="button"` 与事件监听执行交互，原生表单提交受沙箱限制。

## 最小示例

```json
{
  "schemaVersion": 1,
  "id": "uppercase",
  "name": "转换为大写",
  "version": "1.0.0",
  "html": "<label for='input'>输入文本</label><textarea id='input'></textarea><button type='button' id='run'>转换</button><output id='result' aria-live='polite'></output><script>function uppercase(text) { return text.toUpperCase(); } const input = document.getElementById('input'); const result = document.getElementById('result'); document.getElementById('run').addEventListener('click', () => { result.textContent = uppercase(input.value); });</script>"
}
```

将示例粘贴到「工具包源码」，运行预览，输入 `Hello AAW` 并点击「转换」，结果应为 `HELLO AAW`。安装后再从工具列表打开一次，导出并检查文件中的 ID、版本及源码。

## 桌面宿主开发

在 `desktop` 目录执行 `npm run tauri dev` 启动原生开发版。已有调试构建时，也可以用 `npm run dev` 启动 Vite，再运行 `src-tauri/target/debug/desktop.exe`。若修改涉及启动装配，重新加载桌面窗口后再验证。
