import { expect, it } from "vitest";
import {
  checkToolProject, createToolProject, listToolProjects, migrateLegacyTools,
  readToolProject, toolFromProject, toolProjectIdFromWish, type ToolProjectIO,
} from "../../../src/plugins/tools/runtime/project.ts";
import { parseToolPackage } from "../../../src/plugins/tools/runtime/package.ts";

/** 内存版宿主：把路径当字符串、文件当 Map，用来验证落盘逻辑本身。 */
function memoryIO(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const io: ToolProjectIO = {
    userDataDir: (namespace, directory) => Promise.resolve(`/data/${namespace}/${directory}`),
    pathExists: (path) => Promise.resolve(
      files.has(path) || [...files.keys()].some((key) => key.startsWith(`${path}/`)),
    ),
    listDirNames: (path) => Promise.resolve([...new Set([...files.keys()]
      .filter((key) => key.startsWith(`${path}/`))
      .map((key) => key.slice(path.length + 1).split("/")[0]!)
      .filter((name) => name.includes("/") === false))]),
    readTextFile: (path) => {
      const value = files.get(path);
      return value === undefined ? Promise.reject(new Error(`ENOENT ${path}`)) : Promise.resolve(value);
    },
    writeTextFile: (path, contents) => { files.set(path, contents); return Promise.resolve(); },
  };
  return { io, files };
}

const page = `<h1>演示</h1><button id="go">运行</button>
<script>window.aawActions={run:async()=>({ok:true})}</script>`;

it("creates a project whose guide and manifest are already on disk", async () => {
  const { io, files } = memoryIO();
  const created = await createToolProject(io, { id: "demo", name: "演示" });
  expect(created.dir).toBe("/data/tools/projects/demo");
  expect(files.get("/data/tools/projects/demo/AGENTS.md")).toContain("R1");
  expect(JSON.parse(files.get("/data/tools/projects/demo/manifest.json")!)).toMatchObject({ id: "demo", version: "0.1.0" });
  // html 留空 = 还没写完，此时不允许安装。
  const check = await checkToolProject(io, created.dir);
  expect(check.ready).toBe(false);
  expect(check.blocking[0]!.where).toBe("html");
});

it("treats index.html as the entry point and becomes installable once it is complete", async () => {
  const { io } = memoryIO();
  const { dir } = await createToolProject(io, { id: "demo", name: "演示" });
  await io.writeTextFile(`${dir}/index.html`, page);
  const read = await readToolProject(io, dir);
  expect(read.ok).toBe(true);
  if (!read.ok) return;
  expect(read.tool.html).toBe(page);
  // 骨架没声明 actions，但有 aawActions 实现 → 只是"建议"，不该拦住安装。
  const check = await checkToolProject(io, dir);
  expect(check.ready).toBe(true);
  expect(check.warnings.map((problem) => problem.ruleId)).toContain("R3");
});

it("blocks installation when a declared action has no implementation", async () => {
  const { io } = memoryIO();
  const { dir } = await createToolProject(io, { id: "demo", name: "演示" });
  await io.writeTextFile(`${dir}/manifest.json`, JSON.stringify({
    schemaVersion: 1, id: "demo", name: "演示", version: "1.0.0", html: "",
    actions: [{ id: "run", description: "跑", inputSchema: { type: "object", properties: {} } }],
  }));
  await io.writeTextFile(`${dir}/index.html`, "<p>没有实现</p>");
  const check = await checkToolProject(io, dir);
  expect(check.ready).toBe(false);
  expect(check.blocking.map((problem) => problem.ruleId)).toContain("R3");
});

it("explains a missing manifest instead of throwing", async () => {
  const { io } = memoryIO();
  const read = await readToolProject(io, "/data/tools/projects/none");
  expect(read.ok).toBe(false);
  if (read.ok) return;
  expect(read.violations[0]!.message).toContain("manifest.json");
  expect(read.violations[0]!.hint).toContain("新建");
});

it("migrates legacy tools once and never overwrites an existing project", async () => {
  const { io, files } = memoryIO();
  const tool = parseToolPackage(JSON.stringify({
    schemaVersion: 1, id: "legacy", name: "旧工具", version: "1.0.0", html: page,
  }));
  const first = await migrateLegacyTools(io, [tool]);
  expect(first.created).toEqual(["/data/tools/projects/legacy"]);
  expect(files.get("/data/tools/projects/legacy/index.html")).toBe(page);
  // 第二轮：目录已在，必须跳过，不能把用户后来的改动盖掉。
  files.set("/data/tools/projects/legacy/index.html", "<p>改过</p>");
  const second = await migrateLegacyTools(io, [tool]);
  expect(second.created).toEqual([]);
  expect(second.skipped).toEqual(["/data/tools/projects/legacy"]);
  expect(files.get("/data/tools/projects/legacy/index.html")).toBe("<p>改过</p>");
});

it("lists projects and reads one back through the same contract as installing", async () => {
  const { io } = memoryIO();
  const { dir } = await createToolProject(io, { id: "one", name: "一" });
  await io.writeTextFile(`${dir}/index.html`, page);
  expect(await listToolProjects(io)).toEqual(["/data/tools/projects/one"]);
  const result = await toolFromProject(io, dir);
  expect(result.ok).toBe(true);
});

it("derives a usable id from a Chinese wish", () => {
  expect(toolProjectIdFromWish("Text Tool")).toBe("text-tool");
  expect(toolProjectIdFromWish("我想要一个字数统计")).toMatch(/^tool-[a-z0-9]+$/);
});
