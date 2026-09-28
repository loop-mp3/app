const api = window.miniPlayer || {};

const artwork = document.getElementById("artwork");
const title = document.getElementById("title");
const artist = document.getElementById("artist");
const album = document.getElementById("album");
const currentTime = document.getElementById("current-time");
const duration = document.getElementById("duration");
const seek = document.getElementById("seek");
const previous = document.getElementById("previous");
const playPause = document.getElementById("play-pause");
const next = document.getElementById("next");
const close = document.getElementById("close");

const send = (command, data) => {
    if (api.sendCommand) api.sendCommand(command, data);
};

function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const total = Math.floor(seconds);
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function render(state) {
    if (!state || typeof state !== "object") return;

    document.documentElement.dataset.theme = state.theme || "default";
    if (state.artwork) artwork.src = state.artwork;

    title.textContent = state.title || "Nothing playing";
    artist.textContent = state.artist || "Search something to play";
    album.textContent = state.album || "";
    album.hidden = !state.album;

    const durationValue = Number.isFinite(state.duration) ? state.duration : 0;
    const currentValue = Number.isFinite(state.currentTime)
        ? Math.min(state.currentTime, durationValue)
        : 0;

    seek.disabled = durationValue <= 0;
    seek.max = String(durationValue);
    if (document.activeElement !== seek) {
        seek.value = String(currentValue);
    }
    currentTime.textContent = formatTime(currentValue);
    duration.textContent = formatTime(durationValue);

    playPause.innerHTML = state.paused ? "&#9654;" : "&#9208;";
    playPause.setAttribute("aria-label", state.paused ? "Play" : "Pause");
    playPause.title = state.paused ? "Play" : "Pause";
}

playPause.addEventListener("click", () => send("play-pause"));
previous.addEventListener("click", () => send("previous"));
next.addEventListener("click", () => send("next"));
seek.addEventListener("input", () => {
    send("seek", { position: Number(seek.value) });
});
close.addEventListener("click", () => {
    send("close");
    window.close();
});

if (api.onState) {
    api.onState(render);
} else {
    console.warn("[loop] miniPlayer bridge unavailable");
}