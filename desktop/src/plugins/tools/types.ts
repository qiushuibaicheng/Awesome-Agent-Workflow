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
  /** 作者 / 团队名，导入别人给的包时用于判断可信度。 */
  readonly author?: string;
  /** 来源说明（仓库地址、内部文档链接等）。 */
  readonly source?: string;
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
  /** 首次安装时间（毫秒）。升级不改写，用来回答"这工具什么时候装上的"。 */
  readonly installedAt?: number;
  /** 最近一次覆盖安装的时间（毫秒）。 */
  readonly updatedAt?: number;
  /** 被这次覆盖掉的版本号，安装后提示「v1.0 → v2.0」用。 */
  readonly previousVersion?: string;
  /**
   * 这一版是从哪个项目目录装进来的。
   *
   * 记它是为了回答一个此前没人能回答的问题："我改了项目里的 index.html，
   * 工具中心里那个还是新的吗？"——有了目录就能读回来比对，不一致时提示
   * 用户重新安装，而不是让他打开一个旧版本还以为是刚改的。
   */
  readonly dir?: string;
  readonly settings?: ToolSettings;
}
