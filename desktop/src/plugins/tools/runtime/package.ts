import type { ToolPackage } from "../types.ts";

export const toolPackageLimit = 512 * 1024;

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
  if (!tool) throw new Error("工具包需要有效的 schemaVersion、id、name、version 和 html。");
  return tool;
}

export function readToolPackage(value: unknown): ToolPackage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const tool = value as Record<string, unknown>;
  const { schemaVersion, id, name, version, html } = tool;
  if (
    schemaVersion !== 1 ||
    typeof id !== "string" || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(id) ||
    typeof name !== "string" || !name.trim() || name.trim().length > 60 ||
    typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version) || version.length > 30 ||
    typeof html !== "string" || !html.trim()
  ) return undefined;
  return { schemaVersion, id, name: name.trim(), version, html };
}
