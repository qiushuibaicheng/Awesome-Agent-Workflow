import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { importToolProject } from "../../src/plugins/tools/runtime/projectArchive.ts";

async function selectToolAction(page: Page, tool: string, action: string) {
  await page.getByRole("button", { name: `更多操作：${tool}`, exact: true }).click();
  const item = page.getByRole("menuitem", { name: action, exact: true });
  await expect(item).toBeInViewport();
  await item.click();
}

for (const width of [360, 740, 1100]) for (const theme of ["dark", "warm"]) {
  test(`plugin library and management fit ${width}px in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(`/tests/visual/toolsFixture.html${theme === "warm" ? "?warm" : ""}`);
    await page.evaluate(() => document.documentElement.style.setProperty("--ui-font-size", "20px"));
    await expect(page.getByRole("button", { name: "更多操作：JSON 格式化", exact: true })).toBeVisible();
    await expect(page.locator(".tool-row-meta").first()).toHaveCSS("font-size", "11px");
    // 密度是可验收的指标：360px 宽、850px 高的右栏里至少能看到 7 个工具。
    // 卡片式布局在同样高度只能放 3 个，这一条防止以后又把行高做大回去。
    expect(await page.locator(".tool-row").evaluateAll((rows) => rows.filter((row) => row.getBoundingClientRect().bottom <= window.innerHeight).length)).toBeGreaterThanOrEqual(7);
    await page.screenshot({ path: `node_modules/.cache/tools-library-${theme}-${width}.png` });
    await selectToolAction(page, "JSON 格式化", "管理");
    await page.getByLabel("缩进空格数", { exact: false }).fill("4");
    await page.getByRole("combobox", { name: "排序方式" }).click();
    await page.getByRole("option", { name: "按名称排序" }).click();
    await page.getByRole("switch", { name: "处理后自动复制" }).check();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("设置已保存");
    await page.getByRole("button", { name: "← 返回工具中心" }).click();
    await selectToolAction(page, "JSON 格式化", "管理");
    await expect(page.getByRole("combobox", { name: "排序方式" })).toHaveText("按名称排序");
    await expect(page.getByRole("switch")).toBeChecked();
    await page.screenshot({ path: `node_modules/.cache/tools-management-${theme}-${width}.png` });
    await page.getByRole("button", { name: /卸载插件/ }).click();
    await page.getByRole("button", { name: "卸载", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "← 返回工具中心" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "← 返回工具中心" }).click();
    await selectToolAction(page, "未声明设置的工具", "管理");
    await expect(page.getByText("此插件暂未提供自定义设置")).toBeVisible();
    await page.getByRole("button", { name: "← 返回工具中心" }).click();
    // 开发指导现在是独立的 Electron 窗口：面板里只保证入口在、能点、不报错。
    const guide = page.getByRole("button", { name: "开发指导 ↗", exact: true });
    await expect(guide).toBeVisible();
    await guide.click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.screenshot({ path: `node_modules/.cache/tools-guide-entry-${theme}-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

// 管理页里那条长长的来源目录曾经把内容撑宽，overflow-y:auto 又让 overflow-x
// 变成 auto，于是整页底部多出一条横向滚动条。documentElement 的 scrollWidth
// 断言抓不到内部滚动容器，所以单独量 .management-scroll。
test("long source dir never causes a horizontal scrollbar in management", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 850 });
  await page.goto("/tests/visual/toolsFixture.html");
  await selectToolAction(page, "JSON 格式化", "管理");
  await page.getByRole("button", { name: /源码与开发/ }).click();
  await expect(page.locator(".mg-source-dir .tool-path code")).toHaveAttribute("data-hint", /json-formatter/);
  expect(await page.locator(".management-scroll").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "node_modules/.cache/tools-management-source-360.png" });
});

test("exports a downloadable source ZIP with editable HTML and build script", async ({ page }) => {
  await page.goto("/tests/visual/toolsFixture.html?web");
  const downloading = page.waitForEvent("download");
  await selectToolAction(page, "JSON 格式化", "导出源码");
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("json-formatter-1.0.0-source.zip");
  const tool = importToolProject(new Uint8Array(await readFile(await download.path())));
  expect(tool.id).toBe("json-formatter");
  // 源码包不再带 Node 构建脚本，也不该再叫人「拖回」（拖拽导入没实现过）。
  expect(tool.sourceFiles?.["scripts/build.mjs"]).toBeUndefined();
  expect(tool.sourceFiles?.["README.md"]).toContain("导入工具");
  expect(tool.sourceFiles?.["README.md"]).not.toContain("拖");
  expect(tool.html).toContain("aawActions");
  await expect(page.getByRole("status")).toContainText("已导出");
});

