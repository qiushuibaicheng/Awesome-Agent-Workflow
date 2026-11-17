import { useEffect, useState, useSyncExternalStore } from "react";
import { btnSecondary } from "../../../shared/ui/controls.tsx";
import { pathKey } from "../../../shared/panelPaths.ts";
import type { HostService } from "../../host/service.ts";
import type { ProjectService } from "../../project/service.ts";
import type { ToolsService } from "../service.ts";
import { checkToolProject } from "../runtime/project.ts";
import type { ToolPackage, ToolViolation } from "../types.ts";
import { hostToolIO } from "../runtime/io.ts";
import { ToolPreview } from "./ToolPreview.tsx";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly tool: ToolPackage; readonly warnings: readonly ToolViolation[] }
  | { readonly kind: "broken"; readonly message: string; readonly blocking: readonly ToolViolation[] };

/**
 * 右栏里的工具预览：会话在中间，工具在右边，改完就能看。
 *
 * 为什么单独做成右栏标签而不是"把整个工具中心换成预览页"：验收是反复的
 * （改一句 → 看一眼），每看一次都要离开工具列表、再点回来，来回三次用户
 * 就不想验收了。做成标签后，预览与工具列表各占一个标签，会话始终在中间。
 *
 * 内容从磁盘读，而不是从安装记录读：这里看的是"项目现在长什么样"，不是
 * "装进去的那一版"。AI 一停下就自动重读一次——用户不需要再点"刷新"。
 */
export function ToolPreviewTab({ dir, host, project, tools, revision = 0 }: {
  dir: string;
  host: HostService;
  /** 用来监听"AI 停了"：同一工作区停下时自动重读。 */
  project?: ProjectService;
  /** 用来对比"预览的这一份"与"装进去的那一份"。 */
  tools?: ToolsService;
  revision?: number;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);
  const installed = useSyncExternalStore(
    tools?.state.subscribe ?? (() => () => {}),
    tools?.state.getState ?? (() => [] as const),
  );

  const reread = () => setReloads((value) => value + 1);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const check = await checkToolProject(hostToolIO(host), dir);
        if (cancelled) return;
        setState(check.tool
          ? { kind: "ready", tool: check.tool, warnings: check.warnings }
          : { kind: "broken", message: "这个项目现在读不出可预览的工具。", blocking: check.blocking });
      } catch (error) {
        if (cancelled) return;
        setState({
          kind: "broken",
          message: error instanceof Error ? error.message : String(error),
          blocking: [],
        });
      }
    })();
    return () => { cancelled = true; };
  }, [dir, host, revision, reloads]);

  // AI 在这个项目里停下 → 内容可能变了，安静地重读一次。
  useEffect(() => {
    if (!project) return;
    const session = project.conversation.foreground.session;
    let running = session.getState().isAgentRunning;
    return session.subscribe((next) => {
      const stopped = running && !next.isAgentRunning;
      running = next.isAgentRunning;
      if (!stopped) return;
      const active = project.projects.workspace.getState().activePath;
      if (active && pathKey(active) === pathKey(dir)) setReloads((value) => value + 1);
    });
  }, [project, dir]);

  if (state.kind === "loading")
    return <p className="build-hint p-3">正在读取 {dir} …</p>;

  if (state.kind === "broken")
    return <div className="p-3">
      <p className="build-hint is-error">{state.message}</p>
      {state.blocking.length > 0 && <ul className="build-violations">
        {state.blocking.slice(0, 6).map((problem, index) => (
          <li key={index} className="is-block"><span>{problem.ruleId}</span>
            <div><strong>{problem.message}</strong><small>{problem.hint}</small></div>
          </li>
        ))}
      </ul>}
      <button type="button" className={btnSecondary} onClick={reread}>重新读取</button>
    </div>;

  const entry = installed.find((item) => item.package.id === state.tool.id);
  const stale = !!entry && (entry.package.version !== state.tool.version || entry.package.html !== state.tool.html);

  return <div className="flex h-full min-h-0 flex-col">
    {/* 预览看的是磁盘，工具中心看的是快照：不说清楚，用户会以为已经装上了。 */}
    <p className="build-hint px-3 pt-2">
      {!entry
        ? "这是项目里的版本，还没安装——满意后回工具中心点「安装」。"
        : stale
          ? `预览的是项目最新内容；工具中心里还是 v${entry.package.version}，点「安装」才会更新。`
          : null}
    </p>
    {state.warnings.length > 0 && (
      <p className="build-hint px-3 pt-2">{state.warnings.length} 条建议（不影响运行），完整列表在「工具项目」里。</p>
    )}
    <div className="min-h-0 flex-1">
      <ToolPreview
        embedded
        tool={state.tool}
        revision={reloads}
        onReload={reread}
      />
    </div>
  </div>;
}
