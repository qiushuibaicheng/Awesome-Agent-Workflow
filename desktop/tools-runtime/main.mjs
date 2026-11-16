import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, Tray, screen } from "electron";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultRoot } from "./catalog.mjs";
import { createLauncherCatalog, createLauncherStore, createShortcutController } from "./launcher-registry.mjs";
import { createDesktopBridge } from "./desktop-bridge.mjs";
import { prepareRuntime, loadTool } from "./runtime.mjs";
import { runCli } from "./cli.mjs";

const args = process.argv.slice(1);
const cliMarker = args.indexOf("--aaw-cli");
const launcherFile = join(import.meta.dirname, "launcher.html");
const launcherUrl = pathToFileURL(launcherFile).href;
let launcher;
let tray;
let parentTimer;

function request() {
  return {
    openTool: args.find((item) => item.startsWith("--aaw-open="))?.slice(11),
    background: args.includes("--aaw-background"),
    parent: Number(process.env.AAW_TOOLS_PARENT_PID),
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

function installLauncher(root, isolated) {
  const store = createLauncherStore(root);
  const catalog = createLauncherCatalog(root, store, {
    openTool: (tool) => loadTool(isolated, tool, true), openDesktop: createDesktopBridge(),
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
        show: false, width: 860, height: 410, resizable: false,
        frame: false, alwaysOnTop: true, skipTaskbar: true,
        roundedCorners: true, backgroundColor: "#f7f8fa",
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
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const width = Math.min(860, workArea.width - 24);
    const height = Math.min(410, workArea.height - 24);
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
      const { id, name, description, keywords, source, scope, icon, recent, pinned, pinOrder } = entry;
      return { id, name, description, keywords, source, scope, icon, recent, pinned, pinOrder };
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
  ipcMain.handle("launcher:shortcut", (event, value) => {
    verifySender(event);
    shortcuts.change(value);
    updateTray();
    return shortcuts.state;
  });

  shortcuts.start();
  tray = new Tray(join(import.meta.dirname, "icon.png"));
  function updateTray() {
    tray.setToolTip(shortcuts.state.shortcutReady ? `AAW 启动器 · ${shortcuts.state.shortcut}` : "AAW 启动器 · 请设置快捷键");
  }
  updateTray();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开 AAW 启动器", click: () => showLauncher() },
    { type: "separator" },
    { label: "退出工具宿主", click: () => app.quit() },
  ]));
  tray.on("click", () => showLauncher());

  return (intent) => {
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
