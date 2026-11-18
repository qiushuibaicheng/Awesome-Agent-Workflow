import { expect, it, vi } from "vitest";
import { createStore } from "zustand";
import type { HostService } from "../../../src/plugins/host/service.ts";
import type { ProjectService } from "../../../src/plugins/project/service.ts";
import { memoryToolIO } from "../../../src/plugins/tools/runtime/io.ts";
import { parseToolPackage } from "../../../src/plugins/tools/runtime/package.ts";
import type { ToolsService } from "../../../src/plugins/tools/service.ts";
import { createWorkshop, syncToolGuide } from "../../../src/plugins/tools/ui/workshop.ts";

/**
 * 工坊的"人接手"路径：AI 回灌 3 轮还修不好时，必须把选择权交回用户——
 * 状态里留着项目路径（UI 用它渲染可复制的文本）和"重新校验"入口。
 * 只写一句"或直接改文件"等于把死路当结论（见 docs 22 §4 P0-2）。
 */
function harness(options: { native?: boolean } = {}) {
  const io = memoryToolIO();
  const dir = "/data/tools/projects/u1/demo";
  const openInFileManager = vi.fn().mockResolvedValue(undefined);
  const host = {
    isNative: () => options.native ?? true,
    skills: {
      userDataDir: (namespace: string, directory: string) => io.userDataDir(namespace, directory),
      pathExists: (path: string) => io.pathExists(path),
      listDirNames: (path: string) => io.listDirNames(path),
      writeTextFile: (path: string, contents: string) => io.writeTextFile(path, contents),
    },
    archives: { readTextFile: (path: string) => io.readTextFile(path) },
    files: { openInFileManager },
  } as unknown as HostService;

  const setSource = vi.fn();
  const tools = {
    state: createStore<readonly never[]>(() => []),
    install: vi.fn(),
    rollback: vi.fn(),
    setSource,
    open: vi.fn(),
    remove: vi.fn(),
    saveSettings: vi.fn(),
  } as unknown as ToolsService;

  // 会话是否在跑由测试推：工坊订阅的是"true → false"这个沿。
  const session = createStore<{ isAgentRunning: boolean; activeSessionId: string }>(
    () => ({ isAgentRunning: false, activeSessionId: "s1" }),
  );
  const send = vi.fn();
  const project = {
    projects: {
      workspace: createStore(() => ({ activePath: dir })),
      setRecentExclusions: vi.fn(),
      registerProject: vi.fn(),
      pickDirectory: vi.fn(),
    },
    sessions: {
      catalog: createStore(() => ({ agentKey: "agent" })),
      startNewSession: vi.fn(),
    },
    conversation: { send, foreground: { session } },
  } as unknown as ProjectService;

  const workshop = createWorkshop({ tools, project, host, owner: () => "u1" });
  return { workshop, io, dir, send, openInFileManager, session, setSource };
}

/** 让 AI 停下来：工坊的回调是订阅里发的，不等它跑完就断言会读到旧状态。 */
function stopAgent(session: ReturnType<typeof harness>["session"]) {
  session.setState({ isAgentRunning: true });
  session.setState({ isAgentRunning: false });
}

it("hands over to the user after three repair rounds, with both actions wired", async () => {
  const { workshop, io, dir, send, session } = harness();
  await io.writeTextFile(`${dir}/manifest.json`, JSON.stringify({
    schemaVersion: 1, id: "demo", name: "演示", version: "1.0.0", html: "",
    actions: [{ id: "run", description: "跑", inputSchema: { type: "object", properties: {} } }],
  }));
  await io.writeTextFile(`${dir}/index.html`, "<p>没有实现</p>");
  await workshop.select(dir);
  expect(workshop.state.getState().check?.ready).toBe(false);

  for (let round = 1; round <= 3; round += 1) {
    stopAgent(session);
    // 回灌是订阅里的异步回调：等它真的发出去，否则下一轮读到的还是旧计数。
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(round));
  }
  expect(workshop.state.getState().stalled).toBe(false);

  // 第四轮：轮数用满，不再打扰 AI，改成把选择权交回用户。
  stopAgent(session);
  await vi.waitFor(() => expect(workshop.state.getState().stalled).toBe(true));
  expect(send).toHaveBeenCalledTimes(3);
  const stalled = workshop.state.getState().note?.text ?? "";
  expect(stalled).toContain("3 轮");
  expect(stalled).not.toContain("直接改文件");

  // 交接时项目路径还在状态里：UI 靠它渲染可复制的路径文本，不需要再打开目录。
  expect(workshop.state.getState().project?.dir).toBe(dir);

  await io.writeTextFile(`${dir}/index.html`, "<p>改好了</p><script>window.aawActions={run:async()=>({ok:true})}</script>");
  await workshop.verify();
  expect(workshop.state.getState().stalled).toBe(false);
  expect(workshop.state.getState().note?.text).toContain("校验通过");
  expect(workshop.state.getState().check?.ready).toBe(true);
});

