/* eslint-disable @typescript-eslint/no-require-imports -- 这个脚本直接用 node 跑，不经 ESM 构建 */
/* global document -- waitForFunction 的回调在页面里执行 */
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

  // 打开设置页：这一刻主进程应当让出全局热键，同时把 Alt+Space 临时占住。
  await win.click("#shortcut");
  const accelerator = win.locator("#accelerator");
  await accelerator.click();

  // Alt+Space 只要能注册上，Windows 就不会把它当窗口菜单键——那个"关闭窗口"
  // 的系统菜单只有键没被热键占住时才会弹。这条是能自动断言的等价事实。
  const held = await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Alt+Space"));
  console.log(`Alt+Space held while recording: ${held}`);
  if (!held) console.log("WARN 录制期间没占住 Alt+Space，按下去会弹系统菜单");

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

  // Ctrl+A 单独验一遍：这组键能注册成功（代价是抢走所有应用的全选），
  // 用户报的"设了却唤不起来"要么是注册失败、要么是保存失败但界面没退回。
  await accelerator.press("Control+A");
  const ctrlAHint = (await win.textContent("#shortcut-hint")) ?? "";
  console.log(`Ctrl+A hint mentions 全选: ${ctrlAHint.includes("全选")}`);
  await win.click("#shortcut-form button.primary");
  await win.waitForFunction(() => (document.getElementById("message")?.textContent ?? "").includes("已保存"), undefined, { timeout: 5000 });
  await win.click("#settings-close");
  const ctrlARegistered = await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Control+A"));
  console.log(`Ctrl+A registered after save: ${ctrlARegistered}`);

  const passed = result.value === "Alt+Space"
    && result.visible[0] === true
    && held === true
    && !result.hint.includes("不能作为主键")
    && ctrlAHint.includes("全选")
    && ctrlARegistered === true;
  console.log(passed ? "PASS" : "FAIL");
  await app.close();
  process.exitCode = passed ? 0 : 1;
})().catch((error) => {
  console.error("FAILED", error);
  process.exitCode = 1;
});
