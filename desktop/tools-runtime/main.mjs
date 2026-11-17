import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, Notification, Tray, screen } from "electron";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultRoot, readAppearance } from "./catalog.mjs";
import { createLauncherCatalog, createLauncherStore, createShortcutController } from "./launcher-registry.mjs";
import { createDesktopBridge } from "./desktop-bridge.mjs";
import { prepareRuntime, loadTool, readToolWindow } from "./runtime.mjs";
import { createToolStorage } from "./tool-storage.mjs";
import { runCli } from "./cli.mjs";

const args = process.argv.slice(1);
const cliMarker = args.indexOf("--aaw-cli");
const launcherFile = join(import.meta.dirname, "launcher.html");

/** 系统通知：拿不到通知权限或平台不支持时静默跳过，不因为提示失败而影响启动。 */
function notify(title, body) {
  try {
    if (!Notification.isSupported()) return;
    new Notification({ title, body, silent: true }).show();
  } catch { /* 通知只是锦上添花 */ }
}
const launcherUrl = pathToFileURL(launcherFile).href;
let launcher;
let tray;
let parentTimer;

function request() {
  return {
    openTool: args.find((item) => item.startsWith("--aaw-open="))?.slice(11),
    background: args.includes("--aaw-background"),
    parent: Number(process.env.AAW_TOOLS_PARENT_PID),
    bridge: { port: Number(process.env.AAW_LAUNCHER_PORT), token: process.env.AAW_LAUNCHER_TOKEN },
  };
}

function writeResult(value, exitCode) {
  process.stdout.write(JSON.stringify(value) + "\n", () => app.exit(exitCode));
}

function watchDesktop(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return;
  clearInterval(parentTimer);
  parentTimer = setInterval(() => {
    try { process.kill(pid, 0); }
    catch { app.quit(); }
  }, 750);
  parentTimer.unref();
}

const fileReadLimit = 4 * 1024 * 1024;
const fileWriteLimit = 8 * 1024 * 1024;

/**
 * 工具窗口的 IPC 面：存储与文件。
 *
 * 两个都只在"调用方确实是工具窗口"时放行——`readToolWindow` 依赖 loadTool 时
 * 登记的 webContents.id，别的地方伪造不出来。这是"能力可见"的前提：能力只对
 * 工具开放，不对随便是谁开放。
 */
function installToolIpc(root) {
  const storage = createToolStorage(root);
  const context = (event) => {
    const found = readToolWindow(event.sender);
    if (!found) throw new Error("调用来源不是工具窗口。");
    return found;
  };
  const parentOf = (event) => BrowserWindow.fromWebContents(event.sender) ?? undefined;

  ipcMain.handle("tool:store:get", (event, key) => storage.get(context(event).toolId, key));
  ipcMain.handle("tool:store:set", (event, key, value) => storage.set(context(event).toolId, key, value));
  ipcMain.handle("tool:store:delete", (event, key) => storage.delete(context(event).toolId, key));
  ipcMain.handle("tool:store:keys", (event) => storage.keys(context(event).toolId));

  ipcMain.handle("tool:files:open", async (event, options) => {
    context(event);
    const accept = Array.isArray(options?.accept) ? options.accept : [];
    const extensions = accept
      .filter((item) => typeof item === "string" && /^\.[\w.-]{1,12}$/.test(item))
      .slice(0, 8)
      .map((item) => item.slice(1));
    const dialogOptions = {
      properties: ["openFile"],
      ...(extensions.length ? { filters: [{ name: "文件", extensions }] } : {}),
    };
    const win = parentOf(event);
    const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    const path = result.filePaths?.[0];
    if (result.canceled || !path) return null;
    if (statSync(path).size > fileReadLimit) throw new Error("文件超过 4 MB：工具只能读取文本文件。");
    return { name: basename(path), text: readFileSync(path, "utf8") };
  });

  ipcMain.handle("tool:files:save", async (event, name, text) => {
    context(event);
    if (typeof name !== "string" || !name.trim() || name.length > 200) throw new Error("文件名无效。");
    if (typeof text !== "string") throw new Error("要保存的内容必须是文本。");
    if (Buffer.byteLength(text) > fileWriteLimit) throw new Error("内容超过 8 MB，无法保存。");
    const win = parentOf(event);
    const dialogOptions = { defaultPath: name };
    const result = win ? await dialog.showSaveDialog(win, dialogOptions) : await dialog.showSaveDialog(dialogOptions);
    if (result.canceled || !result.filePath) return false;
    writeFileSync(result.filePath, text, "utf8");
    return true;
  });
}

