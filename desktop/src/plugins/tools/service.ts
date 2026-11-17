import type { ReadonlySnapshot } from "../../shared/state/readonlySnapshot.ts";
import type { PersonalTool, ToolPackage, ToolSettings } from "./types.ts";

import type {} from "cordis";

declare module "cordis" {
  interface Context {
    tools: ToolsService;
  }
}

/** 一次安装/覆盖安装的结果，用来给用户说清"装了什么、换掉了什么"。 */
export interface InstallOutcome {
  readonly version: string;
  /** 覆盖安装前那一版的版本号；首次安装为 undefined。 */
  readonly previousVersion?: string;
  /** 之前是否已经装过（true = 更新，false = 新装）。 */
  readonly updated: boolean;
  /** 版本号是否真的变了。false 表示内容覆盖但版本号没动。 */
  readonly versionChanged: boolean;
}

export interface ToolsService {
  readonly state: ReadonlySnapshot<readonly PersonalTool[]>;
  install(tool: ToolPackage, replace?: boolean): InstallOutcome;
  open(id: string): void;
  remove(id: string): void;
  saveSettings(id: string, values: ToolSettings): void;
}
