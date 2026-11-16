import type { ReadonlySnapshot } from "../../shared/state/readonlySnapshot.ts";
import type { PersonalTool, ToolPackage, ToolSettings } from "./types.ts";

import type {} from "cordis";

declare module "cordis" {
  interface Context {
    tools: ToolsService;
  }
}

export interface ToolsService {
  readonly state: ReadonlySnapshot<readonly PersonalTool[]>;
  install(tool: ToolPackage, replace?: boolean): void;
  open(id: string): void;
  remove(id: string): void;
  saveSettings(id: string, values: ToolSettings): void;
}
