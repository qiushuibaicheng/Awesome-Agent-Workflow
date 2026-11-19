/**
 * 工具工坊：从"需求描述"到"装进工具中心"的完整状态机。
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
import { joinPath, pathKey } from "../../../shared/panelPaths.ts";
import { createSnapshotView } from "../../../shared/state/readonlySnapshot.ts";
import type { ReadonlySnapshot } from "../../../shared/state/readonlySnapshot.ts";
import type { HostService } from "../../host/service.ts";
import type { ProjectService } from "../../project/service.ts";
import { briefMessage, repairMessage, toolGuideSkill } from "../runtime/guide.ts";
import {
  checkToolProject, createToolProject, defaultInstalledToolsDir, listToolProjectSummaries,
  migrateLegacyTools, prepareToolDir, readToolDirFiles, readToolProject, renameToolProject, toolProjectFileNames,
  toolProjectIdFromBrief, writeToolFiles,
  type LegacyMigration,
  type ToolProjectCheck,
  type ToolProjectIO,
  type ToolProjectSummary,
} from "../runtime/project.ts";
import { checkCompatibility, ToolPackageError } from "../runtime/package.ts";
import { hostToolIO } from "../runtime/io.ts";
import type { InstallOutcome, ToolsService } from "../service.ts";
import type { ToolPackage } from "../types.ts";

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
  /**
   * 已安装，但项目里的内容跟装进去的那一份不一样了。
   *
   * 这是"AI 改完没点安装"的直接后果：用户以为打开的是新版，其实还是旧的。
   * 与其让他自己猜，不如在卡片上写明「项目已改动，还没装进去」。
   */
  readonly drift: boolean;
  /**
   * AI 自己修不好了：自动回灌用满轮数，或项目连清单都读不出来。
   *
   * 此时唯一的出路是人去看文件——所以界面上必须同时给出「打开目录」和
   * 「我改完了，重新校验」。只写一句"或直接改文件"等于把死路当结论。
   */
  readonly stalled: boolean;
  readonly repairs: number;
  /** 前台会话里 AI 是否正在写；面板据此显示"正在写…"。 */
  readonly running: boolean;
  readonly projects: readonly ToolProjectSummary[];
  readonly projectsLoading: boolean;
  /** 默认项目根目录（AAW 数据目录 / tools / projects），只用于展示。 */
  readonly projectsRoot: string | null;
  /**
   * 用户自定义的项目根目录（设置里存的）。
   *
   * 设置后：新建 / 迁移 / 列表都优先用它（不套账号段，与「选择目录」同一口径），
   * 列表同时扫默认根目录——两边都不会丢项目。
   */
  readonly customRoot: string | null;
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
  /**
   * 安装一个从文件 / 压缩包读出来的工具。
   *
   * 为什么不能直接 `tools.install()`：带依赖的包（`node_modules`、图片、wasm）
   * 没法只写进配置——那些必须落在工具目录里，运行时才 `require` 得到。所以路径是
   * 「先把文件写进目录 → 再从目录读回清单 → 带着目录安装」。
   */
  installArchive(tool: ToolPackage, files?: Readonly<Record<string, Uint8Array>>): Promise<InstallOutcome>;
  /** 退回上一版（覆盖安装前落盘的副本）。 */
  rollback(id: string): Promise<WorkshopNote>;
  /** 改显示名 / 改目录名（= 改 id）。 */
  rename(dir: string, input: { readonly name?: string; readonly id?: string }): Promise<WorkshopNote>;
  /** 打开一个已有工具项目（继续开发：新开一条会话）。 */
  resume(dir: string): Promise<void>;
  /** 选中一个已有项目作为"当前项目"（只校验，不切视图）。 */
  select(dir: string | null): Promise<void>;
  refreshProjects(): Promise<void>;
  /**
   * 旧版本工具体迁成项目目录。
   *
   * 必须由工坊来做：落点要跟"项目列表"用同一个账号那层。放在面板里调时
   * 拿不到 owner，只能落到 `projects/anonymous/`——用户在「开发工具」里
   * 永远看不见这些项目，提示却让他去那里继续开发。
   */
  migrateLegacy(tools: readonly ToolPackage[]): Promise<LegacyMigration>;
  /** 卸载清理：删目录与工具数据。返回给用户看的一句话。 */
  purge(id: string): Promise<WorkshopNote>;
  /** 选一个新的默认项目根目录（设置里持久化；列表与新建都跟着走）。 */
  chooseProjectsRoot(): Promise<void>;
  /** 清掉自定义根目录，回到默认位置。 */
  resetProjectsRoot(): void;
  /** 导入一个本地文件夹（含 manifest.json 与 index.html 的工具目录）。 */
  importFromFolder(): Promise<WorkshopNote>;
  dispose(): void;
}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * 工具的内容指纹：只收影响运行行为的字段。
 *
 * `author` / `source` 是描述性元数据，改了不该提示"项目与已安装的不一致"；
 * 动作、设置、权限、preload 这些改了行为就变了，必须算进去。
 */
