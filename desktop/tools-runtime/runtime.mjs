import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { BrowserWindow, protocol, session, screen, webContents } from "electron";
import { readNetworkRule, resolveToolSettings } from "./package-contract.mjs";

const scheme = "aaw-tool";
/**
 * key → { html, settings, network }。
 *
 * 以前这里只存 html，settings 靠一段内联脚本拼在 HTML 前面。现在 settings 改由
 * preload 通过同步 IPC 取走：注入形态从"字符串拼接"变成"能力暴露"，CSP 才能
 * 自由收紧（将来加 nonce 也不会影响工具）。
 */
const documents = new Map();
/** webContents.id → { key, toolId }：IPC 侧要靠它判断"这个窗口是谁"。 */
const toolWindows = new Map();
/**
 * 声明了自签证书的域名。
 *
 * 证书校验是 per-session 的，没法按窗口区分，所以这里维护一份并集：任何工具
 * 声明了 `insecure`，该域名对整个工具 session 放行。代价是多工具之间共享这
 * 一层信任，收益是不必为每个工具开独立 session（那会让存储与权限行为分叉）。
 */
const insecureHosts = new Set();
let certificateHandlerReady = false;

const hostPattern = /^(\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/i;
const limit = 512 * 1024;
/** 只拦本地/特权协议；http(s) 由 CSP 管。 */
const blockedScheme = /^(?:file|chrome|chrome-extension|chrome-untrusted|devtools|javascript|filesystem):/;

function matchHost(pattern, host) {
  const clean = pattern.toLowerCase();
  const target = host.toLowerCase();
  if (clean.startsWith("*.")) return target === clean.slice(2) || target.endsWith(clean.slice(1));
  return target === clean;
}

/**
 * 不随工具声明变化的 CSP 指令。
 *
 * 单独拎成常量是为了让 `policy.test.ts` 能逐条比对：预览用的 CSP 与真实窗口
 * 必须一致，否则会出现"预览能跑、打开就废"。唯一允许参数化的是 `connect-src`。
 */
const basePolicy = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob: https: http:",
  "font-src data:",
  "media-src data: blob: https: http:",
  "form-action 'none'",
  "base-uri 'none'",
];

/**
 * 按声明生成 CSP。
 *
 * `connect-src` 是唯一一处随工具声明变化的指令：
 * - 没写 `network` → 宽松（`https: http:`），保住存量工具；
 * - 写 `network: false` → `'none'`，作者主动收紧；
 * - 写 `hosts` → 白名单，只有列出的域名能连。
 */
function policyFor(network) {
  let connect = "https: http:";
  if (!network.enabled) connect = "'none'";
  else if (network.hosts.length) {
    const hosts = network.hosts.filter((item) => hostPattern.test(item));
    connect = hosts.length ? hosts.join(" ") : "https: http:";
  }
  return [...basePolicy, `connect-src ${connect}`].join("; ");
}

protocol.registerSchemesAsPrivileged([{ scheme, privileges: { standard: true, secure: true } }]);

