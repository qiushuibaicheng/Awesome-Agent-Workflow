import { useStore } from "zustand";
import { btnGhost, btnPrimary, btnSecondary, DangerButton } from "../../../shared/ui/controls.tsx";
import type { ToolViolation } from "../types.ts";
import type { WorkshopService } from "./workshop.ts";

export function ViolationList({ problems }: { problems: readonly ToolViolation[] }) {
  if (!problems.length) return null;
  return <ul className="build-violations">
    {problems.map((problem, index) => (
      <li key={index} className={problem.level === "block" ? "is-block" : "is-warn"}>
        <span>{problem.ruleId}</span>
        <div><strong>{problem.message}</strong><small>{problem.hint}</small></div>
      </li>
    ))}
  </ul>;
}

/**
 * 新建工具：一句话 + 落在哪。
 *
 * 刻意做成一行而不是半屏卡片——用户打开工具中心的第一诉求通常是"用某个
 * 工具"，不是"再做一个"。要展开细节（选目录）时才展示第二行。
 */
export function NewToolForm({ workshop, available }: {
  workshop: WorkshopService;
  available: boolean;
}) {
  const state = workshop.state;
  const { brief, parent, busy, note } = useStore(state);
  const target = parent ?? "默认位置（AAW 数据目录 / tools / projects）";
  return <section aria-label="新建工具" className="build-new">
    <form onSubmit={(event) => { event.preventDefault(); void workshop.create(); }}>
      <label className="build-new-label" htmlFor="tool-brief">新建工具</label>
      <textarea
        id="tool-brief"
        aria-label="描述你要的工具"
        value={brief}
        placeholder="一句话描述你要的工具，例如：把接口返回的 JSON 转成表格，还能导出 Markdown"
        onChange={(event) => workshop.setBrief(event.target.value)}
        spellCheck={false}
        rows={2}
        disabled={!available || busy}
      />
      <div className="build-new-row">
        <span className="build-target">目录 <code>{target}</code></span>
        <button type="button" className={btnGhost} onClick={() => void workshop.chooseParent()} disabled={!available || busy}>选择目录</button>
        {parent && <button type="button" className={btnGhost} onClick={() => workshop.resetParent()} disabled={busy}>用默认</button>}
        <button type="submit" className={btnPrimary} disabled={!available || busy || !brief.trim()}>
          {busy ? "正在建项目…" : "开始做"}
        </button>
      </div>
      {!available && <p className="build-hint">需要桌面版并登录后才能建项目。</p>}
      {note && <p className={`build-hint ${note.error ? "is-error" : ""}`} aria-live="polite">{note.text}</p>}
    </form>
  </section>;
}

/**
 * 当前项目卡片：AI 正在写 / 校验结果 / 验收。
 *
 * 这块内容是"流程还活着"的可见证据——面板切到会话再切回来，它仍然显示
 * 同一个项目、同一份校验结果，因为状态在插件层而不是组件里。
 */
export function ActiveProjectCard({ workshop, onPreview }: {
  workshop: WorkshopService;
  onPreview: () => void;
}) {
  const snapshot = useStore(workshop.state);
  const project = snapshot.project;
  if (!project) return null;
  const check = snapshot.check;
  return <section aria-label={`当前项目 ${project.name}`} className="build-active">
    <div className="build-active-head">
      <div>
        <strong>{project.name}</strong>
        <code>{project.dir}</code>
      </div>
      <span className={`build-status ${snapshot.running ? "is-running" : check?.ready ? "is-ready" : "is-pending"}`}>
        {snapshot.running ? "AI 正在写…" : check?.ready ? "可以验收" : "待修复"}
      </span>
    </div>
    {check && <>
      <ViolationList problems={check.blocking} />
      <ViolationList problems={check.warnings} />
    </>}
    <div className="build-active-actions">
      <button type="button" className={btnSecondary} onClick={() => void workshop.verify()} disabled={snapshot.busy}>重新校验</button>
      <button type="button" className={btnSecondary} onClick={onPreview} disabled={!check?.tool}>预览</button>
      {snapshot.installed
        ? <span className="build-hint">已安装到工具中心</span>
        : <DangerButton onClick={() => void workshop.install()} disabled={!check?.ready}>确认安装</DangerButton>}
    </div>
  </section>;
}
