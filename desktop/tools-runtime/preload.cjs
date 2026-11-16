// Sandboxed Electron preloads use the built-in CommonJS bridge.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  entries: () => ipcRenderer.invoke("tools:list"),
  open: (id) => ipcRenderer.invoke("tools:open", id),
  hide: () => ipcRenderer.send("tools:hide"),
  pin: (id, pinned) => ipcRenderer.invoke("launcher:pin", id, pinned),
  shortcut: (value) => ipcRenderer.invoke("launcher:shortcut", value),
  onRefresh: (callback) => ipcRenderer.on("tools:refresh", () => callback()),
});
