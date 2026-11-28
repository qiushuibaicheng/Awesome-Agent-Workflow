import { expect, test, type Page } from "@playwright/test";

async function openLauncher(page: Page, surface: "center" | "edge") {
  await page.setViewportSize(
    surface === "center"
      ? { width: 800, height: 360 }
      : { width: 344, height: 548 },
  );
  await page.addInitScript((initialSurface) => {
    let edge = { enabled: initialSurface === "edge", delayMs: 350 };
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke(
          command: string,
          args?: { id?: string; edge?: { enabled: boolean; delayMs: number } },
        ) {
          if (command === "launcher_entries") {
            return Promise.resolve({
              entries: [
                {
                  id: "personal:json",
                  name: "JSON 格式化",
                  description: "个人工具",
                  keywords: ["JSON"],
                  pinned: true,
                  pinOrder: 0,
                  recent: 0,
                  icon: "tool",
                },
                {
                  id: "builtin:aaw",
                  name: "AAW 工作流",
                  description: "打开工作流",
                  keywords: ["workflow"],
                  pinned: true,
                  pinOrder: 1,
                  recent: 0,
                  icon: "workflow",
                },
              ],
              surface: initialSurface,
              edge,
              edgeSupported: true,
              theme: "dark",
              shortcut: "Alt+Space",
              shortcutReady: true,
            });
          }
          if (command === "launcher_shortcut" && args?.edge) {
            edge = args.edge;
            document.documentElement.dataset.edgeSaved = JSON.stringify(edge);
            return Promise.resolve({ edge });
          }
          if (command === "launcher_open") {
            document.documentElement.dataset.lastEntry = args?.id;
            return Promise.resolve();
          }
          return Promise.reject(new Error(`意外的宿主调用 ${command}`));
        },
      },
    });
  }, surface);
  await page.goto("/launcher/index.html");
  await expect(page.locator("html")).toHaveAttribute("data-surface", surface);
}

test("居中小窗继续支持键盘打开，并能从设置启用右侧贴边", async ({ page }) => {
  await openLauncher(page, "center");
  const search = page.getByRole("textbox", { name: "搜索功能" });
  await expect(search).toBeFocused();
  await search.fill("JSON");
  await search.press("Enter");
  await expect(page.locator("html")).toHaveAttribute(
    "data-last-entry",
    "personal:json",
  );

  await page.getByRole("button", { name: "启动器设置" }).click();
  const delay = page.getByLabel("停留时间");
  await expect(delay).toBeDisabled();
  await page.getByRole("radio", { name: /右侧贴边/ }).check();
  await delay.selectOption("500");
  await page.getByRole("button", { name: "应用启动方式" }).click();
  await expect(page.getByText("启动方式已更新。")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-edge-saved",
    '{"enabled":true,"delayMs":500}',
  );
});

test("贴边栏展示固定列表，保持搜索框未聚焦并复用打开命令", async ({ page }) => {
  await openLauncher(page, "edge");
  const search = page.getByRole("textbox", { name: "搜索功能" });
  await expect(search).not.toBeFocused();
  const tool = page.getByRole("button", { name: "JSON 格式化", exact: true });
  const workflow = page.getByRole("button", {
    name: "AAW 工作流",
    exact: true,
  });
  const first = await tool.boundingBox();
  const second = await workflow.boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(second!.y).toBeGreaterThan(first!.y);
  expect(second!.x).toBe(first!.x);
  await workflow.click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-last-entry",
    "builtin:aaw",
  );
  await page.getByRole("button", { name: "启动器设置" }).click();
  const settings = page.getByRole("region", { name: "启动器设置" });
  await expect(
    settings.getByRole("button", { name: "应用启动方式" }),
  ).toBeVisible();
  expect(
    await settings.evaluate((section) => section.scrollWidth),
  ).toBeLessThanOrEqual(344);
});
