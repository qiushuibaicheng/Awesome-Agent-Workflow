export interface ToolAction {
  readonly id: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/**
 * 一条校验结果。
 *
 * 两档：`block` 装不上，`warn` 只提醒作者（例如把密钥写进 html）。分级的意义是
 * 让"尽量不约束"落在 warn 上——提醒但不阻止，用户自己决定。
 */
export interface ToolViolation {
  /** `FIELD` 表示清单字段问题；`R1`…`R7` 对应手册里的红线编号。 */
  readonly ruleId: string;
  readonly level: "block" | "warn";
  /** 位置，例如 `manifest.id`、`index.html`。 */
  readonly where?: string;
  /** 给人看的说明。 */
  readonly message: string;
  /** 给 AI 看的修复建议——它要能照着改，而不是再猜一次。 */
  readonly hint: string;
}

/** 工具在运行时申请的能力；安装时会展示给用户。 */
export interface ToolPermissions {
  /** 会发起网络请求（http/https）。 */
  readonly network?: boolean;
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
  readonly permissions?: ToolPermissions;
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
