/**
 * 写给 AI 的手册（运行时版本）。
 *
 * 落点是工具项目里的 `AGENTS.md`——ACP agent 每个会话都会读它，所以它比"在
 * 聊天里贴一段提示词"可靠：用户关掉窗口、换台机器、下周再来，契约还在。
 *
 * 完整版在仓库 `skills/tool-dev/SKILL.md`（给人看、给技能安装器用）；这里是
 * 精简版，红线表由 `rules.ts` 生成，保证两边编号永远一致。
 */
import { platformFrameworkFiles, ruleGuidance, ruleIds, type RuleId } from "./rules.ts";
import type { ToolViolation } from "../types.ts";

export interface ToolGuideContext {
  readonly id: string;
  readonly name: string;
}

function ruleTable(): string {
  return [
    "| 编号 | 级别 | 规定 | 怎么改 |",
    "|---|---|---|---|",
    ...ruleIds.map((id: RuleId) => {
      const entry = ruleGuidance[id];
      return `| ${id} | ${entry.level} | ${entry.rule} | ${entry.fix} |`;
    }),
  ].join("\n");
}

/**
 * 「平台框架」保留文件名清单，直接读校验器 R9 用的同一份常量。
 * 手册与代码共用一份数据，就不会出现"手册说不能改、校验器却不认"的漂移。
 */
function frameworkFileList(): string {
  return platformFrameworkFiles.map((name) => `\`${name}\``).join("、");
}

/**
 * 工具项目的 AGENTS.md 正文。
 *
 * 只写"这个项目里必须遵守什么"，不写产品背景——AI 不需要知道 AAW 是什么，
 * 它需要知道往哪写文件、能用什么 API、什么会让安装失败。
 */
export function toolGuide(context: ToolGuideContext): string {
  return `# ${context.name} · AAW 工具项目

${guideBody(context)}
`;
}

/**
 * 人读版：工具中心里那份「开发指导」窗口的正文。
 *
 * 与 `toolGuide()` 共用 `guideBody()`，所以窗口里看到的内容和写进项目
 * `AGENTS.md`、AI 技能目录的文字永远一致——两处各写一份，迟早会互相矛盾。
 */
export function toolGuideMarkdown(): string {
  return `# 工具开发指导

这份文档既是给人看的手册，也是平台写进工具项目 \`AGENTS.md\` 和 AI 技能目录的同一份规范。你看到的和 AI 读到的是同一段文字。

## 从这里开始

- **做一个新工具**：工具中心 →「开发工具」→ 写下需求 → 开始做。
- **改一个已有的**：同一个标签页里点项目的「继续开发」。
- **做完了**：面板会自动校验，通过后点「确认安装」。
- **不想让 AI 做**：项目目录里的 \`manifest.json\` 与 \`index.html\` 就是全部源码，直接改，改完点「我改完了，重新校验」。

## 在项目里工作时

${guideBody({ id: "<工具 id>", name: "<工具名>" })}
`;
}

