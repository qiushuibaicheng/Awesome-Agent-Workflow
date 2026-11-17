import { strToU8, unzipSync, zipSync } from "fflate";
import type { ToolPackage } from "../types.ts";
import { parseToolPackage, validateToolPackageText } from "./package.ts";
import { safeSourcePath } from "./sourceFiles.ts";

export const toolArchiveLimit = 1024 * 1024;

/** 压缩包里与工具无关的系统垃圾：macOS 的 `__MACOSX/`、`.DS_Store`、`Thumbs.db`。 */
function isArchiveNoise(path: string): boolean {
  return path.startsWith("__MACOSX/")
    || path.includes("/__MACOSX/")
    || /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(path);
}

/**
 * 导出的源码项目里除了工具本体，还要有"怎么改、怎么装回去"。
 *
 * 早先这里生成 `package.json` + `scripts/build.mjs`，要求接收方装 Node 再
 * `npm run build`——同事拿到 ZIP 第一步就卡住，而产物其实只是把两个文件
 * 打个包。现在直接写清：改完把整个目录（或本 ZIP）拖回工具中心即可。
 */
export function toolProjectFiles(tool: ToolPackage): Record<string, string> {
  const { html, sourceFiles, ...manifest } = tool;
  const author = tool.author ? `作者：${tool.author}\n` : "";
  const source = tool.source ? `来源：${tool.source}\n` : "";
  const scaffolding = {
    "README.md": `# ${tool.name}

${author}${source}
这是 AAW 工具的源码，不需要 Node、不需要安装依赖、不需要构建。

- \`manifest.json\`：工具身份、AI 动作、设置声明、能力声明
- \`index.html\`：实际运行的完整页面（HTML + CSS + JS 全在其中）

把目录交给 AI 继续改时，先让它读 \`manifest.json\` 与 \`index.html\`——本包不含
构建步骤，AI 直接改这两个文件即可。

## 改完怎么装回去

把这个 ZIP（或整个目录）拖进 AAW 的「工具中心」，或在工具中心点「导入工具」选它。
ID 相同的会覆盖更新；界面会在安装后告诉你版本从哪一版变到了哪一版。

## 注意

- \`index.html\` 必须自包含：外部 \`<script src>\`、外链 CSS 都会被拒绝。
- 图片用 data URL。
- 需要跨重启保留的数据用 \`window.aawStore\`，不要用 \`localStorage\`。
- 会联网的工具要在 \`manifest.json\` 里写 \`"permissions": { "network": true }\`，用户安装时能看到。
`,
  };
  // Windows treats paths case-insensitively. Author files win over generated
  // scaffolding while retaining their exact contents and original path casing.
  const authored = new Set(Object.keys(sourceFiles ?? {}).map((path) => path.toLowerCase()));
  const generated = Object.fromEntries(Object.entries(scaffolding).filter(([path]) => !authored.has(path.toLowerCase())));
  const combined = { ...generated, ...sourceFiles };
  // Optional instructions must not turn an installable package into a ZIP
  // that exceeds the source-count or serialized-size limits on reimport.
  const exportedSources = Object.keys(generated).length > 0
    && !validateToolPackageText(JSON.stringify({ ...manifest, html, sourceFiles: combined })).ok
    ? sourceFiles : combined;
  return {
    ...exportedSources,
    "manifest.json": JSON.stringify(manifest, null, 2),
    "index.html": html,
  };
}

export function exportToolProject(tool: ToolPackage): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(toolProjectFiles(tool)).map(([name, source]) => [name, strToU8(source)])), { level: 6 });
}

export function importToolProject(bytes: Uint8Array): ToolPackage {
  if (bytes.length > toolArchiveLimit) throw new Error("源码 ZIP 不能超过 1 MB。");
  const names = new Set<string>();
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (file) => {
      const path = file.name.replace(/\/$/, "");
      // macOS 压缩会带一层 `__MACOSX/` 资源目录和 `.DS_Store`；以前它们会被
      // 当成"不在项目根目录"的证据，用户只看到一句看不懂的报错。
      if (isArchiveNoise(path)) return false;
      if (!safeSourcePath(path) || names.has(path.toLowerCase())) throw new Error("源码 ZIP 含不安全或重复的文件路径。");
      names.add(path.toLowerCase());
      total += file.originalSize;
      if (names.size > 72 || !Number.isSafeInteger(total) || total > toolArchiveLimit) throw new Error("源码 ZIP 解压后不能超过 1 MB 或 72 个条目。");
      return !file.name.endsWith("/");
    } });
  } catch (error) {
    throw new Error(error instanceof Error ? `无法读取源码 ZIP：${error.message}` : "无法读取源码 ZIP。", { cause: error });
  }
  const manifests = Object.keys(files).filter((path) => path === "manifest.json" || path.endsWith("/manifest.json"));
  if (manifests.length !== 1) throw new Error("源码 ZIP 需要唯一的 manifest.json。");
  const prefix = manifests[0]!.slice(0, -"manifest.json".length);
  if (!files[`${prefix}index.html`] || Object.keys(files).some((path) => !path.startsWith(prefix))) throw new Error("manifest.json 与 index.html 必须放在同一个项目根目录。");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const sources = Object.fromEntries(Object.entries(files).map(([path, data]) => [path.slice(prefix.length), decoder.decode(data)]));
  let manifest: unknown;
  try { manifest = JSON.parse(sources["manifest.json"]!); } catch { throw new Error("manifest.json 格式无效。"); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("manifest.json 必须是对象。");
  const sourceFiles = Object.fromEntries(Object.entries(sources).filter(([name]) => name !== "manifest.json" && name !== "index.html"));
  return parseToolPackage(JSON.stringify({
    ...manifest,
    html: sources["index.html"],
    sourceFiles: Object.keys(sourceFiles).length ? sourceFiles : undefined,
  }));
}

export async function readToolImport(file: File): Promise<ToolPackage> {
  if (file.size > toolArchiveLimit) throw new Error("源码 ZIP 不能超过 1 MB。");
  if (file.name.toLowerCase().endsWith(".zip")) return importToolProject(new Uint8Array(await file.arrayBuffer()));
  if (file.size > 512 * 1024) throw new Error("工具包不能超过 512 KB。");
  return parseToolPackage(await file.text());
}
