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
  registry.register("personal", () => getCatalog(root).tools.map((entry) => ({
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
    const { owner, signedIn } = getCatalog(root);
    const user = store.read().users?.[owner ?? "guest"] ?? {};
    const pinned = user.pinned ?? ["builtin:aaw", "builtin:tools"];
    return { owner, signedIn, entries: registry.entries().map((entry) => ({ ...entry,
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

export function normalizeShortcut(value) {
  if (typeof value !== "string" || value.length > 80) throw new Error("请输入有效的快捷键。");
  const parts = value.trim().split("+");
  const key = parts.pop();
  const aliases = { ctrl: "Control", control: "Control", alt: "Alt", shift: "Shift", command: "Command", cmd: "Command", commandorcontrol: "CommandOrControl" };
  const modifiers = parts.map((part) => aliases[part.toLowerCase()]);
  if (!modifiers.length || modifiers.some((part) => !part) || new Set(modifiers).size !== modifiers.length || !/^(Space|[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/i.test(key ?? ""))
    throw new Error("请使用 Alt、Ctrl 或 Shift 加空格、字母、数字或功能键，例如 Alt+Space。");
  return [...modifiers, key.toLowerCase() === "space" ? "Space" : key.toUpperCase()].join("+");
}

/**
 * 快捷键都注册不上时的备选：按"离 Alt+Space 越近越优先"的顺序试。
 * 只在用户自己存的那一组失败时才用，不会悄悄改掉一个还能用的配置。
 */
const fallbackShortcuts = ["Ctrl+Alt+Space", "Ctrl+Shift+Space", "Alt+Shift+Space"];

export function createShortcutController(api, store, callback) {
  let current = "Alt+Space";
  let ready = false;
  return {
    get state() { return { shortcut: current, shortcutReady: ready }; },
    /**
     * 启动时注册。返回 `{ ok, fallbackFrom? }`：拿不到任何快捷键时调用方要能
     * 主动告诉用户（系统通知），而不是只靠托盘 tooltip 等人去看。
     */
    start() {
      let configured;
      try { configured = normalizeShortcut(store.read().shortcut ?? "Alt+Space"); }
      catch { configured = "Alt+Space"; }
      if (api.register(configured, callback)) {
        current = configured;
        ready = true;
        return { ok: true };
      }
      for (const candidate of fallbackShortcuts) {
        if (candidate === configured) continue;
        if (!api.register(candidate, callback)) continue;
        current = candidate;
        ready = true;
        // 记下来，下次启动直接用能用的那组，不再反复撞墙。
        try { store.update({ shortcut: candidate }); } catch { /* 写不进去就本次生效 */ }
        return { ok: true, fallbackFrom: configured };
      }
      current = configured;
      ready = false;
      return { ok: false, occupied: configured };
    },
    change(value) {
      const next = normalizeShortcut(value);
      if (next === current && ready) return;
      if (!api.register(next, callback)) throw new Error("此快捷键被占用，原快捷键已保留。请换一组按键。");
      try { store.update({ shortcut: next }); }
      catch (error) { api.unregister(next); throw error; }
      if (ready && current !== next) api.unregister(current);
      current = next;
      ready = true;
    },
  };
}
