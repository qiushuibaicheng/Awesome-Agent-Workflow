import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useStore } from "zustand";
import { btnGhost, btnPrimary, btnSecondary } from "../../../shared/ui/controls.tsx";
import { SquareTerminalIcon, WrenchIcon } from "../../../shared/ui/icons.tsx";
import type { HostService } from "../../host/service.ts";
import { parseToolPackage } from "../runtime/package.ts";
import { exportToolProject, readToolImport } from "../runtime/projectArchive.ts";
import { toolSettingsScript } from "../runtime/settings.ts";
import { ToolDeveloper } from "./ToolDeveloper.tsx";
import { ToolManagement } from "./ToolManagement.tsx";
import type { ToolsService } from "../service.ts";
import type { ToolPackage } from "../types.ts";
import { sampleTool } from "./sample.ts";
import "./tools.css";

type View = { kind: "library" } | { kind: "manage"; id: string } | { kind: "preview"; tool: ToolPackage };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const framePolicy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'";

export function ToolsPanel({ service, host }: { service: ToolsService; host: HostService }) {
  const tools = useStore(service.state);
  const [view, setView] = useState<View>({ kind: "library" });
  const [development, setDevelopment] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [removing, setRemoving] = useState<string>();
  const [feedback, setFeedback] = useState<{ text: string; error?: true }>();
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const active = view.kind === "preview" ? view.tool : undefined;
  const managed = view.kind === "manage" ? tools.find(({ package: tool }) => tool.id === view.id) : undefined;

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
    return (
      <section aria-label={active.name} className="aaw-tools flex h-full min-h-0 flex-col bg-base">
        <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface/60 px-4 py-3">
          <button type="button" className={btnGhost} onClick={() => setView({ kind: "library" })}>
            返回开发模式
          </button>
          <h2 className="min-w-0 truncate text-ui-lg font-semibold text-ink">{active.name}</h2>
          <span className="text-ui-sm text-ink-subtle">开发预览</span>
        </header>
        {feedback?.error && <p role="alert" className="border-b border-line px-4 py-2 text-ui-sm text-danger-ink">{feedback.text}</p>}
        <iframe
          key={active.id}
          aria-label={active.name}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${framePolicy}">${toolSettingsScript(active)}${active.html}`}
          className="min-h-0 w-full flex-1 border-0"
        />
      </section>
    );
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
          {tools.filter(({ package: tool }) => `${tool.name} ${tool.id}`.toLowerCase().includes(search.trim().toLowerCase())).map(({ package: tool }, index) => (
            <li key={tool.id} className="tool-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface p-3 transition-colors hover:border-info/35">
              <span aria-hidden="true" className={`tool-symbol tone-${index % 4} grid size-9 shrink-0 place-items-center rounded-lg bg-info/10 text-info`}><WrenchIcon className="size-5" /></span>
              <div className="mr-auto min-w-[6rem] flex-1">
                <h3 className="break-words text-ui-base font-semibold text-ink">{tool.name}</h3>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-ui-sm text-ink-subtle">
                  <span>v{tool.version}</span>
                  {!!tool.actions?.length && <span className="inline-flex items-center gap-1 text-info"><SquareTerminalIcon className="size-3.5" />支持 CLI</span>}
                </p>
              </div>
              {removing === tool.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ui-sm text-ink-subtle">卸载此工具？</span>
                  <button type="button" className={btnSecondary} onClick={() => setRemoving(undefined)}>取消</button>
                  <button type="button" className={btnGhost} onClick={() => run(() => {
                    service.remove(tool.id);
                    setRemoving(undefined);
                  })}>确认卸载</button>
                </div>
              ) : (
                <div className="tool-actions flex flex-wrap gap-1">
                  <button type="button" className={btnPrimary} aria-label={`打开 ${tool.name}`} disabled={busy} onClick={() => void openElectron(tool.id)}>打开 ↗</button>
                  <button type="button" className={btnSecondary} aria-label={`管理 ${tool.name}`} onClick={() => { setFeedback(undefined); setView({ kind: "manage", id: tool.id }); }}>管理</button>
                  {development && <button type="button" className={btnGhost} onClick={() => edit(tool)}>编辑</button>}
                  <button type="button" className={btnGhost} data-hint="导出插件项目源码 ZIP" disabled={busy} onClick={() => void exportTool(tool)}>导出</button>
                  <button type="button" className={btnGhost} onClick={() => setRemoving(tool.id)}>卸载</button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {tools.length > 0 && !tools.some(({ package: tool }) => `${tool.name} ${tool.id}`.toLowerCase().includes(search.trim().toLowerCase())) && <p className="py-8 text-center text-ui-sm text-ink-subtle">没有匹配的工具</p>}
      </div>
    </section>
  );
}
