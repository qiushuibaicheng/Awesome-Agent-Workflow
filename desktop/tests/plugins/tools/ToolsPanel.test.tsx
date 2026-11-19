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
  expandSection(/源码与开发/);
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

/** 管理页现在是折叠分区：想用某个分区里的按钮，先点开它的标题。 */
function expandSection(name: RegExp) {
  const head = screen.getByRole("button", { name });
  if (head.getAttribute("aria-expanded") === "false") fireEvent.click(head);
}

it("opens Electron directly, routes Manage separately, saves settings and exports source ZIP", async () => {
  const state = createStore<readonly PersonalTool[]>(() => [{ package: sampleTool, settings: { indent: 2 } }]);
  const service = { state, install: vi.fn(), rollback: vi.fn(), setSource: vi.fn(), open: vi.fn(), remove: vi.fn(), saveSettings: vi.fn((_id: string, values: ToolSettings) => state.setState([{ package: sampleTool, settings: values }], true)) } satisfies ToolsService;
  const open = vi.fn().mockResolvedValue(undefined);
  const write = vi.fn().mockResolvedValue(undefined);
  const stop = vi.fn().mockResolvedValue(undefined);
  const host = { isNative: () => true, openToolsElectron: open, writeToolArchive: write, stopToolsElectron: stop,
    dialogs: { saveFile: vi.fn().mockResolvedValue("E:/export.zip") } } as unknown as HostService;
  render(<ToolsPanel service={service} host={host} workshop={fakeWorkshop()} />);
  fireEvent.click(screen.getByRole("button", { name: "打开 JSON 格式化" }));
  await waitFor(() => expect(open).toHaveBeenCalledWith(sampleTool.id));
  expect(document.querySelector("iframe")).toBeNull();
  openCardMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "管理" }));
  expect(screen.getByRole("button", { name: /自定义设置/ })).toHaveAttribute("aria-expanded", "true");
  fireEvent.change(screen.getByLabelText(/缩进空格数/), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
  expect(service.saveSettings).toHaveBeenCalledWith(sampleTool.id, { indent: 4 });
  expandSection(/源码与开发/);
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
  expandSection(/卸载插件/);
  fireEvent.click(screen.getByRole("button", { name: "卸载" }));
  expect(service.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认卸载" }));
  expect(service.remove).toHaveBeenCalledWith(sampleTool.id);
  // 卸载之后窗口不该继续活着：顺手走同一个停止通道把它关掉。
  expect(stop).toHaveBeenCalledWith(sampleTool.id);
});

/** 分区默认收起，只留摘要；来源目录是文本胶囊，界面不再写死不存在的文件。 */
it("collapses secondary sections and shows the source dir as a copyable text path", () => {
  const dir = "C:/Users/14993/AppData/Roaming/tools/projects/anonymous/json-formatter";
  render(<ToolManagement entry={{ package: sampleTool, dir }} onBack={vi.fn()} onOpen={vi.fn()}
    onExport={vi.fn()} onUpdate={vi.fn()} onSave={() => true} onRemove={vi.fn()} busy={false} />);
  expect(screen.getByRole("button", { name: /自定义设置/ })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: /源码与开发/ })).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("button", { name: /AI 动作/ })).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("button", { name: /插件信息/ })).toHaveAttribute("aria-expanded", "false");
  expandSection(/源码与开发/);
  expect(document.querySelector(`[data-hint="${dir}"]`)).toBeTruthy();
  expect(screen.getByRole("button", { name: "复制路径" })).toBeTruthy();
  // 文件清单跟着导出器走：这个工具没有 AGENTS.md，界面就不该凭空写一个。
  expect(screen.getByText("README.md")).toBeTruthy();
  expect(screen.queryByText("AGENTS.md")).toBeNull();
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

/** 需求可以精心写，界面不再用「一句话」暗示只能随手写一句。 */
it("does not cap the brief to a single sentence, and drops the manual guide-sync module", () => {
  const state = createStore<readonly PersonalTool[]>(() => []);
  const service = { state, install: vi.fn(), rollback: vi.fn(), setSource: vi.fn(), open: vi.fn(), remove: vi.fn(), saveSettings: vi.fn() } satisfies ToolsService;
  const host = { isNative: () => true } as unknown as HostService;
  const { container } = render(<ToolsPanel service={service} host={host} workshop={fakeWorkshop()} />);
  fireEvent.click(screen.getByRole("button", { name: /开发工具/ }));
  expect(screen.getByLabelText("描述你要的工具")).toBeTruthy();
  expect(container.textContent).not.toContain("一句话描述你要的工具");
  expect(container.textContent).not.toContain("让 AI 也按这份指导做工具");
  expect(container.querySelector(".build-guide")).toBeNull();
});

