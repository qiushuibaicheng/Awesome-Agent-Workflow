/**
 * 写给 AI 的手册（运行时版本）。
 *
 * 落点是工具项目里的 `AGENTS.md`——ACP agent 每个会话都会读它，所以它比"在
 * 聊天里贴一段提示词"可靠：用户关掉窗口、换台机器、下周再来，契约还在。
 *
 * 完整版在仓库 `skills/tool-dev/SKILL.md`（给人看、给技能安装器用）；这里是
 * 精简版，红线表由 `rules.ts` 生成，保证两边编号永远一致。
 */
import { ruleGuidance, ruleIds, type RuleId } from "./rules.ts";
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
 * 工具项目的 AGENTS.md 正文。
 *
 * 只写"这个项目里必须遵守什么"，不写产品背景——AI 不需要知道 AAW 是什么，
 * 它需要知道往哪写文件、能用什么 API、什么会让安装失败。
 */
export function toolGuide(context: ToolGuideContext): string {
  return `# ${context.name} · AAW 工具项目

你在一个 AAW 个人工具项目里工作。工具 id 是 \`${context.id}\`，目录就是当前工作区。
用户只负责提需求和验收；技术决策按下面这份契约来，不要反过来问用户。

## 一个工具是什么

单页、自包含、无后端的交互界面：一个 \`index.html\` 装下全部 HTML/CSS/JS。
必须有至少一个动作让 AI 也能调用。不是多页面站点，不是后台服务，不是需要构建的 npm 应用。

## 项目结构

- \`manifest.json\`：身份、动作、设置、能力声明（**你主要编辑它**）
- \`index.html\`：唯一运行入口，必须自包含（**你主要编辑它**）
- \`NOTES.md\`：可选，写设计取舍
- \`AGENTS.md\`：本文件，平台生成，不要改

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

## 运行时能力（只有这四个入口）

1. \`window.aawSettings\` — 只读设置对象，键是 settingsSchema 的 id。
2. \`window.aawActions\` — \`{ [actionId]: async (input) => 结果 }\`，界面上按钮必须调用同一个函数；8 秒内返回、结果 < 512 KB、幂等。
3. \`window.aawStore\` — \`await set(k,v) / get(k) / delete(k) / keys()\`，按工具+用户隔离、上限 5 MB、**跨重启保留**。
4. \`window.aawFiles\` — \`await open({accept})\` 返回 \`{name,text}|null\`；\`await save(name, text)\` 弹保存框。

联网可用（http/https），但清单必须声明 \`permissions.network: true\`（R8）。
\`localStorage\` 也能用，但它活在内存分区，AAW 重启会清空——要留存就走 \`aawStore\`（R6）。
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
description: 在 AAW 平台上开发个人工具的完整规范。当用户说"我想要一个能……的工具"、需要新建或修改工具项目、或工具校验失败需要修复时使用。包含工具定义、项目结构、清单字段、运行时能力、红线与交付前自检。
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
先给我一句话说明你打算怎么做，再动手。`;
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
