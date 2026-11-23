const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");

// Acelera un poco el arranque en Windows
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-renderer-backgrounding");

process.env.EASYITRANSFER_ELECTRON = "1";
process.env.EASYITRANSFER_NO_BROWSER = "1";

let mainWindow = null;
let quitting = false;
let serverApi = null; // lazy: { startServer, shutdownServer, PORT }

function getServer() {
  if (!serverApi) {
    serverApi = require("../server");
  }
  return serverApi;
}

function createShellWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 760,
    minWidth: 360,
    minHeight: 560,
    backgroundColor: "#fff7f0",
    show: true, // ventana al instante
    autoHideMenuBar: true,
    title: "Easy iTransfer",
    icon: path.join(__dirname, "icon.ico"),
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#fff7f0",
      symbolColor: "#1a120c",
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });

  return win;
}

ipcMain.handle("app-quit", () => {
  app.quit();
});

app.whenReady().then(async () => {
  mainWindow = createShellWindow();

  // 1) Pantalla local inmediata (sin esperar al servidor)
  try {
    await mainWindow.loadFile(path.join(__dirname, "boot.html"));
  } catch (err) {
    console.error("boot:", err);
  }

  // 2) Servidor en paralelo; luego entra a la app
  try {
    const { startServer } = getServer();
    const info = await startServer({ openBrowser: false });
    if (!mainWindow || mainWindow.isDestroyed()) return;
    await mainWindow.loadURL(`${info.url}/?app=1`);
  } catch (err) {
    console.error(err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent(
            `<body style="font-family:Segoe UI;background:#fff7f0;padding:40px;color:#1a120c">
              <h2>No se pudo iniciar</h2>
              <p>${String(err.message || err)}</p>
              <p>Cierra la ventana e inténtalo de nuevo.</p>
            </body>`
          )
      );
    }
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  try {
    getServer().shutdownServer("electron");
  } catch {
    app.exit(0);
  }
  setTimeout(() => app.exit(0), 400);
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createShellWindow();
    const port = serverApi?.PORT || 3847;
    mainWindow.loadURL(`http://127.0.0.1:${port}/?app=1`);
  }
});
