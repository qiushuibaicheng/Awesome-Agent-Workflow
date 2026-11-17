import type { Context } from "cordis";
import { useStore } from "zustand";
import { WrenchIcon } from "../../../shared/ui/icons.tsx";
import { ToolsPanel } from "./ToolsPanel.tsx";
import { prepareProjectLauncher } from "../../project/service.ts";

export const name = "tools-ui";
export const inject = ["tools", "workbench", "host", "project", "account"];

export function apply(ctx: Context): void {
  const { workbench, tools, host, project, account } = ctx;

  /**
   * 工具项目的默认目录按账号分一层（`tools/projects/<账号>`），所以面板必须知道
   * "现在是谁"：换账号登录后重新取一次，目录和安装记录才对得上。
   */
  function ToolsView() {
    const user = useStore(account.state).currentUser;
    return <ToolsPanel service={tools} host={host} project={project} owner={user?.id} />;
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