export function contentSignature(tool: ToolPackage): string {
  return JSON.stringify({
    name: tool.name,
    version: tool.version,
    icon: tool.icon,
    html: tool.html,
    actions: tool.actions ?? null,
    settingsSchema: tool.settingsSchema ?? null,
    permissions: tool.permissions ?? null,
    requires: tool.requires ?? null,
    needsSelection: tool.needsSelection ?? null,
    background: tool.background ?? null,
    preload: tool.preload ?? null,
    sourceFiles: tool.sourceFiles ?? null,
  });
}

/** 两份工具内容是否不同（影响运行行为的部分）。预览与工坊共用同一个口径。 */
export function toolContentDiffers(left: ToolPackage, right: ToolPackage): boolean {
  return contentSignature(left) !== contentSignature(right);
}

/** 文件端口：`runtime/io.ts` 里的人一个实现，这里保留旧名字给面板用。 */
export const projectIO = hostToolIO;

/**
 * 把同一份开发规范写进 AI 技能目录（普通会话里让 AI 做工具也认得契约）。
 *
 * 平台默认行为，不需要用户点按钮；正文与项目里的 `AGENTS.md` 同源（`guide.ts`）。
 * 单独导出成纯函数是为了能直接单测，调用方负责 catch——技能目录写不了不该
 * 打断工具中心。
 */
export async function syncToolGuide(io: ToolProjectIO): Promise<void> {
  const dir = await io.userDataDir("chrys", "skills");
  await io.writeTextFile(`${dir}/tool-dev/SKILL.md`, toolGuideSkill());
}

/** 安装结果的用户话术：说清"新装/更新"、版本从哪到哪、版本号有没有动。 */
export function describeInstall(outcome: InstallOutcome, name: string): string {
  if (!outcome.updated) return `已安装 ${name} v${outcome.version}。`;
  if (!outcome.versionChanged)
    return `已覆盖 ${name} v${outcome.version}（版本号没变，内容已更新）。改完版本号再装一次，才看得出是升级。`;
  return `已更新 ${name}：v${outcome.previousVersion ?? "?"} → v${outcome.version}。`;
}

/** 校验通过时说同一句话：AI 停下后自动校验、用户手点重新校验，走的是同一个结论。 */
function passText(check: ToolProjectCheck): string {
  return check.warnings.length
    ? `校验通过（${check.warnings.length} 条建议）。可以预览验收了。`
    : "校验通过，可以预览验收了。";
}

