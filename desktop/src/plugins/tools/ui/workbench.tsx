import type { Context } from "cordis";
import { WrenchIcon } from "../../../shared/ui/icons.tsx";
import { ToolsPanel } from "./ToolsPanel.tsx";

export const name = "tools-ui";
export const inject = ["tools", "workbench", "host"];

export function apply(ctx: Context): void {
  const { workbench, tools, host } = ctx;
  ctx.effect(() => workbench.register("panels", {
    id: "tools",
    launcher: {
      label: "工具",
      description: "打开和管理个人工具",
      searchHint: "tools plugins",
      Icon: WrenchIcon,
      order: 30,
    },
    View: () => <ToolsPanel service={tools} host={host} />,
  }), "tools:panel");
}
