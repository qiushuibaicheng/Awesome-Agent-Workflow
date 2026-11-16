import type { ToolAction, ToolPackage } from "../types.ts";
import { readSettingsSchema } from "./settings.ts";
import { readSourceFiles } from "./sourceFiles.ts";
export { resolveToolSettings, toolSettingsScript } from "./settings.ts";

export const toolPackageLimit = 512 * 1024;
export const toolIdPattern = /^[a-z0-9][a-z0-9.-]{0,63}$/;

export function parseToolPackage(text: string): ToolPackage {
  if (new TextEncoder().encode(text).length > toolPackageLimit)
    throw new Error("工具包不能超过 512 KB。");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("工具包必须是有效的 JSON。");
  }
  const tool = readToolPackage(value);
  if (!tool) throw new Error("工具包需要有效的 schemaVersion、id、name、version、html、设置声明和源码文件。");
  return tool;
}

export function readToolPackage(value: unknown): ToolPackage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const tool = value as Record<string, unknown>;
  const { schemaVersion, id, name, version, html, actions } = tool;
  if (
    schemaVersion !== 1 ||
    typeof id !== "string" || !toolIdPattern.test(id) ||
    typeof name !== "string" || !name.trim() || name.trim().length > 60 ||
    typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version) || version.length > 30 ||
    typeof html !== "string" || !html.trim()
  ) return undefined;
  const settingsSchema = tool.settingsSchema === undefined ? undefined : readSettingsSchema(tool.settingsSchema);
  const sourceFiles = tool.sourceFiles === undefined ? undefined : readSourceFiles(tool.sourceFiles);
  if (tool.settingsSchema !== undefined && !settingsSchema || tool.sourceFiles !== undefined && !sourceFiles) return undefined;
  if (actions !== undefined && (!Array.isArray(actions) || actions.length > 32)) return undefined;
  const checked: ToolAction[] = [];
  const ids = new Set<string>();
  for (const value of (actions ?? []) as readonly unknown[]) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const { id, description, inputSchema } = value as Record<string, unknown>;
    if (typeof id !== "string" || !toolIdPattern.test(id) || ids.has(id) ||
      typeof description !== "string" || !description.trim() || description.length > 300 ||
      !inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) return undefined;
    ids.add(id);
    checked.push({ id, description: description.trim(), inputSchema: inputSchema as Record<string, unknown> });
  }
  return { schemaVersion, id, name: name.trim(), version, html,
    ...(actions === undefined ? {} : { actions: checked }),
    ...(settingsSchema === undefined ? {} : { settingsSchema }),
    ...(sourceFiles === undefined ? {} : { sourceFiles }),
  };
}
