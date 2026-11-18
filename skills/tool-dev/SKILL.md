---
name: tool-dev
version: "1.0.0"
description: 在 AAW 平台上开发个人工具的完整规范。当用户说"我想要一个能……的工具"、需要新建或修改工具项目、或工具校验失败需要修复时使用。包含工具定义、项目结构、清单字段、运行时能力 API、平台框架与不可改动的文件（通用性）、红线 R1–R9 与交付前自检清单。
---

# AAW 工具开发

## 0. 你要做什么

用户在 AAW 里说一句"我想要一个能 XXX 的工具"，你要在这个项目目录里把它做出来：写 `manifest.json`（身份与声明）和 `index.html`（界面与逻辑），跑通预览，然后交给用户验收。

用户不做技术决策。不要问他"要不要用 TypeScript""清单 schema 是什么"，那些由本文规定；只在**产品意图真的不明确**时问一句（例如"这个工具处理的是哪种格式的数据"）。

## 1. 什么是一个工具

**是**：单页、自包含、无后端的交互界面。一个 `index.html` 装下全部 HTML/CSS/JS；声明一个以上动作让 AI 也能用；需要留存的数据走平台存储。

**不是**：

- 多页面/带路由的站点（工具窗口只有一个页面）
- 常驻后台的服务或定时任务（没有进程活过窗口）
- 需要 npm 依赖或构建产物的应用（运行时不装依赖）
- 只做展示、没有任何动作的网页（AI 用不了，价值减半）

## 2. 项目结构

```
<tool-id>/
├── manifest.json   # 身份、动作、设置、能力声明
├── index.html      # 唯一运行入口，必须自包含
├── NOTES.md        # 可选：设计取舍，写给下一个人/下一个 AI
└── AGENTS.md       # 平台生成，勿手改（就是本文的运行时版本）
```

`index.html` 之外的文件**不会被执行**，只用于留存源码。想要模块化，就在交付前把代码内联回 `index.html`。

### 2.1 平台框架与不可改动的文件（R9）

**为什么**：工具是要在平台上传播的。一个工具导出成一个 ZIP，别人导入后要能直接装、直接跑——前提是每台机器上的 AAW 都提供**同一套运行框架**，工具包里只装工具自己。框架是地基，不是行李。

**框架由宿主提供**：工具窗口的 `aaw-tool://` 协议、CSP 沙箱、独立内存分区、五个 `window.aaw*` 能力注入、窗口尺寸与启动器/命令行，都在桌面端的 `tools-runtime/` 与 Tauri 侧 `tools_runtime.rs` 里。它们不在工具项目里，不要复制、改写或伪造。项目里的 `AGENTS.md`、导出 ZIP 里的 `README.md` 都是平台按工具身份生成的契约文件；`manifest.json` 的字段名、`schemaVersion`、`id` 规则、`html` 必须是整页字符串，也属于同一份契约。

**保留文件名**（不要改、不要塞进 `sourceFiles`、不要另造同名文件）：`AGENTS.md`、`runtime.mjs`、`tool-preload.cjs`、`preload.cjs`、`package-contract.mjs`、`tool-storage.mjs`、`main.mjs`、`catalog.mjs`、`cli.mjs`、`launcher-registry.mjs`、`desktop-bridge.mjs`、`tauri.conf.json`、`capabilities.json`、`tools_runtime.rs`、`Cargo.toml`。这份清单由校验器 `rules.ts` 的 `platformFrameworkFiles` 生成，手册与代码同源。

**改了会怎样**：一旦把框架文件打包进去、自己覆盖 `window.aaw*` 注入、或在 html 里写死本机绝对路径 / `file://` 地址，这个 ZIP 就绑死了你这一台机器和这一版宿主。别人导入后加载不到或行为不一致——工具失去通用性，也就没法在平台上传播。要访问外部资源，走 `aawFiles.open` 让用户当场选，或用五个 `window.aaw*` 入口，不要写死路径。

**你能改的**：`manifest.json` 的字段值、`index.html` 的全部内容、可选附加源码与 `NOTES.md`。其余都是宿主的事。

