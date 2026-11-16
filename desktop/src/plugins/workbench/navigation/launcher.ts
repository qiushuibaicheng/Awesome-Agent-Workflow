import type { WorkbenchService } from "../service.ts";

/** Resolve a trusted launcher route against the live contribution registry. */
export function openLauncherPanel(workbench: WorkbenchService, target: string): void {
  const entry = workbench.getSnapshot().panels.find((panel) => panel.id === target && panel.launcher);
  if (!entry) throw new Error("此功能当前不可用。");
  const navigation = workbench.navigation.getState();
  const project = navigation.contextPath;
  if (!project) throw new Error("请先在 AAW 主窗口选择一个项目，再打开此功能。");
  if (workbench.navigationGuard.pending()) throw new Error("请先处理主窗口中尚未完成的操作。");
  navigation.closeOverlay();
  if (entry.launcher?.open) entry.launcher.open(project);
  else workbench.panels.getState().openTab(project, { id: target, kind: target });
}
