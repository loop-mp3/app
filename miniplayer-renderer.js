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
const kawarpCanvas = document.getElementById("mini-kawarp-background");
let kawarpRenderer;
let kawarpState;
let kawarpArtwork = "";
let kawarpModulePromise;
let currentArtworkURL = "";
const fallbackArtworkURLs = new Map();
const fallbackArtworkPromises = new Map();
let artworkRequest = 0;

const send = (command, data) => {
    if (api.sendCommand) api.sendCommand(command, data);
};

function resolveArtworkURL(artworkURL) {
    if (typeof artworkURL !== "string") return Promise.resolve("");
    const match = artworkURL.match(/\/static\/(fallback-artwork|fallback-legacy)\.png(?:[?#]|$)/);
    if (!match || !api.getFallbackArtworkSource) return Promise.resolve(artworkURL);

    const name = match[1];
    if (fallbackArtworkURLs.has(name)) {
        return Promise.resolve(fallbackArtworkURLs.get(name));
    }
    if (!fallbackArtworkPromises.has(name)) {
        const promise = api.getFallbackArtworkSource(name).then((base64) => {
            if (!base64) return artworkURL;
            const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
            const blobURL = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
            fallbackArtworkURLs.set(name, blobURL);
            return blobURL;
        }).catch((error) => {
            console.warn("[loop] Could not read fallback artwork:", error);
            return artworkURL;
        });
        fallbackArtworkPromises.set(name, promise);
    }
    return fallbackArtworkPromises.get(name);
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const total = Math.floor(seconds);
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return `${minutes}:${String(rest).padStart(2, "0")}`;
}

async function updateKawarp(artworkURL) {
    const settings = kawarpState?.settings || {};
    const enabled = Boolean(kawarpState?.enabled) && document.documentElement.dataset.theme !== "sharp";
    kawarpCanvas.style.display = enabled ? "block" : "none";
    if (!enabled) {
        kawarpRenderer?.dispose();
        kawarpRenderer = undefined;
        kawarpArtwork = "";
        return;
    }
    if (!artworkURL) return;

    try {
        if (!kawarpModulePromise) {
            const moduleSource = await api.getKawarpModuleSource();
            if (!moduleSource) return;
            const moduleURL = URL.createObjectURL(new Blob([moduleSource], {
                type: "text/javascript",
            }));
            kawarpModulePromise = import(moduleURL).finally(() => URL.revokeObjectURL(moduleURL));
        }
        const { Kawarp } = await kawarpModulePromise;
        const options = {
            warpIntensity: settings.kawarpWarpIntensity,
            blurPasses: settings.kawarpBlurPasses,
            animationSpeed: settings.kawarpAnimationSpeed,
            transitionDuration: settings.kawarpTransitionDuration,
            saturation: settings.kawarpSaturation,
            dithering: settings.kawarpDithering,
            scale: settings.scale,
        };
        if (!kawarpRenderer) {
            kawarpRenderer = new Kawarp(kawarpCanvas, options);
            kawarpRenderer.start();
        } else {
            kawarpRenderer.setOptions(options);
        }
        console.warn("[loop] Mini-player Kawarp opacity is overridden to 0.33; configured opacity is ignored.");
        kawarpCanvas.style.opacity = String(0.33);
        if (artworkURL && artworkURL !== kawarpArtwork) {
            kawarpArtwork = artworkURL;
            await kawarpRenderer.loadImage(artworkURL);
        }
    } catch (error) {
        console.warn("[loop] Could not initialize mini-player Kawarp:", error);
        kawarpCanvas.style.display = "none";
    }
}

function render(state) {
    if (!state || typeof state !== "object") return;

    document.documentElement.dataset.theme = state.theme || "default";
    const requestId = ++artworkRequest;
    resolveArtworkURL(state.artwork || "").then((artworkURL) => {
        if (requestId !== artworkRequest) return;
        currentArtworkURL = artworkURL;
        if (artworkURL) artwork.src = artworkURL;
        updateKawarp(currentArtworkURL);
    });

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
    api.onKawarpState((state) => {
        kawarpState = state;
        updateKawarp(currentArtworkURL);
    });
    api.getKawarpState().then((state) => {
        kawarpState = state;
        updateKawarp(currentArtworkURL);
    }).catch((error) => console.warn("[loop] Could not read Kawarp state:", error));
} else {
    console.warn("[loop] miniPlayer bridge unavailable");
}
