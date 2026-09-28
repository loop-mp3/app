const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("miniPlayer", {
    onState: (callback) => {
        const listener = (_event, state) => callback(state);
        ipcRenderer.on("loop:electron-mini-player-state", listener);
        return () => {
            ipcRenderer.removeListener("loop:electron-mini-player-state", listener);
        };
    },

    sendCommand: (command, data) => {
        ipcRenderer.send("loop:electron-mini-player-command", {
            command,
            ...(data || {})
        });
    }
});