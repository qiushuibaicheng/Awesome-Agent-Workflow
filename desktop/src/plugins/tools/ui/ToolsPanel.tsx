import { useDeferredValue, useEffect, useRef, useState } from "react";
import type { ChangeEvent, MouseEvent as ReactMouseEvent } from "react";
import { useStore } from "zustand";
import { DangerButton, btnGhost, btnPrimary, btnSecondary } from "../../../shared/ui/controls.tsx";
import { ContextMenu } from "../../../shared/ui/ContextMenu.tsx";
import type { ContextMenuEntry } from "../../../shared/ui/ContextMenu.tsx";
import { SquareTerminalIcon, WrenchIcon } from "../../../shared/ui/icons.tsx";
import { useHeaderMenu } from "../../../shared/ui/useHeaderMenu.ts";
import type { HostService } from "../../host/service.ts";
import type { ProjectService } from "../../project/service.ts";
import { exampleTools } from "../runtime/examples.ts";
import { exportToolProject, readToolImport } from "../runtime/projectArchive.ts";
import { migrateLegacyTools } from "../runtime/project.ts";
import { ActiveProjectCard, NewToolForm } from "./ToolBuilder.tsx";
import { ToolManagement } from "./ToolManagement.tsx";
import { ToolPreview } from "./ToolPreview.tsx";
import { ToolProjectList } from "./ToolProjects.tsx";
import { projectIO, describeInstall } from "./workshop.ts";
import type { WorkshopService } from "./workshop.ts";
import { toolGlyph, toneOf } from "./mark.ts";
import type { ToolsService } from "../service.ts";
import type { ToolPackage } from "../types.ts";
import "./tools.css";

type View =
  | { kind: "library" }
  | { kind: "projects" }
  | { kind: "manage"; id: string }
  | { kind: "preview"; tool: ToolPackage };

type Tab = "library" | "projects";

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * 空列表不是"什么都没有"的占位符，而是这个页面唯一一次讲清「工具能干嘛」的机会。
 *
 * 原来只有一个虚线框 + 一行灰字 + 两个按钮，既没说明做出来的东西长什么样，
 * 也没说 AI 会做哪些事，用户站在空页面前不知道该点哪。这里给出三步预期和
 * 一个具体例子，主按钮直接去「开发工具」——不再和页签摆两个同义入口。
 */
function EmptyLibrary({ onCreate, onImport, onExamples }: { onCreate: () => void; onImport: () => void; onExamples: () => void }) {
  return <section className="tools-empty" aria-label="还没有工具">
    <div className="tools-empty-hero">
      <span className="tools-empty-glow" aria-hidden="true" />
      <span className="tools-empty-mark" aria-hidden="true"><WrenchIcon /></span>
    </div>
    <h3 className="tools-empty-title">从一句话开始，做一个自己的工具</h3>
    <p className="tools-empty-lead">工具是能独立打开的小窗口：格式化 JSON、批量改文本、随手记点东西，或者让你的常用操作一键完成。</p>
    <ol className="tools-empty-steps">
      <li><span aria-hidden="true">1</span><div><strong>说清要做什么</strong><small>例如「把接口返回的 JSON 转成表格」</small></div></li>
      <li><span aria-hidden="true">2</span><div><strong>AI 写好并自动校验</strong><small>源码就在一个真实目录里，随时能改</small></div></li>
      <li><span aria-hidden="true">3</span><div><strong>验收后随时打开</strong><small>工具中心、启动器里都能一键唤起</small></div></li>
    </ol>
    <div className="tools-empty-actions">
      <button type="button" className={`${btnPrimary} tools-empty-primary`} onClick={onCreate}>开始做工具 <span aria-hidden="true">→</span></button>
      <button type="button" className={btnSecondary} onClick={onImport}>导入 ZIP</button>
      <button type="button" className={`${btnGhost} tools-empty-examples`} onClick={onExamples}>载入示例工具</button>
    </div>
    <p className="tools-empty-foot">想先看效果？点「载入示例工具」装进两个可打开的示例，随时能卸载；「开发指导 ↗」里有完整约定。</p>
  </section>;
}

