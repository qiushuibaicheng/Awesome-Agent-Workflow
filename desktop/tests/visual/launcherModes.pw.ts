import { expect, test, type Page } from "@playwright/test";

type Side = "left" | "right" | "top" | "bottom";

async function openLauncher(
  page: Page,
  surface: "center" | "edge",
  side: Side = "right",
) {
  await page.setViewportSize(
    surface === "center"
      ? { width: 800, height: 360 }
      : side === "top" || side === "bottom"
        ? { width: 572, height: 106 }
        : { width: 106, height: 572 },
  );
  await page.addInitScript(
    ({ initialSurface, initialSide }) => {
      let edge = {
        enabled: initialSurface === "edge",
        delayMs: 350,
        side: initialSide,
        offsetPercent: 50,
      };
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {
          invoke(command: string, args?: { id?: string; edge?: typeof edge }) {
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
            if (command === "launcher_show") {
              document.documentElement.dataset.showCenter = "true";
              return Promise.resolve();
            }
            return Promise.reject(new Error(`意外的宿主调用 ${command}`));
          },
        },
      });
    },
    { initialSurface: surface, initialSide: side },
  );
  await page.goto("/launcher/index.html");
  await expect(page.locator("html")).toHaveAttribute("data-surface", surface);
}

test("居中小窗支持键盘打开，在设置里可拖到下边并保存沿边位置", async ({
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
  await page.getByRole("radio", { name: /贴边工具栏/ }).check();
  const handle = page.locator("#dock-handle");
  const preview = page.locator("#dock-preview");
  const handleBounds = await handle.boundingBox();
  const previewBounds = await preview.boundingBox();
  expect(handleBounds).not.toBeNull();
  expect(previewBounds).not.toBeNull();
  const { x, y, width, height } = previewBounds!;
  await page.mouse.move(handleBounds!.x + 6, handleBounds!.y + 8);
  await page.mouse.down();
  await page.mouse.move(x + width * 0.7, y + height - 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByLabel("贴边方向")).toHaveValue("bottom");
  const offset = Number(await page.getByLabel("沿边位置").inputValue());
  expect(offset).toBeGreaterThanOrEqual(68);
  expect(offset).toBeLessThanOrEqual(72);
  await delay.selectOption("500");
  await page.getByRole("button", { name: "应用启动方式" }).click();
  await expect(page.getByText("启动方式已更新。")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-edge-saved",
    JSON.stringify({
      enabled: true,
      delayMs: 500,
      side: "bottom",
      offsetPercent: offset,
    }),
  );
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
