import { strToU8, unzipSync, zipSync } from "fflate";
import type { ToolPackage } from "../types.ts";
import { parseToolPackage } from "./package.ts";
import { safeSourcePath } from "./sourceFiles.ts";

export const toolArchiveLimit = 1024 * 1024;
const buildScript = `import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sourceFiles = {};
function collect(folder, prefix = '') {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
    const path = prefix + entry.name;
    if (entry.isDirectory()) collect(join(folder, entry.name), path + '/');
    else if (entry.isFile() && !['manifest.json', 'index.html'].includes(path))
      sourceFiles[path] = readFileSync(join(folder, entry.name), 'utf8');
  }
}
collect(root);
const result = JSON.stringify({ ...manifest, html, sourceFiles }, null, 2);
if (Buffer.byteLength(result) > 512 * 1024) throw new Error('工具包不能超过 512 KB');
if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(manifest.id)) throw new Error('Invalid tool ID');
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', manifest.id + '.aaw-tool.json'), result);
console.log('已生成 dist/' + manifest.id + '.aaw-tool.json');
`;

export function toolProjectFiles(tool: ToolPackage): Record<string, string> {
  const { html, sourceFiles, ...manifest } = tool;
  return {
    "README.md": `# ${tool.name}\n\n这是 AAW 插件的可编辑源码项目。\n\n- index.html：实际运行的完整 HTML、内联 JavaScript 和 CSS。\n- manifest.json：插件身份、AI actions 与 settingsSchema。\n- scripts/build.mjs：使用 Node.js 构建可导入的工具包，无需 npm install。\n\n修改后执行 npm run build，将 dist 下的 .aaw-tool.json 导入 AAW。也可将本目录压缩为 ZIP 直接导入。更新已有 ID 时请在管理页选择更新源码。\n\nindex.html 必须自包含；外部 script src、CSS 引用需要由作者预先打包内联。附加源码文件会保留在导出包中，但宿主不会执行构建脚本。图片请使用 data URL。\n\n通过 window.aawSettings 读取管理页已保存设置；本项目仅包含设置声明与默认值，不包含用户填写值。通过 window.aawActions 暴露 AI 能力，界面按钮复用相同函数。\n`,
    "package.json": JSON.stringify({ name: `aaw-tool-${tool.id}`, version: tool.version, private: true, type: "module", scripts: { build: "node scripts/build.mjs" } }, null, 2),
    "scripts/build.mjs": buildScript,
    ...sourceFiles,
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
  return parseToolPackage(JSON.stringify({ ...manifest, html: sources["index.html"], sourceFiles }));
}

export async function readToolImport(file: File): Promise<ToolPackage> {
  if (file.size > toolArchiveLimit) throw new Error("源码 ZIP 不能超过 1 MB。");
  if (file.name.toLowerCase().endsWith(".zip")) return importToolProject(new Uint8Array(await file.arrayBuffer()));
  if (file.size > 512 * 1024) throw new Error("工具包不能超过 512 KB。");
  return parseToolPackage(await file.text());
}
