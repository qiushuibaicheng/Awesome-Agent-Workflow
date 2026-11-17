import type { Context } from "cordis";
import { useStore } from "zustand";
import { WrenchIcon } from "../../../shared/ui/icons.tsx";
import { ToolsPanel } from "./ToolsPanel.tsx";
import { createWorkshop } from "./workshop.ts";
import { prepareProjectLauncher } from "../../project/service.ts";

export const name = "tools-ui";
export const inject = ["tools", "workbench", "host", "project", "account"];

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

  function ToolsView() {
    const user = useStore(account.state).currentUser;
    // 换账号后目录与安装记录都换了一层，用 key 让面板重新挂载、重新拉列表。
    return <ToolsPanel key={user?.id ?? "anonymous"} service={tools} host={host} project={project} workshop={workshop} />;
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
}
