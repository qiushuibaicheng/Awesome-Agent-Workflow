import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import electron from "electron";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const source = join(desktop, "tools-runtime");
const staged = process.env.AAW_TOOLS_BUILD_DIR ? resolve(process.env.AAW_TOOLS_BUILD_DIR) : join(source, "dist");
const version = JSON.parse(readFileSync(join(desktop, "node_modules", "electron", "package.json"), "utf8")).version;
const marker = join(staged, `electron-${version}`);
mkdirSync(staged, { recursive: true });
let installed = false;
try { installed = readFileSync(marker, "utf8") === version; } catch { /* first build */ }
if (!installed) {
  const distribution = process.platform === "darwin" ? join(dirname(electron), "../../..") : dirname(electron);
  cpSync(distribution, staged, { recursive: true });
}
const resources = process.platform === "darwin"
  ? join(staged, "Electron.app", "Contents", "Resources")
  : join(staged, "resources");
const appDir = join(resources, "app");
mkdirSync(appDir, { recursive: true });
// Include new sibling modules automatically; a manual list can produce a
// successful build whose entry point fails with ERR_MODULE_NOT_FOUND.
for (const entry of readdirSync(source, { withFileTypes: true })) {
  if (entry.isFile() && (entry.name === "package.json" || /\.(?:mjs|cjs|js|html|css)$/.test(entry.name)))
    cpSync(join(source, entry.name), join(appDir, entry.name));
}
cpSync(join(desktop, "src-tauri", "icons", "32x32.png"), join(appDir, "icon.png"));
await build({
  entryPoints: [join(desktop, "src", "plugins", "tools", "runtime", "package.ts")],
  outfile: join(appDir, "package-contract.mjs"),
  bundle: true,
  format: "esm",
});
if (process.platform === "win32") cpSync(join(source, "aaw-tools.cmd"), join(staged, "aaw-tools.cmd"));
writeFileSync(marker, version);
process.stdout.write(`AAW tools runtime staged (Electron ${version}).\n`);
