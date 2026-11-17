import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { toolFramePolicy } from "../../../src/plugins/tools/runtime/policy.ts";

it("keeps preview and the real tool window on the same CSP", () => {
  // 预览比真实窗口松 → "预览能跑、打开就废"；比它紧 → 冤枉工具。
  const runtime = readFileSync(resolve(process.cwd(), "tools-runtime/runtime.mjs"), "utf8");
  for (const directive of toolFramePolicy.split(";").map((item) => item.trim())) {
    expect(runtime, `runtime.mjs 缺少指令：${directive}`).toContain(directive);
  }
});

it("allows the network but keeps implicit loading locked down", () => {
  expect(toolFramePolicy).toContain("connect-src https: http:");
  expect(toolFramePolicy).toContain("default-src 'none'");
  expect(toolFramePolicy).toContain("form-action 'none'");
});
