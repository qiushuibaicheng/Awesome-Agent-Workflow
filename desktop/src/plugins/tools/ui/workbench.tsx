import type { Context } from "cordis";
import { useStore } from "zustand";
import { WrenchIcon } from "../../../shared/ui/icons.tsx";
import { pathKey } from "../../../shared/panelPaths.ts";
import { ToolsPanel } from "./ToolsPanel.tsx";
import { ToolPreviewTab } from "./ToolPreviewTab.tsx";
import { createWorkshop } from "./workshop.ts";
import { prepareProjectLauncher } from "../../project/service.ts";

export const name = "tools-ui";
export const inject = ["tools", "workbench", "host", "project", "account"];

/** 预览标签的 kind：`tool-preview:<目录>`，同一个项目只开一个标签。 */
const previewKind = "tool-preview";

export function previewTabId(dir: string): string {
  return `${previewKind}:${pathKey(dir)}`;
}

export function apply(ctx: Context): void {
  const { workbench, tools, host, project, account } = ctx;

  /**
   * 工坊状态挂在插件上而不是面板上。
   *
   * 新建工具会把主内容区切到会话页（`startNewSession` 里的 `openView`），
   * 面板随即卸载；状态若留在组件里，AI 写完后既没人校验也没有回灌，用户
   * 回到面板只看到空卡片。放在 `apply()` 这一刻创建，生命周期跟插件走。
   */
  const workshop = createWorkshop({
    tools,
    project,
    host,
    owner: () => account.state.getState().currentUser?.id,
  });
  ctx.effect(() => () => workshop.dispose(), "tools:workshop");

  function ToolsView({ project: panelProject }: { project: string }) {
    const user = useStore(account.state).currentUser;
    // 换账号后目录与安装记录都换了一层，用 key 让面板重新挂载、重新拉列表。
    return <ToolsPanel
      key={user?.id ?? "anonymous"}
      service={tools}
      host={host}
      project={project}
      workshop={workshop}
      onPreviewProject={(dir, name) => {
        // 预览开成右栏的另一个标签：会话留在中间，工具在右边，来回切都不用
        // 离开当前项目。
        workbench.panels.getState().openTab(panelProject, {
          id: previewTabId(dir),
          kind: previewKind,
          data: { dir, ...(name ? { name } : {}) },
        });
      }}
    />;
  }

  ctx.effect(() => workbench.register("panels", {
    id: "tools",
    launcher: {
      label: "工具",
      description: "打开和管理个人工具",
      searchHint: "tools plugins",
      Icon: WrenchIcon,
      order: 30,
      prepareGlobalOpen: () => prepareProjectLauncher(ctx.project, workbench, host, false),
    },
    View: ToolsView,
  }), "tools:panel");

  /**
   * 工具预览标签：可以和工具列表、文件、终端并排存在。
   *
   * `data.dir` 会跟着布局一起落盘，所以重启后标签还在，内容重新从磁盘读
   * ——项目可能已经被改过了，读快照反而会骗人。
   */
  ctx.effect(() => workbench.register("panels", {
    id: previewKind,
    present(tab) {
      const name = typeof tab.data?.name === "string" ? tab.data.name : undefined;
      const dir = typeof tab.data?.dir === "string" ? tab.data.dir : tab.id;
      return {
        title: name ?? dir.split(/[\\/]/).filter(Boolean).pop() ?? "工具预览",
        typeLabel: "工具预览",
        searchHint: "tool preview 预览",
        icon: <WrenchIcon className="size-3.5 shrink-0" />,
      };
    },
    key: ({ tab }) => (typeof tab?.data?.dir === "string" ? tab.data.dir : tab?.id ?? ""),
    View: ({ tab }) => {
      const dir = typeof tab?.data?.dir === "string" ? tab.data.dir : undefined;
      return dir
        ? <ToolPreviewTab dir={dir} host={host} project={project} tools={tools} />
        : <p className="build-hint p-3">这个预览标签缺少项目路径，关掉重新打开。</p>;
    },
  }), "tools:preview");
}
