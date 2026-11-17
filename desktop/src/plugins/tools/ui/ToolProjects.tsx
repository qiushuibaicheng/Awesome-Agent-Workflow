import { useState } from "react";
import { useStore } from "zustand";
import { DangerButton, btnGhost, btnPrimary, btnSecondary } from "../../../shared/ui/controls.tsx";
import { WrenchIcon } from "../../../shared/ui/icons.tsx";
import type { PersonalTool } from "../types.ts";
import type { WorkshopService } from "./workshop.ts";

/**
 * 我的工具项目：磁盘上真实存在的目录，不是"装了什么"。
 *
 * 这一页补的是此前最致命的一个洞——AI 把工具写完了，用户却没有任何入口
 * 把它装进工具中心（只有"导出 ZIP"和"再新建一个"）。现在每个目录都能
 * 直接继续开发、预览、安装、改名、删除。
 */
export function ToolProjectList({ workshop, installed, onPreview, onInstall }: {
  workshop: WorkshopService;
  /** 已安装列表：用来标出"这个项目装了没有 / 装的是哪一版"。 */
  installed: readonly PersonalTool[];
  onPreview: (dir: string) => void;
  onInstall: (dir: string) => void;
}) {
  const snapshot = useStore(workshop.state);
  const [confirming, setConfirming] = useState<string>();
  const [renaming, setRenaming] = useState<{ dir: string; name: string; id: string; note?: string }>();
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

  async function commitRename() {
    if (!renaming) return;
    const note = await workshop.rename(renaming.dir, {
      name: renaming.name.trim(),
      id: renaming.id.trim(),
    });
    if (note.error) setRenaming({ ...renaming, note: note.text });
    else setRenaming(undefined);
  }

  return <>
    <div className="build-projects-head">
      <span>{projects.length} 个项目</span>
      <button type="button" className="build-path" data-hint="在文件管理器中打开" onClick={() => void workshop.openProjectsRoot()}>打开项目根目录</button>
    </div>
    <ul aria-label="工具项目" className="build-projects">
      {projects.map((project) => {
      const name = project.name ?? project.dirName;
      const selectable = !project.broken && project.hasHtml;
      const entry = installed.find((item) => item.package.id === project.id);
      // 版本号对不上就提示：AI 常常改完内容忘了改版本号，那种情况在选中项目
      // 后由「当前项目」卡片按内容比对，这里只处理版本号已经变了的情况。
      const versionDiffers = !!entry && !!project.version && entry.package.version !== project.version;
      return <li key={project.dir} className="build-project">
        <div className="build-project-main">
          <strong>{name}</strong>
          <span>
            {project.version ? `v${project.version}` : "未写版本"}
            {entry
              ? versionDiffers
                ? <em className="build-drift">项目已改到 v{project.version}，装进去的还是 v{entry.package.version}</em>
                : <em className="build-permission">已安装</em>
              : <em className="build-permission">未安装</em>}
            {project.network && <em className="build-permission">可联网</em>}
            {!project.hasHtml && <em className="build-missing">还没有 index.html</em>}
          </span>
          {/* 路径可点：想直接看文件的人不该先"继续开发"再想别的办法。 */}
          <button
            type="button"
            className="build-path"
            data-hint="在文件管理器中打开"
            aria-label={`打开项目目录：${project.dir}`}
            onClick={() => void workshop.openDir(project.dir)}
          >{project.dir}</button>
          {project.broken && <span className="build-hint is-error">{project.broken}</span>}
        </div>
        {renaming?.dir === project.dir ? (
          <form className="build-rename" onSubmit={(event) => { event.preventDefault(); void commitRename(); }}>
            <label>显示名
              <input value={renaming.name} onChange={(event) => setRenaming({ ...renaming, name: event.target.value })} maxLength={60} />
            </label>
            <label>目录名（= 工具 ID）
              <input value={renaming.id} onChange={(event) => setRenaming({ ...renaming, id: event.target.value, note: undefined })} spellCheck={false} />
            </label>
            <div className="build-project-actions">
              <button type="button" className={btnGhost} onClick={() => setRenaming(undefined)}>取消</button>
              <button type="submit" className={btnPrimary} disabled={!renaming.name.trim() || !renaming.id.trim()}>保存</button>
            </div>
            {renaming.note && <span className="build-hint is-error">{renaming.note}</span>}
          </form>
        ) : confirming === project.dir ? <div className="build-project-actions">
          <span className="build-hint">删除会移除项目目录与工具数据，不可恢复。</span>
          <button type="button" className={btnGhost} onClick={() => setConfirming(undefined)}>取消</button>
          <DangerButton onClick={() => {
            setConfirming(undefined);
            void workshop.purge(project.id ?? project.dirName);
          }}>确认删除</DangerButton>
        </div> : <div className="build-project-actions">
          <button type="button" className={btnPrimary} onClick={() => void workshop.resume(project.dir)}>继续开发</button>
          <button type="button" className={btnSecondary} disabled={!selectable} onClick={() => onPreview(project.dir)}>预览</button>
          <button type="button" className={btnSecondary} disabled={!selectable} onClick={() => onInstall(project.dir)}>{entry ? "重新安装" : "安装"}</button>
          <button type="button" className={btnGhost} onClick={() => setRenaming({ dir: project.dir, name, id: project.id ?? project.dirName })}>改名</button>
          <button type="button" className={btnGhost} onClick={() => { void workshop.select(project.dir); setConfirming(project.dir); }}>删除</button>
        </div>}
      </li>;
    })}
    </ul>
  </>;
}
