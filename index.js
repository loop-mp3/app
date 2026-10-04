const { app, BrowserWindow, session, ipcMain, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const DiscordRPC = require("discord-rpc");
const { execFile } = require("child_process");

const EXTENSIONS_DIR = app.isPackaged
    ? path.join(process.resourcesPath, "extention")
    : path.join(__dirname, "extention");
const ICON_PATH = path.join(__dirname, "assets", "icon.ico");
const YT_URL = "https://music.youtube.com/";
const DISCORD_CLIENT_ID = "1547617300230701156";
const LOOP_URL = "https://loop.mizucode.qzz.io";

let discordClient;
let discordReady = false;
let lastActivity;
let mainWindow = null;
let miniPlayerWindow = null;
let miniPlayerPendingState = null;
let kawarpState = { enabled: false, settings: {} };
let kawarpModuleURL = null;
let kawarpModuleSource = null;
let fallbackArtworkSources = {};
let quitting = false;

ipcMain.handle("loop:get-platform", () => {
    return process.platform;
});

ipcMain.handle("loop:electron-get-kawarp-state", () => kawarpState);
ipcMain.handle("loop:electron-get-kawarp-module-url", () => kawarpModuleURL);
ipcMain.handle("loop:electron-get-kawarp-module-source", () => kawarpModuleSource);
ipcMain.handle("loop:electron-get-fallback-artwork-source", (_event, name) => {
    return fallbackArtworkSources[name] || null;
});

function sendDiscordActivity() {
    if (!discordReady || !lastActivity) return;
    const {
        details,
        state,
        largeImageKey,
        largeImageText,
        startTimestamp,
        endTimestamp,
        buttons,
        instance,
    } = lastActivity;
    discordClient.request("SET_ACTIVITY", {
        pid: process.pid,
        activity: {
            type: 2,
            details,
            state,
            timestamps: startTimestamp || endTimestamp
                ? { start: startTimestamp, end: endTimestamp }
                : undefined,
            assets: {
                large_image: largeImageKey,
                large_text: largeImageText,
            },
            buttons,
            instance,
        },
    }).catch(() => {});
}

function startDiscordRPC() {
    DiscordRPC.register(DISCORD_CLIENT_ID);
    discordClient = new DiscordRPC.Client({ transport: "ipc" });
    discordClient.on("ready", () => {
        discordReady = true;
        console.log("[discord] Rich Presence connected");
        sendDiscordActivity();
    });
    discordClient.on("error", (error) => {
        discordReady = false;
        console.warn("[discord] Rich Presence unavailable:", error.message);
    });
    discordClient.login({ clientId: DISCORD_CLIENT_ID }).catch((error) => {
        discordReady = false;
        console.warn("[discord] Start Discord to enable Rich Presence:", error.message);
    });
}
// we dont need you now cuh
// function DisableScreen() {}

function clearDiscordActivity() {
    lastActivity = undefined;
    if (discordReady) discordClient.clearActivity().catch(() => {});
}

function isSleepSupported() {
    return process.platform === "win32";
}

ipcMain.handle("loop:is-screen-off-supported", () => {
    return isSleepSupported();
});

ipcMain.on("loop:screen-off", () => {
    if (process.platform !== "win32") {
        console.warn("[screen] Screen disable is only supported on Windows.");
        return;
    }

    execFile(
        "powershell.exe",
        [
            "-NoProfile",
            "-Command",
            "Start-Process -FilePath 'C:\\Windows\\System32\\scrnsave.scr' -ArgumentList '/s'"
        ],
        {
            windowsHide: true
        },
        (error) => {
            if (error) {
                console.warn("[screen] Failed to disable screen:", error.message);
                return;
            }

            console.log("[screen] Display disabled");
        }
    );
});



ipcMain.on("discord-rpc:update", (_event, activity) => {
    if (!activity || typeof activity !== "object") return;
    const songTitle = String(activity.state || "").trim();
    lastActivity = {
        type: 2,
        details: (songTitle ? `${songTitle}` : String(activity.details || "Listening to Loop")).slice(0, 128),
        state: activity.paused ? "Paused" : undefined,
        largeImageKey: String(activity.largeImageKey || "").slice(0, 300),
        largeImageText: String(activity.largeImageText || "Loop").slice(0, 128),
        buttons: [{ label: "Get Loop", url: "https://loop.mizucode.qzz.io/" }],
        instance: false,
    };
    if (Number.isFinite(activity.startTimestamp)) lastActivity.startTimestamp = activity.startTimestamp;
    if (Number.isFinite(activity.endTimestamp)) lastActivity.endTimestamp = activity.endTimestamp;
    sendDiscordActivity();
});

ipcMain.on("discord-rpc:clear", clearDiscordActivity);

// ─────────────────────────────────────────────────────────
// Mini-player window management
// ─────────────────────────────────────────────────────────

function ensureMiniPlayerWindow() {
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
        return miniPlayerWindow;
    }

    const win = new BrowserWindow({
        width: 380,
        height: 150,
        show: false,
        frame: false,
        alwaysOnTop: true,
        resizable: true,
        skipTaskbar: true,
        backgroundColor: "#1e1e2e",
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, "mini-player-preload.js")
        }
    });

    win.webContents.on("did-finish-load", () => {
        if (miniPlayerPendingState) {
            win.webContents.send(
                "loop:electron-mini-player-state",
                miniPlayerPendingState
            );
        }
        win.webContents.send("loop:electron-kawarp-state", kawarpState);
    });

    // Hide instead of destroy when the user closes the mini-player.
    win.on("close", (event) => {
        if (quitting) return;
        event.preventDefault();
        win.hide();
    });

    win.loadFile(path.join(__dirname, "miniplayer.html"));
    miniPlayerWindow = win;
    return win;
}

