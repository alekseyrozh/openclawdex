import { app, BrowserWindow, nativeTheme } from "electron";
import path from "path";

const DEV_URL = "http://localhost:3000";
const IS_DEV = !app.isPackaged;

function createWindow() {
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 800,
    minHeight: 500,

    // macOS native window chrome
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 14 },
    transparent: true,
    vibrancy: "sidebar",
    visualEffectState: "active",
    roundedCorners: true,

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },

    // Smooth launch: show after ready
    show: false,
  });

  // Show window once content is painted (avoids white flash)
  win.once("ready-to-show", () => {
    win.show();
  });

  if (IS_DEV) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, "../web/dist/index.html"));
  }
}

app.whenReady().then(createWindow);

// macOS: re-create window when dock icon clicked
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Quit when all windows closed (except macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
