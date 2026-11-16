import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useStore } from "zustand";
import { btnGhost, btnPrimary, btnSecondary } from "../../../shared/ui/controls.tsx";
import { SquareTerminalIcon, WrenchIcon } from "../../../shared/ui/icons.tsx";
import type { HostService } from "../../host/service.ts";
import { parseToolPackage, toolPackageLimit } from "../runtime/package.ts";
import type { ToolsService } from "../service.ts";
import type { ToolPackage } from "../types.ts";
import { sampleTool } from "./sample.ts";

type View = { kind: "library" } | { kind: "installed"; id: string } | { kind: "preview"; tool: ToolPackage };
const packageText = (tool: ToolPackage) => JSON.stringify(tool);
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const framePolicy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'";

export function ToolsPanel({ service, host }: { service: ToolsService; host: HostService }) {
  const tools = useStore(service.state);
  const [view, setView] = useState<View>({ kind: "library" });
  const [development, setDevelopment] = useState(false);
  const [draft, setDraft] = useState("");
  const [removing, setRemoving] = useState<string>();
  const [feedback, setFeedback] = useState<{ text: string; error?: true }>();
  const picker = useRef<HTMLInputElement>(null);
  const active = view.kind === "preview" ? view.tool : view.kind === "installed"
    ? tools.find(({ package: tool }) => tool.id === view.id)?.package
    : undefined;

  function run(action: () => void) {
    setFeedback(undefined);
    try {
      action();
    } catch (error) {
      setFeedback({ text: errorText(error), error: true });
    }
  }

  async function openElectron(id?: string) {
    setFeedback(undefined);
    try {
      await host.openToolsElectron(id);
    } catch (error) {
      setFeedback({ text: errorText(error), error: true });
    }
  }

  async function importFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const failures: string[] = [];
    let installed = 0;
    for (const file of files) {
      try {
        if (file.size > toolPackageLimit) throw new Error("工具包不能超过 512 KB。");
        service.install(parseToolPackage(await file.text()));
        installed++;
      } catch (error) {
        failures.push(`${file.name}：${errorText(error)}`);
      }
    }
    const result = `已导入 ${installed} 个工具。`;
    setFeedback(failures.length ? { text: [result, ...failures].join("\n"), error: true } : { text: result });
  }

  async function exportTool(tool: ToolPackage) {
    setFeedback(undefined);
    const filename = `${tool.id}-${tool.version}.aaw-tool.json`;
    try {
      if (host.isNative()) {
        const path = await host.dialogs.saveFile({ defaultPath: filename, filters: [{ name: "AAW 工具包", extensions: ["json"] }] });
        if (!path) return;
        await host.skills.writeTextFile(path, packageText(tool));
      } else {
        const url = URL.createObjectURL(new Blob([packageText(tool)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setFeedback({ text: "工具包已导出。" });
    } catch (error) {
      setFeedback({ text: errorText(error), error: true });
    }
  }

  function edit(tool: ToolPackage) {
    setDraft(JSON.stringify(tool, null, 2));
    setDevelopment(true);
    setFeedback(undefined);
  }

  if (active) {
    const preview = view.kind === "preview";
    return (
      <section aria-label={active.name} className="flex h-full min-h-0 flex-col bg-base">
        <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface/60 px-4 py-3">
          <button type="button" className={btnGhost} onClick={() => setView({ kind: "library" })}>
            {preview ? "返回开发模式" : "返回工具列表"}
          </button>
          <h2 className="min-w-0 truncate text-ui-lg font-semibold text-ink">{active.name}</h2>
          {preview && <span className="text-ui-sm text-ink-subtle">开发预览</span>}
          {!preview && host.isNative() && <button type="button" className={`${btnSecondary} ml-auto`} onClick={() => void openElectron(active.id)}>在 Electron 打开</button>}
        </header>
        {feedback?.error && <p role="alert" className="border-b border-line px-4 py-2 text-ui-sm text-danger-ink">{feedback.text}</p>}
        <iframe
          key={active.id}
          aria-label={active.name}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${framePolicy}">${active.html}`}
          className="min-h-0 w-full flex-1 border-0"
        />
      </section>
    );
  }

  return (
    <section aria-label="工具" className="flex h-full min-h-0 flex-col bg-base">
      <header className="border-b border-line bg-gradient-to-br from-info/10 via-surface/70 to-base px-4 pb-3 pt-5 sm:px-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-info/20 bg-info/10 text-info"><WrenchIcon className="size-5" /></span>
          <h2 className="mr-auto text-ui-xl font-semibold text-ink">个人工具</h2>
          {host.isNative() && <button type="button" className={btnSecondary} onClick={() => void openElectron()}>打开小窗</button>}
          <button type="button" className={btnPrimary} onClick={() => picker.current?.click()}>导入工具</button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className={development ? btnGhost : btnSecondary} aria-pressed={!development} onClick={() => setDevelopment(false)}>已安装 · {tools.length}</button>
          <button type="button" className={development ? btnSecondary : btnGhost} aria-pressed={development} onClick={() => setDevelopment(true)}>开发模式</button>
        </div>
        <input ref={picker} type="file" multiple accept=".json,application/json" onChange={(event) => void importFiles(event)} hidden />
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:px-5">
        {feedback && (
          <p role={feedback.error ? "alert" : "status"} className={`whitespace-pre-wrap break-words rounded-lg border border-line bg-surface px-3 py-2 text-ui-sm ${feedback.error ? "text-danger-ink" : "text-ink-subtle"}`}>
            {feedback.text}
          </p>
        )}
        {development && (
          <section aria-label="开发模式" className="space-y-3 rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="personal-tool-source" className="mr-auto text-ui-base font-semibold text-ink">工具包源码</label>
              <button type="button" className={btnGhost} onClick={() => edit(sampleTool)}>载入 JSON 格式化示例</button>
            </div>
            <textarea id="personal-tool-source" className="min-h-48 w-full rounded-lg border border-line bg-base p-3 font-mono text-ui-sm leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-info" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="粘贴 .aaw-tool.json 源码" spellCheck={false} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnSecondary} disabled={!draft.trim()} onClick={() => run(() => setView({ kind: "preview", tool: parseToolPackage(draft) }))}>运行预览</button>
              <button type="button" className={btnPrimary} disabled={!draft.trim()} onClick={() => run(() => {
                service.install(parseToolPackage(draft), true);
                setFeedback({ text: "工具已安装或更新。" });
              })}>安装或更新</button>
            </div>
          </section>
        )}
        {tools.length === 0 && !development && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong px-5 py-10 text-center">
            <WrenchIcon className="size-7 text-info" />
            <p className="text-ui-base font-semibold text-ink">暂无个人工具</p>
            <p className="text-ui-sm text-ink-subtle">导入工具包，或在开发模式中试用示例。</p>
            <button type="button" className={btnSecondary} onClick={() => edit(sampleTool)}>试用 JSON 格式化</button>
          </div>
        )}
        <ul aria-label="已安装工具" className="space-y-2">
          {tools.map(({ package: tool }) => (
            <li key={tool.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface p-3 transition-colors hover:border-info/35">
              <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-info/10 text-info"><WrenchIcon className="size-4" /></span>
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
                <div className="flex flex-wrap gap-1">
                  <button type="button" className={btnPrimary} aria-label={`打开 ${tool.name}`} onClick={() => run(() => {
                    service.open(tool.id);
                    setView({ kind: "installed", id: tool.id });
                  })}>打开</button>
                  {development && <button type="button" className={btnGhost} onClick={() => edit(tool)}>编辑</button>}
                  <button type="button" className={btnGhost} onClick={() => void exportTool(tool)}>导出</button>
                  <button type="button" className={btnGhost} onClick={() => setRemoving(tool.id)}>卸载</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
