import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readToolPackage, resolveToolSettings } from "./package-contract.mjs";

export function readRecord(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

export function defaultRoot() {
  if (process.env.AAW_TOOLS_DATA_ROOT) return process.env.AAW_TOOLS_DATA_ROOT;
  if (process.platform === "win32" && process.env.LOCALAPPDATA)
    return join(process.env.LOCALAPPDATA, "com.aaw.desktop");
  throw new Error("请指定 AAW_TOOLS_DATA_ROOT。");
}

/**
 * 主窗外观（workbench 写在 `aaw-desktop.settings.v1` 里的 theme）。
 *
 * 启动器要跟随主窗：主窗默认就是深色，小窗却长期写死浅色——半夜按快捷键
 * 弹出一整块白板。这里只读，不做任何写入。
 * `warm` 是主窗对浅色主题的叫法（`theme-warm` 根类）。
 */
function appearanceOf(settings) {
  let value;
  try { value = JSON.parse(settings["aaw-desktop.settings.v1"] || "null"); }
  catch { /* 偏好文件里存了坏数据就按默认深色处理 */ }
  return { theme: value?.theme === "warm" ? "warm" : "dark" };
}

export function readAppearance(root) {
  const storage = readRecord(join(root, "storage-location.json")).active || root;
  return appearanceOf(readRecord(join(storage, "configuration", "preferences.json")));
}

export function getCatalog(root) {
  const storage = readRecord(join(root, "storage-location.json")).active || root;
  const configuration = join(storage, "configuration");
  const settings = readRecord(join(configuration, "preferences.json"));
  // 主题顺带带走：小窗唤起时不用为它再读一遍同一个文件（里面有每个工具的完整 HTML）。
  const { theme } = appearanceOf(settings);
  const auth = JSON.parse(settings["aaw-desktop.auth.v1"] || "null");
  const library = JSON.parse(settings["aaw-desktop.personal-tools.v1"] || "{}");
  const owner = typeof auth?.user?.id === "string" ? `user:${auth.user.id}` : null;
  if (!owner) return { signedIn: false, theme, tools: [] };
  const recentPath = join(configuration, "tools-recent.json");
  const recent = readRecord(recentPath);
  const items = Object.hasOwn(library, owner) ? library[owner] : [];
  const tools = (Array.isArray(items) ? items : []).flatMap((entry) => {
    const tool = readToolPackage(entry?.package);
    if (!tool) return [];
    const key = `${owner}/${tool.id}`;
    return [{
      tool,
      settings: resolveToolSettings(tool, entry.settings),
      lastOpened: Math.max(Number(entry.lastOpened) || 0, Number(recent[key]) || 0),
      touch() {
        mkdirSync(configuration, { recursive: true });
        const next = { ...readRecord(recentPath), [key]: Date.now() };
        const temp = `${recentPath}.tmp-${process.pid}`;
        writeFileSync(temp, JSON.stringify(next));
        renameSync(temp, recentPath);
      },
    }];
  });
  tools.sort((a, b) => b.lastOpened - a.lastOpened || a.tool.name.localeCompare(b.tool.name, "zh-CN"));
  return { signedIn: true, owner, theme, tools };
}

export function describeTool(tool) {
  return { id: tool.id, name: tool.name, version: tool.version, actions: tool.actions ?? [], settingsSchema: tool.settingsSchema ?? [] };
}
