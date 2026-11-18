import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  capabilitiesAt,
  capabilityEntries,
  toolCapabilities,
  toolContractVersion,
} from "../../../src/plugins/tools/runtime/contract.ts";

/**
 * 契约快照测试。
 *
 * 这是"事前守门"，比版本闸门更重要：闸门是事后拦用户，这个测试是事前拦开发。
 * 谁改了 `tool-preload.cjs` 的暴露面、却没同步能力表或契约版本，这里直接失败。
 */
const preload = readFileSync(resolve(process.cwd(), "tools-runtime/tool-preload.cjs"), "utf8");
const runtime = readFileSync(resolve(process.cwd(), "tools-runtime/runtime.mjs"), "utf8");

/** `aawStore.scope` 归一到 `aawStore`：同一次 expose 里的附加入口。 */
const baseEntry = (entry: string) => entry.split(".")[0] ?? entry;

describe("工具运行契约", () => {
  it("契约版本是显式常量，改动必须是有意识的决定", () => {
    // 这个断言故意写死：升契约版本时你会看到它失败，从而必须来改这一行。
    expect(toolContractVersion).toBe(1);
  });

  it("能力表与 preload 实际暴露的 window 入口完全一致", () => {
    const exposed = [...preload.matchAll(/expose\("(aaw[A-Za-z]+)"/g)]
      .map((match) => match[1])
      .filter((name): name is string => typeof name === "string");
    const declared = capabilityEntries()
      .filter((item) => item.entry)
      .map((item) => baseEntry(item.entry));
    expect([...new Set(exposed)].sort()).toEqual([...new Set(declared)].sort());
  });

  it("每个能力都写清了 since 与 summary", () => {
    for (const capability of toolCapabilities) {
      expect(capability.name, "能力名不能为空").toMatch(/^[a-z][a-zA-Z.]{0,31}$/);
      expect(capability.since, `${capability.name} 需要 since`).toBeGreaterThanOrEqual(1);
      expect(capability.since, `${capability.name} 的 since 不能超过当前契约版本`).toBeLessThanOrEqual(toolContractVersion);
      expect(capability.summary.trim(), `${capability.name} 需要说明`).not.toBe("");
    }
  });

  it("能力名唯一", () => {
    const names = toolCapabilities.map((item) => item.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("capabilitiesAt 按代际过滤", () => {
    expect(capabilitiesAt(0)).toEqual([]);
    expect(capabilitiesAt(toolContractVersion)).toEqual(toolCapabilities.map((item) => item.name));
  });

  it("快照：能力表（改动会在这里显形）", () => {
    expect(toolCapabilities.map((item) => `${item.name}|${item.entry}|${item.direction}|${item.since}`)).toMatchInlineSnapshot(`
      [
        "settings|aawSettings|down|1",
        "store|aawStore|down|1",
        "sharedStore|aawStore.scope|down|1",
        "files|aawFiles|down|1",
        "clipboard|aawClipboard|down|1",
        "actions|aawActions|up|1",
        "system|aawSystem|down|1",
        "secrets|aawSecrets|down|1",
        "lifecycle|aawLifecycle|down|1",
        "context|aawContext|down|1",
        "bus|aawBus|down|1",
        "network||none|1",
      ]
    `);
  });

  it("运行时仍保留不可变的 CSP 基底（只有 connect-src 可参数化）", () => {
    expect(runtime).toContain("basePolicy");
    expect(runtime).toContain(`default-src 'none'`);
    expect(runtime).toContain(`script-src 'unsafe-inline'`);
    expect(runtime).toContain(`form-action 'none'`);
    expect(runtime).toContain(`base-uri 'none'`);
  });

  it("运行时不再把 settings 拼进 HTML（走 preload 注入）", () => {
    expect(runtime).not.toContain("toolSettingsScript");
    expect(runtime).toContain("additionalArguments");
    expect(preload).toContain("tool:settings:sync");
    expect(preload).toContain("sendSync");
  });
});
