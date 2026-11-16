import { btnGhost, btnPrimary, btnSecondary } from "../../../shared/ui/controls.tsx";
import { SquareTerminalIcon } from "../../../shared/ui/icons.tsx";

/** Editing surface only; package validation and installation belong to ToolsPanel. */
export function ToolDeveloper({ source, onChange, onExample, onPreview, onInstall }: {
  source: string;
  onChange: (value: string) => void;
  onExample: () => void;
  onPreview: () => void;
  onInstall: () => void;
}) {
  return <section aria-label="开发模式" className="tools-developer">
    <div className="developer-heading">
      <div><h3>插件开发</h3><p>编辑工具包，预览后安装到你的工具库。</p></div>
      <button type="button" className={btnGhost} onClick={onExample}>载入 JSON 格式化示例</button>
    </div>
    <div className="developer-editor">
      <div className="developer-file"><SquareTerminalIcon className="size-3.5" /><label htmlFor="personal-tool-source">工具包源码</label><span>.aaw-tool.json</span></div>
      <textarea id="personal-tool-source" value={source} onChange={(event) => onChange(event.target.value)} placeholder={'粘贴 .aaw-tool.json 源码，或从上方载入示例。'} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
      <div className="developer-status"><span>JSON · UTF-8</span><span>{source.split("\n").length} 行</span></div>
    </div>
    <div className="developer-footer">
      <p>预览不会修改已安装的插件。</p>
      <div className="developer-actions">
        <button type="button" className={btnSecondary} disabled={!source.trim()} onClick={onPreview}>运行预览</button>
        <button type="button" className={btnPrimary} disabled={!source.trim()} onClick={onInstall}>安装或更新</button>
      </div>
    </div>
  </section>;
}
