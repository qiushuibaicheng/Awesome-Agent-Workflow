import { it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createStore } from "zustand";
import { ToolsPanel } from "../../../src/plugins/tools/ui/ToolsPanel.tsx";
import { sampleTool } from "../../../src/plugins/tools/ui/sample.ts";
import type { PersonalTool, ToolSettings } from "../../../src/plugins/tools/types.ts";
import type { ToolsService } from "../../../src/plugins/tools/service.ts";
import type { HostService } from "../../../src/plugins/host/service.ts";
import { importToolProject } from "../../../src/plugins/tools/runtime/projectArchive.ts";
import { ToolManagement } from "../../../src/plugins/tools/ui/ToolManagement.tsx";

it("defers a selected source update until dirty settings are explicitly discarded", () => {
  const update = vi.fn();
  const { container } = render(<ToolManagement entry={{ package: sampleTool }} onBack={vi.fn()} onOpen={vi.fn()}
    onExport={vi.fn()} onUpdate={update} onEdit={vi.fn()} onSave={() => true} onRemove={vi.fn()} busy={false} />);
  fireEvent.change(screen.getByLabelText(/缩进空格数/), { target: { value: "4" } });
  const file = new File(["{}"], "update.json", { type: "application/json" });
  const picker = container.querySelector('input[type="file"]')!;
  fireEvent.change(picker, { target: { files: [file] } });
  expect(update).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "继续编辑" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(screen.getByLabelText(/缩进空格数/)).toHaveValue(4);
  fireEvent.change(picker, { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "放弃修改并继续" }));
  expect(update).toHaveBeenCalledExactlyOnceWith(file);
});

it("keeps unsaved settings until source editing is explicitly confirmed", () => {
  const state = createStore<readonly PersonalTool[]>(() => [{ package: sampleTool }]);
  const service = { state, install: vi.fn(), open: vi.fn(), remove: vi.fn(), saveSettings: vi.fn() } satisfies ToolsService;
  const host = { isNative: () => true } as unknown as HostService;
  render(<ToolsPanel service={service} host={host} />);
  fireEvent.click(screen.getByRole("button", { name: "管理 JSON 格式化" }));
  fireEvent.change(screen.getByLabelText(/缩进空格数/), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "编辑工具包" }));
  expect(screen.getByRole("alert")).toHaveTextContent("未保存");
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(screen.getByLabelText(/缩进空格数/)).toHaveValue(4);
  fireEvent.click(screen.getByRole("button", { name: "编辑工具包" }));
  fireEvent.click(screen.getByRole("button", { name: "放弃修改并继续" }));
  expect(screen.getByLabelText("工具包源码")).toBeVisible();
  expect(service.saveSettings).not.toHaveBeenCalled();
});

it("opens Electron directly, routes Manage separately, saves settings and exports source ZIP", async () => {
  const state = createStore<readonly PersonalTool[]>(() => [{ package: sampleTool, settings: { indent: 2 } }]);
  const service = { state, install: vi.fn(), open: vi.fn(), remove: vi.fn(), saveSettings: vi.fn((_id: string, values: ToolSettings) => state.setState([{ package: sampleTool, settings: values }], true)) } satisfies ToolsService;
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
  vi.mocked(host.dialogs.saveFile).mockResolvedValueOnce(null);
  fireEvent.click(screen.getByRole("button", { name: "导出源码 ZIP" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已取消导出"));
  expect(write).toHaveBeenCalledTimes(1);
  write.mockRejectedValueOnce(new Error("磁盘无法写入"));
  fireEvent.click(screen.getByRole("button", { name: "导出源码 ZIP" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("导出失败：磁盘无法写入"));
  fireEvent.click(screen.getByRole("button", { name: "卸载" }));
  expect(service.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认卸载" }));
  expect(service.remove).toHaveBeenCalledWith(sampleTool.id);
});
