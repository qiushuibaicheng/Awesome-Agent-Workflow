/**
 * 工具项目：把"工具"从一段配置字符串变成文件系统上的一个目录。
 *
 * 为什么必须改：以前工具按 `user:<id>` 存在 configuration 里（`tools/index.ts`
 * 的 `userKey`），换账号就"消失"、不能用 git、不能用编辑器打开、AI 也看不到。
 * 现在目录才是源：`manifest.json` + `index.html` + `AGENTS.md`，安装只是把
 * 目录内容"编"进运行时注册表。
 */
import { joinPath } from "../../../shared/panelPaths.ts";
import type { ToolPackage, ToolViolation } from "../types.ts";
import { validateToolPackage, validateToolPackageText } from "./package.ts";
import { runToolRules, splitViolations } from "./rules.ts";
import { toolGuide } from "./guide.ts";

/** 工具项目需要的最小宿主能力（便于测试时注入假实现）。 */
export interface ToolProjectIO {
  userDataDir(namespace: string, directory: string): Promise<string>;
  pathExists(path: string): Promise<boolean>;
  listDirNames(path: string): Promise<readonly string[]>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, contents: string): Promise<void>;
}

export const toolProjectFileNames = {
  manifest: "manifest.json",
  html: "index.html",
  guide: "AGENTS.md",
  notes: "NOTES.md",
} as const;

export function toolProjectIdFromWish(wish: string): string {
  const ascii = wish.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  // 中文许愿抽不出 ascii 时用时间戳兜底：id 只是标识，名字另有字段。
  return ascii || `tool-${Date.now().toString(36)}`;
}

/** 默认落点：`<AAW 数据目录>/tools/projects`。用户选目录时以他选的为准。 */
export async function defaultToolProjectsDir(io: ToolProjectIO): Promise<string> {
  return io.userDataDir("tools", "projects");
}

export async function listToolProjects(io: ToolProjectIO, parent?: string): Promise<readonly string[]> {
  const root = parent ?? await defaultToolProjectsDir(io);
  if (!await io.pathExists(root)) return [];
  const names = await io.listDirNames(root);
  return names.map((name) => joinPath(root, name));
}

export interface CreatedToolProject {
  readonly dir: string;
  readonly id: string;
  readonly name: string;
}

/**
 * 建一个空工具项目：清单骨架 + 空 index.html + AGENTS.md。
 *
 * `html` 故意留空——空字符串会被校验判为"还没写完"，这样用户不会误装一个
 * 空白工具；AI 填上内容后才算完成。
 */
export async function createToolProject(
  io: ToolProjectIO,
  input: { readonly id: string; readonly name: string; readonly dir?: string; readonly parent?: string },
): Promise<CreatedToolProject> {
  const parent = input.parent ?? await defaultToolProjectsDir(io);
  const dir = input.dir ?? joinPath(parent, input.id);
  const manifest = {
    schemaVersion: 1,
    id: input.id,
    name: input.name,
    version: "0.1.0",
    html: "",
  };
  await io.writeTextFile(joinPath(dir, toolProjectFileNames.guide), toolGuide({ id: input.id, name: input.name }));
  await io.writeTextFile(joinPath(dir, toolProjectFileNames.html), "");
  await io.writeTextFile(joinPath(dir, toolProjectFileNames.manifest), JSON.stringify(manifest, null, 2));
  return { dir, id: input.id, name: input.name };
}

export type ToolProjectRead =
  | { readonly ok: true; readonly tool: ToolPackage; readonly violations: readonly ToolViolation[] }
  | { readonly ok: false; readonly violations: readonly ToolViolation[] };

/**
 * 读一个工具项目：manifest.json 是主文件，index.html 作为运行入口覆盖 `html`。
 *
 * AI 写东西时通常把界面写在 index.html、清单里不放 html（字符串里嵌整页 HTML
 * 太容易转义出错）。所以这里以文件为准，只有 manifest 自带 html 时才用它的。
 */
