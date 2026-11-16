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
