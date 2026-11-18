import { createStore } from "zustand";
import type { WorkshopService, WorkshopSnapshot } from "../../../src/plugins/tools/ui/workshop.ts";

/**
 * 面板测试用的工坊替身：面板只读快照、只调动作，不需要真实项目服务。
 * 默认是"什么都没在做"的状态，需要的话用 `overrides` 摆出正在校验/可安装。
 */
export function fakeWorkshop(overrides: Partial<WorkshopSnapshot> = {}): WorkshopService {
  const store = createStore<WorkshopSnapshot>(() => ({
    brief: "",
    parent: null,
    project: null,
    check: null,
    note: null,
    busy: false,
    installed: false,
    drift: false,
    stalled: false,
    repairs: 0,
    running: false,
    projects: [],
    projectsLoading: false,
    projectsRoot: "E:/AAW/tools/projects",
    ...overrides,
  }));
  const idle = async () => {};
  return {
    state: store,
    setBrief: (value) => store.setState({ brief: value }),
    chooseParent: idle,
    resetParent: () => {},
    create: idle,
    verify: () => Promise.resolve(null),
    install: () => Promise.resolve(false),
    installArchive: (tool) => Promise.resolve({ version: tool.version, updated: false, versionChanged: false }),
    rollback: () => Promise.resolve({ text: "没有可回退的版本。" }),
    rename: () => Promise.resolve({ text: "已改名。" }),
    resume: idle,
    select: idle,
    refreshProjects: idle,
    purge: () => Promise.resolve({ text: "已清理。" }),
    dispose: () => {},
  };
}
