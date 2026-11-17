import { expect, it, vi } from "vitest";
import { createStore } from "zustand";
import type { HostService } from "../../../src/plugins/host/service.ts";
import type { ProjectService } from "../../../src/plugins/project/service.ts";
import { memoryToolIO } from "../../../src/plugins/tools/runtime/io.ts";
import type { ToolsService } from "../../../src/plugins/tools/service.ts";
import { createWorkshop } from "../../../src/plugins/tools/ui/workshop.ts";

/**
 * 工坊的"人接手"路径：AI 回灌 3 轮还修不好时，用户必须能打开目录、改完
 * 自己发起校验。这两个动作都得真的接到宿主上——只写一句"或直接改文件"
 * 等于把死路当结论（见 docs 22 §4 P0-2）。
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

  const tools = {
    state: createStore<readonly never[]>(() => []),
    install: vi.fn(),
    rollback: vi.fn(),
    setSource: vi.fn(),
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
  return { workshop, io, dir, send, openInFileManager, session };
}

/** 让 AI 停下来：工坊的回调是订阅里发的，不等它跑完就断言会读到旧状态。 */
function stopAgent(session: ReturnType<typeof harness>["session"]) {
  session.setState({ isAgentRunning: true });
  session.setState({ isAgentRunning: false });
}

it("hands over to the user after three repair rounds, with both actions wired", async () => {
  const { workshop, io, dir, send, openInFileManager, session } = harness();
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

  // 两个动作都必须真的能点：打开目录走宿主，重新校验读磁盘。
  await workshop.openDir();
  expect(openInFileManager).toHaveBeenCalledWith(dir, "directory");

  await io.writeTextFile(`${dir}/index.html`, "<p>改好了</p><script>window.aawActions={run:async()=>({ok:true})}</script>");
  await workshop.verify();
  expect(workshop.state.getState().stalled).toBe(false);
  expect(workshop.state.getState().note?.text).toContain("校验通过");
  expect(workshop.state.getState().check?.ready).toBe(true);
});

it("says the directory is gone instead of opening nothing", async () => {
  const { workshop, io, dir, openInFileManager } = harness();
  await workshop.select(dir);
  io.files.clear();
  await workshop.openDir();
  expect(openInFileManager).not.toHaveBeenCalled();
  expect(workshop.state.getState().note?.text).toContain("项目目录不在了");
});

it("refuses to open a local directory in browser preview instead of failing silently", async () => {
  const { workshop, dir, openInFileManager } = harness({ native: false });
  await workshop.select(dir);
  await workshop.openDir();
  expect(openInFileManager).not.toHaveBeenCalled();
  expect(workshop.state.getState().note?.text).toContain("桌面版");
});