/** 两个入口共用的正文：项目落点、清单结构、运行时能力、红线、交付流程。 */
function guideBody(context: ToolGuideContext): string {
  return `你在一个 AAW 个人工具项目里工作。工具 id 是 \`${context.id}\`，目录就是当前工作区。
用户只负责提需求和验收；技术决策按下面这份契约来，不要反过来问用户。

## 一个工具是什么

一个**随叫随到、独立完成一件事**的小程序：有自己的窗口界面，能从工具中心或启动器一键打开，也能被 AI 通过命令调用。它不是一个网页，也不是一个需要部署的服务——更接近 uTools 里的插件：打开就用，用完就走，中间的状态能留到下次。

工具能做的事远比「格式化一段文本」多，常见的几类：

| 场景 | 例子 |
|---|---|
| 文本与数据处理 | JSON / YAML 格式化与互转、正则测试、批量改名、编码解码、Markdown 转表格 |
| 剪切板与输入增强 | 剪切板历史、复制后自动去格式或转大写、常用短语速查、颜色值转换 |
| 计算与查阅 | 时间戳换算、进制与单位换算、哈希与二维码、内网接口状态速查 |
| 文件与小批处理 | 打开一个文本、清洗内容、再存成新文件；把一批文本合并导出 |
| 个人留存 | 待办清单、随手记、常用配置、最近用过的输入（走 \`aawStore\`） |

它能读写系统剪切板、读写用户亲手选的文件、把数据留到下次打开、按声明联网访问 http/https。**不能**做后台常驻服务、不能装 npm 包、不能读任意本地路径、不能弹系统通知或调用摄像头——平台把这些挡在沙箱外面，是为了让一个 ZIP 能在别人机器上直接装、直接跑。

技术上的边界只有一条：整个工具是自包含的 \`index.html\`（HTML/CSS/JS 都在里面），\`manifest.json\` 描述身份、动作、设置与能力。不是多页面站点，不是后台服务，不是需要构建的 npm 应用。必须有至少一个动作让 AI 也能调用——界面上的按钮和 \`aawActions\` 里的函数是同一件事，人和 AI 走同一条路。

## 项目结构

- \`manifest.json\`：身份、动作、设置、能力声明（**你主要编辑它**）
- \`index.html\`：唯一运行入口，必须自包含（**你主要编辑它**）
- \`NOTES.md\`：可选，写设计取舍
- \`AGENTS.md\`：本文件，平台生成，不要改（见下节 R9）

## 平台框架与不可改动的文件（R9）

**为什么有这条**：我们做的是能在平台上传播的工具。一个工具导出成一个 ZIP，别人导入后要能直接装、直接跑——前提是**每台机器上的 AAW 都提供同一套运行框架**，而工具包里只装工具自己。框架是地基，不是行李。

**框架是什么、由谁提供**：工具窗口的 \`aaw-tool://\` 协议、CSP 沙箱、独立内存分区、五个 \`window.aaw*\` 能力注入、窗口尺寸与启动器/命令行，全在桌面端的 \`tools-runtime/\` 与 Tauri 侧 \`tools_runtime.rs\` 里，由**宿主**在运行时提供。它们不在工具项目里，也不要复制、改写或伪造它们。项目里的 \`AGENTS.md\`、导出 ZIP 里的 \`README.md\` 都是平台按工具身份生成的契约文件，不是给你改的；\`manifest.json\` 的字段名、\`schemaVersion\`、\`id\` 规则、\`html\` 必须是整页字符串这些约定，也属于同一份契约。

**平台框架/关键文件的保留名**（不要改、不要塞进 \`sourceFiles\`、不要另造同名文件）：${frameworkFileList()}。

**改了会怎样**：一旦把框架文件打包进去、自己覆盖 \`window.aaw*\` 注入、在 html 里写死本机绝对路径或 \`file://\` 地址，这个 ZIP 就绑死了你这一台机器和这一版宿主。别人导入后要么加载不到、要么行为不一致——工具就失去了通用性，也就没法在平台上传播。要访问外部资源，走 \`aawFiles.open\` 让用户当场选，或用五个 \`window.aaw*\` 入口，而不是写死路径。

**你能改的**：\`manifest.json\` 里的字段值、\`index.html\` 的全部内容、可选的附加源码与 \`NOTES.md\`。仅此而已——其余都是宿主的事。校验器会把夹带框架文件挡下来（R9，block），把绑本机路径标成建议（R9，warn）。

## manifest.json

\`\`\`json
{
  "schemaVersion": 1,
  "id": "${context.id}",
  "name": "${context.name}",
  "version": "1.0.0",
  "icon": "字",
  "html": "<完整自包含 HTML>",
  "actions": [
    { "id": "run", "description": "一句话说明", "inputSchema": { "type": "object", "properties": {} } }
  ],
  "settingsSchema": [
    { "id": "indent", "label": "缩进空格数", "type": "number", "default": 2, "min": 0, "max": 8 }
  ],
  "permissions": { "network": false },
  "author": "你的名字",
  "source": "https://…"
}
\`\`\`

- \`id\` 已经定好，**不要改**（R1）。
- \`version\` 每次交付递增。
- \`html\` 是整页字符串：写的时候注意转义，别漏 \`</script>\`。
- \`settingsSchema\` 的 \`type\` 只能是 text / number / boolean / select；select 要带 \`options\`。

## 运行时能力（只有这五个入口）

1. \`window.aawSettings\` — 只读设置对象，键是 settingsSchema 的 id。
2. \`window.aawActions\` — \`{ [actionId]: async (input) => 结果 }\`，界面上按钮必须调用同一个函数；8 秒内返回、结果 < 512 KB、幂等。
3. \`window.aawStore\` — \`await set(k,v) / get(k) / delete(k) / keys()\`，按工具+用户隔离、上限 5 MB、**跨重启保留**。
4. \`window.aawFiles\` — \`await open({accept})\` 返回 \`{name,text}|null\`；\`await save(name, text)\` 弹保存框。
5. \`window.aawClipboard\` — \`await readText()\` 取当前剪切板文本（没有文本返回空串）；\`await writeText(text)\` 写入，上限 1 MB。剪切板历史、复制后清洗、一键复制结果都靠它。

联网可用（http/https），但清单必须声明 \`permissions.network: true\`（R8）。
\`navigator.clipboard\` 也能用，但它要求用户手势、在 AI 执行的动作里拿不到；优先用 \`aawClipboard\`。
\`localStorage\` 也能用，但它活在内存分区，AAW 重启会清空——要留存就走 \`aawStore\`（R6）。
读剪切板只在用户点击或动作被显式调用时做，不要在页面一加载就静默读取。
窗口宽度不固定（最小约 360px），布局别写死宽度（R7）。

## 红线

${ruleTable()}

## 交付流程

1. 改 \`manifest.json\` + \`index.html\`。
2. 平台会自动校验并把问题回给你：出现 \`必须修\` 的条目就按"怎么改"修掉，再等下一轮校验。
3. 校验通过后平台会生成预览，用户点验收才真正安装。
4. 不要为了让校验通过而删掉功能；宁可改实现方式。

## 自检（提交前逐条过）

- [ ] 没有任何外部 \`src\` / \`href\`
- [ ] 每个 action 在 \`aawActions\` 里都有同名函数，界面按钮复用同一函数
- [ ] 需要留存的数据走 \`aawStore\`
- [ ] 用到剪切板时是用户主动触发的，不是打开就偷偷读
- [ ] 没有硬编码密钥
- [ ] 会联网就声明了 \`permissions.network\`
- [ ] 空输入 / 超长输入 / 非法输入都有提示，不是白屏
- [ ] 360px 宽下没有横向滚动
`;
}

