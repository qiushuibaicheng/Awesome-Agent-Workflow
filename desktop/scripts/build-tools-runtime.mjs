import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import electron from "electron";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const source = join(desktop, "tools-runtime");
const staged = join(source, "dist");
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
for (const name of ["package.json", "main.mjs", "runtime.mjs", "catalog.mjs", "launcher-registry.mjs", "desktop-bridge.mjs", "cli.mjs", "preload.cjs", "launcher.html", "launcher.css", "launcher.js"])
  cpSync(join(source, name), join(appDir, name));
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
