import { expect, test, type Page } from "@playwright/test";

type Side = "left" | "right" | "top" | "bottom";

async function openLauncher(
  page: Page,
  surface: "center" | "edge",
  side: Side = "right",
  extra = 0,
  theme: "dark" | "warm" = "dark",
) {
  await page.setViewportSize(
    surface === "center"
      ? { width: 800, height: 360 }
      : side === "top" || side === "bottom"
        ? { width: 572, height: 106 }
        : { width: 106, height: 572 },
  );
  await page.addInitScript(
    ({ initialSurface, initialSide, extraEntries, theme }) => {
      let edge = {
        enabled: initialSurface === "edge",
        delayMs: 350,
        side: initialSide,
      };
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {
          invoke(
            command: string,
            args?: { id?: string; edge?: typeof edge; dockDrag?: boolean },
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
                  ...Array.from({ length: extraEntries }, (_, index) => ({
                    id: `personal:tool-${index}`,
                    name: `个人工具 ${index + 1}`,
                    keywords: [],
                    pinned: false,
                    recent: 0,
                    icon: "tool",
                  })),
                ],
                surface: initialSurface,
                edge,
                edgeSupported: true,
                theme,
                shortcut: "Alt+Space",
                shortcutReady: true,
              });
            }
            if (command === "launcher_shortcut" && args?.edge) {
              edge = args.edge;
              document.documentElement.dataset.edgeSaved = JSON.stringify(edge);
              return Promise.resolve({
                edge,
                shortcut: "Alt+Space",
                shortcutReady: !edge.enabled,
              });
            }
            if (command === "launcher_shortcut" && args?.dockDrag) {
              document.documentElement.dataset.startedDrag = "true";
              return Promise.resolve();
            }
            if (command === "launcher_open") {
              document.documentElement.dataset.lastEntry = args?.id;
              return Promise.resolve();
            }
            if (command === "launcher_show") {
              document.documentElement.dataset.showCenter = "true";
              return Promise.resolve();
            }
            return Promise.reject(new Error(`意外的宿主调用 ${command}`));
          },
        },
      });
    },
    { initialSurface: surface, initialSide: side, extraEntries: extra, theme },
  );
  await page.goto("/launcher/index.html");
  await expect(page.locator("html")).toHaveAttribute("data-surface", surface);
}

test("居中小窗保留键盘操作，切换到贴边模式后停用快捷键设置", async ({
  page,
}) => {
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
  await expect(delay).toBeHidden();
  await page.getByRole("radio", { name: /贴边工具栏/ }).check();
  await expect(page.getByLabel("全局唤起快捷键")).toBeHidden();
  await expect(delay).toBeVisible();
  await page.getByLabel("贴边方向").selectOption("bottom");
  await delay.selectOption("500");
  await page.getByRole("button", { name: "应用启动方式" }).click();
  await expect(page.getByText("启动方式已更新。")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-edge-saved",
    JSON.stringify({
      enabled: true,
      delayMs: 500,
      side: "bottom",
    }),
  );
  await expect(page.getByLabel("全局唤起快捷键")).toBeHidden();
  await page.getByRole("radio", { name: /快捷键小窗/ }).check();
  await page.getByRole("button", { name: "应用启动方式" }).click();
  await expect(page.getByLabel("全局唤起快捷键")).toBeVisible();
});

test("窄窗口浅色设置页保留键盘焦点和可操作的选项", async ({ page }) => {
  await openLauncher(page, "center", "right", 0, "warm");
  await page.setViewportSize({ width: 360, height: 360 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "warm");
  await page.getByRole("button", { name: "启动器设置" }).click();
  await expect(page.getByRole("button", { name: "返回" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio", { name: /快捷键小窗/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: /贴边工具栏/ })).toBeChecked();
  await expect(page.getByLabel("贴边方向")).toBeVisible();
  const settings = page.getByRole("region", { name: "启动器设置" });
  expect(
    await settings.evaluate((view) => view.scrollWidth - view.clientWidth),
  ).toBe(0);
  await page.getByRole("button", { name: "应用启动方式" }).click();
  await expect(page.getByText("启动方式已更新。")).toBeInViewport();
  await page.getByRole("button", { name: "返回" }).click();
  await expect(page.getByRole("textbox", { name: "搜索功能" })).toBeFocused();
});

for (const side of ["left", "right", "top", "bottom"] as const) {
  test(`贴边工具栏在 ${side} 排列图标，悬停放大并复用打开命令`, async ({
    page,
  }) => {
    await openLauncher(page, "edge", side);
    const search = page.getByRole("textbox", { name: "搜索功能" });
    await expect(search).toBeHidden();
    const dock = page.getByRole("region", { name: "贴边工具栏" });
    await expect(dock).toHaveAttribute("data-side", side);
    const tool = page.getByRole("button", { name: "JSON 格式化", exact: true });
    const workflow = page.getByRole("button", {
      name: "AAW 工作流",
      exact: true,
    });
    const first = await tool.boundingBox();
    const second = await workflow.boundingBox();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (side === "left" || side === "right") {
      expect(second!.y).toBeGreaterThan(first!.y);
      expect(second!.x).toBe(first!.x);
    } else {
      expect(second!.x).toBeGreaterThan(first!.x);
      expect(second!.y).toBe(first!.y);
    }
    await tool.hover();
    await expect(page.locator("#dock-caption")).toHaveText("JSON 格式化");
    const weight = (locator: typeof tool) =>
      locator.evaluate((button) =>
        Number(button.style.getPropertyValue("--dock-weight")),
      );
    expect(await weight(workflow)).toBeGreaterThan(0);
    expect(await weight(tool)).toBeGreaterThan(await weight(workflow));
    const scale = (locator: typeof tool) =>
      locator.locator(".item-mark").evaluate((icon) => {
        const transform = getComputedStyle(icon).transform;
        return transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a;
      });
    await expect.poll(() => scale(tool)).toBeGreaterThan(1.4);
    expect(await scale(workflow)).toBeGreaterThan(1);
    await page.mouse.move(1, 1);
    expect(await weight(tool)).toBe(0);
    await expect.poll(() => scale(tool)).toBe(1);
    await workflow.click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-last-entry",
      "builtin:aaw",
    );
    await page.getByRole("button", { name: "搜索全部功能" }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-show-center",
      "true",
    );
  });
}

for (const side of ["right", "bottom"] as const) {
  test(`在 ${side} 可用滚轮找到并打开远处的未固定工具`, async ({ page }) => {
    await openLauncher(page, "edge", side, 24);
    const items = page.getByRole("navigation", { name: "快捷工具" });
    await items.hover({ position: { x: 25, y: 25 } });
    const position = () =>
      items.evaluate(
        (list, vertical) => (vertical ? list.scrollTop : list.scrollLeft),
        side === "right",
      );
    expect(await position()).toBe(0);
    await page.mouse.wheel(0, 2000);
    await expect.poll(position).toBeGreaterThan(500);
    await page
      .getByRole("button", { name: "个人工具 24", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-last-entry",
      "personal:tool-23",
    );
  });
}

test("按住真实工具栏请求拖动，松手时避免误打开工具", async ({ page }) => {
  await openLauncher(page, "edge", "right");
  await page.getByRole("button", { name: "JSON 格式化" }).hover();
  await page.mouse.down();
  await expect(page.locator("html")).toHaveAttribute(
    "data-started-drag",
    "true",
  );
  await page.mouse.up();
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-last-entry",
    /.+/,
  );
});