/**
 * 装进 agent 技能目录的 `SKILL.md`。
 *
 * 项目里的 `AGENTS.md` 只在那个工具项目内生效；用户在**普通会话**里让 AI
 * 顺手做个工具时，AI 看不到规范，产出的包往往装不上。把同一份正文加个
 * frontmatter 写进 `chrys/skills/tool-dev/SKILL.md`，全局会话才认得这套契约。
 */
export function toolGuideSkill(): string {
  return `---
name: tool-dev
version: "1.0.0"
description: 在 AAW 平台上开发个人工具的完整规范。当用户说"我想要一个能……的工具"、需要新建或修改工具项目、或工具校验失败需要修复时使用。包含工具能做什么（文本处理、剪切板、文件、留存、联网等场景）、项目结构、清单字段、五个运行时能力入口、平台框架与不可改动的文件（R9 通用性红线）、红线与交付前自检。
---

${toolGuide({ id: "<工具 id>", name: "<工具名>" })}

## 在普通会话里被要求做工具时

1. 先问一句"要不要在工具中心新建一个项目"——建项目会自带本规范与预览、安装链路。
2. 如果用户只是要一段代码，就把 \`manifest.json\` 与 \`index.html\` 一起给出，并在结尾附上红线自检结果。
3. 不要把它做成需要构建的 npm 工程：平台只执行自包含的 \`index.html\`。
`;
}

/** 用户描述需求后发给会话的第一条消息：用户原话 + 落点指引，不夹带技术细节。 */
export function briefMessage(brief: string, context: ToolGuideContext): string {
  return `我想做一个工具：${brief}

项目已经建好了（id: \`${context.id}\`），请先读项目里的 AGENTS.md，然后在当前目录里写 \`manifest.json\` 和 \`index.html\`。
先说明你打算怎么做，再动手。`;
}

/** 校验失败时回灌给会话的消息：只带必须修与建议，AI 照着改。 */
export function repairMessage(problems: readonly ToolViolation[]): string {
  const lines = problems.map((problem) => {
    const where = problem.where ? `（${problem.where}）` : "";
    return `- [${problem.ruleId}][${problem.level === "block" ? "必须修" : "建议"}]${where} ${problem.message}\n  改法：${problem.hint}`;
  });
  return `平台校验没通过，请按下面逐条修改后继续（不要删功能，改实现方式即可）：\n\n${lines.join("\n")}`;
}

/** 校验通过的收尾消息。 */
export function acceptedMessage(tool: { readonly name: string; readonly version: string }): string {
  return `校验通过：${tool.name} v${tool.version} 已生成预览，等用户验收。`;
}
