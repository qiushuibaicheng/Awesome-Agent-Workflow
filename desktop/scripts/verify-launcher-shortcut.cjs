/**
 * 真机验证：把全局唤起快捷键从别的组合键改回 Alt+Space。
 *
 * 为什么要单独一个脚本：启动器是纯静态页面 + Electron 主进程，单测只能覆盖
 * jsdom 里的 keydown 逻辑，覆盖不到"全局热键会不会把按键吞掉、窗口会不会被
 * 自己的快捷键关掉"。这里用 Playwright 驱动真实 Electron 宿主跑一遍。
 *
 *   npm run tools:verify-shortcut
 *
 * 注意：Playwright 派发的按键不经过 `before-input-event`，所以主进程那层兜底
 * （Windows 把 Alt+Space 当系统菜单键时接住再回送）在这里观测不到，只能靠
 * 人工按键确认。脚本会打印 main-process keydowns 便于判断走了哪条路径。
 */
const { _electron: electron } = require("playwright");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const desktop = path.resolve(__dirname, "..");
const profile = mkdtempSync(path.join(tmpdir(), "aaw-launcher-verify-"));

(async () => {
  const app = await electron.launch({
    executablePath: path.join(desktop, "tools-runtime/dist/electron.exe"),
    args: [path.join(desktop, "tools-runtime/dist/resources/app")],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      NODE_OPTIONS: undefined,
      CODEBUDDY_SAFE_DELETE_SANDBOX: undefined,
      AAW_TOOLS_HOST_PROFILE: profile,
      AAW_TOOLS_DATA_ROOT: profile,
    },
  });
  const win = await app.firstWindow();
  await win.waitForSelector("#shortcut", { state: "attached" });

  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.__captures = [];
    window.webContents.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown") window.__captures.push(`${input.alt ? "Alt+" : ""}${input.code}`);
    });
  });

  // 打开设置页：这一刻主进程应当让出全局热键。
  await win.click("#shortcut");
  const accelerator = win.locator("#accelerator");
  await accelerator.click();

  const step = async (label) => {
    const visible = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => window.isVisible()));
    const value = await accelerator.inputValue();
    const hint = (await win.textContent("#shortcut-hint")) ?? "";
    console.log(`${label}: value=${JSON.stringify(value)} visible=${JSON.stringify(visible)} hint=${JSON.stringify(hint.slice(0, 24))}`);
    return { visible, value, hint };
  };

  // 先把快捷键调成别的。
  await accelerator.press("Control+K");
  await step("after Ctrl+K");

  // 再按回 Alt+Space —— 修复前这里会红字报错并让窗口消失。
  await accelerator.press("Alt+Space");
  const result = await step("after Alt+Space");

  const captures = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].__captures);
  console.log("main-process keydowns:", JSON.stringify(captures));
  const passed = result.value === "Alt+Space"
    && result.visible[0] === true
    && !result.hint.includes("不能作为主键");
  console.log(passed ? "PASS" : "FAIL");
  await app.close();
  process.exitCode = passed ? 0 : 1;
})().catch((error) => {
  console.error("FAILED", error);
  process.exitCode = 1;
});
