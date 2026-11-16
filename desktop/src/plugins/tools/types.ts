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
}

export interface PersonalTool {
  readonly package: ToolPackage;
  readonly lastOpened?: number;
}
