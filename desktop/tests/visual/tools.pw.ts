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

for (const width of [360, 740]) {
  test(`stalled project hands the work back to the user at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/tests/visual/toolsFixture.html?stalled");
    await page.getByRole("button", { name: /开发工具/ }).click();
    await expect(page.getByText("打开目录自己改", { exact: true })).toBeVisible();
    const openDir = page.getByRole("button", { name: "打开项目目录", exact: true });
    const recheck = page.getByRole("button", { name: "我改完了，重新校验", exact: true });
    await expect(openDir).toBeInViewport();
    await expect(recheck).toBeInViewport();
    // 窄面板下"说明 + 两个按钮"不能撑出横向滚动条。
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `node_modules/.cache/tools-stalled-${width}.png` });
    // 列表行里的路径也是入口：滚到底确认它没被挤成半行。
    const rowPath = page.getByRole("list", { name: "工具项目" }).getByRole("button", { name: "打开项目目录：E:/AAW/tools/projects/u1/json-table" });
    await rowPath.scrollIntoViewIfNeeded();
    await expect(rowPath).toBeInViewport();
    await page.screenshot({ path: `node_modules/.cache/tools-stalled-list-${width}.png` });
  });
}
