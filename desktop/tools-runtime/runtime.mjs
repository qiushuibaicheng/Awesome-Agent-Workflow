import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { BrowserWindow, protocol, session, screen } from "electron";

const scheme = "aaw-tool";
const documents = new Map();
const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'";
const limit = 512 * 1024;

protocol.registerSchemesAsPrivileged([{ scheme, privileges: { standard: true, secure: true } }]);

export function prepareRuntime() {
  const isolated = session.fromPartition("aaw-personal-tool-runtime");
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.on("will-download", (event) => event.preventDefault());
  isolated.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !new URL(details.url).protocol.match(/^(aaw-tool:|data:|blob:)$/) });
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

export async function loadTool(isolated, tool, visible) {
  const key = randomUUID();
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const win = new BrowserWindow({
    show: false, title: tool.name, width: Math.min(900, workArea.width - 32), height: Math.min(650, workArea.height - 32),
    minWidth: Math.min(360, workArea.width - 32), minHeight: Math.min(280, workArea.height - 32), autoHideMenuBar: true,
    icon: join(import.meta.dirname, "icon.png"),
    backgroundColor: "#171c24",
    webPreferences: {
      session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false,
      spellcheck: false, devTools: false,
    },
  });
  documents.set(key, tool.html);
  win.on("closed", () => documents.delete(key));
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

export async function executeAction(isolated, tool, action, input) {
  let timer;
  let win;
  const loading = loadTool(isolated, tool, false);
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
