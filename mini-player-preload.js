const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("miniPlayer", {
    onState: (callback) => {
        const listener = (_event, state) => callback(state);
        ipcRenderer.on("loop:electron-mini-player-state", listener);
        return () => {
            ipcRenderer.removeListener("loop:electron-mini-player-state", listener);
        };
    },

    onKawarpState: (callback) => {
        const listener = (_event, state) => callback(state);
        ipcRenderer.on("loop:electron-kawarp-state", listener);
        return () => ipcRenderer.removeListener("loop:electron-kawarp-state", listener);
    },

    getKawarpState: () => ipcRenderer.invoke("loop:electron-get-kawarp-state"),
    getKawarpModuleSource: () => ipcRenderer.invoke("loop:electron-get-kawarp-module-source"),
    getFallbackArtworkSource: (name) => ipcRenderer.invoke(
        "loop:electron-get-fallback-artwork-source",
        name
    ),

    sendCommand: (command, data) => {
        ipcRenderer.send("loop:electron-mini-player-command", {
            command,
            ...(data || {})
        });
    }
});