function installLauncher(root, isolated) {
  installToolIpc(root);
  const store = createLauncherStore(root);
  // 窗口底色跟着主窗主题走：深色默认值，warm（浅色）用原浅底，避免出现瞬间闪白。
  const launcherBackground = () => readAppearance(root).theme === "warm" ? "#f7f8fa" : "#16181f";
  const catalog = createLauncherCatalog(root, store, {
    openTool: (tool, settings) => loadTool(isolated, tool, true, settings), openDesktop: createDesktopBridge(),
  });
  const shortcuts = createShortcutController(globalShortcut, store, () => showLauncher(true));

  async function open(id) {
    await catalog.open(id);
    launcher?.hide();
  }

  function showLauncher(toggle = false) {
    if (toggle && launcher?.isVisible()) {
      launcher.hide();
      return;
    }
    if (!launcher) {
      launcher = new BrowserWindow({
        show: false, width: 800, height: 360, resizable: false,
        frame: false, alwaysOnTop: true, skipTaskbar: true,
        roundedCorners: true, backgroundColor: launcherBackground(),
        webPreferences: {
          preload: join(import.meta.dirname, "preload.cjs"),
          sandbox: true, nodeIntegration: false, contextIsolation: true,
        },
      });
      launcher.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      launcher.webContents.on("will-navigate", (event) => event.preventDefault());
      launcher.on("blur", () => launcher?.hide());
      launcher.on("closed", () => { launcher = undefined; });
      launcher.once("ready-to-show", () => showLauncher());
      void launcher.loadFile(launcherFile).catch((error) => dialog.showErrorBox("AAW 启动器", error.message));
      return;
    }
    // 主题可能在两次唤起之间被改过，这里再同步一次底色，避免切换瞬间闪出另一套底色。
    launcher.setBackgroundColor(launcherBackground());
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const width = Math.min(800, workArea.width - 24);
    const height = Math.min(360, workArea.height - 24);
    // Windows locks non-resizable bounds; briefly release them for display/DPI changes.
    launcher.setResizable(true);
    launcher.setBounds({ width, height,
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + (workArea.height - height) / 3),
    });
    launcher.setResizable(false);
    launcher.show();
    launcher.focus();
    launcher.webContents.send("tools:refresh");
  }

  function verifySender(event) {
    if (event.sender !== launcher?.webContents || event.senderFrame?.url !== launcherUrl)
      throw new Error("调用来源无效。");
  }

  ipcMain.handle("tools:list", (event) => {
    verifySender(event);
    const { entries, signedIn } = catalog.read();
    return { entries: entries.map((entry) => {
      const { id, name, description, keywords, source, scope, icon, glyph, tone, recent, pinned, pinOrder } = entry;
      return { id, name, description, keywords, source, scope, icon, glyph, tone, recent, pinned, pinOrder };
    }), signedIn, ...shortcuts.state };
  });
  ipcMain.handle("tools:open", async (event, id) => {
    verifySender(event);
    if (typeof id !== "string" || id.length > 100) throw new Error("无效的启动项。");
    await open(id);
  });
  ipcMain.on("tools:hide", (event) => {
    if (event.sender === launcher?.webContents && event.senderFrame?.url === launcherUrl) launcher.hide();
  });

  ipcMain.handle("launcher:pin", (event, id, pinned) => {
    verifySender(event);
    catalog.pin(id, pinned);
  });
  ipcMain.handle("launcher:theme", (event) => {
    verifySender(event);
    return readAppearance(root).theme;
  });
  ipcMain.handle("launcher:shortcut", (event, value) => {
    verifySender(event);
    shortcuts.change(value);
    updateTray();
    return shortcuts.state;
  });

  const shortcutStart = shortcuts.start();
  tray = new Tray(join(import.meta.dirname, "icon.png"));
  function updateTray() {
    tray.setToolTip(shortcuts.state.shortcutReady ? `AAW 启动器 · ${shortcuts.state.shortcut}` : "AAW 启动器 · 请设置快捷键");
  }
  updateTray();
  /**
   * 快捷键拿不到时必须主动说一声。
   *
   * 以前只有小窗底部一行字和托盘 tooltip——用户按 Alt+Space 没反应，只会
   * 以为"工具没启动"，然后反复点图标。改用系统通知，说清原因和当前可用
   * 的替代方式。
   */
  if (!shortcutStart.ok) {
    notify(
      "快捷键被占用",
      `${shortcutStart.occupied ?? "Alt+Space"} 已被其他程序占用，备用组合也都没注册上。点击托盘图标仍可打开启动器，或在小窗设置里换一组按键。`,
    );
  } else if (shortcutStart.fallbackFrom) {
    notify(
      "快捷键已自动换一组",
      `${shortcutStart.fallbackFrom} 被占用，已改用 ${shortcuts.state.shortcut}。可在小窗设置里再调。`,
    );
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开 AAW 启动器", click: () => showLauncher() },
    { type: "separator" },
    { label: "退出工具宿主", click: () => app.quit() },
  ]));
  tray.on("click", () => showLauncher());

  return (intent) => {
    // A rapid desktop restart may reuse the tray process before its parent watcher fires.
    if (Number.isInteger(intent?.bridge?.port) && intent.bridge.port > 0 && intent.bridge.port < 65536
      && typeof intent.bridge.token === "string" && /^[a-f0-9]{64}$/.test(intent.bridge.token)) {
      process.env.AAW_LAUNCHER_PORT = String(intent.bridge.port);
      process.env.AAW_LAUNCHER_TOKEN = intent.bridge.token;
    }
    watchDesktop(intent?.parent);
    if (intent?.openTool) {
      void open(`personal:${intent.openTool}`).catch((error) => dialog.showErrorBox("无法打开 AAW 工具", error.message));
    } else if (!intent?.background && !launcher?.isVisible()) showLauncher();
  };
}

