export interface ToolPackage {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly html: string;
}

export interface PersonalTool {
  readonly package: ToolPackage;
  readonly lastOpened?: number;
}
