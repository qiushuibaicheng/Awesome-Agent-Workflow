import { expect, it } from "vitest";
import type { Context } from "cordis";
import { createTestDesktopRuntime } from "../../helpers/desktopRuntime.ts";
import { parseToolPackage } from "../../../src/plugins/tools/runtime/package.ts";

const makeTool = (id: string) => parseToolPackage(JSON.stringify({
  schemaVersion: 1,
  id,
  name: id,
  version: "1.0.0",
  html: "<button>Run</button>",
}));

it("validates the portable package without evaluating its contents", () => {
  expect(makeTool("format-json").html).toBe("<button>Run</button>");
  // 字段级错误：乱写 id 时要指明是 id 的问题，而不是一句笼统的"工具包无效"。
  expect(() => makeTool("../outside")).toThrow(/id/);
  expect(() => parseToolPackage("broken")).toThrow("JSON");
});

it("maintains distinct personal libraries and keeps recent use when updating", async () => {
  let context: Context | undefined;
  const runtime = createTestDesktopRuntime(
    { attachPreloading: () => () => {}, close: () => Promise.resolve() },
    undefined,
    (value) => { context = value; },
  );
  try {
    await runtime.ready;
    if (!context) throw new Error("Missing desktop context");
    const { account, tools } = context;
    const first = { name: "First", employeeId: "tools-test-first" };
    const second = { name: "Second", employeeId: "tools-test-second" };
    const a = makeTool("a");
    const b = makeTool("b");
    account.loginAsDev(first);
    tools.install(a);
    tools.install(b);
    tools.install({ ...a, settingsSchema: [{ id: "count", type: "number", label: "数量", default: 2, min: 1, max: 8 }] }, true);
    tools.saveSettings(a.id, { count: 4 });
    expect(() => tools.saveSettings(a.id, { count: -1 })).toThrow("数量");
    expect(() => tools.install(b)).toThrow("相同 ID");
    tools.open(b.id);
    // 升级要能回答"从哪一版到哪一版"：以前 install 返回 void，界面只能提示
    // "已安装或更新"，用户不知道版本到底动了没有。
    const upgraded = tools.install({ ...b, version: "1.1.0" }, true);
    expect(upgraded).toMatchObject({ updated: true, versionChanged: true, previousVersion: "1.0.0", version: "1.1.0" });
    expect(tools.state.getState()[0]?.installedAt).toBeTypeOf("number");
    expect(tools.state.getState()[0]?.updatedAt).toBeTypeOf("number");
    expect(tools.state.getState()[0]?.previousVersion).toBe("1.0.0");
    const sameVersion = tools.install({ ...b, version: "1.1.0", html: "<p>改</p>" }, true);
    expect(sameVersion).toMatchObject({ updated: true, versionChanged: false });
    expect(tools.state.getState().map((entry) => entry.package.id)).toEqual(["b", "a"]);
    account.loginAsDev(second);
    expect(tools.state.getState()).toEqual([]);
    account.loginAsDev(first);
    expect(tools.state.getState().find((entry) => entry.package.id === a.id)?.settings).toEqual({ count: 4 });
    expect(tools.state.getState()[0]?.package.version).toBe("1.1.0");
    tools.remove(b.id);
    expect(tools.state.getState().map((entry) => entry.package.id)).toEqual(["a"]);
  } finally {
    await runtime.shutdown();
  }
});
