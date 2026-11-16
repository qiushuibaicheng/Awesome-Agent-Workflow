// Sandboxed Electron preloads use the built-in CommonJS bridge.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  entries: () => ipcRenderer.invoke("tools:list"),
  open: (id) => ipcRenderer.invoke("tools:open", id),
  hide: () => ipcRenderer.send("tools:hide"),
  onRefresh: (callback) => ipcRenderer.on("tools:refresh", () => callback()),
});
