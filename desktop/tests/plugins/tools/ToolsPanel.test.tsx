import { it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createStore } from "zustand";
import { ToolsPanel } from "../../../src/plugins/tools/ui/ToolsPanel.tsx";
import { sampleTool } from "../../../src/plugins/tools/ui/sample.ts";
import type { PersonalTool } from "../../../src/plugins/tools/types.ts";
import type { ToolsService } from "../../../src/plugins/tools/service.ts";
import type { HostService } from "../../../src/plugins/host/service.ts";
import { importToolProject } from "../../../src/plugins/tools/runtime/projectArchive.ts";

it("opens Electron directly, routes Manage separately, saves settings and exports source ZIP", async () => {
  const state = createStore<readonly PersonalTool[]>(() => [{ package: sampleTool, settings: { indent: 2 } }]);
  const service = { state, install: vi.fn(), open: vi.fn(), remove: vi.fn(), saveSettings: vi.fn((_id, values) => state.setState([{ package: sampleTool, settings: values }], true)) } satisfies ToolsService;
  const open = vi.fn().mockResolvedValue(undefined);
  const write = vi.fn().mockResolvedValue(undefined);
  const host = { isNative: () => true, openToolsElectron: open, writeToolArchive: write,
    dialogs: { saveFile: vi.fn().mockResolvedValue("E:/export.zip") } } as unknown as HostService;
  render(<ToolsPanel service={service} host={host} />);
  fireEvent.click(screen.getByRole("button", { name: "打开 JSON 格式化" }));
  await waitFor(() => expect(open).toHaveBeenCalledWith(sampleTool.id));
  expect(document.querySelector("iframe")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "管理 JSON 格式化" }));
  expect(screen.getByRole("heading", { name: "自定义设置" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/缩进空格数/), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
  expect(service.saveSettings).toHaveBeenCalledWith(sampleTool.id, { indent: 4 });
  fireEvent.click(screen.getByRole("button", { name: "导出源码 ZIP" }));
  await waitFor(() => expect(write).toHaveBeenCalled());
  const exported = importToolProject(write.mock.calls[0]![1] as Uint8Array);
  expect(exported.settingsSchema?.[0]?.default).toBe(2);
  expect(exported).not.toHaveProperty("settings");
  expect(exported.html).toBe(sampleTool.html);
  fireEvent.click(screen.getByRole("button", { name: "卸载" }));
  expect(service.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认卸载" }));
  expect(service.remove).toHaveBeenCalledWith(sampleTool.id);
});
