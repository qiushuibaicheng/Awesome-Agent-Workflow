import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, MouseEvent as ReactMouseEvent } from "react";
import { useStore } from "zustand";
import { DangerButton, btnGhost, btnPrimary, btnSecondary } from "../../../shared/ui/controls.tsx";
import { ContextMenu } from "../../../shared/ui/ContextMenu.tsx";
import type { ContextMenuEntry } from "../../../shared/ui/ContextMenu.tsx";
import { SquareTerminalIcon, WrenchIcon } from "../../../shared/ui/icons.tsx";
import { useHeaderMenu } from "../../../shared/ui/useHeaderMenu.ts";
import type { HostService } from "../../host/service.ts";
import type { ProjectService } from "../../project/service.ts";
import { parseToolPackage } from "../runtime/package.ts";
import { exportToolProject, readToolImport } from "../runtime/projectArchive.ts";
import { ToolDeveloper } from "./ToolDeveloper.tsx";
import { ToolManagement } from "./ToolManagement.tsx";
import { ToolPreview } from "./ToolPreview.tsx";
import { migrateLegacyTools } from "../runtime/project.ts";
import { ToolWishCard } from "./ToolWish.tsx";
import { projectIO, useToolWish } from "./useToolWish.ts";
import { toolGlyph, toneOf } from "./mark.ts";
import type { ToolsService } from "../service.ts";
import type { ToolPackage } from "../types.ts";
import { sampleTool } from "./sample.ts";
import "./tools.css";

