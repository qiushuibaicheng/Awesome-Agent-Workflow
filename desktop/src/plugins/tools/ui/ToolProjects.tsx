import { useState } from "react";
import { useStore } from "zustand";
import { DangerButton, btnGhost, btnPrimary, btnSecondary } from "../../../shared/ui/controls.tsx";
import { WrenchIcon } from "../../../shared/ui/icons.tsx";
import type { WorkshopService } from "./workshop.ts";

/**
 * 我的工具项目：磁盘上真实存在的目录，不是"装了什么"。
 *
 * 这一页补的是此前最致命的一个洞——AI 把工具写完了，用户却没有任何入口
 * 把它装进工具中心（只有"导出 ZIP"和"再新建一个"）。现在每个目录都能
 * 直接继续开发、预览、安装、删除。
 */
export function ToolProjectList({ workshop, onPreview, onInstall }: {
  workshop: WorkshopService;
  onPreview: (dir: string) => void;
  onInstall: (dir: string) => void;
}) {
  const snapshot = useStore(workshop.state);
  const [confirming, setConfirming] = useState<string>();
  const { projects, projectsLoading } = snapshot;
  if (projectsLoading && !projects.length)
    return <p className="build-hint">正在读取工具项目…</p>;
  if (!projects.length)
    return <div className="build-empty">
      <WrenchIcon className="size-6 text-info" />
      <div>
        <strong>还没有工具项目</strong>
        <p>在上面写一句需求，AI 会在一个真实目录里把工具做出来。</p>
      </div>
    </div>;
  return <ul aria-label="工具项目" className="build-projects">
    {projects.map((project) => {
      const name = project.name ?? project.dirName;
      const selectable = !project.broken && project.hasHtml;
      return <li key={project.dir} className="build-project">
        <div className="build-project-main">
          <strong>{name}</strong>
          <span>
            {project.version ? `v${project.version}` : "未写版本"}
            {project.network && <em className="build-permission">可联网</em>}
            {!project.hasHtml && <em className="build-missing">还没有 index.html</em>}
          </span>
          <code>{project.dir}</code>
          {project.broken && <span className="build-hint is-error">{project.broken}</span>}
        </div>
        {confirming === project.dir ? <div className="build-project-actions">
          <span className="build-hint">删除会移除项目目录与工具数据，不可恢复。</span>
          <button type="button" className={btnGhost} onClick={() => setConfirming(undefined)}>取消</button>
          <DangerButton onClick={() => {
            setConfirming(undefined);
            void workshop.purge(project.id ?? project.dirName);
          }}>确认删除</DangerButton>
        </div> : <div className="build-project-actions">
          <button type="button" className={btnPrimary} onClick={() => void workshop.resume(project.dir)}>继续开发</button>
          <button type="button" className={btnSecondary} disabled={!selectable} onClick={() => onPreview(project.dir)}>预览</button>
          <button type="button" className={btnSecondary} disabled={!selectable} onClick={() => onInstall(project.dir)}>安装</button>
          <button type="button" className={btnGhost} onClick={() => { void workshop.select(project.dir); setConfirming(project.dir); }}>删除</button>
        </div>}
      </li>;
    })}
  </ul>;
}