## 3. manifest.json 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `schemaVersion` | 是 | 固定数字 `1` |
| `id` | 是 | 小写字母或数字开头，可含点与短横，≤64。**创建后不可改** |
| `name` | 是 | 用户看到的名称，≤60 字 |
| `version` | 是 | 三段数字，如 `1.0.0`；每次交付递增 |
| `icon` | 否 | 1–2 个字符（一个 emoji 或一个汉字），显示在卡片与小窗 |
| `html` | 是 | 完整自包含 HTML（内联 style 与 script），≤512 KB |
| `actions` | 否 | 动作数组，见 §4.2；最多 32 个 |
| `settingsSchema` | 否 | 设置声明，见 §4.3；最多 32 项 |
| `permissions` | 否 | `{ "network": true }`：声明会联网。详见 R8 |
| `author` | 否 | 作者或团队名，≤200 字。导入陌生人给的包时用户靠它判断可信度 |
| `source` | 否 | 来源（仓库地址、内部文档链接），≤200 字 |

## 4. 运行时能力

工具窗口是沙箱页面：**没有 Node、没有文件系统任意读写、没有 Electron API**。所有能与外界交互的入口都挂在 `window` 上，只有下面五个。

### 4.1 `window.aawSettings` — 只读设置

由 `settingsSchema` 的默认值或用户保存值注入的冻结对象，键就是 schema 的 `id`。

```js
const indent = window.aawSettings?.indent ?? 2;
```

### 4.2 `window.aawActions` — 给 AI 用的动作

```js
window.aawActions = {
  format: async (input) => ({ text: JSON.stringify(JSON.parse(String(input?.text ?? "")), null, 2) }),
};
```

- 清单里声明的每个 `id` 都必须在这里有同名函数，否则 AI 一调用就报"工具未实现动作"（R3）。
- 界面上按钮触发的逻辑**必须调用同一个函数**，不要写两份。
- 约束：8 秒内返回；返回值 < 512 KB 且可 JSON 序列化；同一输入应得到同一结果。
- 动作不能依赖"窗口当前显示什么"，它会在后台窗口里执行。

### 4.3 `window.aawStore` — 持久化（跨 AAW 重启保留）

```js
await aawStore.set("lastQuery", "abc");   // 单键 ≤ 256 KB
const saved = await aawStore.get("lastQuery"); // 不存在返回 null
await aawStore.delete("lastQuery");
const keys = await aawStore.keys();
```

- 按「工具 id + 当前用户」隔离，别的工具读不到。
- 单工具上限 5 MB，超了 `set` 抛错，不会静默丢。
- **要留存的数据一律走这里**（R6）。

### 4.4 `window.aawFiles` — 文件

```js
const picked = await aawFiles.open({ accept: [".json", ".csv"] }); // { name, text } | null
await aawFiles.save("result.json", JSON.stringify(data));          // 弹系统保存框
```

每次调用都由用户亲手确认；没有"列目录""读任意路径"的能力，也不要假装有。

### 4.5 `window.aawClipboard` — 剪切板文本

```js
const text = await aawClipboard.readText();   // 没有文本时返回空串
await aawClipboard.writeText("结果");          // 上限 1 MB
```

读/写都走主进程，不要求用户手势，AI 在后台窗口里执行动作时也能用；`navigator.clipboard` 反而拿不到。剪切板历史、复制后清洗、一键复制结果都靠它。读剪切板只在用户点击或动作被显式调用时做，别一加载就静默读取。

### 4.6 其他

- 联网：`fetch` 可用（http/https），但清单必须声明 `permissions.network`（R8）。
- `localStorage` / `sessionStorage` / `IndexedDB` 可用，但它们活在**内存分区**里，AAW 重启即清空。只在本次运行内用的临时状态才用它。
- 窗口尺寸不固定（最小约 360px 宽），布局用 `max-width` / 百分比 / `clamp()`（R7）。

## 5. 红线（R1–R9）

`block` 会让安装失败，`warn` 只在你交付时提示。

