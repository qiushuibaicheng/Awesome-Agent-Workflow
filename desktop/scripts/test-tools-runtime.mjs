import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sampleTool } from "../src/plugins/tools/ui/sample.ts";
import { exportToolProject, importToolProject } from "../src/plugins/tools/runtime/projectArchive.ts";
import { unzipSync } from "fflate";

const root = mkdtempSync(join(tmpdir(), "aaw-tools-runtime-test-"));
const runner = fileURLToPath(new URL("./tools-cli.mjs", import.meta.url));

function invoke(args, input) {
  const child = spawnSync(process.execPath, [runner, ...args], {
    input, encoding: "utf8", timeout: 30000, env: { ...process.env, AAW_TOOLS_DATA_ROOT: root },
  });
  if (child.error) throw child.error;
  return { code: child.status, data: JSON.parse(child.stdout.trim()) };
}

try {
  // aawStore 的最小探针：写一次、另起进程读一次，证明数据真落在磁盘上。
  const storeProbe = {
    schemaVersion: 1, id: "store-probe", name: "存储探针", version: "1.0.0",
    html: `<script>window.aawActions = {
      write: async (input) => { await aawStore.set("probe", input.value); return { written: input.value }; },
      read: async () => ({ value: await aawStore.get("probe") }),
    };</script>`,
    actions: [
      { id: "write", description: "写入一个值", inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } },
      { id: "read", description: "读出已存的值", inputSchema: { type: "object", properties: {} } },
    ],
  };
  const configuration = join(root, "configuration");
  mkdirSync(configuration);
  writeFileSync(join(configuration, "preferences.json"), JSON.stringify({
    "aaw-desktop.auth.v1": JSON.stringify({ version: 1, user: { id: "smoke" } }),
    "aaw-desktop.personal-tools.v1": JSON.stringify({
      "user:smoke": [{ package: sampleTool, settings: { indent: 4 } }, { package: storeProbe }],
      "user:unrelated": [{ package: { ...sampleTool, id: "hidden" } }],
    }),
  }));
  const listed = invoke(["list"]);
  assert.equal(listed.code, 0);
  assert.deepEqual(listed.data.result.map(({ id }) => id).sort(), [sampleTool.id, storeProbe.id].sort());

  const described = invoke(["describe", sampleTool.id]);
  assert.equal(described.code, 0);
  assert.equal(described.data.result.actions[0].inputSchema.properties.text.type, "string");

  const executed = invoke(["run", sampleTool.id, "format"], JSON.stringify({ text: '{"hello":"AAW"}' }));
  assert.deepEqual(executed, { code: 0, data: { ok: true, result: '{\n    "hello": "AAW"\n}' } });
  const wrongAction = invoke(["run", sampleTool.id, "missing"], "{}");
  assert.equal(wrongAction.code, 1);
  assert.equal(wrongAction.data.ok, false);

  const written = invoke(["run", storeProbe.id, "write"], JSON.stringify({ value: "持久化" }));
  assert.deepEqual(written.data.result, { written: "持久化" });
  // 换一个进程读：内存分区可不会跨进程存活，能读到就说明落盘了。
  const readBack = invoke(["run", storeProbe.id, "read"], "{}");
  assert.deepEqual(readBack.data.result, { value: "持久化" });
  assert.ok(readFileSync(join(root, "tools", "storage", "smoke", "store-probe.json"), "utf8").includes("持久化"));
  const exported = join(root, "source");
  const archive = exportToolProject(sampleTool);
  assert.equal(importToolProject(archive).html, sampleTool.html);
  for (const [path, bytes] of Object.entries(unzipSync(archive))) {
    const target = join(exported, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  const built = spawnSync(process.execPath, [join(exported, "scripts", "build.mjs")], { encoding: "utf8", timeout: 10000 });
  assert.equal(built.status, 0, built.stderr);
  const rebuilt = JSON.parse(readFileSync(join(exported, "dist", `${sampleTool.id}.aaw-tool.json`), "utf8"));
  assert.equal(rebuilt.html, sampleTool.html);
  assert.equal(rebuilt.settingsSchema[0].default, 2);
  process.stdout.write("Electron tools CLI smoke passed.\n");
} finally {
  rmSync(root, { force: true, recursive: true });
}
