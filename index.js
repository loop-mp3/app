const { app, BrowserWindow, session } = require("electron");
const path = require("path");
const fs = require("fs");

const EXTENSIONS_DIR = path.join(__dirname, "extention");
const YT_URL = "https://music.youtube.com/";

function findExtensionDirs(dir) {
    const results = [];

    if (!fs.existsSync(dir)) {
        return results;
    }

    for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry);

        if (!fs.statSync(fullPath).isDirectory()) {
            continue;
        }

        const manifestPath = path.join(fullPath, "manifest.json");

        if (fs.existsSync(manifestPath)) {
            results.push(fullPath);
        } else {
            results.push(...findExtensionDirs(fullPath));
        }
    }

    return results;
}

async function loadExtensions() {
    if (!fs.existsSync(EXTENSIONS_DIR)) {
        console.log("[ext] No extensions folder found, skipping.");
        return;
    }

    const extensionDirs = findExtensionDirs(EXTENSIONS_DIR);

    if (extensionDirs.length === 0) {
        console.log("[ext] No extensions found.");
        return;
    }

    for (const extPath of extensionDirs) {
        const name = path.basename(extPath);

        try {
            const extension = await session.defaultSession.loadExtension(
                extPath,
                {
                    allowFileAccess: true
                }
            );

            console.log(`[ext] Loaded: ${name} (${extension.id})`);
        } catch (error) {
            console.error(
                `[ext] Failed to load ${name}:`,
                error
            );
        }
    }
}

async function createWindow() {
    // Load extensions BEFORE loading YouTube Music.
    await loadExtensions();

    const win = new BrowserWindow({
        width: 900,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    win.removeMenu();
    win.webContents.on("did-finish-load", () => {
        win.webContents.setZoomFactor(0.8);
    });

    await win.loadURL(YT_URL);
}

app.whenReady().then(() => {
    createWindow();

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