const { app, BrowserWindow, session, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const DiscordRPC = require("discord-rpc");

const EXTENSIONS_DIR = path.join(__dirname, "extention");
const YT_URL = "https://music.youtube.com/";
const DISCORD_CLIENT_ID = "1547617300230701156";
const LOOP_URL = "https://loop.mizucode.qzz.io/";

let discordClient;
let discordReady = false;
let lastActivity;

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

function clearDiscordActivity() {
    lastActivity = undefined;
    if (discordReady) discordClient.clearActivity().catch(() => {});
}

ipcMain.on("discord-rpc:update", (_event, activity) => {
    if (!activity || typeof activity !== "object") return;
    lastActivity = {
        type: 2,
        details: String(activity.details || "Listening to Loop").slice(0, 128),
        state: String(activity.state || "").slice(0, 128),
        largeImageKey: String(activity.largeImageKey || "").slice(0, 300),
        largeImageText: String(activity.largeImageText || "Loop").slice(0, 128),
        buttons: [{ label: "Get Loop", url: LOOP_URL }],
        instance: false,
    };
    if (Number.isFinite(activity.startTimestamp)) lastActivity.startTimestamp = activity.startTimestamp;
    if (Number.isFinite(activity.endTimestamp)) lastActivity.endTimestamp = activity.endTimestamp;
    sendDiscordActivity();
});

ipcMain.on("discord-rpc:clear", clearDiscordActivity);

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
        width: 1100,
        height: 750,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, "preload.js")
        }
    });

    win.removeMenu();
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
    clearDiscordActivity();
    discordClient?.destroy();
});