app.setName("AAW 启动器");
if (process.env.AAW_TOOLS_HOST_PROFILE)
  app.setPath("userData", process.env.AAW_TOOLS_HOST_PROFILE);
else if (cliMarker >= 0) {
  const profile = mkdtempSync(join(app.getPath("temp"), "aaw-tools-cli-profile-"));
  app.setPath("userData", profile);
  app.once("quit", () => {
    try { rmSync(profile, { recursive: true, force: true }); }
    catch { /* Chromium may still hold transient cache files during shutdown. */ }
  });
}

if (cliMarker >= 0) {
  app.whenReady().then(async () => {
    // CLI 跑动作时也要能用 aawStore，否则"界面能存、命令行不能存"会变成隐蔽的坑。
    installToolIpc(defaultRoot());
    const result = await runCli(defaultRoot(), prepareRuntime(), args.slice(cliMarker + 1));
    writeResult({ ok: true, result }, 0);
  }).catch((error) => writeResult({ ok: false, error: error.message }, 1));
} else if (!app.requestSingleInstanceLock(request())) {
  app.quit();
} else {
  const ready = app.whenReady().then(() => installLauncher(defaultRoot(), prepareRuntime()));
  ready.then((handle) => handle(request())).catch((error) => {
    dialog.showErrorBox("AAW 工具宿主", error.message);
    app.quit();
  });
  app.on("second-instance", (_event, _command, _workingDir, intent) => {
    void ready.then((handle) => handle(intent), () => {});
  });
  app.on("window-all-closed", () => {});
  app.on("will-quit", () => {
    clearInterval(parentTimer);
    globalShortcut.unregisterAll();
    tray?.destroy();
  });
}
