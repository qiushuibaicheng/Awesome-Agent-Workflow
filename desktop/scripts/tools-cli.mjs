import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../tools-runtime/dist/", import.meta.url));
const binary = join(root, process.platform === "win32" ? "electron.exe"
  : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron");
const args = process.argv.slice(2);
const launcher = args[0] === "--launcher";
const profile = launcher ? undefined : mkdtempSync(join(tmpdir(), "aaw-tools-cli-"));

async function writeInput(directory) {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 512 * 1024) throw new Error("JSON 输入不能超过 512 KB。");
    chunks.push(chunk);
  }
  const path = join(directory, "action-input.json");
  writeFileSync(path, length ? Buffer.concat(chunks) : "{}");
  return path;
}

try {
  if (!existsSync(binary)) throw new Error("未构建 Electron 宿主，请先运行 npm run tools:build。");
  if (args[0] === "run" && args.length === 3 && !process.stdin.isTTY && profile)
    args.push(`--input-file=${await writeInput(profile)}`);
  const child = spawn(binary, launcher ? [] : ["--aaw-cli", ...args], {
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: !launcher,
    env: profile ? { ...process.env, AAW_TOOLS_HOST_PROFILE: profile } : process.env,
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error.message }) + "\n");
  process.exitCode = 1;
} finally {
  if (profile) {
    try { rmSync(profile, { recursive: true, force: true }); }
    catch { /* Electron may still be releasing transient cache files. */ }
  }
}
