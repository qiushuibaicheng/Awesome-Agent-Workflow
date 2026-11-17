import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 启动器小窗是纯静态 HTML + 普通 `<script>`，没有构建期检查，也没有组件测试
 * 能覆盖到它。这里用 jsdom 把真实页面跑起来，锁住三件用户会直接踩到的事：
 * 图标能区分、键盘选中态有标记、设置页不会被"隐藏再唤起"吞掉。
 */
// jsdom 下 import.meta.url 不是 file://，按工作目录定位（vitest 从 desktop 根跑）。
const read = (name: string) => readFileSync(join(process.cwd(), "tools-runtime", name), "utf8");

type Entry = {
  id: string; name: string; description?: string; keywords?: string[]; icon?: string;
  glyph?: string; tone?: number; source?: string; recent?: number; pinned?: boolean; pinOrder?: number;
};

const entries: Entry[] = [
  { id: "personal:json-format", name: "JSON 格式化", keywords: ["json"], glyph: "J", tone: 0, source: "personal", icon: "tool", recent: 3, pinned: true, pinOrder: 0 },
  { id: "personal:regex-lab", name: "正则试验台", keywords: ["regex"], glyph: "正", tone: 1, source: "personal", icon: "tool", recent: 2, pinned: false, pinOrder: -1 },
  { id: "builtin:tools", name: "工具中心", keywords: ["工具"], icon: "library", source: "builtin", recent: 0, pinned: true, pinOrder: 1 },
];

function boot() {
  const html = read("launcher.html");
  document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>")).replace(/<script[\s\S]*?<\/script>/g, "");
  let wake = () => {};
  let resolveOpen = () => {};
  const launcher = {
    entries: vi.fn(() => Promise.resolve({ entries, signedIn: true, shortcut: "Alt+Space", shortcutReady: true })),
    // 默认永不 resolve：用来观察"打开中"的中间态。
    open: vi.fn(() => new Promise<void>((resolve) => { resolveOpen = resolve; })),
    hide: vi.fn(),
    pin: vi.fn(async () => {}),
    shortcut: vi.fn(() => Promise.resolve({ shortcut: "Alt+Space", shortcutReady: true })),
    onRefresh: (callback: () => void) => { wake = callback; },
  };
  (window as unknown as { launcher: typeof launcher }).launcher = launcher;
  // 启动器是普通 <script>，测试必须原样执行它（没有可 import 的模块形态）。
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- 执行被测静态脚本
  (new Function(read("launcher.js")) as () => void)();
  return { launcher, wake: () => wake(), finishOpen: () => resolveOpen() };
}

const items = () => [...document.querySelectorAll<HTMLElement>("#results .item")];

/** 首屏只按列数显示最近使用（jsdom 无布局，列数为 1），切到"全部功能"才铺满。 */
async function showAll() {
  await vi.waitFor(() => expect(items().length).toBeGreaterThan(0));
  document.getElementById("all")!.click();
  await vi.waitFor(() => expect(items()).toHaveLength(3));
}

it("renders a per-tool glyph and tone, and marks the keyboard cursor", async () => {
  boot();
  await vi.waitFor(() => expect(items().length).toBeGreaterThan(0));

  // 内置功能继续用矢量图标、没有字形（切到"全部功能"后固定区会隐藏，所以先查）。
  const builtin = document.querySelector<HTMLElement>('#pinned .item[data-id="builtin:tools"] .item-mark');
  expect(builtin).not.toBeNull();
  expect(builtin!.querySelector("svg")).not.toBeNull();
  expect(builtin!.querySelector(".item-glyph")).toBeNull();

  await showAll();

  const [first, second] = items();
  // 两个个人工具字形不同——之前所有工具共用同一个 `< >` 图标。
  expect(first!.querySelector(".item-glyph")?.textContent).toBe("J");
  expect(second!.querySelector(".item-glyph")?.textContent).toBe("正");
  expect(first!.querySelector<HTMLElement>(".item-mark")?.dataset.tone).toBe("0");
  expect(second!.querySelector<HTMLElement>(".item-mark")?.dataset.tone).toBe("1");

  // 键盘光标：默认落在第一个，焦点切换时跟着走。
  expect(first!.getAttribute("aria-current")).toBe("true");
  second!.focus();
  expect(second!.getAttribute("aria-current")).toBe("true");
  expect(first!.getAttribute("aria-current")).toBe("false");
});

it("keeps the settings page and the accelerator draft across a hide/show cycle", async () => {
  const { launcher, wake, finishOpen } = boot();
  finishOpen();
  await vi.waitFor(() => expect(launcher.entries).toHaveBeenCalled());

  document.getElementById("settings-open")!.click();
  const settings = document.getElementById("settings")!;
  const accelerator = document.getElementById("accelerator") as HTMLInputElement;
  expect(settings.hidden).toBe(false);

  accelerator.value = "Ctrl+Alt+K";
  accelerator.dispatchEvent(new Event("input"));

  // 失焦隐藏后再唤起 = refresh(reset = true)。设置页与草稿都必须还在。
  wake();
  await vi.waitFor(() => expect(launcher.entries).toHaveBeenCalledTimes(2));
  expect(settings.hidden).toBe(false);
  expect(accelerator.value).toBe("Ctrl+Alt+K");
});

it("captures the accelerator from real key presses and refuses one without a modifier", async () => {
  const { launcher } = boot();
  await vi.waitFor(() => expect(launcher.entries).toHaveBeenCalled());
  document.getElementById("settings-open")!.click();

  const accelerator = document.getElementById("accelerator") as HTMLInputElement;
  const press = (init: KeyboardEventInit) => accelerator.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));

  press({ key: "K", code: "KeyK", ctrlKey: true, altKey: true });
  expect(accelerator.value).toBe("Control+Alt+K");

  // 只有主键、没有修饰键：保留上一次的结果并当场说明原因，而不是等保存后报错。
  press({ key: "K", code: "KeyK" });
  expect(accelerator.value).toBe("Control+Alt+K");
  expect(document.getElementById("shortcut-hint")!.textContent).toContain("修饰键");

  press({ key: " ", code: "Space", ctrlKey: true });
  expect(accelerator.value).toBe("Control+Space");

  // 本地校验不过就不发 IPC。
  accelerator.value = "随便写的";
  document.getElementById("shortcut-form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(launcher.shortcut).not.toHaveBeenCalled();
});

it("shows an in-place busy state while a tool opens, and does not open twice", async () => {
  const { launcher, finishOpen } = boot();
  await showAll();

  const target = items()[1]!;
  target.click();
  await vi.waitFor(() => expect(target.dataset.busy).toBe("true"));
  expect(target.getAttribute("aria-busy")).toBe("true");

  // 忙碌期间的重复点击不会发出第二次 IPC。
  target.click();
  expect(launcher.open).toHaveBeenCalledTimes(1);

  finishOpen();
  await vi.waitFor(() => expect(target.dataset.busy).toBeUndefined());
  expect(target.getAttribute("aria-busy")).toBe("false");
});