export async function readToolProject(io: ToolProjectIO, dir: string): Promise<ToolProjectRead> {
  const manifestPath = joinPath(dir, toolProjectFileNames.manifest);
  let text: string;
  try {
    text = await io.readTextFile(manifestPath);
  } catch {
    return { ok: false, violations: [{ ruleId: "FIELD", level: "block", where: toolProjectFileNames.manifest, message: "项目里没有 manifest.json。", hint: "在项目根目录新建 manifest.json，至少写 schemaVersion、id、name、version。" }] };
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    return { ok: false, violations: [{ ruleId: "FIELD", level: "block", where: toolProjectFileNames.manifest, message: `manifest.json 不是有效 JSON：${error instanceof Error ? error.message : String(error)}`, hint: "检查逗号、引号是否闭合；文件里不要写注释。" }] };
  }
  const page = joinPath(dir, toolProjectFileNames.html);
  let html: string | undefined;
  try {
    html = await io.readTextFile(page);
  } catch { /* 没有 index.html 时退回清单里的 html */ }
  const value = html !== undefined && html.trim()
    ? { ...(manifest as Record<string, unknown>), html }
    : manifest;
  const validated = validateToolPackage(value);
  if (!validated.ok) return { ok: false, violations: validated.violations };
  const problems = runToolRules(validated.tool, {
    previousId: (manifest as Record<string, unknown>).id as string | undefined,
  });
  return { ok: true, tool: validated.tool, violations: problems };
}

/** 把一份工具包写回目录（迁移与"编辑后保存"共用）。 */
export async function writeToolProject(io: ToolProjectIO, dir: string, tool: ToolPackage): Promise<void> {
  const { html, ...manifest } = tool;
  await io.writeTextFile(joinPath(dir, toolProjectFileNames.guide), toolGuide({ id: tool.id, name: tool.name }));
  await io.writeTextFile(joinPath(dir, toolProjectFileNames.html), html);
  await io.writeTextFile(joinPath(dir, toolProjectFileNames.manifest), JSON.stringify(manifest, null, 2));
}

export interface ToolProjectCheck {
  readonly tool?: ToolPackage;
  readonly blocking: readonly ToolViolation[];
  readonly warnings: readonly ToolViolation[];
  readonly ready: boolean;
}

/** 校验一个项目目录，拆成"必须修 / 建议"。安装按钮只看 `ready`。 */
export async function checkToolProject(io: ToolProjectIO, dir: string): Promise<ToolProjectCheck> {
  const read = await readToolProject(io, dir);
  if (!read.ok) {
    const split = splitViolations(read.violations);
    return { blocking: split.blocking, warnings: split.warnings, ready: false };
  }
  const split = splitViolations(read.violations);
  return { tool: read.tool, blocking: split.blocking, warnings: split.warnings, ready: split.blocking.length === 0 };
}

export interface LegacyMigration {
  readonly created: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * 把旧版本（存在 configuration 里）的工具迁成项目目录。
 *
 * 只写不删：迁移失败可以整体回退，旧记录在下一版才清理。目录已存在就跳过——
 * 用户可能已经手工改过，覆盖等于吃掉他的工作。
 */
export async function migrateLegacyTools(
  io: ToolProjectIO,
  tools: readonly ToolPackage[],
  parent?: string,
): Promise<LegacyMigration> {
  const root = parent ?? await defaultToolProjectsDir(io);
  const created: string[] = [];
  const skipped: string[] = [];
  for (const tool of tools) {
    const dir = joinPath(root, tool.id);
    if (await io.pathExists(joinPath(dir, toolProjectFileNames.manifest))) {
      skipped.push(dir);
      continue;
    }
    try {
      await writeToolProject(io, dir, tool);
      created.push(dir);
    } catch {
      skipped.push(dir);
    }
  }
  return { created, skipped };
}

/** 从目录里取一份可安装的工具包（给"安装"按钮用）。 */
export async function toolFromProject(io: ToolProjectIO, dir: string): Promise<{ ok: true; tool: ToolPackage } | { ok: false; violations: readonly ToolViolation[] }> {
  const read = await readToolProject(io, dir);
  if (!read.ok) return { ok: false, violations: read.violations };
  const { blocking } = splitViolations(read.violations);
  if (blocking.length) return { ok: false, violations: blocking };
  return { ok: true, tool: read.tool };
}

/** 供测试与"从文本导入"复用：一段 JSON 文本也要按同一套规则过一遍。 */
export function checkToolText(text: string): ToolProjectCheck {
  const validated = validateToolPackageText(text);
  if (!validated.ok) {
    const split = splitViolations(validated.violations);
    return { blocking: split.blocking, warnings: split.warnings, ready: false };
  }
  const problems = runToolRules(validated.tool);
  const split = splitViolations(problems);
  return { tool: validated.tool, blocking: split.blocking, warnings: split.warnings, ready: split.blocking.length === 0 };
}
