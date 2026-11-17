export interface ToolAction {
  readonly id: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ToolPackage {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /**
   * 卡片与小窗上显示的 1–2 个字符（emoji 或字母）。缺省取名称首字。
   *
   * 加它是因为所有个人工具此前共用同一个图标，只能靠 4 色循环区分；这是
   * 可选字段，旧清单不受影响。
   */
  readonly icon?: string;
  readonly html: string;
  readonly actions?: readonly ToolAction[];
  readonly settingsSchema?: readonly ToolSetting[];
  /** Additional UTF-8 authoring files. The executable entry remains self-contained html. */
  readonly sourceFiles?: Readonly<Record<string, string>>;
}

export type ToolSettingValue = string | number | boolean;
export type ToolSettings = Readonly<Record<string, ToolSettingValue>>;
export type ToolSetting = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
} & (
  | { readonly type: "text"; readonly default: string }
  | { readonly type: "number"; readonly default: number; readonly min?: number; readonly max?: number }
  | { readonly type: "boolean"; readonly default: boolean }
  | { readonly type: "select"; readonly default: string; readonly options: readonly { readonly label: string; readonly value: string }[] }
);

export interface PersonalTool {
  readonly package: ToolPackage;
  readonly lastOpened?: number;
  readonly settings?: ToolSettings;
}
