import { createRoot } from "react-dom/client";
import { createStore } from "zustand";
import { ToolsPanel } from "../../src/plugins/tools/ui/ToolsPanel.tsx";
import { sampleTool } from "../../src/plugins/tools/ui/sample.ts";
import { resolveToolSettings } from "../../src/plugins/tools/runtime/settings.ts";
import type { PersonalTool } from "../../src/plugins/tools/types.ts";
import type { ToolsService } from "../../src/plugins/tools/service.ts";
import { fakeWorkshop } from "../plugins/tools/fakeWorkshop.ts";
import type { HostService } from "../../src/plugins/host/service.ts";
import "../../src/shared/styles/index.css";

if (new URLSearchParams(location.search).has("warm")) document.documentElement.classList.add("theme-warm");
const entries: PersonalTool[] = [
  { package: { ...sampleTool, settingsSchema: [
    ...sampleTool.settingsSchema!,
    { id: "label", label: "工作区名称", type: "text", default: "我的工作区" },
    { id: "sort", label: "排序方式", type: "select", default: "original", options: [{ value: "original", label: "保持原序" }, { value: "alpha", label: "按名称排序" }] },
    { id: "copy", label: "处理后自动复制", type: "boolean", default: false },
  ] } },
  { package: { ...sampleTool, id: "legacy-tool", name: "未声明设置的工具", settingsSchema: [] } },
];
const state = createStore<readonly PersonalTool[]>(() => entries);
const service: ToolsService = {
  state,
  install: (tool) => ({ version: tool.version, updated: false, versionChanged: false }),
  rollback: () => Promise.resolve(undefined),
  setSource: () => {},
  open: () => {}, remove: () => {},
  saveSettings: (id, values) => state.setState(state.getState().map((entry) => entry.package.id === id ? { ...entry, settings: resolveToolSettings(entry.package, values) } : entry), true),
};
const host = { isNative: () => !new URLSearchParams(location.search).has("web"), openToolsElectron: async () => {} } as unknown as HostService;
createRoot(document.getElementById("root")!).render(<main style={{ height: "100vh" }}><ToolsPanel service={service} host={host} workshop={fakeWorkshop()} /></main>);
