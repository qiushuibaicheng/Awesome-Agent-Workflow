import { useState } from "react";
import { btnGhost, btnPrimary, btnSecondary } from "../../../shared/ui/controls.tsx";
import { CopyButton } from "../../../shared/ui/CopyButton.tsx";
import { SquareTerminalIcon } from "../../../shared/ui/icons.tsx";
import { developerPrompt, extractToolPackage } from "./aiPrompt.ts";

/** Editing surface only; package validation and installation belong to ToolsPanel. */
export function ToolDeveloper({ source, onChange, onExample, onPreview, onInstall }: {
  source: string;
  onChange: (value: string) => void;
  onExample: () => void;
  onPreview: () => void;
  onInstall: () => void;
}) {
  const [note, setNote] = useState<{ text: string; error?: true }>();

  /** AI 不会只输出纯 JSON（通常带解释和 ```json 围栏），这一步替用户剥离。 */
  function tidy() {
    const result = extractToolPackage(source);
    if ("error" in result) { setNote({ text: result.error, error: true }); return; }
    onChange(result.json);
    setNote({ text: "已从 AI 回复中提取工具包，可先运行预览确认，再安装。" });
  }

  return <section aria-label="开发模式" className="tools-developer">
    <div className="developer-heading">
      <div><h3>插件开发</h3><p>把需求说给 AI，把它的回复粘回来即可安装。</p></div>
      <div className="developer-heading-actions">
        <CopyButton getText={developerPrompt} label="复制提示词给 AI" />
        <button type="button" className={btnGhost} onClick={onExample}>载入示例</button>
      </div>
    </div>
    <div className="developer-editor">
      <div className="developer-file"><SquareTerminalIcon className="size-3.5" /><label htmlFor="personal-tool-source">工具包源码</label><span>.aaw-tool.json</span></div>
      <textarea id="personal-tool-source" value={source} onChange={(event) => { setNote(undefined); onChange(event.target.value); }}
        placeholder={"把 AI 的回复整段粘进来，然后点「整理 AI 输出」；也可以直接粘 .aaw-tool.json。"}
        spellCheck={false} autoCapitalize="off" autoCorrect="off" />
      <div className="developer-status"><span>JSON · UTF-8</span><span>{source.split("\n").length} 行</span></div>
    </div>
    {note && <p className={`developer-note ${note.error ? "is-error" : ""}`} role={note.error ? "alert" : "status"}>{note.text}</p>}
    <div className="developer-footer">
      <p>预览不会修改已安装的插件。</p>
      <div className="developer-actions">
        <button type="button" className={btnGhost} disabled={!source.trim()} onClick={tidy}>整理 AI 输出</button>
        <button type="button" className={btnSecondary} disabled={!source.trim()} onClick={onPreview}>运行预览</button>
        <button type="button" className={btnPrimary} disabled={!source.trim()} onClick={onInstall}>安装或更新</button>
      </div>
    </div>
  </section>;
}
