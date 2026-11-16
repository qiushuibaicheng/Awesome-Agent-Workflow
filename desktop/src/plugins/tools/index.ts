import type { Context } from "cordis";
import { createStore } from "zustand";
import { createSnapshotView } from "../../shared/state/readonlySnapshot.ts";
import type { ToolsService } from "./service.ts";
import type { PersonalTool } from "./types.ts";
import { readToolPackage } from "./runtime/package.ts";

export const name = "tools";
export const inject = ["account", "configuration"];

export async function installWorkbench(ctx: Context): Promise<void> {
  await ctx.plugin(await import("./ui/workbench.tsx"));
}

function readTools(value: unknown): readonly PersonalTool[] {
  if (!Array.isArray(value)) return [];
  const tools: PersonalTool[] = [];
  const ids = new Set<string>();
  for (const entry of value as readonly unknown[]) {
    if (!entry || typeof entry !== "object") continue;
    const fields = entry as Record<string, unknown>;
    const tool = readToolPackage(fields.package);
    if (!tool || ids.has(tool.id)) continue;
    ids.add(tool.id);
    const lastOpened = fields.lastOpened;
    tools.push({
      package: tool,
      lastOpened: typeof lastOpened === "number" && Number.isFinite(lastOpened) ? lastOpened : undefined,
    });
  }
  return tools.sort((a, b) =>
    (b.lastOpened ?? 0) - (a.lastOpened ?? 0) ||
    a.package.name.localeCompare(b.package.name),
  );
}

export function apply(ctx: Context): void {
  const scope = ctx.configuration.register("aaw-desktop.personal-tools.v1");
  const account = ctx.account.state;
  const userKey = () => {
    const user = account.getState().currentUser;
    return user ? `user:${user.id}` : undefined;
  };
  function readCurrent() {
    const key = userKey();
    if (!key) return [];
    try {
      return readTools(scope.read()?.[key]);
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

  ctx.provide(name, {
    state: view.snapshot,
    install(tool, replace = false) {
      update((current) => {
        const previous = current.find((entry) => entry.package.id === tool.id);
        if (previous && !replace) throw new Error("已安装相同 ID 的工具。请在开发模式中更新，或先卸载旧版本。");
        return [
          ...current.filter((entry) => entry.package.id !== tool.id),
          { package: tool, lastOpened: previous?.lastOpened },
        ];
      });
    },
    open(id) {
      update((current) => current.map((entry) =>
        entry.package.id === id ? { ...entry, lastOpened: Date.now() } : entry,
      ));
    },
    remove(id) {
      update((current) => current.filter((entry) => entry.package.id !== id));
    },
  } satisfies ToolsService);

  ctx.effect(() => {
    const offState = account.subscribe((next, previous) => {
      if (next.currentUser?.id !== previous.currentUser?.id) store.setState(readCurrent(), true);
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
