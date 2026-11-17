import { useStore } from "zustand";
import { btnGhost, btnPrimary, btnSecondary, DangerButton } from "../../../shared/ui/controls.tsx";
import { CopyButton } from "../../../shared/ui/CopyButton.tsx";
import { describeViolations } from "../runtime/rules.ts";
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
  const { brief, parent, busy, note, project, projectsRoot } = useStore(state);
  const target = parent ?? projectsRoot;
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
        {/* 目录要能点开：之前只写着"默认位置（AAW 数据目录 / tools / projects）"，
            而用户没有别的入口打开它——AI 写坏一个文件时连去哪看都不知道。 */}
        <span className="build-target">目录
          {target
            ? <button
              type="button"
              className="build-path"
              data-hint="在文件管理器中打开"
              aria-label={`打开目录：${target}`}
              onClick={() => void (parent ? workshop.openDir(parent) : workshop.openProjectsRoot())}
            >{target}</button>
            : <code>默认位置</code>}
        </span>
        <button type="button" className={btnGhost} onClick={() => void workshop.chooseParent()} disabled={!available || busy}>选择目录</button>
        {parent && <button type="button" className={btnGhost} onClick={() => workshop.resetParent()} disabled={busy}>用默认</button>}
        <button type="submit" className={btnPrimary} disabled={!available || busy || !brief.trim()}>
          {busy ? "正在建项目…" : "开始做"}
        </button>
      </div>
      {!available && <p className="build-hint">需要桌面版并登录后才能建项目。</p>}
      {/* 有当前项目时结论在项目卡片上：说"AI 没修好"的话不该长在新建表单下面。 */}
      {note && !project && <p className={`build-hint ${note.error ? "is-error" : ""}`} aria-live="polite">{note.text}</p>}
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
        {/* 路径就是"源码在哪"的答案：点一下就打开文件管理器，比再加一个按钮省地方。 */}
        <button
          type="button"
          className="build-path"
          data-hint="在文件管理器中打开"
          aria-label={`打开项目目录：${project.dir}`}
          onClick={() => void workshop.openDir(project.dir)}
        >{project.dir}</button>
      </div>
      <span className={`build-status ${snapshot.running ? "is-running" : check?.ready ? "is-ready" : "is-pending"}`}>
        {snapshot.running ? "AI 正在写…" : check?.ready ? "可以验收" : "待修复"}
      </span>
    </div>
    {snapshot.note && <p className={`build-hint ${snapshot.note.error ? "is-error" : ""}`} aria-live="polite">{snapshot.note.text}</p>}
    {snapshot.stalled && (
      <div className="build-stalled" role="group" aria-label="需要你接手">
        <div>
          <strong>打开目录自己改</strong>
          <p>目录里的 index.html 与 manifest.json 就是源码，直接改；改完点「我改完了，重新校验」。</p>
        </div>
        <div className="build-stalled-actions">
          <button type="button" className={btnSecondary} onClick={() => void workshop.openDir()}>打开项目目录</button>
          <button type="button" className={btnPrimary} onClick={() => void workshop.verify()}>我改完了，重新校验</button>
        </div>
      </div>
    )}
    {check && <>
      <ViolationList problems={check.blocking} />
      <ViolationList problems={check.warnings} />
    </>}
    {/* 装进去的是快照：改了项目却没重装，打开工具看到的还是旧版。 */}
    {snapshot.drift && (
      <p className="build-hint">项目里的内容跟已安装的那一版不一样了——点「确认安装」把这一版装进去，否则打开工具看到的还是旧的。</p>
    )}
    <div className="build-active-actions">
      {/* 交接块里已经有「我改完了，重新校验」，这里就不再重复一个同名动作。 */}
      {!snapshot.stalled && <button type="button" className={btnSecondary} onClick={() => void workshop.verify()} disabled={snapshot.busy}>重新校验</button>}
      <button type="button" className={btnSecondary} onClick={onPreview} disabled={!check?.tool}>预览</button>
      {/* 文案一直说"把问题复制给 AI"，却只有一段不能一键复制的列表——这里补上按钮。 */}
      {!!check && (check.blocking.length > 0 || check.warnings.length > 0) && (
        <CopyButton
          tone="soft"
          label="复制问题给 AI"
          getText={() => describeViolations([...check.blocking, ...check.warnings])}
        />
      )}
      {snapshot.installed
        ? <span className="build-hint">{snapshot.drift ? "已安装（旧版）" : "已安装到工具中心"}</span>
        : <DangerButton onClick={() => void workshop.install()} disabled={!check?.ready}>确认安装</DangerButton>}
    </div>
  </section>;
}