export function ToolsPanel({ service, host, project, workshop, onPreviewProject }: {
  service: ToolsService;
  host: HostService;
  project?: ProjectService;
  workshop: WorkshopService;
  /**
   * 在右栏另开一个预览标签（会话留在中间）。
   *
   * 省略时退回"把工具中心整页换成预览"的旧行为——那是给浏览器预览模式
   * 与没有右栏的场合留的后路。
   */
  onPreviewProject?: (dir: string, name?: string) => void;
}) {
  const tools = useStore(service.state);
  const workshopState = useStore(workshop.state);
  const [view, setView] = useState<View>({ kind: "library" });
  const [search, setSearch] = useState("");
  const [removing, setRemoving] = useState<{ id: string; files: boolean }>();
  const [feedback, setFeedback] = useState<{ text: string; error?: true }>();
  const [busy, setBusy] = useState(false);
  const cardMenu = useHeaderMenu();
  const picker = useRef<HTMLInputElement>(null);
  const active = view.kind === "preview" ? view.tool : undefined;
  const managed = view.kind === "manage" ? tools.find(({ package: tool }) => tool.id === view.id) : undefined;
  const tab: Tab = view.kind === "projects" ? "projects" : "library";
  // 列表可能上百条：搜索输入先降级渲染，打字时不会卡在过滤上。
  const query = useDeferredValue(search);
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? tools.filter(({ package: tool }) => `${tool.name} ${tool.id}`.toLowerCase().includes(needle))
    : tools;

  // 每次进面板刷一次项目列表：AI 刚写完的项目要能立刻出现。
  useEffect(() => { void workshop.refreshProjects(); }, [workshop]);

  // 旧版本的工具体存在 configuration 里；首次打开时迁成项目目录（只写不删）。
  const migrated = useRef(false);
  useEffect(() => {
    if (!project || !host.isNative() || migrated.current || tools.length === 0) return;
    migrated.current = true;
    void (async () => {
      try {
        const result = await migrateLegacyTools(projectIO(host), tools.map((entry) => entry.package));
        if (result.created.length) {
          // 迁移出来的目录就是这些工具现在的源码位置：记下来，卡片才能判断
          // "项目改了没重装"。
          for (const dir of result.created) {
            const id = dir.split(/[\\/]/).filter(Boolean).pop();
            if (id) service.setSource(id, dir);
          }
          setFeedback({ text: `已把 ${result.created.length} 个旧工具迁成项目目录，可以在「开发工具」里继续开发。` });
          void workshop.refreshProjects();
        }
      } catch { /* 迁移失败不该影响使用，下次打开再试 */ }
    })();
  }, [host, project, service, tools, workshop]);

  function run(action: () => void) {
    setFeedback(undefined);
    try {
      action();
    } catch (error) {
      setFeedback({ text: errorText(error), error: true });
    }
  }

  async function openElectron(id?: string) {
    if (busy) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      if (!host.isNative()) throw new Error("请在 AAW 桌面版中打开 Electron 插件窗口。");
      await host.openToolsElectron(id);
    } catch (error) {
      setFeedback({ text: errorText(error), error: true });
    } finally { setBusy(false); }
  }

  function installPackage(tool: ToolPackage) {
    setFeedback({ text: describeInstall(service.install(tool, true), tool.name) });
  }

  /** 示例工具走和导入 ZIP 完全一样的 install 路径，不搞特殊数据通道。 */
  function installExamples() {
    try {
      const names = exampleTools.map((tool) => {
        service.install(tool, true);
        return tool.name;
      });
      setFeedback({ text: `已载入 ${names.length} 个示例工具：${names.join("、")}。在「已安装」里可以打开、改设置或卸载；卸载完空状态里还能再载入一次。` });
    } catch (error) {
      setFeedback({ text: `载入示例失败：${errorText(error)}`, error: true });
    }
  }

  async function importFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const failures: string[] = [];
    const lines: string[] = [];
    for (const file of files) {
      try {
        const tool = await readToolImport(file);
        lines.push(describeInstall(service.install(tool, true), tool.name));
        if (tool.permissions?.network) lines.push(`注意：${tool.name} 会联网（作者声明的）。`);
      } catch (error) {
        failures.push(`${file.name}：${errorText(error)}`);
      }
    }
    setFeedback(failures.length ? { text: [...lines, ...failures].join("\n"), error: true } : { text: lines.join("\n") });
  }

  async function exportTool(tool: ToolPackage) {
    if (busy) return;
    setBusy(true);
    setFeedback(undefined);
    const filename = `${tool.id}-${tool.version}-source.zip`;
    try {
      const bytes = exportToolProject(tool);
      let destination = filename;
      if (host.isNative()) {
        const path = await host.dialogs.saveFile({ defaultPath: filename, filters: [{ name: "工具源码", extensions: ["zip"] }] });
        if (!path) { setFeedback({ text: "已取消导出。" }); return; }
        await host.writeToolArchive(path, bytes);
        destination = path;
      } else {
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: "application/zip" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      // 之前写的是"拖回工具中心即可导入"——但拖拽从来没被支持过，用户会照着做然后发现没反应。
      // 只说真实存在的路径：点「导入工具」选这个文件。
      setFeedback({ text: `已导出到 ${destination}。要导入时点右上角「导入工具」，选中这个 ZIP 即可；不需要 Node，也不需要构建。` });
    } catch (error) {
      setFeedback({ text: `导出失败：${errorText(error)}`, error: true });
    } finally { setBusy(false); }
  }

  /** 打开「工具开发指导」窗口：内容与 AI 读的规范同源。 */
  async function openGuide() {
    if (busy) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      await host.openToolsGuide();
    } catch (error) {
      setFeedback({ text: errorText(error), error: true });
    } finally { setBusy(false); }
  }

  async function previewProject(dir: string) {
    // 先校验一次：能读出来才值得开预览（否则预览里只会是一句报错）。
    await workshop.select(dir);
    const tool = workshop.state.getState().check?.tool;
    if (!tool) {
      setFeedback({ text: "这个项目还读不出可预览的工具，先看下面的校验问题。", error: true });
      return;
    }
    if (onPreviewProject) {
      onPreviewProject(dir, workshop.state.getState().project?.name);
      return;
    }
    setView({ kind: "preview", tool });
  }

  async function installProject(dir: string) {
    await workshop.select(dir);
    if (await workshop.install()) {
      const check = workshop.state.getState().check;
      setFeedback({ text: check?.tool ? describeInstall({ version: check.tool.version, updated: true, versionChanged: true }, check.tool.name) : "已安装。" });
    } else {
      setFeedback({ text: workshop.state.getState().note?.text ?? "安装失败。", error: true });
    }
  }

  /**
   * 卡片上只留一个主操作（打开），其余收进「⋯」：之前 5 个按钮平铺，扫视
   * 成本高，而且「卸载」和「导出」的视觉权重完全一样。
   */
  function openCardMenu(event: ReactMouseEvent<HTMLButtonElement>, tool: ToolPackage) {
    const rect = event.currentTarget.getBoundingClientRect();
    const entry = tools.find((item) => item.package.id === tool.id);
    const entries: ContextMenuEntry[] = [
      { id: "manage", label: "管理", onSelect: () => { setFeedback(undefined); setView({ kind: "manage", id: tool.id }); } },
      { id: "export", label: "导出源码", disabled: busy, onSelect: () => void exportTool(tool) },
      // 只有"装过至少两次"的工具才有上一版：装坏了这一步能救回来。
      ...(entry?.previousVersion
        ? [{ id: "rollback", label: `退回上一版 v${entry.previousVersion}`, onSelect: () => void rollbackTool(tool.id) }]
        : []),
      { type: "separator" as const },
      { id: "remove", label: "卸载", danger: true, onSelect: () => setRemoving({ id: tool.id, files: false }) },
    ];
    cardMenu.open(tool.id, `${tool.name} 操作`, entries, { x: rect.right, y: rect.bottom + 4, side: "bottom", align: "end" });
  }

  async function rollbackTool(id: string) {
    const note = await workshop.rollback(id);
    setFeedback({ text: note.text, ...(note.error ? { error: true as const } : {}) });
  }

  async function confirmRemove(id: string, files: boolean) {
    setRemoving(undefined);
    run(() => service.remove(id));
    if (!files) return;
    const note = await workshop.purge(id);
    setFeedback({ text: `已卸载。${note.text}`, ...(note.error ? { error: true as const } : {}) });
  }

  if (managed) return <ToolManagement key={`${managed.package.id}:${JSON.stringify(managed.settings)}:${JSON.stringify(managed.package.settingsSchema)}`} entry={managed} busy={busy} feedback={feedback}
    onBack={() => { setView({ kind: "library" }); setFeedback(undefined); }}
    onOpen={() => void openElectron(managed.package.id)} onExport={() => void exportTool(managed.package)}
    onRollback={() => void rollbackTool(managed.package.id)}
    onSave={(values) => { try { service.saveSettings(managed.package.id, values); setFeedback({ text: "设置已保存，重新打开插件后生效。" }); return true; } catch (error) { setFeedback({ text: errorText(error), error: true }); return false; } }}
    onRemove={() => run(() => { service.remove(managed.package.id); setView({ kind: "library" }); })}
    onUpdate={(file) => { void (async () => { try {
      const tool = await readToolImport(file);
      if (tool.id !== managed.package.id) throw new Error("更新包的插件 ID 必须与当前插件一致。");
      setFeedback({ text: describeInstall(service.install(tool, true), tool.name) });
    } catch (error) { setFeedback({ text: errorText(error), error: true }); } })(); }} />;

  if (active) {
    return <ToolPreview
      tool={active}
      onBack={() => setView({ kind: "library" })}
      onInstall={() => { run(() => installPackage(active)); setView({ kind: "library" }); }}
      installLabel="安装到工具中心"
    />;
  }

  return (
    <section aria-label="工具" className="aaw-tools flex h-full min-h-0 flex-col bg-base">
      <header className="tools-header border-b border-line px-4 pb-3 pt-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-info/20 bg-info/10 text-info"><WrenchIcon className="size-5" /></span>
          <div className="tools-title mr-auto"><h2 className="text-ui-xl font-semibold text-ink">工具中心</h2><p className="mt-1 text-ui-sm text-ink-subtle">说一句需求，AI 做一个能用的小工具</p></div>
          {host.isNative() && <button type="button" className={btnSecondary} onClick={() => void openElectron()}>打开启动器 ↗</button>}
          <button type="button" className={btnSecondary} onClick={() => picker.current?.click()}>导入工具</button>
        </div>
        <div className="tools-tabs mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className={tab === "library" ? btnSecondary : btnGhost} aria-pressed={tab === "library"} onClick={() => setView({ kind: "library" })}>已安装 · {tools.length}</button>
          {/* 顶部不再放「新建工具」：它和这个页签是同一个界面，两个入口只会让人
              以为点了会去别的地方。做工具统一从这里进，名字也统一叫「开发工具」。 */}
          <button type="button" className={tab === "projects" ? btnSecondary : btnGhost} aria-pressed={tab === "projects"} onClick={() => setView({ kind: "projects" })}>开发工具 · {workshopState.projects.length}</button>
          {/* 开发指导独立成窗口：内容是全平台通用的规范，不该混在"做某个工具"的流程里。 */}
          <button type="button" className={`${btnGhost} tools-guide`} onClick={() => void openGuide()} disabled={busy}>开发指导 ↗</button>
        </div>
        <input ref={picker} type="file" multiple accept=".zip,.json,application/zip,application/json" onChange={(event) => void importFiles(event)} hidden />
      </header>
      <div className="tools-content min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {feedback && (
          <p role={feedback.error ? "alert" : "status"} className={`whitespace-pre-wrap break-words rounded-lg border border-line bg-surface px-3 py-2 text-ui-sm ${feedback.error ? "text-danger-ink" : "text-ink-subtle"}`}>
            {feedback.text}
          </p>
        )}

        {tab === "projects" && <>
          <NewToolForm workshop={workshop} available={host.isNative()} />
          <ActiveProjectCard workshop={workshop} onPreview={() => {
            const state = workshop.state.getState();
            const tool = state.check?.tool;
            if (!tool) return;
            if (onPreviewProject && state.project) {
              onPreviewProject(state.project.dir, state.project.name);
              return;
            }
            setView({ kind: "preview", tool });
          }} />
          <ToolProjectList
            workshop={workshop}
            installed={tools}
            onPreview={(dir) => void previewProject(dir)}
            onInstall={(dir) => void installProject(dir)}
          />
          {/* 以前这块是一整张"安装规范"卡片——内容写进了 AI 技能目录，人却看不见。
              现在内容在「开发指导」窗口里，这里只负责把同一份正文也交给 AI。 */}
          <section aria-label="AI 开发规范" className="build-guide">
            <div>
              <strong>让 AI 也按这份指导做工具</strong>
              <p>写进 AI 技能目录后，普通会话里让 AI 做工具也会守同一份契约；正文就是「开发指导」里那份。</p>
            </div>
            <button type="button" className={btnSecondary} onClick={() => void workshop.installGuide()} disabled={!host.isNative()}>同步到 AI 技能目录</button>
            {workshopState.guideNote && <p className={`build-hint ${workshopState.guideNote.error ? "is-error" : ""}`}>{workshopState.guideNote.text}</p>}
          </section>
        </>}

        {tab === "library" && <>
          {tools.length === 0 && (
            <EmptyLibrary
              onCreate={() => setView({ kind: "projects" })}
              onImport={() => picker.current?.click()}
              onExamples={installExamples}
            />
          )}
          {tools.length > 0 && <label className="tools-search"><span aria-hidden="true">⌕</span><input aria-label="搜索已安装工具" placeholder="搜索你的工具…" value={search} onChange={(event) => setSearch(event.target.value)} /><span>{tools.length}</span></label>}
          {/* 紧凑行而不是大卡片：右栏只有 360px 左右，卡片式一屏只能放三个，
              而"打开某个工具"是这一页最高频的动作。一行一个，扫视成本最低。 */}
          <ul aria-label="已安装工具" className="tool-rows">
            {visible.map(({ package: tool }) => (
              <li key={tool.id} className={`tool-row ${removing?.id === tool.id ? "is-expanded" : ""}`}>
                {/* 图标与底色都由工具 id 决定，与小窗完全一致：字形优先，缺省用名称首字。 */}
                <span aria-hidden="true" className={`tool-symbol is-row tone-${toneOf(tool.id)}`}>{toolGlyph(tool)}</span>
                <div className="tool-row-main">
                  <span className="tool-row-name">{tool.name}</span>
                  <span className="tool-row-meta">
                    v{tool.version}
                    {!!tool.actions?.length && <span className="tool-row-tag"><SquareTerminalIcon className="size-3" />{tool.actions.length} 动作</span>}
                    {tool.permissions?.network && <span className="tool-row-tag">可联网</span>}
                  </span>
                </div>
                {removing?.id === tool.id ? (
                  <div className="tool-remove is-row">
                    <div className="tool-remove-actions">
                      <button type="button" className={btnGhost} onClick={() => setRemoving(undefined)}>取消</button>
                      {/* 危险动作给危险配色，取消退回中性：之前两者权重是反的。 */}
                      <DangerButton onClick={() => void confirmRemove(tool.id, removing.files)}>卸载</DangerButton>
                    </div>
                    <label className="tool-remove-option">
                      <input type="checkbox" checked={removing.files} onChange={(event) => setRemoving({ id: tool.id, files: event.target.checked })} />
                      同时删除项目目录与工具数据
                    </label>
                  </div>
                ) : (
                  <div className="tool-row-actions">
                    <button type="button" className="tool-row-open" aria-label={`打开 ${tool.name}`} disabled={busy} onClick={() => void openElectron(tool.id)}>打开</button>
                    <button type="button" className="tool-row-more" aria-label={`更多操作：${tool.name}`} aria-haspopup="menu" aria-expanded={cardMenu.menu?.id === tool.id} onClick={(event) => openCardMenu(event, tool)}>⋯</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {needle && visible.length === 0 && (
            <div className="tools-search-empty">
              <span aria-hidden="true">⌕</span>
              <div>
                <strong>没有找到匹配的工具</strong>
                <p>名字或 ID 里没有「{query.trim()}」。换个关键词，或者看看是不是还没导入。</p>
              </div>
              <button type="button" className={btnGhost} onClick={() => setSearch("")}>清空搜索</button>
            </div>
          )}
        </>}
      </div>
      {cardMenu.menu && (
        <ContextMenu
          entries={cardMenu.menu.entries}
          placement={cardMenu.menu.placement}
          label={cardMenu.menu.label}
          closing={cardMenu.menu.closing}
          onDismiss={cardMenu.dismiss}
        />
      )}
    </section>
  );
}
