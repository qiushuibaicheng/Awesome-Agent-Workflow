# 个人工具开发手册

## 在 AAW 中运行

登录 AAW Desktop 并进入项目，从右侧「新标签页」打开「工具」。选择「开发模式」，载入「JSON 格式化」示例。点击「运行预览」执行工具，返回编辑器后可安装或更新。关闭开发模式后，仍可从已安装列表打开工具。

可以一次导入多个源码 `.zip` 或 `.aaw-tool.json` 文件。每张卡片提供打开、管理、导出、卸载。**打开**直接启动 Electron 独立窗口；**管理**进入插件设置与源码管理页。卸载保留确认步骤。

导出得到 `<id>-<version>-source.zip` 源码项目，包含 `manifest.json`、`index.html`、`package.json`、`scripts/build.mjs`、开发说明及作者附加源码。解压后使用 Node.js 执行 `npm run build`，无需安装依赖，即可生成 `dist/*.aaw-tool.json`；也可直接将项目目录压缩为 ZIP 导入。导入遇到同 ID 会提示冲突，更新时在该插件的「管理 → 更新源码」选择同 ID 文件，或通过开发模式编辑并保存。

ZIP 压缩前后均限制 1 MB，最多 72 个条目；转换后的工具包总大小仍限制 512 KB。项目必须有唯一的 `manifest.json` 和同目录的 `index.html`，可以有一层外部目录。附加源码只支持 UTF-8 文本，最多 64 个文件；拒绝路径穿越、重复路径和 Windows 设备路径。请勿打包 `node_modules`、`.git`、`dist` 或凭据。宿主不会执行导入包中的安装和构建脚本。

按 **Alt + 空格** 呼出 AAW 启动器。小窗采用搜索栏、「最近使用」和「已固定」的图标网格布局，提供「全部功能」，支持方向键选择、回车打开、Esc 返回或隐藏。鼠标移到入口上点击星标可固定或取消固定。点击右上角 AAW 图标或底部快捷键，输入自定义组合键并保存，即刻生效且重启保留；冲突时会保留原快捷键，也可以从系统托盘打开小窗。快捷键偏好保存在本机，当前版本不再使用 `AAW_TOOLS_SHORTCUT` 环境变量。

小窗和 CLI 读取 AAW Desktop 当前登录账号的本地安装清单。小窗是统一功能入口，已经接入个人工具、AAW 工作流和工具中心。没有当前项目时优先使用最近项目，完全没有可用目录时弹出项目选择。打开 AAW 时没有会话则建立会话草稿并尝试连接 agent，随后打开工作流；agent 暂时不可用时保留草稿。工具中心不额外创建会话。AAW、工具中心等固定内置入口不记录最近使用，旧记录也不再显示；个人工具仍按最近成功打开排序。架构及扩展约定见 [统一启动器架构](unified-launcher.md)。

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
| `settingsSchema` | 可选。声明管理页设置项，见下文；最多 32 项 |
| `sourceFiles` | 可选。相对路径到 UTF-8 源码字符串的映射，用于保留作者的开发文件；运行入口仍为自包含 `html` |

开发预览使用 Tauri WebView。已安装工具直接打开 Electron 沙箱窗口，CLI 同样使用 Electron 沙箱渲染器，两者执行相同 HTML 和 JavaScript。将所需 JS 和 CSS 内联到 HTML，图片可使用数据 URL。附加源码不会自动作为外部 JS/CSS 加载，使用构建工具的作者需事先生成自包含 `index.html`。宿主未开放本地文件、网络请求、Node.js、Electron API 或跨工具存储。使用 `type="button"` 与事件监听执行操作。[Electron 沙箱与上下文隔离](https://www.electronjs.org/docs/latest/tutorial/security/)

## 管理页与用户设置

插件作者通过 `settingsSchema` 声明设置，宿主自动渲染表单。支持 `text`、`number`、`boolean`、`select`，每项必须提供稳定 `id`、显示 `label`、类型和 `default`，可选 `description`；数字可设置 `min`/`max`，选项须包含 `value`/`label`。

```json
"settingsSchema": [
  { "id": "indent", "label": "缩进空格数", "type": "number", "default": 2, "min": 0, "max": 8 },
  { "id": "style", "label": "输出风格", "type": "select", "default": "pretty", "options": [
    { "value": "pretty", "label": "易读" }, { "value": "compact", "label": "紧凑" }
  ] }
]
```

设置按账号及插件保存。运行时通过只读 `window.aawSettings.indent` 读取。Electron 窗口与 AI CLI 注入同一份经过校验的已保存设置；开发预览使用声明默认值。保存后重新打开插件生效，旧窗口不会热更新。源码 ZIP 只携带设置声明和默认值，不包含用户的个人设置。更新时保留仍有效的值，对移除字段或无效值使用新默认值；卸载清理个人设置。

未声明设置的旧插件可照常管理和导出，管理页显示空状态。平台负责校验和保存，插件负责把相同配置传给 UI 与 AI 共用的业务函数。当前配置适合普通偏好，不是密码或 API Key 的凭据库。

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
