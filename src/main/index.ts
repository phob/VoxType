import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage } from "electron";
import { join } from "node:path";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: "VoxType",
    backgroundColor: "#101114",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function createTray(): void {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("VoxType");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show VoxType",
        click: () => mainWindow?.show()
      },
      {
        label: "Quit",
        click: () => app.quit()
      }
    ])
  );
}

ipcMain.handle("app:get-version", () => app.getVersion());

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