| 编号 | 级别 | 规定 | 为什么 | 怎么改 |
|---|---|---|---|---|
| **R1** | block | `id` 创建后不可改 | 改 id 等于新工具，用户的设置与数据会失联 | 继续原工具就保持原 id；确实另起一个就说明清楚 |
| **R2** | block | 界面必须自包含，不得引用外部 script/style | 沙箱加载不到外链，用户看到的是没有样式/点不动的页面 | 把依赖源码内联进同一个 `<script>`/`<style>` |
| **R3** | block / warn | 清单声明的动作必须都有实现 | 声明了没实现，AI 调用直接失败 | 在 `<script>` 末尾写 `window.aawActions = { … }`；不打算给 AI 用就把动作删掉 |
| **R4** | warn | 设置只能经 `settingsSchema` | 自己造的设置项用户在管理页看不到、改不了 | 设置写进清单，代码读 `window.aawSettings` |
| **R5** | warn | 不得把密钥/口令写进 html | 工具包会被分享，写进去等于公开 | 改成设置项由用户填，或运行时让用户输入 |
| **R6** | warn | 需要留存的数据走 `aawStore` | localStorage 在内存分区，重启即清空 | `await aawStore.set(k, v)` / `get(k)` |
| **R7** | warn | 不得写死 ≥800px 的宽度 | 用户可能把窗口缩到 360px | 用 `max-width: 62rem` + `width: 100%` |
| **R8** | block | 联网必须在清单声明 `permissions.network` | 用户在安装前有权知道这个工具会联网 | 加 `"permissions": { "network": true }` |
| **R9** | block / warn | 不得改动或夹带平台框架与关键契约文件（见 §2.1） | 框架由每台机器的宿主统一提供，绑进工具包就失去通用性，别人装不上也跑不对 | 工具包只留 `manifest.json`、`index.html` 与自己的源码；删掉 `AGENTS.md`/`runtime.mjs` 之类文件，不要写死本机路径 |

## 6. 交付前自检

- [ ] `manifest.json` 能被 JSON.parse，`id` 与目录名一致
- [ ] `index.html` 里没有任何外部 `src` / `href`（R2）
- [ ] 清单每个 action 在 `aawActions` 里都有同名函数，界面按钮调用同一个函数（R3）
- [ ] 需要留存的数据走 `aawStore`，没有裸 `localStorage` 存业务数据（R6）
- [ ] 没有硬编码密钥（R5）
- [ ] 会联网就声明了 `permissions.network`（R8）
- [ ] 空输入、超长输入、非法输入三种情况都有明确提示，不是一片空白
- [ ] 窄窗口（360px）下没有横向滚动条（R7）
- [ ] 没有夹带 `AGENTS.md` / `runtime.mjs` 等平台框架文件，没写死本机绝对路径（R9）

## 7. 常见失败与定位

| 现象 | 原因 | 处理 |
|---|---|---|
| 预览一片空白 | `<script>` 里抛错，或引用了外部资源 | 检查 R2；把初始化代码包进 `try/catch` 并在页面上显示错误文本 |
| 按钮点了没反应 | 事件绑定发生在元素之前，或选择器写错 | 把 `<script>` 放在 body 末尾，或用 `DOMContentLoaded` |
| AI 调用报"工具未实现动作 X" | `aawActions` 缺同名函数 | 补上 `window.aawActions.X`（R3） |
| 重启后设置/数据没了 | 用了 localStorage | 改 `aawStore`（R6） |
| 安装时提示 R8 | 有 fetch 但没声明联网 | 补 `permissions.network: true` |

## 8. 最小可用骨架

```html
<!doctype html>
<meta charset="utf-8">
<title>字数统计</title>
<textarea id="text" rows="6" placeholder="粘贴文本"></textarea>
<p><strong id="count">0</strong> 个字符</p>
<script>
  const area = document.getElementById("text");
  const out = document.getElementById("count");
  const count = (input) => ({ characters: [...String(input?.text ?? "")].length });

  area.addEventListener("input", () => { out.textContent = count({ text: area.value }).characters; });
  window.aawActions = { count };
</script>
```
