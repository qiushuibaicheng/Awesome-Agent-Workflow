import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readToolPackage } from "./package-contract.mjs";

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

export function getCatalog(root) {
  const storage = readRecord(join(root, "storage-location.json")).active || root;
  const configuration = join(storage, "configuration");
  const settings = readRecord(join(configuration, "preferences.json"));
  const auth = JSON.parse(settings["aaw-desktop.auth.v1"] || "null");
  const library = JSON.parse(settings["aaw-desktop.personal-tools.v1"] || "{}");
  const owner = typeof auth?.user?.id === "string" ? `user:${auth.user.id}` : null;
  if (!owner) return { signedIn: false, tools: [] };
  const recentPath = join(configuration, "tools-recent.json");
  const recent = readRecord(recentPath);
  const items = Object.hasOwn(library, owner) ? library[owner] : [];
  const tools = (Array.isArray(items) ? items : []).flatMap((entry) => {
    const tool = readToolPackage(entry?.package);
    if (!tool) return [];
    const key = `${owner}/${tool.id}`;
    return [{
      tool,
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
  return { signedIn: true, owner, tools };
}

export function describeTool(tool) {
  return { id: tool.id, name: tool.name, version: tool.version, actions: tool.actions ?? [] };
}