export function createWorkshop(deps: {
  readonly tools: ToolsService;
  readonly project: ProjectService;
  readonly host: HostService;
  /** 当前账号 id（由调用方订阅 account 后传入，换账号要能重新取）。 */
  readonly owner: () => string | undefined;
  /**
   * 自定义项目根目录的存取（桌面版由配置作用域 `tools-workshop.v1` 提供）。
   * 省略时（预览模式 / 测试）没有自定义目录，一切落默认位置。
   */
  readonly settings?: {
    readonly read: () => string | undefined;
    readonly write: (value: string | undefined) => void;
  };
}): WorkshopService {
  const { tools, project, host } = deps;
  const io = projectIO(host);

  /** 用户自定义的项目根目录：新建/迁移/列表的优先落点，不套账号段。 */
  let customRoot: string | null = deps.settings?.read() ?? null;
  /** 「继续开发」是否正在开会话：同步标志，挡住连点导致的重复会话。 */
  let resuming = false;
  /** 列表刷新的代际：并发时只认最后一次，避免旧结果覆盖新结果。 */
  let refreshToken = 0;

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
    projectsRoot: null,
    customRoot,
  }));
  const view = createSnapshotView(store, (snapshot) => snapshot);
  const patch = (next: Partial<WorkshopSnapshot>) => store.setState(next);

  /** 当前项目是不是前台会话所在的工作区——不是就别拿别的会话的停止事件来校验。 */
  function isForeground(dir: string): boolean {
    const active = project.projects.workspace.getState().activePath;
    return !!active && pathKey(active) === pathKey(dir);
  }

  /**
   * 校准"装进去的那一份"与"目录里的那一份"。
   *
   * 只比版本号不够——AI 经常改了内容忘了改版本号；只比 html 又漏掉清单里
   * 动作/设置/权限的改动——用户会看到"已安装"，打开却是旧行为。所以比
   * 一整份内容指纹：作者、来源这类描述字段除外（它们不影响跑起来的样子）。
   */
  function syncWithInstalled(tool: ToolPackage | undefined): { installed: boolean; drift: boolean } {
    if (!tool) return { installed: false, drift: false };
    const entry = tools.state.getState().find((item) => item.package.id === tool.id);
    if (!entry) return { installed: false, drift: false };
    return { installed: true, drift: toolContentDiffers(entry.package, tool) };
  }

  async function readCheck(dir: string): Promise<ToolProjectCheck> {
    const result = await checkToolProject(io, dir);
    // 读盘期间用户可能已经切到别的项目：这时的结果不再属于"当前项目"，
    // 写进状态会让卡片拿着 A 的校验结论去描述 B（比如给一个坏项目标"可以验收"）。
    const current = store.getState().project?.dir;
    if (current && pathKey(current) !== pathKey(dir)) return result;
    patch({ check: result, ...syncWithInstalled(result.tool) });
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
        stalled: false,
        note: { text: passText(result) },
      });
      return;
    }
    const repairs = store.getState().repairs;
    if (!result.tool || repairs >= maxRepairRounds) {
      // 到这里自动回灌就到底了。别只留一句"或直接改文件"——用户手里得有
      // 能打开那个目录的按钮，以及改完能自己发起校验的按钮。
      patch({
        stalled: true,
        note: {
          text: result.tool
            ? `还有 ${result.blocking.length} 个问题，AI 试了 ${maxRepairRounds} 轮也没修好。`
            : "这个项目读不出 manifest.json，自动校验没法继续。",
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
  let activeSessionId = session.getState().activeSessionId;
  const unsubscribe = session.subscribe((state) => {
    // 切会话（activeSessionId 变了）不是"AI 停了"：以前会把新会话的空闲状态
    // 当成上一轮结束，去给工坊当前项目做一次莫名其妙的自动校验/回灌。
    const switched = state.activeSessionId !== activeSessionId;
    if (switched) activeSessionId = state.activeSessionId;
    const stopped = running && !state.isAgentRunning && !switched;
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
      patch({ projectsRoot: root });
      project.projects.setRecentExclusions(customRoot ? [root, customRoot] : [root]);
    } catch { /* 拿不到目录只是不排除，不影响主流程 */ }
  })();

  /**
   * 开发规范默认交给 AI，不需要用户点按钮。
   *
   * 每个工具项目里的 `AGENTS.md` 由 `createToolProject` 自动写（ACP agent 每个
   * 会话都会读）；这里是补上「普通会话里让 AI 顺手做个工具」的全局技能目录，
   * 两份正文同源（都出自 `guide.ts`）。做成启动时的静默写入：规范是平台契约，
   * 不该变成一个要用户记得去点的开关，失败也不该弹一条打断用户的提示。
   * 只在桌面版写；浏览器预览模式没有宿主文件通道。
   */
  if (host.isNative()) void syncToolGuide(io).catch(() => { /* 技能目录不可写不影响工具中心：项目里的 AGENTS.md 仍在 */ });

  async function refreshProjects(): Promise<void> {
    // 并发刷新（选中项目、安装、改名都可能同时触发）：只让最后一次的结果落地，
    // 否则先发的慢扫描会把刚改完名的旧列表又写回来。
    const token = ++refreshToken;
    patch({ projectsLoading: true });
    try {
      // 两个根都扫：自定义根目录里的项目以前是“建完就找不到”——列表只认默认
      // 根目录，用户点「继续开发」时点的其实是默认位置下的旧/迁移副本，会话
      // 自然开在错误的目录。两根合并 + 按路径去重，哪边都不丢。
      const [defaultProjects, customProjects] = await Promise.all([
        listToolProjectSummaries(io, { owner: deps.owner() }),
        customRoot
          ? listToolProjectSummaries(io, { parent: customRoot }).catch(() => [])
          : Promise.resolve([] as readonly ToolProjectSummary[]),
      ]);
      if (token !== refreshToken) return;
      const seen = new Set<string>();
      const projects = [...defaultProjects, ...customProjects].filter((entry) => {
        const key = pathKey(entry.dir);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      patch({ projects });
    } catch (error) {
      if (token === refreshToken) patch({ note: { text: `读取工具项目失败：${errorText(error)}`, error: true } });
    } finally {
      if (token === refreshToken) patch({ projectsLoading: false });
    }
  }

  async function select(dir: string | null): Promise<void> {
    if (!dir) {
      patch({ project: null, check: null, installed: false, drift: false, stalled: false, repairs: 0 });
      return;
    }
    // 列表去重用 pathKey，这里也用它比：大小写 / 分隔符差异不该让摘要查不到。
    const key = pathKey(dir);
    const summary = store.getState().projects.find((entry) => pathKey(entry.dir) === key);
    patch({
      project: {
        dir,
        id: summary?.id ?? dir.split(/[\\/]/).pop() ?? "tool",
        name: summary?.name ?? summary?.dirName ?? dir,
      },
      stalled: false,
      repairs: 0,
    });
      try { await readCheck(dir); }
      catch (error) { patch({ note: { text: errorText(error), error: true } }); }
      // 选中后立刻刷新一次列表：目录可能是 AI 刚写完、列表还是旧的。
      void refreshProjects();
    }

  async function verify(dir?: string): Promise<ToolProjectCheck | null> {
    const target = dir ?? store.getState().project?.dir;
    if (!target) return null;
    try {
      const result = await readCheck(target);
      // 手动点「重新校验」必须留下结论：否则界面看起来跟点之前一模一样，
      // 用户会怀疑按钮没生效。
      patch(result.ready
        ? { stalled: false, repairs: 0, note: { text: passText(result) } }
        : { note: { text: `还有 ${result.blocking.length} 个问题没解决。`, error: true } });
      return result;
    } catch (error) {
      patch({ note: { text: errorText(error), error: true } });
      return null;
    }
  }

  async function install(): Promise<boolean> {
    const current = store.getState().project;
    if (!current) return false;
    const result = await verify(current.dir);
    // 校验期间用户切了项目：这时再装，装的是他刚才点的那个目录，但状态会写到
    // 现在选中的项目上（"已安装"标签跑到别的卡片）。直接取消，让他重新点。
    if (pathKey(store.getState().project?.dir ?? "") !== pathKey(current.dir)) {
      patch({ note: { text: "项目已切换，这次安装已取消。回到这个项目再点一次确认安装。", error: true } });
      return false;
    }
    if (!result?.ready || !result.tool) {
      patch({ note: { text: "还有必须修的问题，先让 AI 修完再安装。", error: true } });
      return false;
    }
    try {
      // 带上来源目录：以后能回答"这个工具是哪个项目装的"，也能比对两边的差异。
      const outcome = tools.install(result.tool, true, current.dir);
      patch({ installed: true, drift: false, note: { text: describeInstall(outcome, result.tool.name) } });
      void refreshProjects();
      return true;
    } catch (error) {
      patch({ note: { text: errorText(error), error: true } });
      return false;
    }
  }

  async function installArchive(tool: ToolPackage, files?: Readonly<Record<string, Uint8Array>>): Promise<InstallOutcome> {
    // 闸门提前到写盘之前。`tools.install()` 里那道契约校验只依赖清单的
    // `requires`，不需要磁盘；等它拦下来时目录已经解压完了，installed/<账号>/<id>/
    // 会留一个注册表里查不到的空壳——用户看不见、卸载清不到、白占空间。
    // 把同一道判定挪到这里，不兼容的包从头到尾不碰磁盘。
    const incompatible = checkCompatibility(tool);
    if (incompatible.length) throw new ToolPackageError(incompatible);
    // 只有清单与页面的包走原路径：不建目录、不碰磁盘，行为和以前一模一样。
    if (!files || !Object.keys(files).length) return tools.install(tool, true);
    // 解到 `installed/` 而不是 `projects/`：前者是我们的运行副本（卸载可删），
    // 后者是用户自己的源码（永远不替用户删）。混在一起，两个方向都会做错。
    const parent = await defaultInstalledToolsDir(io, deps.owner());
    const dir = await prepareToolDir(io, { id: tool.id, parent });
    await writeToolFiles(io, dir, files);
    // 以磁盘上的那份为准重新读一次：清单可能与 ZIP 里的不一致（比如 AI 顺手改了 id），
    // 与其装进去两份不一样的东西，不如当场让校验说话。
    const read = await readToolProject(io, dir);
    if (!read.ok) throw new Error(`文件已写入 ${dir}，但目录里的清单校验不通过：${read.violations[0]?.message ?? "原因未知"}`);
    const outcome = tools.install(read.tool, true, dir);
    void refreshProjects();
    return outcome;
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
      patch({ busy: true, note: null, installed: false, check: null, stalled: false, repairs: 0 });
      try {
        const name = brief.slice(0, 24);
        const wanted = toolProjectIdFromBrief(brief);
        const created = await createToolProject(io, {
          id: wanted, name,
          // 用户这次显式选的目录 > 设置里的自定义根目录 > 默认位置（带账号段）。
          ...(state.parent ? { parent: state.parent } : customRoot ? { parent: customRoot } : {}),
          owner: deps.owner(),
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
    installArchive,

    async rollback(id) {
      try {
        const outcome = await tools.rollback(id);
        if (!outcome) return { text: "没有可回退的版本——只有覆盖安装过的工具才会留下上一版。", error: true };
        // 退回旧版之后，项目目录里（如果有）通常还是新内容，标记成"有改动"。
        const selected = store.getState().project;
        patch(selected?.id === id ? { installed: true, drift: true } : { installed: true });
        void refreshProjects();
        const name = tools.state.getState().find((entry) => entry.package.id === id)?.package.name ?? id;
        return {
          text: `已退回 ${name} v${outcome.version}${outcome.previousVersion ? `（原 v${outcome.previousVersion} 已留下，可以再点一次退回去）` : ""}。`,
        };
      } catch (error) {
        return { text: `回退失败：${errorText(error)}`, error: true };
      }
    },

    async rename(dir, input) {
      const current = store.getState().project;
      const previousId = current?.dir === dir ? current.id : dir.split(/[\\/]/).pop() ?? "";
      const installedIds = new Set(tools.state.getState().map((entry) => entry.package.id));
      const nextId = input.id?.trim();
      // 已安装的工具改 id 会让设置与 aawStore 数据（都按 id 存）对不上，
      // 等于换了一个工具；只改显示名没有任何副作用。
      if (nextId && nextId !== previousId && installedIds.has(previousId))
        return { text: "这个工具已经装进工具中心了。改目录名会换掉它的身份（设置与数据都按 id 存），先在「已安装」里卸载再改；只改显示名不受影响。", error: true };
      if (nextId && nextId !== previousId && isForeground(dir))
        return { text: "这个项目正开着，会话历史挂在当前路径上——改目录名会让它接不上。先在侧栏换到别的项目再改名；只改显示名不受影响。", error: true };
      try {
        const result = await renameToolProject(io, { dir, ...input });
        if (current?.dir === dir)
          patch({ project: { dir: result.dir, id: result.id, name: result.name } });
        await refreshProjects();
        return {
          text: result.moved
            ? `已改名：目录 ${result.previousId} → ${result.id}，显示名「${result.name}」。`
            : `已改名为「${result.name}」。`,
        };
      } catch (error) {
        return { text: errorText(error), error: true };
      }
    },

    // 目录不再由工坊打开：路径在 UI 上以文本 + 复制呈现（ToolPath），
    // 不需要 host.files.openInFileManager，也就不需要为它申请 opener 权限。
    async resume(dir) {
      // 连点会开两条会话：同一项目开两条既浪费额度，历史也分叉。
      // 标志位在第一行同步置上——busy 要等文件检查之后才写，中间那段窗口仍会漏。
      if (resuming) return;
      resuming = true;
      try {
        // 开会话前先确认项目还在：列表可能是旧数据（目录被移动/改名/删了），
        // 照着旧路径开会话只会让用户面对一个空目录，还以为是自己改错了地方。
        if (!await io.pathExists(joinPath(dir, toolProjectFileNames.manifest))) {
          patch({ note: { text: `这个目录里没有 manifest.json：${dir}。项目可能已被移动或删除，先刷新列表确认它还在。`, error: true } });
          return;
        }
        patch({ busy: true });
        await select(dir);
        patch({ note: null });
        project.projects.registerProject(dir);
        const started = await project.sessions.startNewSession(dir);
        if (!started.ok) patch({ note: { text: `会话没连上（${started.reason}），可稍后重试。`, error: true } });
      } catch (error) {
        patch({ note: { text: errorText(error), error: true } });
      } finally {
        patch({ busy: false });
        resuming = false;
      }
    },

    select,

    refreshProjects,

    async migrateLegacy(list) {
      // 迁移落点跟新建同一口径：自定义根目录优先，不套账号段。
      const result = await migrateLegacyTools(io, list, {
        owner: deps.owner(),
        ...(customRoot ? { parent: customRoot } : {}),
      });
      // 迁移出来的目录就是这些工具现在的源码位置：记下来，卡片才能判断"项目改了没重装"。
      for (const dir of result.created) {
        const id = dir.split(/[\\/]/).filter(Boolean).pop();
        if (id) tools.setSource(id, dir);
      }
      return result;
    },

    async purge(id) {
      const owner = deps.owner() ?? "";
      // 两个根都扫：自定义根目录下的项目也是这个工具的源码，删工具时不能留下。
      const [defaultProjects, customProjects] = await Promise.all([
        listToolProjectSummaries(io, { owner }),
        customRoot ? listToolProjectSummaries(io, { parent: customRoot }).catch(() => []) : Promise.resolve([]),
      ]);
      const projectDirs = [...defaultProjects, ...customProjects]
        .filter((entry) => entry.id === id)
        .map((entry) => entry.dir);
      /**
       * 运行副本也一起清：ZIP 装进来的工具可能带着 `node_modules`（几十到几百 MB），
       * 只删注册表等于把它们永久留在磁盘上。
       *
       * 只认两种来源，别的路径一概不传给宿主：
       * - `projects/<账号>/<id>`：用户自己建的项目（在这里出现的才说明它就是这个工具）；
       * - `installed/<账号>/<id>`：我们自己解压出来的副本，路径可推算。
       * 用户选了别处的目录当运行目录（`setSource`）时，那条路径不会出现在这里，
       * 所以永远不会被误删。
       */
      const dirs = [...projectDirs];
      const installedDir = joinPath(await defaultInstalledToolsDir(io, owner), id);
      if (await io.pathExists(installedDir)) dirs.push(installedDir);
      try {
        const report = await host.skills.toolPurge({ toolId: id, owner, projectDirs: dirs });
        const parts: string[] = [];
        if (report.removedDirs.length) parts.push(`已删除 ${report.removedDirs.length} 个目录（源码或运行副本，含 node_modules）`);
        if (report.removedData) parts.push("已删除工具数据");
        if (report.skippedDirs.length) parts.push(`${report.skippedDirs.length} 个目录没有删除（不在受管目录内，或不是这个工具）`);
        if (store.getState().project && dirs.includes(store.getState().project!.dir))
          patch({ project: null, check: null, installed: false, drift: false, stalled: false, repairs: 0 });
        void refreshProjects();
        return { text: parts.length ? parts.join("；") + "。" : "没有找到需要清理的文件。" };
      } catch (error) {
        return { text: `清理失败：${errorText(error)}`, error: true };
      }
    },

    async chooseProjectsRoot() {
      const path = await project.projects.pickDirectory();
      if (!path) return;
      customRoot = path;
      patch({ customRoot: path });
      deps.settings?.write(path);
      try {
        project.projects.setRecentExclusions([await io.userDataDir("tools", "projects"), path]);
      } catch { /* 排除列表失败不影响目录切换本身 */ }
      await refreshProjects();
    },

    resetProjectsRoot() {
      customRoot = null;
      patch({ customRoot: null });
      deps.settings?.write(undefined);
      void refreshProjects();
    },

    async importFromFolder() {
      if (!host.isNative()) return { text: "导入文件夹需要桌面版。", error: true };
      const dir = await project.projects.pickDirectory();
      if (!dir) return { text: "已取消导入。" };
      if (!await io.pathExists(joinPath(dir, toolProjectFileNames.manifest)))
        return { text: `所选文件夹里没有 manifest.json：${dir}\n请选择包含 manifest.json 与 index.html 的工具目录。`, error: true };
      const check = await checkToolProject(io, dir);
      if (!check.ready || !check.tool) {
        const first = check.blocking[0];
        return { text: first ? `校验没通过：${first.message}\n${first.hint}` : "校验没通过，没有可安装的工具。", error: true };
      }
      try {
        // 带上目录里的其余文件（依赖、图片等），与 ZIP 导入走同一条安装链路。
        const extra = await readToolDirFiles(io, dir);
        const outcome = await installArchive(check.tool, extra.files);
        const skipped = extra.skipped.length ? `（${extra.skipped.length} 个文件超过单包上限没带走）` : "";
        return { text: describeInstall(outcome, check.tool.name) + skipped };
      } catch (error) {
        return { text: errorText(error), error: true };
      }
    },

    dispose() {
      unsubscribe();
      view.dispose();
    },
  };
}
