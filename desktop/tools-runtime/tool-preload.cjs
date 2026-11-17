// 工具窗口专用 preload。沙箱里只能用内置的 CommonJS 桥。
// 这里暴露三个能力：存储、文件、剪切板文本。没有 Node、没有任意路径读写——
// 那是唯一一条硬底线，其余能力（联网）在 runtime.mjs 的 CSP 与权限处理器里放开。
// 剪切板走主进程而不是页面里的 navigator.clipboard：后者要用户手势，AI 在
// 隐藏窗口里执行动作时拿不到，剪切板历史 / 复制增强这类工具会莫名其妙失效。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aawStore", {
  set: (key, value) => ipcRenderer.invoke("tool:store:set", key, value),
  get: (key) => ipcRenderer.invoke("tool:store:get", key),
  delete: (key) => ipcRenderer.invoke("tool:store:delete", key),
  keys: () => ipcRenderer.invoke("tool:store:keys"),
});

contextBridge.exposeInMainWorld("aawFiles", {
  /** 用户亲手选一个文本文件；取消返回 null。 */
  open: (options) => ipcRenderer.invoke("tool:files:open", options),
  /** 弹系统保存框写文本；取消返回 false。 */
  save: (name, text) => ipcRenderer.invoke("tool:files:save", name, text),
});

contextBridge.exposeInMainWorld("aawClipboard", {
  /** 读当前系统剪切板里的纯文本；没有文本时返回空串。 */
  readText: () => ipcRenderer.invoke("tool:clipboard:read"),
  /** 把文本写进系统剪切板；返回 true。 */
  writeText: (text) => ipcRenderer.invoke("tool:clipboard:write", text),
});
