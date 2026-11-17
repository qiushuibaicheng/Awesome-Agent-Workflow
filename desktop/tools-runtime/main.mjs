import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, Notification, Tray, screen } from "electron";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
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
const guideFile = join(import.meta.dirname, "guide.html");

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
    guide: args.includes("--aaw-guide"),
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

  // 剪切板文本（uTools 类插件最常见的一件事）。只读写纯文本，不碰图片/HTML/富文本：
  // 那些格式会牵出编码与权限问题，而"复制结果 / 剪切板历史"只需要文本。
  ipcMain.handle("tool:clipboard:read", (event) => {
    context(event);
    return clipboard.readText();
  });
  ipcMain.handle("tool:clipboard:write", (event, text) => {
    context(event);
    if (typeof text !== "string") throw new Error("写入剪切板的内容必须是文本。");
    if (Buffer.byteLength(text) > 1024 * 1024) throw new Error("写入剪切板的文本不能超过 1 MB。");
    clipboard.writeText(text);
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
  /**
   * 工具开发指导：一个正经的文档窗口。
   *
   * 之前只有一个「安装规范」按钮——内容写进了 AI 技能目录，人却看不到。
   * 这份正文与写进 AGENTS.md / SKILL.md 的是同一段文字（构建期从同一份
   * 源码渲染），所以"人读的"和"AI 读的"不会互相矛盾。
   */
  let guideWindow;
  function openGuide() {
    if (guideWindow && !guideWindow.isDestroyed()) {
      if (guideWindow.isMinimized()) guideWindow.restore();
      guideWindow.focus();
      return;
    }
    const theme = readAppearance(root).theme;
    guideWindow = new BrowserWindow({
      show: false, width: 980, height: 720, minWidth: 720, minHeight: 460,
      title: "工具开发指导", autoHideMenuBar: true,
      icon: join(import.meta.dirname, "icon.png"),
      backgroundColor: theme === "warm" ? "#f7f8fa" : "#16181f",
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
    });
    guideWindow.on("closed", () => { guideWindow = undefined; });
    guideWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    // 页内锚点不算导航，这里拦的是把文档窗口导去别处。
    guideWindow.webContents.on("will-navigate", (event) => event.preventDefault());
    guideWindow.once("ready-to-show", () => guideWindow?.show());
    void guideWindow.loadFile(guideFile, { query: { theme } })
      .catch((error) => dialog.showErrorBox("工具开发指导", error.message));
  }
  const shortcuts = createShortcutController(globalShortcut, store, () => showLauncher(true));
  /**
   * "正在录快捷键"这一段必须把全局热键让出来：用户按下的第一下往往就是当前
   * 生效的那组，不让就会被自己的快捷键关掉窗口。
   *
   * 让位的范围由渲染进程按录制框的焦点决定（选中即让、失焦即还），不是整个
   * 设置页——设置页开着但光标不在录制框里时，用户仍应能按快捷键收回面板。
   * 恢复走窗口事件兜底（hide / 关闭），不能只依赖渲染进程发来的通知——
   * 它一旦没发出去，用户的全局热键就永久丢了。
   */
  let capturing = false;
  /**
   * 录制期间临时占住 Alt+Space。
   *
   * 不占的话，Windows 会把它当窗口菜单键，弹出左上角那个"还原/移动/大小/关闭"
   * 的系统菜单——既挡住视线，又把焦点抢走，用户永远录不进 Alt+Space。
   * 占住之后按键走热键通道，我们不 toggle，直接把组合键回送给页面。
   */
  const captureKey = "Alt+Space";
  let captureKeyHeld = false;
  function holdCaptureKey() {
    if (captureKeyHeld) return;
    captureKeyHeld = globalShortcut.register(captureKey, () => {
      if (capturing) launcher?.webContents.send("launcher:shortcut-pressed", captureKey);
    });
  }
  function dropCaptureKey() {
    if (!captureKeyHeld) return;
    globalShortcut.unregister(captureKey);
    captureKeyHeld = false;
  }
  function setCapture(active) {
    if (active === capturing) return;
    capturing = active;
    if (active) {
      shortcuts.pause();
      holdCaptureKey();
    } else {
      dropCaptureKey();
      shortcuts.resume();
    }
  }

  async function open(id) {
    await catalog.open(id);
    launcher?.hide();
  }

  /**
   * 启动器窗口在宿主就绪时就建好（保持隐藏），不是等第一次按快捷键才建。
   *
   * 第一次按 Alt+Space 之所以要等好几秒，就是这段冷启动：new BrowserWindow +
   * Chromium 渲染进程 + loadFile + 首帧。预热之后按键只剩 show() 和一次刷新，
   * 从"几秒"降到几十毫秒；页面加载时 tools:list 也顺带把目录读进缓存。
   */
  let launcherReady = false;
  let pendingShow = false;
  function ensureLauncher() {
    if (launcher) return launcher;
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
    // 失焦即收起；隐藏时 setCapture(false) 会把全局热键和临时占位一起收回来。
    launcher.on("blur", () => launcher?.hide());
    launcher.on("hide", () => setCapture(false));
    launcher.on("closed", () => { launcher = undefined; launcherReady = false; });
    launcher.once("ready-to-show", () => {
      launcherReady = true;
      if (pendingShow) { pendingShow = false; showLauncher(); }
    });
    void launcher.loadFile(launcherFile).catch((error) => dialog.showErrorBox("AAW 启动器", error.message));
    return launcher;
  }

  function showLauncher(toggle = false) {
    if (toggle && launcher?.isVisible()) {
      launcher.hide();
      return;
    }
    const win = ensureLauncher();
    // 预热还没完成时先记下这次按键，ready-to-show 立刻显示，别把输入吞掉。
    if (!launcherReady) { pendingShow = true; return; }
    // 主题可能在两次唤起之间被改过，这里再同步一次底色，避免切换瞬间闪出另一套底色。
    win.setBackgroundColor(launcherBackground());
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const width = Math.min(800, workArea.width - 24);
    const height = Math.min(360, workArea.height - 24);
    // Windows locks non-resizable bounds; briefly release them for display/DPI changes.
    win.setResizable(true);
    win.setBounds({ width, height,
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + (workArea.height - height) / 3),
    });
    win.setResizable(false);
    win.show();
    win.focus();
    win.webContents.send("tools:refresh");
  }

  function verifySender(event) {
    if (event.sender !== launcher?.webContents || event.senderFrame?.url !== launcherUrl)
      throw new Error("调用来源无效。");
  }

  ipcMain.handle("tools:list", (event) => {
    verifySender(event);
    // theme 跟着这次 read 一起回去：页面不必再为它单发一次 IPC（那会再读一遍
    // preferences.json，里面存着每个工具的完整 HTML）。
    const { entries, signedIn, theme } = catalog.read();
    return { entries: entries.map((entry) => {
      const { id, name, description, keywords, source, scope, icon, glyph, tone, recent, pinned, pinOrder } = entry;
      return { id, name, description, keywords, source, scope, icon, glyph, tone, recent, pinned, pinOrder };
    }), signedIn, theme, ...shortcuts.state };
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
    // 保存的一瞬要把临时占位让开，否则用户想把默认键存回去时会被自己挡住；
    // 存完仍在录制态，再占回来。
    dropCaptureKey();
    try {
      shortcuts.change(value);
    } finally {
      if (capturing) holdCaptureKey();
    }
    updateTray();
    return shortcuts.state;
  });
  ipcMain.handle("launcher:capture", (event, active) => {
    verifySender(event);
    setCapture(active === true);
    return capturing;
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

  /** 把"这次想做什么"抽成纯动作：命令行参数、单实例转发和常驻命令通道共用。 */
  function applyIntent(command) {
    if (command === "--aaw-guide") { openGuide(); return; }
    if (typeof command === "string" && command.startsWith("--aaw-open=")) {
      void open(`personal:${command.slice(11)}`).catch((error) => dialog.showErrorBox("无法打开 AAW 工具", error.message));
      return;
    }
    if (command === "--aaw-background") return;
    if (!launcher?.isVisible()) showLauncher();
  }

  /**
   * 常驻命令通道：宿主一就绪就主动连上主窗口的桥，并保持这条连接。
   *
   * 以前每次点「开发指导」或「打开工具」，Rust 侧都要 spawn 一个完整 Electron
   * 进程，只为让单实例锁把参数转发给已经在跑的宿主——1~2 秒就这么来的。现在
   * Rust 直接往这条连接写一行命令，省掉整个进程冷启动；连接断了也无所谓，
   * Rust 会退回原来的 spawn 转发，功能不会丢。
   */
  let commandChannelStarted = false;
  function connectCommandChannel(token) {
    if (commandChannelStarted) return;
    const port = Number(process.env.AAW_LAUNCHER_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !token) return;
    commandChannelStarted = true;
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setEncoding("utf8");
    socket.setKeepAlive(true);
    let buffer = "";
    socket.on("connect", () => socket.write(`${JSON.stringify({ token, kind: "host" })}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 65536) { buffer = ""; return; }
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        try {
          const message = JSON.parse(line);
          if (message.token === token) applyIntent(message.command);
        } catch { /* 坏行丢掉，不影响后面的命令 */ }
      }
    });
    socket.on("error", () => {});
    // 连接断了要重建：否则 Rust 侧会一直退回 spawn 转发（功能在，但会慢回去）。
    // 父进程退出时 watchDesktop 会让宿主一起退出，不会留下无限重连的孤儿。
    socket.on("close", () => {
      commandChannelStarted = false;
      setTimeout(() => connectCommandChannel(process.env.AAW_LAUNCHER_TOKEN), 1500).unref();
    });
  }

  return (intent) => {
    // A rapid desktop restart may reuse the tray process before its parent watcher fires.
    if (Number.isInteger(intent?.bridge?.port) && intent.bridge.port > 0 && intent.bridge.port < 65536
      && typeof intent.bridge.token === "string" && /^[a-f0-9]{64}$/.test(intent.bridge.token)) {
      process.env.AAW_LAUNCHER_PORT = String(intent.bridge.port);
      process.env.AAW_LAUNCHER_TOKEN = intent.bridge.token;
    }
    watchDesktop(intent?.parent);
    // 只有常驻后台宿主需要预热启动器窗口：它才是"用户按 Alt+Space 时已经
    // 就绪"的那一个。带 --aaw-guide / --aaw-open 直接启动的实例不需要这个小窗，
    // 提前建反而会抢焦点、影响首次录制快捷键时的焦点归属。
    if (intent?.background) ensureLauncher();
    connectCommandChannel(process.env.AAW_LAUNCHER_TOKEN);
    const command = intent?.guide ? "--aaw-guide"
      : intent?.openTool ? `--aaw-open=${intent.openTool}`
        : intent?.background ? "--aaw-background" : "--aaw-launcher";
    applyIntent(command);
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