/** 空状态是一个主 CTA + 两个统一尺寸的备选，不再是三种大小的按钮并排。 */
it("gives the empty library one primary CTA and two equally-sized alternatives", () => {
  const state = createStore<readonly PersonalTool[]>(() => []);
  const service = { state, install: vi.fn(), rollback: vi.fn(), setSource: vi.fn(), open: vi.fn(), remove: vi.fn(), saveSettings: vi.fn() } satisfies ToolsService;
  const host = { isNative: () => true } as unknown as HostService;
  const { container } = render(<ToolsPanel service={service} host={host} workshop={fakeWorkshop()} />);
  expect(container.querySelectorAll(".tools-empty-primary")).toHaveLength(1);
  expect(container.querySelectorAll(".tools-empty-alt")).toHaveLength(2);
  expect(container.querySelector(".tools-empty-examples")).toBeNull();
  expect(screen.getByRole("button", { name: "导入工具…" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "载入示例工具" })).toBeTruthy();
});

/** 导入只有一个入口：点「导入工具」弹菜单选 ZIP 还是文件夹（浏览器无文件夹项）。 */
it("routes both import kinds through a single menu entry", () => {
  const state = createStore<readonly PersonalTool[]>(() => []);
  const service = { state, install: vi.fn(), rollback: vi.fn(), setSource: vi.fn(), open: vi.fn(), remove: vi.fn(), saveSettings: vi.fn() } satisfies ToolsService;
  const importFromFolder = vi.fn(() => Promise.resolve({ text: "已导入。" }));
  const native = { isNative: () => true } as unknown as HostService;
  const workshop = { ...fakeWorkshop(), importFromFolder } as never;
  const first = render(<ToolsPanel service={service} host={native} workshop={workshop} />);
  // 头部不再有两个并排导入按钮：文件夹入口收进菜单。
  expect(screen.queryByRole("button", { name: "导入文件夹" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "导入工具" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "导入文件夹…" }));
  expect(importFromFolder).toHaveBeenCalledOnce();
  first.unmount();
  // 同一个菜单在浏览器宿主下不提供文件夹项：点了没用的项等于骗人。
  const web = { isNative: () => false } as unknown as HostService;
  render(<ToolsPanel service={service} host={web} workshop={workshop} />);
  fireEvent.click(screen.getByRole("button", { name: "导入工具" }));
  expect(screen.getByRole("menuitem", { name: "导入 ZIP 包…" })).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: "导入文件夹…" })).toBeNull();
});

/** 常驻工具：关窗只是隐藏，所以列表要标明，菜单要留一条真出口。 */
it("marks background tools and offers a real stop from the card menu", async () => {
  const tool = { ...sampleTool, background: { reason: "剪切板历史" } };
  const state = createStore<readonly PersonalTool[]>(() => [{ package: tool }]);
  const stopToolsElectron = vi.fn(async () => {});
  const service = { state, install: vi.fn(), rollback: vi.fn(), setSource: vi.fn(), open: vi.fn(), remove: vi.fn(), saveSettings: vi.fn() } satisfies ToolsService;
  const host = { isNative: () => true, stopToolsElectron } as unknown as HostService;
  render(<ToolsPanel service={service} host={host} workshop={fakeWorkshop()} />);
  expect(screen.getByText("后台")).toBeVisible();
  openCardMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "停止后台运行" }));
  await waitFor(() => expect(stopToolsElectron).toHaveBeenCalledExactlyOnceWith(tool.id));
  expect(screen.getByRole("status")).toHaveTextContent("已停止该工具的后台运行");
});

/** 非常驻工具不该出现「停止后台运行」：菜单里放一条点了没用的项等于骗人。 */
it("does not offer the background stop for tools that never keep running", () => {
  const state = createStore<readonly PersonalTool[]>(() => [{ package: sampleTool }]);
  const service = { state, install: vi.fn(), rollback: vi.fn(), setSource: vi.fn(), open: vi.fn(), remove: vi.fn(), saveSettings: vi.fn() } satisfies ToolsService;
  const host = { isNative: () => true } as unknown as HostService;
  render(<ToolsPanel service={service} host={host} workshop={fakeWorkshop()} />);
  openCardMenu();
  expect(screen.queryByRole("menuitem", { name: "停止后台运行" })).toBeNull();
});