for (const width of [360, 740]) {
  test(`unsaved settings warning stays visible after source action at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 650 });
    await page.goto(`/tests/visual/toolsFixture.html${width === 360 ? "?warm" : ""}`);
    await selectToolAction(page, "JSON 格式化", "管理");
    await page.getByLabel(/缩进空格数/).fill("4");
    await page.getByRole("button", { name: /返回工具中心/ }).click();
    await expect(page.getByRole("alert")).toBeInViewport();
    await expect(page.getByRole("button", { name: "继续编辑" })).toBeFocused();
    await page.screenshot({ path: `node_modules/.cache/tools-unsaved-${width}.png` });
    await page.getByRole("button", { name: "继续编辑" }).click();
    await expect(page.getByLabel(/缩进空格数/)).toHaveValue("4");
    await page.getByRole("button", { name: /返回工具中心/ }).click();
    await page.getByRole("button", { name: "放弃修改并返回" }).click();
    await expect(page.getByRole("list", { name: "已安装工具" })).toBeVisible();
  });
}

// 第一次打开、一个工具都没有时，这一屏是唯一一次讲清"工具能干嘛"的机会。
// 顺手留一张真实渲染截图，窄栏与宽栏都不能出现横向滚动。
for (const width of [360, 1100]) {
  test(`empty library guides the first tool at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/tests/visual/toolsFixture.html?empty");
    await expect(page.getByText("从你的想法开始，做一个自己的工具")).toBeVisible();
    await expect(page.getByRole("button", { name: /开始做工具/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "导入工具…", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "载入示例工具", exact: true })).toBeVisible();
    // 主 CTA 明显大于两个备选，且两个备选等高：之前三种按钮各有一套内边距。
    const boxes = await page.evaluate(() => {
      const primary = document.querySelector<HTMLElement>(".tools-empty-primary")!.getBoundingClientRect();
      const alts = [...document.querySelectorAll<HTMLElement>(".tools-empty-alt")].map((el) => el.getBoundingClientRect());
      return { primary: primary.height, alts: alts.map((box) => box.height) };
    });
    expect(boxes.alts).toHaveLength(2);
    expect(boxes.primary).toBeGreaterThan(boxes.alts[0]!);
    expect(Math.abs(boxes.alts[0]! - boxes.alts[1]!)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `node_modules/.cache/tools-empty-${width}.png` });
  });
}

test("loading example tools fills the library", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.goto("/tests/visual/toolsFixture.html?empty");
  await page.getByRole("button", { name: "载入示例工具", exact: true }).click();
  const rows = page.getByRole("list", { name: "已安装工具" });
  await expect(rows.getByText("JSON 格式化")).toBeVisible();
  await expect(rows.getByText("随手记")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "node_modules/.cache/tools-examples-1100.png" });
});

for (const width of [360, 740]) {
  test(`stalled project hands the work back to the user at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/tests/visual/toolsFixture.html?stalled");
    await page.getByRole("button", { name: /开发工具/ }).click();
    await expect(page.getByText("按这个路径自己改", { exact: true })).toBeVisible();
    const recheck = page.getByRole("button", { name: "我改完了，重新校验", exact: true });
    await expect(recheck).toBeInViewport();
    // 路径不再是按钮：完整值在 data-hint 里，窄栏省略但不丢信息。
    await expect(page.locator(".build-stalled .tool-path code")).toHaveAttribute("data-hint", "E:/AAW/tools/projects/u1/json-table");
    // 窄面板下"说明 + 两个按钮"不能撑出横向滚动条。
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `node_modules/.cache/tools-stalled-${width}.png` });
    // 列表行里的路径也是文本：滚到底确认它没被挤成半行。
    const rowPath = page.getByRole("list", { name: "工具项目" }).locator(".tool-path code").first();
    await rowPath.scrollIntoViewIfNeeded();
    await expect(rowPath).toBeInViewport();
    await page.screenshot({ path: `node_modules/.cache/tools-stalled-list-${width}.png` });
  });
}

for (const width of [360, 740]) {
  test(`one row per project, only the open one expands at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/tests/visual/toolsFixture.html?projects");
    await page.getByRole("button", { name: /开发工具/ }).click();

    const rows = page.getByRole("list", { name: "工具项目" }).getByRole("listitem");
    await expect(rows).toHaveCount(3);
    // 展开的内容只属于一行：源码路径出现一次；另外两行是收起的。
    await expect(page.getByText("源码位置")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "接口 JSON 转表格" })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: "Markdown 导出" })).toHaveAttribute("aria-expanded", "false");
    // 窄栏不能因为"多一个展开块"撑出横向滚动条。
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `node_modules/.cache/tools-projects-${width}.png` });
    // 再点一次标题就收起：这是僵尸卡片缺的那条出口。
    await page.getByRole("button", { name: "接口 JSON 转表格" }).click();
    await expect(page.getByText("源码位置")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "接口 JSON 转表格" })).toHaveAttribute("aria-expanded", "false");
  });
}