function openMiniPlayer() {
    const win = ensureMiniPlayerWindow();
    const display = screen.getDisplayMatching(mainWindow?.getBounds() || win.getBounds());
    const { workArea } = display;
    const [width, height] = win.getSize();
    const margin = 20;
    win.setPosition(
        workArea.x + workArea.width - width - margin,
        workArea.y + workArea.height - height - margin
    );
    win.show();
    win.focus();
}

function hideMiniPlayer() {
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
        miniPlayerWindow.hide();
    }
}

ipcMain.on("loop:electron-open-mini-player", openMiniPlayer);
ipcMain.on("loop:electron-close-mini-player", hideMiniPlayer);

ipcMain.on("loop:electron-mini-player-state", (_event, state) => {
    miniPlayerPendingState = state;
    const win = miniPlayerWindow;

    if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
        win.webContents.send("loop:electron-mini-player-state", state);
    }
});

ipcMain.on("loop:electron-kawarp-state", (_event, state) => {
    if (!state || typeof state !== "object") return;
    kawarpState = {
        enabled: Boolean(state.enabled),
        settings: { ...(state.settings || {}) },
    };
    const win = miniPlayerWindow;
    if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
        win.webContents.send("loop:electron-kawarp-state", kawarpState);
    }
});

// Commands sent by the mini-player renderer get routed back into the main
// window so the extension can act on them (play/pause, seek, etc.).
ipcMain.on("loop:electron-mini-player-command", (_event, value) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("loop:electron-mini-player-command", value);
});

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
            if (name === "loop") {
                kawarpModuleURL = `chrome-extension://${extension.id}/modules/kawarp.js`;
                try {
                    kawarpModuleSource = fs.readFileSync(
                        path.join(extPath, "modules", "kawarp.js"),
                        "utf8"
                    );
                } catch (error) {
                    console.warn("[ext] Could not read Kawarp module:", error.message);
                }
                fallbackArtworkSources = {};
                for (const name of ["fallback-artwork", "fallback-legacy"]) {
                    try {
                        fallbackArtworkSources[name] = fs.readFileSync(
                            path.join(extPath, "static", `${name}.png`)
                        ).toString("base64");
                    } catch (error) {
                        console.warn(`[ext] Could not read ${name}:`, error.message);
                    }
                }
            }
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
        width: 1000,
        height: 700,
        icon: ICON_PATH,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, "preload.js")
        }
    });

    mainWindow = win;
    win.on("minimize", openMiniPlayer);
    win.on("restore", hideMiniPlayer);
    win.on("closed", () => {
        if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
            miniPlayerWindow.destroy();
        }
        miniPlayerWindow = null;
        mainWindow = null;
    });

    win.removeMenu();
    win.webContents.on("before-input-event", (event, input) => {
        if (
            input.type === "keyDown" &&
            input.control &&
            input.shift &&
            input.key.toLowerCase() === "i"
        ) {
            event.preventDefault();
            win.webContents.toggleDevTools();
        }
    });
    win.webContents.on("did-finish-load", () => {
        win.webContents.setZoomFactor(0.8);
    });

    await win.loadURL(YT_URL);
}

app.whenReady().then(() => {
    startDiscordRPC();
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

app.on("before-quit", () => {
    quitting = true;
    clearDiscordActivity();
    discordClient?.destroy();
});
