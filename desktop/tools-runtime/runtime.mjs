import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { BrowserWindow, protocol, session, screen } from "electron";
import { toolSettingsScript } from "./package-contract.mjs";

const scheme = "aaw-tool";
const documents = new Map();
/** webContents.id → { key, toolId }：IPC 侧要靠它判断"这个窗口是谁"。 */
const toolWindows = new Map();
/**
 * 沙箱策略：仍然禁掉一切隐式加载，但放开主动联网。
 *
 * 以前是 `default-src 'none'` 且 webRequest 拦掉所有非 aaw-tool 请求，等于工具
 * 不能跟内网接口说话——"查一下接口状态"这种最日常的需求都做不了。现在放开
 * connect-src，图片/媒体允许 https，其余（外链脚本、表单提交、宿主权限）照旧收紧。
 */
const policy = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob: https: http:",
  "font-src data:",
  "media-src data: blob: https: http:",
  "connect-src https: http:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");
const limit = 512 * 1024;
/** 只拦本地/特权协议；http(s) 由 CSP 管。 */
const blockedScheme = /^(?:file|chrome|chrome-extension|chrome-untrusted|devtools|javascript|filesystem):/;

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
  isolated.protocol.handle(scheme, (request) => {
    const url = new URL(request.url);
    const html = url.pathname === "/index.html" ? documents.get(url.hostname) : undefined;
    if (html === undefined) return new Response("", { status: 404 });
    return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${html}`, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": policy },
    });
  });
  return isolated;
}

/** 某个 webContents 对应的工具身份；非工具窗口返回 undefined。 */
export function readToolWindow(contents) {
  return contents ? toolWindows.get(contents.id) : undefined;
}

export async function loadTool(isolated, tool, visible, settings, options = {}) {
  const key = randomUUID();
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const win = new BrowserWindow({
    show: false, title: tool.name, width: Math.min(900, workArea.width - 32), height: Math.min(650, workArea.height - 32),
    minWidth: Math.min(360, workArea.width - 32), minHeight: Math.min(280, workArea.height - 32), autoHideMenuBar: true,
    icon: join(import.meta.dirname, "icon.png"),
    backgroundColor: "#171c24",
    webPreferences: {
      session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false,
      spellcheck: false, devTools: options.dev === true,
      preload: join(import.meta.dirname, "tool-preload.cjs"),
    },
  });
  documents.set(key, toolSettingsScript(tool, settings) + tool.html);
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
