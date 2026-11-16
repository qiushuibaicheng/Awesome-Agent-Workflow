import { it, expect } from "vitest";
import type { Context } from "cordis";
import { createTestDesktopRuntime } from "../../helpers/desktopRuntime.ts";
import { openLauncherPanel } from "../../../src/plugins/workbench/navigation/launcher.ts";
import { pathKey } from "../../../src/shared/panelPaths.ts";
import { installWorkbench } from "../../../src/plugins/tools/index.ts";

it("opens existing workbench contributions and rejects missing project or unregistered targets", async () => {
  let ctx: Context | undefined;
  const runtime = createTestDesktopRuntime({ attachPreloading: () => () => {}, close: async () => {} }, undefined, (value) => { ctx = value; });
  try {
    await runtime.ready;
    await installWorkbench(ctx!);
    const workbench = ctx!.workbench;
    expect(() => openLauncherPanel(workbench, "not-registered")).toThrow("不可用");
    expect(() => openLauncherPanel(workbench, "tools")).toThrow("选择一个项目");
    workbench.navigation.getState().openView("project", "E:/launcher-project");
    openLauncherPanel(workbench, "tools");
    const panel = workbench.panels.getState().projects[pathKey("E:/launcher-project")];
    expect(panel?.active).toBe("tools");
    openLauncherPanel(workbench, "tools");
    expect(workbench.panels.getState().projects[pathKey("E:/launcher-project")]?.tabs.filter((tab) => tab.id === "tools")).toHaveLength(1);
  } finally { await runtime.shutdown(); }
});
