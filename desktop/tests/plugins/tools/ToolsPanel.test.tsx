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
import { fakeWorkshop } from "./fakeWorkshop.ts";

it("defers a selected source update until dirty settings are explicitly discarded", () => {
  const update = vi.fn();
  const { container } = render(<ToolManagement entry={{ package: sampleTool }} onBack={vi.fn()} onOpen={vi.fn()}
    onExport={vi.fn()} onUpdate={update} onSave={() => true} onRemove={vi.fn()} busy={false} />);
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

it("keeps unsaved settings until leaving the tool is explicitly confirmed", () => {
  const state = createStore<readonly PersonalTool[]>(() => [{ package: sampleTool }]);
  const service = { state, install: vi.fn(), rollback: vi.fn(), setSource: vi.fn(), open: vi.fn(), remove: vi.fn(), saveSettings: vi.fn() } satisfies ToolsService;
  const host = { isNative: () => true } as unknown as HostService;
  render(<ToolsPanel service={service} host={host} workshop={fakeWorkshop()} />);
  openCardMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "管理" }));
  fireEvent.change(screen.getByLabelText(/缩进空格数/), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: /返回工具中心/ }));
  expect(screen.getByRole("alert")).toHaveTextContent("未保存");
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(screen.getByLabelText(/缩进空格数/)).toHaveValue(4);
  fireEvent.click(screen.getByRole("button", { name: /返回工具中心/ }));
  fireEvent.click(screen.getByRole("button", { name: "放弃修改并返回" }));
  expect(screen.getByRole("list", { name: "已安装工具" })).toBeVisible();
  expect(service.saveSettings).not.toHaveBeenCalled();
});

/** 卡片上只剩「打开」与「⋯」，管理 / 导出 / 卸载都收进了菜单。 */
function openCardMenu(name = "JSON 格式化") {
  fireEvent.click(screen.getByRole("button", { name: `更多操作：${name}` }));
}

it("opens Electron directly, routes Manage separately, saves settings and exports source ZIP", async () => {
  const state = createStore<readonly PersonalTool[]>(() => [{ package: sampleTool, settings: { indent: 2 } }]);
  const service = { state, install: vi.fn(), rollback: vi.fn(), setSource: vi.fn(), open: vi.fn(), remove: vi.fn(), saveSettings: vi.fn((_id: string, values: ToolSettings) => state.setState([{ package: sampleTool, settings: values }], true)) } satisfies ToolsService;
  const open = vi.fn().mockResolvedValue(undefined);
  const write = vi.fn().mockResolvedValue(undefined);
  const host = { isNative: () => true, openToolsElectron: open, writeToolArchive: write,
    dialogs: { saveFile: vi.fn().mockResolvedValue("E:/export.zip") } } as unknown as HostService;
  render(<ToolsPanel service={service} host={host} workshop={fakeWorkshop()} />);
  fireEvent.click(screen.getByRole("button", { name: "打开 JSON 格式化" }));
  await waitFor(() => expect(open).toHaveBeenCalledWith(sampleTool.id));
  expect(document.querySelector("iframe")).toBeNull();
  openCardMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "管理" }));
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

/** AI 修不动时不能只留一句话：源码路径要看得见可复制，校验要能自己发起（docs 22 §4 P0-2）。 */
it("shows the source path and re-checking once AI gave up", () => {
  const state = createStore<readonly PersonalTool[]>(() => []);
  const service = { state, install: vi.fn(), rollback: vi.fn(), setSource: vi.fn(), open: vi.fn(), remove: vi.fn(), saveSettings: vi.fn() } satisfies ToolsService;
  const host = { isNative: () => true } as unknown as HostService;
  const verify = vi.fn().mockResolvedValue(null);
  const workshop = {
    ...fakeWorkshop({
      project: { dir: "E:/tools/demo", id: "demo", name: "演示" },
      stalled: true,
      note: { text: "还有 2 个问题，AI 试了 3 轮也没修好。", error: true },
    }),
    verify,
  };
  render(<ToolsPanel service={service} host={host} workshop={workshop} />);
  fireEvent.click(screen.getByRole("button", { name: /开发工具/ }));
  expect(screen.getByText(/AI 试了 3 轮也没修好/)).toBeVisible();
  expect(screen.getByText("按这个路径自己改")).toBeVisible();
  // 路径是文本而不是按钮：完整值放在 data-hint 里，旁边有纯前端的复制入口。
  expect(document.querySelectorAll('[data-hint="E:/tools/demo"]').length).toBeGreaterThan(0);
  expect(screen.getAllByRole("button", { name: "复制路径" }).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "我改完了，重新校验" }));
  expect(verify).toHaveBeenCalledOnce();
});
