import { useRef, useState } from "react";
import { btnGhost, btnPrimary, btnSecondary, Listbox } from "../../../shared/ui/controls.tsx";
import { WrenchIcon, SquareTerminalIcon } from "../../../shared/ui/icons.tsx";
import type { PersonalTool, ToolSettings } from "../types.ts";
import { resolveToolSettings } from "../runtime/settings.ts";

export function ToolManagement({ entry, onBack, onOpen, onExport, onUpdate, onEdit, onSave, onRemove, busy, feedback }: {
  entry: PersonalTool; onBack: () => void; onOpen: () => void; onExport: () => void; onUpdate: (file: File) => void;
  onEdit: () => void; onSave: (values: ToolSettings) => boolean; onRemove: () => void; busy: boolean;
  feedback?: { text: string; error?: true };
}) {
  const tool = entry.package;
  const [values, setValues] = useState<ToolSettings>(() => resolveToolSettings(tool, entry.settings));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(values) !== JSON.stringify(resolveToolSettings(tool, entry.settings));
  const fields = tool.settingsSchema ?? [];
  return <section aria-label={`${tool.name} 管理`} className="aaw-tools tool-management flex h-full min-h-0 flex-col bg-base">
    <header className="management-nav"><button type="button" className={btnGhost} onClick={() => dirty ? setLeaving(true) : onBack()}>← 返回工具中心</button><span>插件管理</span></header>
    <div className="management-scroll">
      <div className="management-hero">
        <span className="management-icon"><WrenchIcon className="size-7" /></span>
        <div><h2>{tool.name}</h2><p>v{tool.version} <span>·</span> 个人插件</p></div>
        <button type="button" className={btnPrimary} onClick={onOpen} disabled={busy}>打开插件 ↗</button>
      </div>
      {feedback && <p className={`management-feedback ${feedback.error ? "is-error" : ""}`} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
      {leaving && <div className="management-feedback" role="alert"><p>还有未保存的设置。</p><div className="management-actions"><button type="button" className={btnSecondary} onClick={() => setLeaving(false)}>继续编辑</button><button type="button" className={btnGhost} onClick={onBack}>放弃修改并返回</button></div></div>}
      <section className="management-card" aria-labelledby="settings-title">
        <div className="management-section-title"><div><h3 id="settings-title">自定义设置</h3><p>为你的使用习惯调整插件</p></div><span className="management-badge">{fields.length} 项</span></div>
        {fields.length ? <form onSubmit={(event) => { event.preventDefault(); onSave(values); }}>
          <div className="management-fields">{fields.map((field) => <div className={`management-field ${field.type === "boolean" ? "is-toggle" : ""}`} key={field.id}>
            <label htmlFor={`setting-${field.id}`}>{field.label}{field.description && <small>{field.description}</small>}</label>
            {field.type === "boolean" ? <input id={`setting-${field.id}`} type="checkbox" role="switch" checked={values[field.id] === true} onChange={(event) => setValues({ ...values, [field.id]: event.target.checked })} />
              : field.type === "select" ? <Listbox label={field.label} value={String(values[field.id])} options={field.options} onChange={(value) => setValues({ ...values, [field.id]: value })} fullWidth className="py-2 text-sm" />
              : <input id={`setting-${field.id}`} type={field.type === "number" ? "number" : "text"} value={Number.isNaN(values[field.id]) ? "" : String(values[field.id] ?? "")}
                min={field.type === "number" ? field.min : undefined} max={field.type === "number" ? field.max : undefined} step={field.type === "number" ? "any" : undefined} maxLength={field.type === "text" ? 4096 : undefined}
                onChange={(event) => setValues({ ...values, [field.id]: field.type === "number" ? event.target.value === "" ? NaN : Number(event.target.value) : event.target.value })} />}
          </div>)}</div>
          <div className="management-form-footer"><span>{dirty ? "有未保存的修改" : "保存后，重新打开插件生效"}</span><div className="management-actions"><button type="button" className={btnGhost} onClick={() => setValues(resolveToolSettings(tool))}>恢复默认</button><button type="submit" className={btnPrimary} disabled={!dirty}>保存设置</button></div></div>
        </form> : <div className="management-empty"><WrenchIcon className="size-6" /><div><strong>此插件暂未提供自定义设置</strong><p>作者添加设置项后，它们会自动出现在这里。</p></div></div>}
      </section>
      <section className="management-card" aria-labelledby="source-title"><div className="management-section-title"><div><h3 id="source-title">源码与开发</h3><p>导出完整源码，交给你或 AI 继续开发</p></div><span className="management-badge">ZIP</span></div>
        <div className="management-files"><code>manifest.json</code><code>index.html</code><code>scripts/build.mjs</code><span>+ 开发说明与附加源码</span></div>
        <div className="management-actions"><button type="button" className={btnSecondary} onClick={onExport} disabled={busy}>导出源码 ZIP</button><button type="button" className={btnGhost} onClick={() => picker.current?.click()} disabled={busy}>更新源码</button><button type="button" className={btnGhost} onClick={onEdit}>编辑工具包</button></div>
        <p className="management-note">导出包含设置声明与默认值，不包含你的个人设置。</p>
        <input ref={picker} type="file" accept=".zip,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onUpdate(file); }} />
      </section>
      <section className="management-card"><div className="management-section-title"><div><h3>插件信息</h3><p>运行能力与标识</p></div></div><dl className="management-meta"><dt>插件 ID</dt><dd><code>{tool.id}</code></dd><dt>运行方式</dt><dd>Electron 独立窗口</dd><dt>AI 接口</dt><dd><SquareTerminalIcon className="size-3.5" />{tool.actions?.length ? `${tool.actions.length} 个 CLI 动作` : "暂未声明"}</dd></dl></section>
      <section className="management-remove"><div><h3>卸载插件</h3><p>移除本账号中的插件与设置，可先导出源码保留项目。</p></div>{confirmRemove ? <div className="management-actions"><button type="button" className={btnGhost} onClick={() => setConfirmRemove(false)}>取消</button><button type="button" className={`${btnSecondary} remove-button`} onClick={onRemove}>确认卸载</button></div> : <button type="button" className={`${btnGhost} remove-button`} onClick={() => setConfirmRemove(true)}>卸载</button>}</section>
    </div>
  </section>;
}
