import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, Tray, screen } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultRoot, getCatalog, describeTool } from "./catalog.mjs";
import { prepareRuntime, loadTool } from "./runtime.mjs";
import { runCli } from "./cli.mjs";

const args = process.argv.slice(1);
const cliMarker = args.indexOf("--aaw-cli");
const shortcut = process.env.AAW_TOOLS_SHORTCUT || "CommandOrControl+Alt+Space";
const launcherFile = join(import.meta.dirname, "launcher.html");
const launcherUrl = pathToFileURL(launcherFile).href;
let launcher;
let tray;
let shortcutReady = false;
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
  // 注册项拥有各自的打开方式。后续内置功能通过新来源接入相同列表。
  const providers = [() => {
    const { signedIn, tools } = getCatalog(root);
    return {
      signedIn,
      entries: tools.map((entry) => ({
        ...describeTool(entry.tool),
        id: `personal:${entry.tool.id}`,
        recent: entry.lastOpened,
        open: async () => {
          await loadTool(isolated, entry.tool, true);
          entry.touch();
        },
      })),
    };
  }];
  const readEntries = () => {
    const catalogs = providers.map((provide) => provide());
    return {
      signedIn: catalogs.some((catalog) => catalog.signedIn),
      entries: catalogs.flatMap((catalog) => catalog.entries).sort((a, b) => b.recent - a.recent),
    };
  };

  async function open(id) {
    const entry = readEntries().entries.find((item) => item.id === id);
    if (!entry) throw new Error("工具已卸载，或当前账号无法使用该工具。");
    await entry.open();
    launcher?.hide();
  }

  function showLauncher() {
    if (launcher?.isVisible()) {
      launcher.hide();
      return;
    }
    if (!launcher) {
      launcher = new BrowserWindow({
        show: false, width: 570, height: 490, resizable: false,
        frame: false, alwaysOnTop: true, skipTaskbar: true,
        roundedCorners: true, backgroundColor: "#141a25",
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
      void launcher.loadFile(launcherFile).catch((error) => dialog.showErrorBox("AAW 工具", error.message));
      return;
    }
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const [width, height] = launcher.getSize();
    launcher.setPosition(
      Math.round(workArea.x + Math.max(0, (workArea.width - width) / 2)),
      Math.round(workArea.y + Math.max(0, (workArea.height - height) / 3)),
    );
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
    const { entries, signedIn } = readEntries();
    return { entries: entries.map(({ id, name, version, actions, recent }) => ({ id, name, version, actions, recent })), signedIn, shortcut, shortcutReady };
  });
  ipcMain.handle("tools:open", async (event, id) => {
    verifySender(event);
    if (typeof id !== "string" || id.length > 100) throw new Error("无效的启动项。");
    await open(id);
  });
  ipcMain.on("tools:hide", (event) => {
    if (event.sender === launcher?.webContents && event.senderFrame?.url === launcherUrl) launcher.hide();
  });

  try { shortcutReady = globalShortcut.register(shortcut, showLauncher); }
  catch { shortcutReady = false; }
  tray = new Tray(join(import.meta.dirname, "icon.png"));
  tray.setToolTip(shortcutReady ? `AAW 工具 · ${shortcut}` : "AAW 工具 · 快捷键不可用");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开工具小窗", click: showLauncher },
    { type: "separator" },
    { label: "退出工具宿主", click: () => app.quit() },
  ]));
  tray.on("click", showLauncher);

  return (intent) => {
    watchDesktop(intent?.parent);
    if (intent?.openTool) {
      void open(`personal:${intent.openTool}`).catch((error) => dialog.showErrorBox("无法打开 AAW 工具", error.message));
    } else if (!intent?.background && !launcher?.isVisible()) showLauncher();
  };
}

app.setName("AAW 工具");
if (process.env.AAW_TOOLS_HOST_PROFILE)
  app.setPath("userData", process.env.AAW_TOOLS_HOST_PROFILE);

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