type View = { kind: "library" } | { kind: "manage"; id: string } | { kind: "preview"; tool: ToolPackage };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function ToolsPanel({ service, host, project, owner }: {
  service: ToolsService;
  host: HostService;
  project?: ProjectService;
  /** 当前账号 id：工具项目默认目录按它分一层，和安装记录同一维度。 */
  owner?: string;
}) {
  const tools = useStore(service.state);
  const [view, setView] = useState<View>({ kind: "library" });
  const [development, setDevelopment] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [removing, setRemoving] = useState<string>();
  const [feedback, setFeedback] = useState<{ text: string; error?: true }>();
  const [busy, setBusy] = useState(false);
  const cardMenu = useHeaderMenu();
  const picker = useRef<HTMLInputElement>(null);
  const active = view.kind === "preview" ? view.tool : undefined;
  const managed = view.kind === "manage" ? tools.find(({ package: tool }) => tool.id === view.id) : undefined;
  const wish = useToolWish({
    project, host, owner,
    onAccept: (tool) => service.install(tool, true),
    onInstalled: () => setFeedback({ text: "已安装到工具中心。" }),
  });

  // 旧版本的工具体存在 configuration 里；首次打开时迁成项目目录（只写不删）。
  // 按账号记一次：换账号后新账号的旧工具也要能迁，但同账号不要反复扫。
  const migratedFor = useRef<string | null>(null);
  useEffect(() => {
    const current = owner ?? "";
    if (!project || !host.isNative() || migratedFor.current === current || tools.length === 0) return;
    migratedFor.current = current;
    void (async () => {
      try {
        const result = await migrateLegacyTools(projectIO(host), tools.map((entry) => entry.package), { owner });
        if (result.created.length)
          setFeedback({ text: `已把 ${result.created.length} 个旧工具迁成项目目录，可以在会话里继续开发。` });
      } catch { /* 迁移失败不该影响使用，下次打开再试 */ }
    })();
  }, [host, owner, project, tools]);

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

  async function importFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const failures: string[] = [];
    let installed = 0;
    for (const file of files) {
      try {
        service.install(await readToolImport(file));
        installed++;
      } catch (error) {
        failures.push(`${file.name}：${errorText(error)}`);
      }
    }
    const result = `已导入 ${installed} 个工具。`;
    setFeedback(failures.length ? { text: [result, ...failures].join("\n"), error: true } : { text: result });
  }

  async function exportTool(tool: ToolPackage) {
    if (busy) return;
    setBusy(true);
    setFeedback(undefined);
    const filename = `${tool.id}-${tool.version}-source.zip`;
    try {
      const bytes = exportToolProject(tool);
      if (host.isNative()) {
        const path = await host.dialogs.saveFile({ defaultPath: filename, filters: [{ name: "插件源码项目", extensions: ["zip"] }] });
        if (!path) { setFeedback({ text: "已取消导出。" }); return; }
        await host.writeToolArchive(path, bytes);
      } else {
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: "application/zip" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setFeedback({ text: "插件源码已导出为 ZIP。" });
    } catch (error) {
      setFeedback({ text: `导出失败：${errorText(error)}`, error: true });
    } finally { setBusy(false); }
  }

  function edit(tool: ToolPackage) {
    setDraft(JSON.stringify(tool, null, 2));
    setDevelopment(true);
    setFeedback(undefined);
    setView({ kind: "library" });
  }

  /**
   * 卡片上只留一个主操作（打开），其余收进「⋯」：之前 5 个按钮平铺，扫视
   * 成本高，而且「卸载」和「导出」的视觉权重完全一样。
   */
  function openCardMenu(event: ReactMouseEvent<HTMLButtonElement>, tool: ToolPackage) {
    const rect = event.currentTarget.getBoundingClientRect();
    const entries: ContextMenuEntry[] = [
      { id: "manage", label: "管理", onSelect: () => { setFeedback(undefined); setView({ kind: "manage", id: tool.id }); } },
      ...(development ? [{ id: "edit", label: "编辑", onSelect: () => edit(tool) }] : []),
      { id: "export", label: "导出源码", disabled: busy, onSelect: () => void exportTool(tool) },
      { type: "separator" },
      { id: "remove", label: "卸载", danger: true, onSelect: () => setRemoving(tool.id) },
    ];
    cardMenu.open(tool.id, `${tool.name} 操作`, entries, { x: rect.right, y: rect.bottom + 4, side: "bottom", align: "end" });
  }

  if (managed) return <ToolManagement key={`${managed.package.id}:${JSON.stringify(managed.settings)}:${JSON.stringify(managed.package.settingsSchema)}`} entry={managed} busy={busy} feedback={feedback}
    onBack={() => { setView({ kind: "library" }); setFeedback(undefined); }}
    onOpen={() => void openElectron(managed.package.id)} onExport={() => void exportTool(managed.package)} onEdit={() => edit(managed.package)}
    onSave={(values) => { try { service.saveSettings(managed.package.id, values); setFeedback({ text: "设置已保存，重新打开插件后生效。" }); return true; } catch (error) { setFeedback({ text: errorText(error), error: true }); return false; } }}
    onRemove={() => run(() => { service.remove(managed.package.id); setView({ kind: "library" }); })}
    onUpdate={(file) => { void (async () => { try {
      const tool = await readToolImport(file);
      if (tool.id !== managed.package.id) throw new Error("更新包的插件 ID 必须与当前插件一致。");
      service.install(tool, true); setFeedback({ text: "插件源码已更新，重新打开插件后生效。" });
    } catch (error) { setFeedback({ text: errorText(error), error: true }); } })(); }} />;

  if (active) {
    return <ToolPreview
      tool={active}
      onBack={() => setView({ kind: "library" })}
      onInstall={() => run(() => {
        service.install(active, true);
        setFeedback({ text: "工具已安装或更新。" });
        setView({ kind: "library" });
      })}
      installLabel="安装到工具中心"
    />;
  }

  return (
    <section aria-label="工具" className="aaw-tools flex h-full min-h-0 flex-col bg-base">
      <header className="tools-header border-b border-line px-4 pb-3 pt-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-info/20 bg-info/10 text-info"><WrenchIcon className="size-5" /></span>
          <div className="tools-title mr-auto"><h2 className="text-ui-xl font-semibold text-ink">工具中心</h2><p className="mt-1 text-ui-sm text-ink-subtle">把灵感变成随手可用的工具</p></div>
          {host.isNative() && <button type="button" className={btnSecondary} onClick={() => void openElectron()}>打开启动器 ↗</button>}
          <button type="button" className={btnPrimary} onClick={() => picker.current?.click()}>导入工具</button>
        </div>
        <div className="tools-tabs mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className={development ? btnGhost : btnSecondary} aria-pressed={!development} onClick={() => setDevelopment(false)}>已安装 · {tools.length}</button>
          <button type="button" className={development ? btnSecondary : btnGhost} aria-pressed={development} onClick={() => setDevelopment(true)}>开发模式</button>
        </div>
        <input ref={picker} type="file" multiple accept=".zip,.json,application/zip,application/json" onChange={(event) => void importFiles(event)} hidden />
      </header>
      <div className="tools-content min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {feedback && (
          <p role={feedback.error ? "alert" : "status"} className={`whitespace-pre-wrap break-words rounded-lg border border-line bg-surface px-3 py-2 text-ui-sm ${feedback.error ? "text-danger-ink" : "text-ink-subtle"}`}>
            {feedback.text}
          </p>
        )}
        {project && (
          <ToolWishCard
            state={wish}
            available={host.isNative()}
            onPreview={() => {
              const tool = wish.check?.tool;
              if (tool) setView({ kind: "preview", tool });
            }}
            onInstall={() => void wish.install()}
          />
        )}
        {development && <ToolDeveloper source={draft} onChange={setDraft} onExample={() => edit(sampleTool)}
          onPreview={() => run(() => setView({ kind: "preview", tool: parseToolPackage(draft) }))}
          onInstall={() => run(() => {
            service.install(parseToolPackage(draft), true);
            setFeedback({ text: "工具已安装或更新。" });
          })} />}
        {tools.length === 0 && !development && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong px-5 py-10 text-center">
            <WrenchIcon className="size-7 text-info" />
            <p className="text-ui-base font-semibold text-ink">暂无个人工具</p>
            <p className="text-ui-sm text-ink-subtle">导入工具包，或在开发模式中试用示例。</p>
            <button type="button" className={btnSecondary} onClick={() => edit(sampleTool)}>试用 JSON 格式化</button>
          </div>
        )}
        {tools.length > 0 && <label className="tools-search"><span aria-hidden="true">⌕</span><input aria-label="搜索已安装工具" placeholder="搜索你的工具…" value={search} onChange={(event) => setSearch(event.target.value)} /><span>{tools.length}</span></label>}
        <ul aria-label="已安装工具" className="tools-grid">
          {tools.filter(({ package: tool }) => `${tool.name} ${tool.id}`.toLowerCase().includes(search.trim().toLowerCase())).map(({ package: tool }) => (
            <li key={tool.id} className="tool-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface p-3 transition-colors hover:border-info/35">
              {/* 图标与底色都由工具 id 决定，与小窗完全一致：字形优先，缺省用名称首字。 */}
              <span aria-hidden="true" className={`tool-symbol tone-${toneOf(tool.id)}`}>{toolGlyph(tool)}</span>
              <div className="mr-auto min-w-[6rem] flex-1">
                <h3 className="break-words text-ui-base font-semibold text-ink">{tool.name}</h3>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-ui-sm text-ink-subtle">
                  <span>v{tool.version}</span>
                  {!!tool.actions?.length && <span className="inline-flex items-center gap-1 text-info"><SquareTerminalIcon className="size-3.5" />{tool.actions.length} 个动作 · AI 可调用</span>}
                </p>
              </div>
              {removing === tool.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ui-sm text-ink-subtle">卸载此工具？</span>
                  <button type="button" className={btnGhost} onClick={() => setRemoving(undefined)}>取消</button>
                  {/* 危险动作给危险配色，取消退回中性：之前两者权重是反的。 */}
                  <DangerButton onClick={() => run(() => {
                    service.remove(tool.id);
                    setRemoving(undefined);
                  })}>确认卸载</DangerButton>
                </div>
              ) : (
                <div className="tool-actions flex flex-wrap gap-1">
                  <button type="button" className={btnPrimary} aria-label={`打开 ${tool.name}`} disabled={busy} onClick={() => void openElectron(tool.id)}>打开 ↗</button>
                  <button type="button" className={btnGhost} aria-label={`更多操作：${tool.name}`} aria-haspopup="menu" aria-expanded={cardMenu.menu?.id === tool.id} onClick={(event) => openCardMenu(event, tool)}>⋯</button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {tools.length > 0 && !tools.some(({ package: tool }) => `${tool.name} ${tool.id}`.toLowerCase().includes(search.trim().toLowerCase())) && <p className="py-8 text-center text-ui-sm text-ink-subtle">没有匹配的工具</p>}
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
