// 工具窗口专用 preload。沙箱里只能用内置的 CommonJS 桥。
// 这里只暴露两个能力：存储与文件。没有 Node、没有任意路径读写——那是唯一
// 一条硬底线，其余能力（联网、剪贴板）在 runtime.mjs 的 CSP 与权限处理器里放开。
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
