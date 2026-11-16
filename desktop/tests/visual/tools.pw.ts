import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { importToolProject } from "../../src/plugins/tools/runtime/projectArchive.ts";

for (const width of [360, 740, 1100]) for (const theme of ["dark", "warm"]) {
  test(`plugin library and management fit ${width}px in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(`/tests/visual/toolsFixture.html${theme === "warm" ? "?warm" : ""}`);
    await page.evaluate(() => document.documentElement.style.setProperty("--ui-font-size", "20px"));
    await expect(page.getByRole("button", { name: "管理 JSON 格式化" })).toBeVisible();
    await expect(page.locator(".tool-card p").first()).toHaveCSS("font-size", "12px");
    await page.screenshot({ path: `node_modules/.cache/tools-library-${theme}-${width}.png` });
    await page.getByRole("button", { name: "管理 JSON 格式化" }).click();
    await page.getByLabel("缩进空格数", { exact: false }).fill("4");
    await page.getByRole("combobox", { name: "排序方式" }).click();
    await page.getByRole("option", { name: "按名称排序" }).click();
    await page.getByRole("switch", { name: "处理后自动复制" }).check();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("设置已保存");
    await page.getByRole("button", { name: "← 返回工具中心" }).click();
    await page.getByRole("button", { name: "管理 JSON 格式化" }).click();
    await expect(page.getByRole("combobox", { name: "排序方式" })).toHaveText("按名称排序");
    await expect(page.getByRole("switch")).toBeChecked();
    await page.screenshot({ path: `node_modules/.cache/tools-management-${theme}-${width}.png` });
    await page.getByRole("button", { name: "卸载", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "← 返回工具中心" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "← 返回工具中心" }).click();
    await page.getByRole("button", { name: "管理 未声明设置的工具" }).click();
    await expect(page.getByText("此插件暂未提供自定义设置")).toBeVisible();
    await page.getByRole("button", { name: "← 返回工具中心" }).click();
    await page.getByRole("button", { name: "开发模式", exact: true }).click();
    await page.getByRole("button", { name: "载入 JSON 格式化示例" }).click();
    const preview = page.getByRole("button", { name: "运行预览", exact: true });
    await expect(preview).toHaveCSS("font-size", "12px");
    await expect(page.getByLabel("工具包源码")).toHaveCSS("font-size", "12px");
    expect((await preview.boundingBox())!.height).toBeGreaterThanOrEqual(32);
    await page.screenshot({ path: `node_modules/.cache/tools-development-${theme}-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("exports a downloadable source ZIP with editable HTML and build script", async ({ page }) => {
  await page.goto("/tests/visual/toolsFixture.html?web");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出", exact: true }).first().click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("json-formatter-1.0.0-source.zip");
  const tool = importToolProject(new Uint8Array(await readFile(await download.path())));
  expect(tool.id).toBe("json-formatter");
  expect(tool.sourceFiles?.["scripts/build.mjs"]).toContain("writeFileSync");
  expect(tool.html).toContain("aawActions");
  await expect(page.getByRole("status")).toContainText("已导出");
});

for (const width of [360, 740]) {
  test(`unsaved settings warning stays visible after source action at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 650 });
    await page.goto(`/tests/visual/toolsFixture.html${width === 360 ? "?warm" : ""}`);
    await page.getByRole("button", { name: "管理 JSON 格式化" }).click();
    await page.getByLabel(/缩进空格数/).fill("4");
    await page.getByRole("button", { name: "编辑工具包", exact: true }).click();
    await expect(page.getByRole("alert")).toBeInViewport();
    await expect(page.getByRole("button", { name: "继续编辑" })).toBeFocused();
    await page.screenshot({ path: `node_modules/.cache/tools-unsaved-${width}.png` });
    await page.getByRole("button", { name: "继续编辑" }).click();
    await expect(page.getByLabel(/缩进空格数/)).toHaveValue("4");
    await page.getByRole("button", { name: "编辑工具包", exact: true }).click();
    await page.getByRole("button", { name: "放弃修改并继续" }).click();
    await expect(page.getByLabel("工具包源码")).toBeVisible();
  });
}
