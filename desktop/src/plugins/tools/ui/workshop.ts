/**
 * 工具工坊：从"一句话需求"到"装进工具中心"的完整状态机。
 *
 * 为什么状态不放在 React 组件里：新建工具会调用 `startNewSession`，而它
 * 一进来就把主内容区切到会话页（`sessionStart.ts` 的 `openView`）。面板
 * 因此被卸载，`useState` 与 `useEffect` 订阅一起消失——AI 写完后没人校验，
 * 用户回到面板看到的是一张空卡片。所以状态与订阅都放在插件层（这个模块
 * 由 `tools-ui` 的 `apply()` 创建一次），面板只是它的一个视图。
 *
 * 三个身份维度在这里汇合，别混：
 * - `owner`：账号，决定项目目录与工具数据落在哪一层；
 * - `projectDir`：当前在做的那个工具项目；
 * - `brief`：用户写的需求原文，只用于建项目与首条消息。
 */
import { createStore } from "zustand";
import { pathKey } from "../../../shared/panelPaths.ts";
import { createSnapshotView } from "../../../shared/state/readonlySnapshot.ts";
import type { ReadonlySnapshot } from "../../../shared/state/readonlySnapshot.ts";
import type { HostService } from "../../host/service.ts";
import type { ProjectService } from "../../project/service.ts";
import { briefMessage, repairMessage, toolGuideSkill } from "../runtime/guide.ts";
import {
  checkToolProject, createToolProject, listToolProjectSummaries,
  toolProjectIdFromBrief,
  type ToolProjectCheck,
  type ToolProjectIO,
  type ToolProjectSummary,
} from "../runtime/project.ts";
import type { InstallOutcome, ToolsService } from "../service.ts";

/** 一轮最多几次自动回灌。超过就把问题摊给用户——AI 卡住时人得能接管。 */
const maxRepairRounds = 3;

export interface WorkshopNote {
  readonly text: string;
  readonly error?: true;
}

export interface WorkshopProject {
  readonly dir: string;
  readonly id: string;
  readonly name: string;
}

export interface WorkshopSnapshot {
  readonly brief: string;
  readonly parent: string | null;
  readonly project: WorkshopProject | null;
  readonly check: ToolProjectCheck | null;
  readonly note: WorkshopNote | null;
  readonly busy: boolean;
  /** 当前项目是否已通过"确认安装"进了工具中心。 */
  readonly installed: boolean;
  readonly repairs: number;
  /** 前台会话里 AI 是否正在写；面板据此显示"正在写…"。 */
  readonly running: boolean;
  readonly projects: readonly ToolProjectSummary[];
  readonly projectsLoading: boolean;
  /** 一键写入手册的结果（成功/失败都留一条，避免按钮点了没反应）。 */
  readonly guideNote: WorkshopNote | null;
}

export interface WorkshopService {
  readonly state: ReadonlySnapshot<WorkshopSnapshot>;
  setBrief(value: string): void;
  chooseParent(): Promise<void>;
  resetParent(): void;
  /** 建项目 → 注册工作区 → 开会话 → 发首条消息。 */
  create(): Promise<void>;
  verify(dir?: string): Promise<ToolProjectCheck | null>;
  install(): Promise<boolean>;
  /** 打开一个已有工具项目（继续开发：新开一条会话）。 */
  resume(dir: string): Promise<void>;
  /** 选中一个已有项目作为"当前项目"（只校验，不切视图）。 */
  select(dir: string | null): Promise<void>;
  refreshProjects(): Promise<void>;
  /** 卸载清理：删目录与工具数据。返回给用户看的一句话。 */
  purge(id: string): Promise<WorkshopNote>;
  installGuide(): Promise<void>;
  dispose(): void;
}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function projectIO(host: HostService): ToolProjectIO {
  return {
    userDataDir: (namespace, directory) => host.skills.userDataDir(namespace, directory),
    pathExists: (path) => host.skills.pathExists(path),
    listDirNames: (path) => host.skills.listDirNames(path),
    readTextFile: (path) => host.archives.readTextFile(path),
    writeTextFile: (path, contents) => host.skills.writeTextFile(path, contents),
  };
}

/** 安装结果的用户话术：说清"新装/更新"、版本从哪到哪、版本号有没有动。 */
export function describeInstall(outcome: InstallOutcome, name: string): string {
  if (!outcome.updated) return `已安装 ${name} v${outcome.version}。`;
  if (!outcome.versionChanged)
    return `已覆盖 ${name} v${outcome.version}（版本号没变，内容已更新）。改完版本号再装一次，才看得出是升级。`;
  return `已更新 ${name}：v${outcome.previousVersion ?? "?"} → v${outcome.version}。`;
}

