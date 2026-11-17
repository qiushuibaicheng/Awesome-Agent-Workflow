import type { Context } from "cordis";
import { createStore } from "zustand";
import { createSnapshotView } from "../../shared/state/readonlySnapshot.ts";
import type { InstallOutcome, ToolsService } from "./service.ts";
import type { PersonalTool } from "./types.ts";
import { readToolPackage } from "./runtime/package.ts";
import { resolveToolSettings, validateToolSettings } from "./runtime/settings.ts";
import { createBackupQueue, readToolBackup } from "./runtime/backup.ts";
import { hostToolIO } from "./runtime/io.ts";

export const name = "tools";
export const inject = ["account", "configuration", "host"];

export async function installWorkbench(ctx: Context): Promise<void> {
  await ctx.plugin(await import("./ui/workbench.tsx"));
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

interface ReadToolsResult {
  readonly tools: readonly PersonalTool[];
  /** 解析不出来、被丢掉的条目数——顺手清理掉，免得每次启动都白跑一遍。 */
  readonly dropped: number;
}

function readTools(value: unknown): ReadToolsResult {
  if (!Array.isArray(value)) return { tools: [], dropped: 0 };
  const tools: PersonalTool[] = [];
  const ids = new Set<string>();
  let dropped = 0;
  for (const entry of value as readonly unknown[]) {
    if (!entry || typeof entry !== "object") {
      dropped += 1;
      continue;
    }
    const fields = entry as Record<string, unknown>;
    const tool = readToolPackage(fields.package);
    if (!tool || ids.has(tool.id)) {
      dropped += 1;
      continue;
    }
    ids.add(tool.id);
    tools.push({
      package: tool,
      settings: resolveToolSettings(tool, fields.settings),
      lastOpened: finiteNumber(fields.lastOpened),
      installedAt: finiteNumber(fields.installedAt),
      updatedAt: finiteNumber(fields.updatedAt),
      dir: text(fields.dir),
      ...(typeof fields.previousVersion === "string" ? { previousVersion: fields.previousVersion } : {}),
    });
  }
  return {
    tools: tools.sort((a, b) =>
      (b.lastOpened ?? 0) - (a.lastOpened ?? 0) ||
      a.package.name.localeCompare(b.package.name),
    ),
    dropped,
  };
}

export function apply(ctx: Context): void {
  const scope = ctx.configuration.register("aaw-desktop.personal-tools.v1");
  const account = ctx.account.state;
  const io = hostToolIO(ctx.host);
  const backups = createBackupQueue(io, () => account.getState().currentUser?.id);
  const userKey = () => {
    const user = account.getState().currentUser;
    return user ? `user:${user.id}` : undefined;
  };
  function readCurrent() {
    const key = userKey();
    if (!key) return [];
    try {
      return readTools(scope.read()?.[key]).tools;
    } catch (error) {
      if (error instanceof SyntaxError) return [];
      throw error;
    }
  }

  const store = createStore<readonly PersonalTool[]>(readCurrent);
  const view = createSnapshotView(store, (tools) => tools);
  function update(transform: (current: readonly PersonalTool[]) => readonly PersonalTool[]) {
    const key = userKey();
    if (!key) throw new Error("请先登录 AAW。");
    scope.update({ [key]: transform(readCurrent()) });
  }

  /**
   * 一次性清掉读不出来的条目。
   *
   * 以前 `readTools` 遇到坏条目只是 `.filter()` 掉：界面上看不见，配置里却
   * 一直躺着，每次启动重新解析一遍、永远不自愈。这里在登录后写回一次干净
   * 的数组（没坏条目就不写，避免无意义的磁盘写入）。
   */
  function pruneBroken(): void {
    const key = userKey();
    if (!key) return;
    try {
      const raw = scope.read()?.[key];
      if (!Array.isArray(raw)) return;
      const { tools, dropped } = readTools(raw);
      if (dropped > 0) scope.update({ [key]: tools });
    } catch { /* 配置读不出来时不动它，下次启动再试 */ }
  }

  ctx.provide(name, {
    state: view.snapshot,
    install(tool, replace = false, sourceDir): InstallOutcome {
      let outcome: InstallOutcome = { version: tool.version, updated: false, versionChanged: false };
      update((current) => {
        const previous = current.find((entry) => entry.package.id === tool.id);
        if (previous && !replace) throw new Error("已安装相同 ID 的工具。请在「开发工具」里重新安装，或先卸载旧版本。");
        // 覆盖前把上一版挪到磁盘：装坏了能一步退回，不用再找 AI 重写。
        if (previous) backups.enqueue(previous.package);
        const dir = sourceDir ?? previous?.dir;
        outcome = {
          version: tool.version,
          ...(previous ? { previousVersion: previous.package.version } : {}),
          updated: previous !== undefined,
          versionChanged: previous !== undefined && previous.package.version !== tool.version,
          ...(dir ? { dir } : {}),
        };
        const now = Date.now();
        return [
          ...current.filter((entry) => entry.package.id !== tool.id),
          {
            package: tool,
            lastOpened: previous?.lastOpened,
            installedAt: previous?.installedAt ?? now,
            ...(previous ? { updatedAt: now, previousVersion: previous.package.version } : {}),
            // 来源目录优先用这次传入的（用户可能换了目录重装），否则沿用上一次。
            ...(dir ? { dir } : {}),
            settings: resolveToolSettings(tool, previous?.settings),
          },
        ];
      });
      return outcome;
    },
    async rollback(id) {
      const owner = account.getState().currentUser?.id;
      if (!owner) throw new Error("请先登录 AAW。");
      const assertOwner = () => {
        if (account.getState().currentUser?.id !== owner) throw new Error("账号已切换，已取消版本回退。请在当前账号重新操作。");
      };
      await backups.settled();
      assertOwner();
      const backup = await readToolBackup(io, owner, id);
      assertOwner();
      if (!backup) return undefined;
      // 回滚本身也是一次安装：被换下来的那一版会自动成为新的"上一版"，
      // 所以点错了还能再点一次换回去。
      const install = ctx.tools.install.bind(ctx.tools);
      return install(backup, true);
    },
    setSource(id, dir) {
      update((current) => current.map((entry) => entry.package.id === id
        ? { ...entry, dir }
        : entry));
    },
    open(id) {
      update((current) => current.map((entry) =>
        entry.package.id === id ? { ...entry, lastOpened: Date.now() } : entry,
      ));
    },
    remove(id) {
      update((current) => current.filter((entry) => entry.package.id !== id));
    },
    saveSettings(id, values) {
      update((current) => {
        if (!current.some((entry) => entry.package.id === id)) throw new Error("插件已卸载。");
        return current.map((entry) => entry.package.id === id
          ? { ...entry, settings: validateToolSettings(entry.package, values) } : entry);
      });
    },
  } satisfies ToolsService);

  ctx.effect(() => {
    pruneBroken();
    const offState = account.subscribe((next, previous) => {
      if (next.currentUser?.id !== previous.currentUser?.id) {
        store.setState(readCurrent(), true);
        pruneBroken();
      }
    });
    const offConfig = scope.subscribe(() => store.setState(readCurrent(), true));
    return () => {
      offConfig();
      offState();
      view.dispose();
      scope.dispose();
    };
  }, "tools:resources");
}
