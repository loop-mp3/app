const { contextBridge, ipcRenderer } = require("electron");

// The YouTube Music extension runs in an isolated world. Passing updates through
// postMessage keeps the Discord client in the Electron process instead of
// exposing Node.js to the music page.
window.addEventListener("message", async (event) => {
    if (event.source !== window || event.data?.source !== "loop.mp3") return;
    if (event.data.type === "discord-rpc:update") {
        ipcRenderer.send("discord-rpc:update", event.data.activity);
    } else if (event.data.type === "discord-rpc:clear") {
        ipcRenderer.send("discord-rpc:clear");
    } else if (event.data.type === "loop:screen-off") {
        ipcRenderer.send("loop:screen-off");
    } else if (event.data.type === "loop:is-screen-off-supported") {
        const supported = await ipcRenderer.invoke(
            "loop:is-screen-off-supported"
        );
        window.postMessage({
            source: "loop.mp3",
            type: "loop:is-screen-off-supported-response",
            supported
        }, "*");
    } else if (event.data.type === "loop:electron-open-mini-player") {
        ipcRenderer.send("loop:electron-open-mini-player");
    } else if (event.data.type === "loop:electron-close-mini-player") {
        ipcRenderer.send("loop:electron-close-mini-player");
    } else if (event.data.type === "loop:electron-mini-player-state") {
        ipcRenderer.send("loop:electron-mini-player-state", event.data.state);
    }
});
contextBridge.exposeInMainWorld("loopElectron", {
    isElectron: true,
});

window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== "loop.mp3") return;

    if (event.data.type === "loop:get-platform") {
        const platform = await ipcRenderer.invoke("loop:get-platform");

        window.postMessage({
            source: "loop.mp3",
            type: "loop:platform",
            platform
        }, "*");
    }
});

contextBridge.exposeInMainWorld("electronAPI", {
    openMiniPlayer: () => {
        ipcRenderer.send("loop:electron-open-mini-player");
    },

    closeMiniPlayer: () => {
        ipcRenderer.send("loop:electron-close-mini-player");
    },

    updateMiniPlayer: (state) => {
        ipcRenderer.send("loop:electron-mini-player-state", state);
    },

    sendMiniPlayerCommand: (command, data) => {
        ipcRenderer.send("loop:electron-mini-player-command", {
            command,
            ...(data || {})
        });
    }
});

// Mini-player commands arriving from the main process are handed back to the
// page so the extension can act on them (play/pause, previous, next, seek...).
ipcRenderer.on("loop:electron-mini-player-command", (_event, value) => {
    window.postMessage({
        source: "loop.mp3",
        type: "loop:electron-mini-player-command",
        value
    }, "*");
});