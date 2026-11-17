import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readRecord, getCatalog } from "./catalog.mjs";
import { toneOf, toolGlyph } from "./tone.mjs";

export function createLauncherStore(root) {
  const path = join(root, "launcher-settings.json");
  return {
    read: () => readRecord(path),
    update(patch) {
      mkdirSync(root, { recursive: true });
      const next = { ...readRecord(path), ...patch };
      const temp = `${path}.tmp-${process.pid}`;
      writeFileSync(temp, JSON.stringify(next));
      renameSync(temp, path);
    },
  };
}

// Providers own execution; the renderer only receives serializable presentation data.
export function createLauncherRegistry() {
  const providers = new Map();
  return {
    register(id, provider) {
      if (providers.has(id)) throw new Error(`重复的启动项来源：${id}`);
      providers.set(id, provider);
      return () => providers.delete(id);
    },
    entries() {
      const entries = [...providers.values()].flatMap((provider) => provider());
      if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
        throw new Error("启动项 ID 必须唯一。");
      return entries;
    },
  };
}

export function createLauncherCatalog(root, store, { openTool, openDesktop }) {
  const registry = createLauncherRegistry();
  /**
   * 目录快照：`preferences.json` 里存着每个工具的完整 HTML，文件可能有几 MB。
   * 原来一次 read() 里 owner 和 personal provider 各调一次 getCatalog，等于把同
   * 一个文件读两遍、解析两遍；用户连续按快捷键时更明显。这里做一次短 TTL 缓存
   * （1 秒）——同一个动作里复用，短时间重复唤起也不重复解析，装完新工具最多晚
   * 一秒出现。
   */
  let snapshot;
  const ttl = 1000;
  function catalog(force = false) {
    if (!force && snapshot && Date.now() - snapshot.at < ttl) return snapshot.value;
    const value = getCatalog(root);
    snapshot = { at: Date.now(), value };
    return value;
  }
  registry.register("personal", () => catalog().tools.map((entry) => ({
    id: `personal:${entry.tool.id}`, name: entry.tool.name,
    description: `个人工具 · v${entry.tool.version}`, keywords: [entry.tool.id, "工具", "plugin"],
    source: "personal", scope: "personal", icon: "tool",
    // 字形与色板在这里算好再下发：页面只负责渲染，避免主窗/小窗两份实现漂移。
    glyph: toolGlyph(entry.tool), tone: toneOf(entry.tool.id),
    recent: entry.lastOpened,
    open: async () => { await openTool(entry.tool, entry.settings); entry.touch(); },
  })));
  registry.register("builtin", () => [
    { id: "builtin:aaw", name: "AAW 工作流", description: "在主窗口打开当前项目的工作流", keywords: ["workflow", "工作流"], icon: "workflow", target: "aaw" },
    { id: "builtin:tools", name: "工具中心", description: "管理、导入和开发个人工具", keywords: ["工具", "插件", "管理", "开发"], icon: "library", target: "tools" },
  ].map((entry) => ({ ...entry, source: "builtin", scope: "builtin", recent: 0, trackRecent: false,
    open: () => openDesktop(entry.target),
  })));
  function read() {
    const { owner, signedIn, theme } = catalog();
    const user = store.read().users?.[owner ?? "guest"] ?? {};
    const pinned = user.pinned ?? ["builtin:aaw", "builtin:tools"];
    return { owner, signedIn, theme, entries: registry.entries().map((entry) => ({ ...entry,
      recent: entry.trackRecent === false ? 0 : Math.max(entry.recent, Number(user.recent?.[entry.id]) || 0), pinned: pinned.includes(entry.id), pinOrder: pinned.indexOf(entry.id),
    })).sort((a, b) => b.recent - a.recent || a.name.localeCompare(b.name, "zh-CN")) };
  }
  function updateUser(patch, owner = read().owner) {
    const users = store.read().users ?? {};
    const key = owner ?? "guest";
    store.update({ users: { ...users, [key]: { ...users[key], ...patch(users[key] ?? {}) } } });
  }
  return {
    registry, read,
    async open(id) {
      const snapshot = read();
      const entry = snapshot.entries.find((item) => item.id === id);
      if (!entry) throw new Error("此功能已移除或当前账号不可用，请重新搜索。");
      await entry.open();
      if (entry.trackRecent !== false) updateUser((user) => ({ recent: { ...user.recent, [id]: Date.now() } }), snapshot.owner);
    },
    pin(id, pinned) {
      const entries = read().entries;
      if (!entries.some((entry) => entry.id === id) || typeof pinned !== "boolean") throw new Error("无效的固定入口。");
      const ids = entries.filter((entry) => entry.pinned && entry.id !== id).sort((a, b) => a.pinOrder - b.pinOrder).map((entry) => entry.id);
      updateUser(() => ({ pinned: pinned ? [...ids, id] : ids }));
    },
  };
}


// 快捷键控制器搬到 shortcut.mjs（不依赖 catalog，便于单测）；这里保持原有导出面。
export { normalizeShortcut, createShortcutController } from "./shortcut.mjs";
