import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { parseToolPackage } from "../../../src/plugins/tools/runtime/package.ts";
import { ruleIds, runToolRules, splitViolations, describeViolations } from "../../../src/plugins/tools/runtime/rules.ts";
import { toolGuide, repairMessage } from "../../../src/plugins/tools/runtime/guide.ts";

const tool = (extra: Record<string, unknown> = {}) => parseToolPackage(JSON.stringify({
  schemaVersion: 1,
  id: "demo",
  name: "演示",
  version: "1.0.0",
  html: "<button id=go>Go</button><script>window.aawActions={run:async()=>({ok:true})}</script>",
  actions: [{ id: "run", description: "跑一下", inputSchema: { type: "object", properties: {} } }],
  ...extra,
}));

const ids = (problems: readonly { ruleId: string }[]) => problems.map((problem) => problem.ruleId);

it("accepts a self-contained tool that implements its declared actions", () => {
  expect(runToolRules(tool())).toEqual([]);
});

it("R1 blocks renaming an installed tool", () => {
  const problems = runToolRules(tool(), { previousId: "older-id" });
  expect(ids(problems)).toContain("R1");
  expect(splitViolations(problems).blocking).toHaveLength(1);
  // 提示要给出两条明确出路，否则 AI 只会把 id 改回去又撞一次。
  expect(problems[0]!.hint).toContain("older-id");
});

it("R2 blocks external scripts and styles, because the sandbox cannot load them", () => {
  const external = tool({ html: '<script src="https://cdn.example/x.js"></script>' });
  expect(ids(runToolRules(external))).toContain("R2");
  const linked = tool({ html: '<link rel="stylesheet" href="theme.css"><p>x</p>' });
  expect(ids(runToolRules(linked))).toContain("R2");
  // `<script src=>` 只是脚本字符串里的普通文本，不该被当成外链。
  expect(ids(runToolRules(tool({ html: "<script>const s='<script src=>'</script>" }))))
    .not.toContain("R2");
});

it("R3 blocks actions that were declared but never implemented", () => {
  const problems = runToolRules(tool({ html: "<p>没有动作实现</p>" }));
  expect(ids(problems)).toContain("R3");
  expect(splitViolations(problems).blocking.map((problem) => problem.ruleId)).toContain("R3");
});

it("R4/R6/R7 warn without blocking, so users keep their freedom", () => {
  const problems = runToolRules(tool({
    html: `<style>body{width:1200px}</style><script>
      localStorage.setItem("setting.indent", "2");
      localStorage.setItem("rows", "12");
      window.aawActions={run:async()=>({})};
    </script>`,
  }));
  expect(ids(problems)).toEqual(expect.arrayContaining(["R4", "R6", "R7"]));
  expect(splitViolations(problems).blocking).toEqual([]);
});

it("R5 flags a secret but never blocks", () => {
  const problems = runToolRules(tool({
    html: `<script>const token="sk-abcdefghijklmnopqrstuvwxyz";window.aawActions={run:async()=>({})}</script>`,
  }));
  const r5 = problems.filter((problem) => problem.ruleId === "R5");
  expect(r5).toHaveLength(1);
  expect(r5[0]!.level).toBe("warn");
});

it("R8 blocks networking that was not declared, and passes once declared", () => {
  const html = `<script>fetch("https://intranet.example/api").then(r=>r.json());window.aawActions={run:async()=>({})}</script>`;
  expect(ids(runToolRules(tool({ html })))).toContain("R8");
  expect(ids(runToolRules(tool({ html, permissions: { network: true } })))).not.toContain("R8");
});

it("keeps the manual and the checker on the same rule ids", () => {
  // vitest 在 jsdom 环境下 import.meta.url 不是 file:，用 cwd 定位仓库根更稳。
  const manual = readFileSync(resolve(process.cwd(), "../skills/tool-dev/SKILL.md"), "utf8");
  const guide = toolGuide({ id: "demo", name: "演示" });
  for (const id of ruleIds) {
    expect(manual).toContain(`**${id}**`);
    expect(guide).toContain(`| ${id} |`);
  }
});

it("hands violations back to the agent as repair instructions", () => {
  const problems = runToolRules(tool({ html: "<p>没有动作实现</p>" }));
  const text = repairMessage(problems);
  expect(text).toContain("必须修");
  expect(text).toContain("R3");
  expect(text).toContain("改法：");
  expect(describeViolations(problems)).toContain("R3");
});
