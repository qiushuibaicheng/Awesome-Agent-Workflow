import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sampleTool } from "../src/plugins/tools/ui/sample.ts";

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
  const configuration = join(root, "configuration");
  mkdirSync(configuration);
  writeFileSync(join(configuration, "preferences.json"), JSON.stringify({
    "aaw-desktop.auth.v1": JSON.stringify({ version: 1, user: { id: "smoke" } }),
    "aaw-desktop.personal-tools.v1": JSON.stringify({
      "user:smoke": [{ package: sampleTool }],
      "user:unrelated": [{ package: { ...sampleTool, id: "hidden" } }],
    }),
  }));
  const listed = invoke(["list"]);
  assert.equal(listed.code, 0);
  assert.deepEqual(listed.data.result.map(({ id }) => id), [sampleTool.id]);

  const described = invoke(["describe", sampleTool.id]);
  assert.equal(described.code, 0);
  assert.equal(described.data.result.actions[0].inputSchema.properties.text.type, "string");

  const executed = invoke(["run", sampleTool.id, "format"], JSON.stringify({ text: '{"hello":"AAW"}' }));
  assert.deepEqual(executed, { code: 0, data: { ok: true, result: '{\n  "hello": "AAW"\n}' } });
  const wrongAction = invoke(["run", sampleTool.id, "missing"], "{}");
  assert.equal(wrongAction.code, 1);
  assert.equal(wrongAction.data.ok, false);
  process.stdout.write("Electron tools CLI smoke passed.\n");
} finally {
  rmSync(root, { force: true, recursive: true });
}
