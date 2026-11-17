import { useEffect, useRef, useState } from "react";
import { DangerButton, btnGhost, btnPrimary, btnSecondary, Listbox } from "../../../shared/ui/controls.tsx";
import { CopyButton } from "../../../shared/ui/CopyButton.tsx";
import { SquareTerminalIcon } from "../../../shared/ui/icons.tsx";
import type { PersonalTool, ToolSettings } from "../types.ts";
import { resolveToolSettings } from "../runtime/settings.ts";
import { toolGlyph, toneOf } from "./mark.ts";

/**
 * 插件管理页：分组设置排版，不是四张卡片摞起来。
 *
 * 旧的每一节都是「22px 内边距 + 边框 + 圆角 + 底色」的大卡片，右栏只有
 * 360px 时一屏只放得下一节，标题、说明、内容、按钮各自占一行，翻半天才能
 * 找到「导出源码」。现在每节是一行：左侧是分组名与一句说明，右侧是内容，
 * 中间用细线分隔。信息密度上去了，扫视顺序也稳定了。窄栏自动折成上下两块。
 */
export function ToolManagement({ entry, onBack, onOpen, onExport, onUpdate, onSave, onRemove, onRollback, busy, feedback }: {
  entry: PersonalTool; onBack: () => void; onOpen: () => void; onExport: () => void; onUpdate: (file: File) => void;
  onSave: (values: ToolSettings) => boolean; onRemove: () => void; onRollback?: () => void; busy: boolean;
  feedback?: { text: string; error?: true };
}) {
  const tool = entry.package;
  const [values, setValues] = useState<ToolSettings>(() => resolveToolSettings(tool, entry.settings));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, setPending] = useState<{ label: string; confirmLabel: string; run: () => void }>();
  const continueEditing = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(values) !== JSON.stringify(resolveToolSettings(tool, entry.settings));
  const fields = tool.settingsSchema ?? [];
  useEffect(() => { if (pending) continueEditing.current?.focus(); }, [pending]);
  function requestAction(label: string, run: () => void, confirmLabel = "放弃修改并继续") {
    if (dirty) setPending({ label, run, confirmLabel });
    else run();
  }
  return <section aria-label={`${tool.name} 管理`} className="aaw-tools tool-management flex h-full min-h-0 flex-col bg-base">
    <header className="management-nav"><button type="button" className={btnGhost} onClick={() => requestAction("返回工具中心", onBack, "放弃修改并返回")}>← 返回工具中心</button><span>插件管理</span></header>
    <div className="management-scroll">
      <div className="management-inner">
        <div className="management-hero">
          <span aria-hidden="true" className={`management-icon tone-${toneOf(tool.id)}`}>{toolGlyph(tool)}</span>
          <div className="management-hero-copy"><h2>{tool.name}</h2><p>v{tool.version} <span>·</span> 个人插件{tool.author ? ` · ${tool.author}` : ""}</p></div>
          <button type="button" className={btnPrimary} onClick={onOpen} disabled={busy}>打开插件 ↗</button>
        </div>
        {feedback && <p className={`management-feedback ${feedback.error ? "is-error" : ""}`} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
        {pending && <div className="management-feedback" role="alert"><p>还有未保存的设置，继续{pending.label}将放弃这些修改。</p><div className="mg-actions"><button ref={continueEditing} type="button" className={btnSecondary} onClick={() => setPending(undefined)}>继续编辑</button><DangerButton onClick={() => { setPending(undefined); pending.run(); }}>{pending.confirmLabel}</DangerButton></div></div>}

        <section className="mg-row" aria-labelledby="settings-title">
          <div className="mg-label">
            <div className="mg-label-head"><h3 id="settings-title">自定义设置</h3><span className="mg-badge">{fields.length} 项</span></div>
            <p>按你的使用习惯调整这个插件</p>
          </div>
          <div className="mg-content">
            {fields.length ? <form onSubmit={(event) => { event.preventDefault(); onSave(values); }}>
              <div className="mg-fields">{fields.map((field) => <div className={`mg-field ${field.type === "boolean" ? "is-toggle" : ""}`} key={field.id}>
                <label htmlFor={`setting-${field.id}`}>{field.label}{field.description && <small>{field.description}</small>}</label>
                {field.type === "boolean" ? <input id={`setting-${field.id}`} type="checkbox" role="switch" checked={values[field.id] === true} onChange={(event) => setValues({ ...values, [field.id]: event.target.checked })} />
                  : field.type === "select" ? <Listbox label={field.label} value={String(values[field.id])} options={field.options} onChange={(value) => setValues({ ...values, [field.id]: value })} fullWidth className="py-2 text-sm" />
                  : <input id={`setting-${field.id}`} type={field.type === "number" ? "number" : "text"} value={Number.isNaN(values[field.id]) ? "" : String(values[field.id] ?? "")}
                    min={field.type === "number" ? field.min : undefined} max={field.type === "number" ? field.max : undefined} step={field.type === "number" ? "any" : undefined} maxLength={field.type === "text" ? 4096 : undefined}
                    onChange={(event) => setValues({ ...values, [field.id]: field.type === "number" ? event.target.value === "" ? NaN : Number(event.target.value) : event.target.value })} />}
              </div>)}</div>
              <div className="mg-form-footer"><span>{dirty ? "有未保存的修改" : "保存后，重新打开插件生效"}</span><div className="mg-actions"><button type="button" className={btnGhost} onClick={() => setValues(resolveToolSettings(tool))}>恢复默认</button><button type="submit" className={btnPrimary} disabled={!dirty}>保存设置</button></div></div>
            </form> : <p className="mg-empty">此插件暂未提供自定义设置。作者添加设置项后，它们会自动出现在这里。</p>}
          </div>
        </section>

        <section className="mg-row" aria-labelledby="source-title">
          <div className="mg-label">
            <div className="mg-label-head"><h3 id="source-title">源码与开发</h3><span className="mg-badge">ZIP</span></div>
            <p>导出完整源码，交给你或 AI 继续开发</p>
          </div>
          <div className="mg-content">
            <div className="mg-files"><code>manifest.json</code><code>index.html</code><code>AGENTS.md</code><code>README.md</code><span>+ 附加源码</span></div>
            <div className="mg-actions"><button type="button" className={btnSecondary} onClick={onExport} disabled={busy}>导出源码 ZIP</button><button type="button" className={btnGhost} onClick={() => picker.current?.click()} disabled={busy}>更新源码</button>{entry.previousVersion && onRollback && <button type="button" className={btnGhost} onClick={onRollback} disabled={busy}>退回上一版 v{entry.previousVersion}</button>}</div>
            <p className="mg-note">导出的是可直接导入的源码包：不需要 Node、不需要构建；要装回去时在工具中心点「导入工具」选中这个 ZIP。不包含你的个人设置。</p>
            {entry.dir && <p className="mg-note">这一版是从 <code>{entry.dir}</code> 装进来的。在那里改完内容要回工具中心点一次「安装」才会生效——已安装的是一份快照，不会跟着目录自动变。</p>}
            <input ref={picker} type="file" accept=".zip,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) requestAction("更新源码", () => onUpdate(file)); }} />
          </div>
        </section>

        <section className="mg-row" aria-labelledby="actions-title">
          <div className="mg-label">
            <div className="mg-label-head"><h3 id="actions-title">AI 动作</h3><span className="mg-badge">{tool.actions?.length ?? 0} 个</span></div>
            <p>你和 AI 走的是同一个函数</p>
          </div>
          <div className="mg-content">
            {tool.actions?.length ? <ul className="mg-actions-list">{tool.actions.map((action) => {
              // 安装版里没有 npm：真正的入口是安装目录下 tools-runtime/aaw-tools.cmd。
              const command = `aaw-tools run ${tool.id} ${action.id}`;
              return <li key={action.id} className="mg-action">
                <div className="mg-action-head"><code>{action.id}</code><CopyButton getText={() => command} label="复制命令" /></div>
                <p>{action.description}</p>
                <code className="mg-command">{command}</code>
              </li>;
            })}</ul> : <p className="mg-empty">此插件暂未声明动作。声明 actions 后，AI 就能通过 CLI 调用与界面相同的逻辑。</p>}
            {!!tool.actions?.length && <p className="mg-note">在 AAW 安装目录的 <code>tools-runtime</code> 下执行 <code>aaw-tools.cmd</code>；源码仓库里等价于 <code>npm run tools -- run …</code>。参数走标准输入或 <code>--input-file=&lt;路径&gt;</code>。</p>}
          </div>
        </section>

        <section className="mg-row" aria-labelledby="info-title">
          <div className="mg-label">
            <div className="mg-label-head"><h3 id="info-title">插件信息</h3></div>
            <p>运行能力与标识</p>
          </div>
          <div className="mg-content">
            <dl className="mg-meta">
              <div><dt>插件 ID</dt><dd><code>{tool.id}</code></dd></div>
              <div><dt>运行方式</dt><dd>Electron 独立窗口</dd></div>
              <div><dt>运行能力</dt><dd>{tool.permissions?.network ? "会联网（http/https）" : "仅本地，不联网"}</dd></div>
              <div><dt>AI 接口</dt><dd><SquareTerminalIcon className="size-3.5" />{tool.actions?.length ? `${tool.actions.length} 个 CLI 动作` : "暂未声明"}</dd></div>
              {tool.author && <div><dt>作者</dt><dd>{tool.author}</dd></div>}
              {tool.source && <div><dt>来源</dt><dd className="mg-source">{tool.source}</dd></div>}
              {entry.installedAt && <div><dt>安装于</dt><dd>{new Date(entry.installedAt).toLocaleString("zh-CN")}</dd></div>}
              {entry.updatedAt && <div><dt>最近更新</dt><dd>{new Date(entry.updatedAt).toLocaleString("zh-CN")}{entry.previousVersion ? `（上一版 v${entry.previousVersion}）` : ""}</dd></div>}
            </dl>
          </div>
        </section>

        <section className="mg-row is-last" aria-labelledby="remove-title">
          <div className="mg-label">
            <div className="mg-label-head"><h3 id="remove-title">卸载插件</h3></div>
            <p>移除本账号中的插件与设置，可先导出源码保留项目</p>
          </div>
          <div className="mg-content mg-remove">{confirmRemove ? <div className="mg-actions"><button type="button" className={btnGhost} onClick={() => setConfirmRemove(false)}>取消</button><DangerButton onClick={onRemove}>确认卸载</DangerButton></div> : <button type="button" className={`${btnGhost} remove-button`} onClick={() => setConfirmRemove(true)}>卸载</button>}</div>
        </section>
      </div>
    </div>
  </section>;
}