export function prepareRuntime() {
  const isolated = session.fromPartition("aaw-personal-tool-runtime");
  // 权限：剪贴板给用（工具常见的"复制结果"），其余（摄像头、通知、地理位置…）一律拒。
  const allowed = new Set(["clipboard-read", "clipboard-sanitized-write"]);
  isolated.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed.has(permission)));
  isolated.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));
  isolated.on("will-download", (event) => event.preventDefault());
  isolated.webRequest.onBeforeRequest((details, callback) => {
    let scheme;
    try { scheme = new URL(details.url).protocol; } catch { callback({ cancel: true }); return; }
    callback({ cancel: blockedScheme.test(scheme) });
  });
  if (!certificateHandlerReady) {
    certificateHandlerReady = true;
    isolated.setCertificateVerifyProc((request, callback) => {
      for (const pattern of insecureHosts) {
        if (matchHost(pattern, request.hostname)) return callback(0);
      }
      // -3 = 交回 Chromium 默认校验，不自己实现一套证书逻辑。
      callback(-3);
    });
  }
  isolated.protocol.handle(scheme, (request) => {
    const url = new URL(request.url);
    const entry = url.pathname === "/index.html" ? documents.get(url.hostname) : undefined;
    if (entry === undefined) return new Response("", { status: 404 });
    return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${entry.html}`, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": policyFor(entry.network) },
    });
  });
  return isolated;
}

/** 某个 webContents 对应的工具身份；非工具窗口返回 undefined。 */
export function readToolWindow(contents) {
  return contents ? toolWindows.get(contents.id) : undefined;
}

/**
 * 取某个工具窗口的 settings。
 *
 * 由 preload 通过 `ipcRenderer.sendSync("tool:settings:sync")` 调用——必须同步，
 * 因为 `window.aawSettings` 要在工具脚本第一行就能读到，异步会变成"有时 undefined"。
 */
export function readToolSettings(key) {
  return documents.get(key)?.settings;
}

/** 读取所有已登记的自签证书域名，供诊断与手册自检展示。 */
export function readInsecureHosts() {
  return [...insecureHosts];
}

/** 取某个工具窗口的唤起上下文（selection / origin）。 */
export function readToolContext(key) {
  return documents.get(key)?.context;
}

/**
 * 向所有在线工具窗口广播一条消息。
 *
 * `aawBus` 用它。刻意不保留历史：工具不在线就收不到，避免把简单的广播做成
 * 一个小型消息队列（那会带来"离线补发"的语义与存储成本）。
 */
export function broadcastToTools(channel, payload, exceptContentsId) {
  for (const [id] of toolWindows) {
    if (id === exceptContentsId) continue;
    const contents = webContents.fromId(id);
    if (contents && !contents.isDestroyed()) contents.send(channel, ...payload);
  }
}

/** 当前在线的工具 id 列表，供调试与诊断。 */
export function onlineToolIds() {
  return [...new Set([...toolWindows.values()].map((item) => item.toolId))];
}

export async function loadTool(isolated, tool, visible, settings, options = {}) {
  const key = randomUUID();
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const network = readNetworkRule(tool.permissions);
  for (const host of network.insecure ? network.hosts : []) {
    if (hostPattern.test(host)) insecureHosts.add(host.toLowerCase());
  }
  const win = new BrowserWindow({
    show: false, title: tool.name, width: Math.min(900, workArea.width - 32), height: Math.min(650, workArea.height - 32),
    minWidth: Math.min(360, workArea.width - 32), minHeight: Math.min(280, workArea.height - 32), autoHideMenuBar: true,
    icon: join(import.meta.dirname, "icon.png"),
    backgroundColor: "#171c24",
    webPreferences: {
      session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false,
      spellcheck: false, devTools: options.dev === true,
      preload: join(import.meta.dirname, "tool-preload.cjs"),
      // key 只有 36 字符，不撞 Windows 命令行长度上限；settings 本身走同步 IPC。
      additionalArguments: [`--aaw-tool-key=${key}`],
    },
  });
  documents.set(key, {
    html: tool.html,
    settings: resolveToolSettings(tool, settings),
    network,
    context: options.context ?? { selection: "", origin: "launcher" },
  });
  const contentsId = win.webContents.id;
  toolWindows.set(contentsId, { key, toolId: tool.id });
  win.on("closed", () => {
    documents.delete(key);
  });
  win.webContents.once("destroyed", () => { toolWindows.delete(contentsId); });
  win.on("page-title-updated", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-frame-navigate", (event) => event.preventDefault());
  win.webContents.on("will-redirect", (event) => event.preventDefault());
  try {
    await win.loadURL(`${scheme}://${key}/index.html`);
    if (visible) win.show();
    return win;
  } catch (error) {
    if (!win.isDestroyed()) win.destroy();
    throw error;
  }
}

export async function executeAction(isolated, tool, action, input, settings) {
  let timer;
  let win;
  const loading = loadTool(isolated, tool, false, settings);
  try {
    return await Promise.race([
      loading.then(async (window) => {
        win = window;
        const result = await window.webContents.executeJavaScript(`(async () => {
          const id = ${JSON.stringify(action)};
          const handlers = window.aawActions;
          if (!handlers || !Object.hasOwn(handlers, id) || typeof handlers[id] !== 'function')
            throw new Error('工具未实现动作 ' + id);
          const value = await handlers[id](JSON.parse(${JSON.stringify(JSON.stringify(input))}));
          const encoded = JSON.stringify(value);
          if (encoded === undefined || new TextEncoder().encode(encoded).length > ${limit})
            throw new Error('动作必须返回 512 KB 以内的 JSON 值');
          return encoded;
        })()`);
        return JSON.parse(result);
      }),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("工具动作执行超时（8 秒）。")), 8000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (win && !win.isDestroyed()) win.destroy();
    else void loading.then((window) => { if (!window.isDestroyed()) window.destroy(); }, () => {});
  }
}