/**
 * 开发规范是平台默认写给 AI 的，不再需要用户点「同步到 AI 技能目录」：
 * 建工坊时静默写一次，写的是含 R9 通用性红线与五个能力入口的那份正文。
 */
it("silently installs the same guide into the skill directory on startup", async () => {
  const { workshop, io } = harness();
  await vi.waitFor(() => expect(io.files.get("chrys/skills/tool-dev/SKILL.md")).toBeTruthy());
  const skill = io.files.get("chrys/skills/tool-dev/SKILL.md")!;
  expect(skill).toContain("R9");
  expect(skill).toContain("aawClipboard");
  expect(skill).toContain("平台框架");
  workshop.dispose();
});

it("syncToolGuide writes the guide through the narrow file port", async () => {
  const io = memoryToolIO();
  await syncToolGuide(io);
  expect(io.files.get("chrys/skills/tool-dev/SKILL.md")).toContain("name: tool-dev");
});


/**
 * 从 ZIP 装进来的工具解到 `tools/installed/`，不进 `tools/projects/`。
 *
 * 两个目录的**归属**不同：`projects/` 是用户自己的源码（卸载时不替用户删），
 * `installed/` 是我们解出来的运行副本（卸载时该连 `node_modules` 一起清）。
 * 混在一起的代价以前是看得见的——导入一个 ZIP，那个工具会以"工具项目"的身份
 * 出现在用户从没创建过的项目列表里。
 */
it("extracts an imported archive into installed/, never into the author's projects", async () => {
  const { workshop, io } = harness();
  const manifest = JSON.stringify({ schemaVersion: 1, id: "demo", name: "Demo", version: "1.0.0" });
  const installer = new TextEncoder();
  await workshop.installArchive(
    { schemaVersion: 1, id: "demo", name: "Demo", version: "1.0.0", html: "<p>hi</p>" },
    { "manifest.json": installer.encode(manifest), "index.html": installer.encode("<p>hi</p>") },
  );
  const written = [...io.files.keys()];
  // 只关心工具落盘那部分：建工坊时还会往技能目录静默写一份开发规范。
  const toolFiles = written.filter((path) => path.startsWith("tools/"));
  expect(toolFiles.length).toBeGreaterThan(0);
  expect(toolFiles.filter((path) => path.startsWith("tools/projects/"))).toEqual([]);
  expect(toolFiles.every((path) => path.startsWith("tools/installed/u1/demo/"))).toBe(true);
  workshop.dispose();
});

/**
 * 契约不够的包要"从头到尾没碰过磁盘"。
 *
 * 以前闸门只在 `tools.install()` 里，而 installArchive 是先把 ZIP 解压、
 * 写进 `installed/<账号>/<id>/` 再调 install。被拒之后注册表没记录，
 * 目录却留着：界面看不见、卸载清不到、白占空间（带 node_modules 时尤其明显）。
 */
it("rejects an incompatible archive before creating any directory", async () => {
  const { workshop, io } = harness();
  const tool = parseToolPackage(JSON.stringify({
    schemaVersion: 1, id: "future", name: "未来版工具", version: "1.0.0",
    html: "<p>hi</p>", requires: { contract: 99 },
  }));
  const encoder = new TextEncoder();
  await expect(workshop.installArchive(tool, {
    "manifest.json": encoder.encode(JSON.stringify({ schemaVersion: 1, id: "future", name: "未来版工具", version: "1.0.0", requires: { contract: 99 } })),
    "index.html": encoder.encode("<p>hi</p>"),
  })).rejects.toThrow(/第 99 代/);
  expect([...io.files.keys()].filter((path) => path.startsWith("tools/installed/"))).toEqual([]);
  workshop.dispose();
});

/**
 * 迁移的落点必须跟项目列表同一个账号层。
 *
 * 以前这一步在面板里直接调 `migrateLegacyTools(io, tools)`，没传 owner，
 * 于是所有旧工具都迁进了 `projects/anonymous/`，而项目列表扫的是
 * `projects/<账号>/`——用户看到"已把 2 个旧工具迁成项目目录"，去「开发工具」
 * 里却一个也没有。这条断言盯的就是那个 anonymous 目录不再出现。
 */
it("migrates legacy tools into the signed-in account, not into anonymous", async () => {
  const { workshop, io, setSource } = harness();
  const tool = parseToolPackage(JSON.stringify({
    schemaVersion: 1, id: "legacy", name: "旧工具", version: "1.0.0", html: "<p>hi</p>",
  }));
  const result = await workshop.migrateLegacy([tool]);
  expect(result.created).toEqual(["tools/projects/u1/legacy"]);
  expect(await io.pathExists("tools/projects/u1/legacy/manifest.json")).toBe(true);
  expect(await io.pathExists("tools/projects/anonymous/legacy/manifest.json")).toBe(false);
  // 迁出来的目录要登记成这个工具的源码位置，卡片才判得出"项目改了没重装"。
  expect(setSource).toHaveBeenCalledWith("legacy", "tools/projects/u1/legacy");
  workshop.dispose();
});
