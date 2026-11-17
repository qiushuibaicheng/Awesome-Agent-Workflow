import { btnGhost, btnPrimary, btnSecondary, DangerButton } from "../../../shared/ui/controls.tsx";
import type { ToolViolation } from "../types.ts";
import type { ToolWishState } from "./useToolWish.ts";

function ViolationList({ problems }: { problems: readonly ToolViolation[] }) {
  if (!problems.length) return null;
  return <ul className="wish-violations">
    {problems.map((problem, index) => (
      <li key={index} className={problem.level === "block" ? "is-block" : "is-warn"}>
        <span>{problem.ruleId}</span>
        <div><strong>{problem.message}</strong><small>{problem.hint}</small></div>
      </li>
    ))}
  </ul>;
}

/** 许愿卡片：一句话 → 目录 → 开始。状态与动作都来自 `useToolWish`。 */
export function ToolWishCard({ state, available, onPreview, onInstall }: {
  state: ToolWishState;
  available: boolean;
  onPreview: () => void;
  onInstall: () => void;
}) {
  const target = state.parent ?? "默认位置（AAW 数据目录 / tools / projects）";
  return <section aria-label="许愿做工具" className="wish-card">
    <h3>我想要一个…</h3>
    <p>说一句话就行。AI 会在一个真实项目里写，写完自动校验；你验收后它才变成能用的工具。</p>
    <form className="wish-form" onSubmit={(event) => { event.preventDefault(); void state.start(); }}>
      <textarea
        aria-label="我想要一个工具"
        value={state.wish}
        placeholder="例如：一个能把 JSON 转成表格、还能复制成 Markdown 的小工具"
        onChange={(event) => state.setWish(event.target.value)}
        spellCheck={false}
        disabled={!available || state.busy}
      />
      <div className="wish-row">
        <span className="wish-target" data-hint={target}>目录 <code>{target}</code></span>
        <button type="button" className={btnGhost} onClick={() => void state.chooseParent()} disabled={!available || state.busy}>选择目录</button>
        {state.parent && <button type="button" className={btnGhost} onClick={state.resetParent} disabled={state.busy}>用默认</button>}
        <div className="wish-actions">
          <button type="submit" className={btnPrimary} disabled={!available || state.busy || !state.wish.trim()}>
            {state.busy ? "正在建项目…" : "开始做"}
          </button>
        </div>
      </div>
      {!available && <p className="wish-hint">需要桌面版并登录后才能建项目。</p>}
      {state.note && <p className={`wish-hint ${state.note.error ? "is-error" : ""}`} aria-live="polite">{state.note.text}</p>}
    </form>
    {state.projectDir && <div className="wish-project">
      <div className="wish-project-head">
        <span>工具项目</span>
        <code>{state.projectDir}</code>
      </div>
      {state.check && <>
        <ViolationList problems={state.check.blocking} />
        <ViolationList problems={state.check.warnings} />
      </>}
      <div className="wish-project-actions">
        <button type="button" className={btnSecondary} onClick={() => void state.verify()} disabled={state.busy}>重新校验</button>
        <button type="button" className={btnSecondary} onClick={onPreview} disabled={!state.check?.tool || !state.check.ready}>预览</button>
        {state.installed
          ? <span className="wish-hint">已安装到工具中心</span>
          : <DangerButton onClick={onInstall} disabled={!state.check?.ready}>确认安装</DangerButton>}
      </div>
    </div>}
  </section>;
}
