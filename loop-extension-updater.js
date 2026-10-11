const https = require("https");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const LOOP_REPOSITORY = "loop-mp3/loop";
const RELEASES_URL = `https://api.github.com/repos/${LOOP_REPOSITORY}/releases/latest`;
const AD_BLOCK_EXTENSION = "adblock";

function requestJSON(url) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, {
            headers: {
                Accept: "application/vnd.github+json",
                "User-Agent": "loop-app-extension-updater",
            },
        }, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.resume();
                requestJSON(response.headers.location).then(resolve, reject);
                return;
            }

            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => { body += chunk; });
            response.on("end", () => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(`GitHub returned HTTP ${response.statusCode}`));
                    return;
                }

                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(new Error(`GitHub returned invalid JSON: ${error.message}`));
                }
            });
        });

        request.setTimeout(15000, () => request.destroy(new Error("GitHub request timed out")));
        request.on("error", reject);
    });
}

function downloadFile(url, destination) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, {
            headers: { "User-Agent": "loop-app-extension-updater" },
        }, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.resume();
                downloadFile(response.headers.location, destination).then(resolve, reject);
                return;
            }

            if (response.statusCode < 200 || response.statusCode >= 300) {
                response.resume();
                reject(new Error(`Source archive returned HTTP ${response.statusCode}`));
                return;
            }

            const output = fs.createWriteStream(destination);
            response.pipe(output);
            output.on("finish", () => output.close(resolve));
            output.on("error", reject);
            response.on("error", reject);
        });

        request.setTimeout(120000, () => request.destroy(new Error("Source archive download timed out")));
        request.on("error", reject);
    });
}

function findManifestRoot(directory) {
    const manifestPath = path.join(directory, "manifest.json");
    if (fs.existsSync(manifestPath)) return directory;

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const result = findManifestRoot(path.join(directory, entry.name));
        if (result) return result;
    }
    return null;
}

async function extractArchive(archivePath, destination) {
    await fs.promises.mkdir(destination, { recursive: true });
    await execFileAsync("tar", ["-xf", archivePath, "-C", destination], { windowsHide: true });
}

function listExtensionManifestPaths(directory) {
    const manifests = [];
    if (!fs.existsSync(directory)) return manifests;

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const extensionDirectory = path.join(directory, entry.name);
        const manifestPath = path.join(extensionDirectory, "manifest.json");
        if (fs.existsSync(manifestPath)) {
            manifests.push({ name: entry.name, path: manifestPath });
        } else {
            manifests.push(...listExtensionManifestPaths(extensionDirectory));
        }
    }
    return manifests;
}

async function disableStaleExtensionManifests(extensionsDirectory, activeManifestPath) {
    const activePath = path.resolve(activeManifestPath);
    for (const manifest of listExtensionManifestPaths(extensionsDirectory)) {
        if (path.resolve(manifest.path) === activePath || manifest.name === AD_BLOCK_EXTENSION) continue;
        const disabledPath = `${manifest.path}.disabled`;
        await fs.promises.rename(manifest.path, disabledPath);
        console.log(`[ext] Disabled stale manifest: ${manifest.path}`);
    }
}

async function readLoopManifest(extensionsDirectory) {
    const loopManifest = path.join(extensionsDirectory, "loop", "manifest.json");
    if (!fs.existsSync(loopManifest)) return null;
    try {
        const manifest = JSON.parse(await fs.promises.readFile(loopManifest, "utf8"));
        process.env.LOOP_EXTENTION_VERSION = String(manifest.version || "").trim();
        return manifest;
    } catch (error) {
        console.warn("[ext] Could not read the installed Loop manifest:", error.message);
        return null;
    }
}

async function updateLoopExtension(extensionsDirectory) {
    const installedManifest = await readLoopManifest(extensionsDirectory);
    const installedVersion = installedManifest?.version || "";
    const release = await requestJSON(RELEASES_URL);
    const releaseTag = String(release.tag_name || "").trim();
    const installedReleaseTag = `v${process.env.LOOP_EXTENTION_VERSION || installedVersion}`;

    if (!releaseTag || releaseTag === installedReleaseTag) {
        if (installedManifest) {
            await disableStaleExtensionManifests(
                extensionsDirectory,
                path.join(extensionsDirectory, "loop", "manifest.json")
            );
        }
        console.log(`[ext] Loop is up to date (${installedVersion || "unknown version"}).`);
        return false;
    }

    const archivePath = path.join(os.tmpdir(), `loop-${Date.now()}.zip`);
    const extractionDirectory = path.join(os.tmpdir(), `loop-extract-${Date.now()}`);
    const archiveURL = `https://github.com/${LOOP_REPOSITORY}/archive/refs/tags/${encodeURIComponent(releaseTag)}.zip`;

    try {
        console.log(`[ext] New Loop release found: ${releaseTag}. Downloading source archive.`);
        await downloadFile(archiveURL, archivePath);
        await extractArchive(archivePath, extractionDirectory);

        const downloadedRoot = findManifestRoot(extractionDirectory);
        if (!downloadedRoot) throw new Error("The downloaded archive does not contain a manifest.json");

        await fs.promises.mkdir(extensionsDirectory, { recursive: true });
        const loopDirectory = path.join(extensionsDirectory, "loop");
        if (fs.existsSync(loopDirectory)) {
            const backupDirectory = path.join(extensionsDirectory, `loop-previous-${Date.now()}`);
            await fs.promises.rename(loopDirectory, backupDirectory);
        }
        await fs.promises.rename(downloadedRoot, loopDirectory);
        await disableStaleExtensionManifests(extensionsDirectory, path.join(loopDirectory, "manifest.json"));
        console.log(`[ext] Installed Loop release ${releaseTag}.`);
        return true;
    } finally {
        await fs.promises.rm(archivePath, { force: true }).catch(() => {});
        await fs.promises.rm(extractionDirectory, { recursive: true, force: true }).catch(() => {});
    }
}

module.exports = {
    updateLoopExtension,
};
