import type { Context } from "cordis";
import { WrenchIcon } from "../../../shared/ui/icons.tsx";
import { ToolsPanel } from "./ToolsPanel.tsx";
import { prepareProjectLauncher } from "../../project/service.ts";

export const name = "tools-ui";
export const inject = ["tools", "workbench", "host", "project"];

export function apply(ctx: Context): void {
  const { workbench, tools, host, project } = ctx;
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
    View: () => <ToolsPanel service={tools} host={host} project={project} />,
  }), "tools:panel");
}
