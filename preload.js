const { contextBridge, ipcRenderer } = require("electron");

// The YouTube Music extension runs in an isolated world. Passing updates through
// postMessage keeps the Discord client in the Electron process instead of
// exposing Node.js to the music page.
window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "loop.mp3") return;
    if (event.data.type === "discord-rpc:update") {
        ipcRenderer.send("discord-rpc:update", event.data.activity);
    } else if (event.data.type === "discord-rpc:clear") {
        ipcRenderer.send("discord-rpc:clear");
    }
});

contextBridge.exposeInMainWorld("loopElectron", {
    isElectron: true,
});