export function createWorkshop(deps: {
  readonly tools: ToolsService;
  readonly project: ProjectService;
  readonly host: HostService;
  /** 当前账号 id（由调用方订阅 account 后传入，换账号要能重新取）。 */
  readonly owner: () => string | undefined;
}): WorkshopService {
  const { tools, project, host } = deps;
  const io = projectIO(host);

  const store = createStore<WorkshopSnapshot>(() => ({
    brief: "",
    parent: null,
    project: null,
    check: null,
    note: null,
    busy: false,
    installed: false,
    repairs: 0,
    running: false,
    projects: [],
    projectsLoading: false,
    guideNote: null,
  }));
  const view = createSnapshotView(store, (snapshot) => snapshot);
  const patch = (next: Partial<WorkshopSnapshot>) => store.setState(next);

  /** 当前项目是不是前台会话所在的工作区——不是就别拿别的会话的停止事件来校验。 */
  function isForeground(dir: string): boolean {
    const active = project.projects.workspace.getState().activePath;
    return !!active && pathKey(active) === pathKey(dir);
  }

  async function readCheck(dir: string): Promise<ToolProjectCheck> {
    const result = await checkToolProject(io, dir);
    patch({ check: result });
    return result;
  }

  /** 把校验问题回灌给会话；返回是否真的发出去了。 */
  function sendRepair(dir: string, check: ToolProjectCheck): boolean {
    const agentKey = project.sessions.catalog.getState().agentKey ?? "";
    if (!agentKey) {
      patch({ note: { text: "会话还没连上 Agent，无法自动回灌。把下面的问题复制给 AI 即可。", error: true } });
      return false;
    }
    project.conversation.send({
      workspacePath: dir,
      agentKey,
      sessionId: project.conversation.foreground.session.getState().activeSessionId,
    }, repairMessage(check.blocking));
    return true;
  }

  async function afterAgentStops(dir: string): Promise<void> {
    let result: ToolProjectCheck;
    try {
      result = await readCheck(dir);
    } catch (error) {
      patch({ note: { text: errorText(error), error: true } });
      return;
    }
    if (result.ready) {
      patch({
        repairs: 0,
        note: {
          text: result.warnings.length
            ? `校验通过（${result.warnings.length} 条建议）。可以预览验收了。`
            : "校验通过，可以预览验收了。",
        },
      });
      return;
    }
    const repairs = store.getState().repairs;
    if (!result.tool || repairs >= maxRepairRounds) {
      patch({
        note: {
          text: `还有 ${result.blocking.length} 个问题没修好，已经试了 ${maxRepairRounds} 轮。可以复制下面的问题继续问 AI，或直接改文件。`,
          error: true,
        },
      });
      return;
    }
    if (!isForeground(dir)) return;
    if (!sendRepair(dir, result)) return;
    patch({ repairs: repairs + 1, note: { text: `发现问题，已回给 AI 修（第 ${repairs + 1} 轮）。` } });
  }

  // AI 停下来就校验。订阅挂在插件层，面板切走/重挂都不影响。
  const session = project.conversation.foreground.session;
  let running = session.getState().isAgentRunning;
  const unsubscribe = session.subscribe((state) => {
    const stopped = running && !state.isAgentRunning;
    running = state.isAgentRunning;
    if (state.isAgentRunning !== store.getState().running) patch({ running: state.isAgentRunning });
    if (!stopped) return;
    const dir = store.getState().project?.dir;
    if (!dir) return;
    void afterAgentStops(dir);
  });

  // 工具项目不进侧栏「最近项目」：它们由工具中心自己管。
  void (async () => {
    try {
      const root = await io.userDataDir("tools", "projects");
      project.projects.setRecentExclusions([root]);
    } catch { /* 拿不到目录只是不排除，不影响主流程 */ }
  })();

  async function refreshProjects(): Promise<void> {
    patch({ projectsLoading: true });
    try {
      const projects = await listToolProjectSummaries(io, { owner: deps.owner() });
      patch({ projects });
    } catch (error) {
      patch({ note: { text: `读取工具项目失败：${errorText(error)}`, error: true } });
    } finally {
      patch({ projectsLoading: false });
    }
  }

  async function select(dir: string | null): Promise<void> {
    if (!dir) {
      patch({ project: null, check: null, installed: false, repairs: 0 });
      return;
    }
    const summary = store.getState().projects.find((entry) => entry.dir === dir);
    patch({
      project: {
        dir,
        id: summary?.id ?? dir.split(/[\\/]/).pop() ?? "tool",
        name: summary?.name ?? summary?.dirName ?? dir,
      },
      installed: tools.state.getState().some((entry) => entry.package.id === summary?.id),
      repairs: 0,
    });
    try { await readCheck(dir); }
    catch (error) { patch({ note: { text: errorText(error), error: true } }); }
  }

  async function verify(dir?: string): Promise<ToolProjectCheck | null> {
    const target = dir ?? store.getState().project?.dir;
    if (!target) return null;
    try {
      return await readCheck(target);
    } catch (error) {
      patch({ note: { text: errorText(error), error: true } });
      return null;
    }
  }

  async function install(): Promise<boolean> {
    const current = store.getState().project;
    if (!current) return false;
    const result = await verify(current.dir);
    if (!result?.ready || !result.tool) {
      patch({ note: { text: "还有必须修的问题，先让 AI 修完再安装。", error: true } });
      return false;
    }
    try {
      const outcome = tools.install(result.tool, true);
      patch({ installed: true, note: { text: describeInstall(outcome, result.tool.name) } });
      void refreshProjects();
      return true;
    } catch (error) {
      patch({ note: { text: errorText(error), error: true } });
      return false;
    }
  }

  return {
    state: view.snapshot,
    setBrief(value) { patch({ brief: value }); },
    resetParent() { patch({ parent: null }); },

    async chooseParent() {
      const path = await project.projects.pickDirectory();
      if (path) patch({ parent: path });
    },

    async create() {
      const state = store.getState();
      const brief = state.brief.trim();
      if (!brief || state.busy) return;
      patch({ busy: true, note: null, installed: false, check: null, repairs: 0 });
      try {
        const name = brief.slice(0, 24);
        const wanted = toolProjectIdFromBrief(brief);
        const created = await createToolProject(io, {
          id: wanted, name, ...(state.parent ? { parent: state.parent } : {}), owner: deps.owner(),
        });
        // 同名目录已存在时会退到 -2，得让用户知道"不是覆盖，是新建了一份"。
        const renamed = created.id === wanted ? "" : `已有同名项目，这次建成了 ${created.id}。`;
        patch({ project: { dir: created.dir, id: created.id, name: created.name } });
        project.projects.registerProject(created.dir);
        const started = await project.sessions.startNewSession(created.dir);
        if (!started.ok) {
          patch({ note: { text: `${renamed}项目已建好，但会话没连上（${started.reason}）。可以稍后在会话里继续。`, error: true } });
          void refreshProjects();
          return;
        }
        const agentKey = project.sessions.catalog.getState().agentKey ?? "";
        if (agentKey) {
          project.conversation.send({
            workspacePath: created.dir,
            agentKey,
            sessionId: project.conversation.foreground.session.getState().activeSessionId,
          }, briefMessage(brief, created));
          patch({ note: { text: `${renamed}会话已开始，AI 写完后会自动校验。` } });
        } else {
          patch({ note: { text: `${renamed}会话已建好，但还没连上 Agent。连上后把需求发给它即可（项目里的 AGENTS.md 就是规范）。` } });
        }
        void refreshProjects();
      } catch (error) {
        patch({ note: { text: errorText(error), error: true } });
      } finally {
        patch({ busy: false });
      }
    },

    verify,
    install,

    async resume(dir) {
      await select(dir);
      patch({ note: null });
      try {
        project.projects.registerProject(dir);
        const started = await project.sessions.startNewSession(dir);
        if (!started.ok) patch({ note: { text: `会话没连上（${started.reason}），可稍后重试。`, error: true } });
      } catch (error) {
        patch({ note: { text: errorText(error), error: true } });
      }
    },

    select,

    refreshProjects,

    async purge(id) {
      const owner = deps.owner() ?? "";
      const dirs = (await listToolProjectSummaries(io, { owner }))
        .filter((entry) => entry.id === id)
        .map((entry) => entry.dir);
      try {
        const report = await host.skills.toolPurge({ toolId: id, owner, projectDirs: dirs });
        const parts: string[] = [];
        if (report.removedDirs.length) parts.push(`已删除 ${report.removedDirs.length} 个项目目录`);
        if (report.removedData) parts.push("已删除工具数据");
        if (report.skippedDirs.length) parts.push(`${report.skippedDirs.length} 个目录没有删除（不在受管目录内，或不是这个工具）`);
        if (store.getState().project && dirs.includes(store.getState().project!.dir))
          patch({ project: null, check: null, installed: false });
        void refreshProjects();
        return { text: parts.length ? parts.join("；") + "。" : "没有找到需要清理的文件。" };
      } catch (error) {
        return { text: `清理失败：${errorText(error)}`, error: true };
      }
    },

    async installGuide() {
      try {
        const dir = await io.userDataDir("chrys", "skills");
        await io.writeTextFile(`${dir}/tool-dev/SKILL.md`, toolGuideSkill());
        patch({ guideNote: { text: "开发规范已写入 AI 技能目录，普通会话也会遵守它。" } });
      } catch (error) {
        patch({ guideNote: { text: `写入失败：${errorText(error)}`, error: true } });
      }
    },

    dispose() {
      unsubscribe();
      view.dispose();
    },
  };
}
