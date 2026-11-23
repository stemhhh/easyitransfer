const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("easyApp", {
  isDesktop: true,
  quit: () => ipcRenderer.invoke("app-quit"),
});
