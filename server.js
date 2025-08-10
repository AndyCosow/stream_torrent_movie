import express from "express";
import WebTorrent from "webtorrent";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

// Resolve paths for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const client = new WebTorrent();

let torrent;

// Serve static files from /public
app.use(express.static(path.join(__dirname, "public")));

// Load torrent at startup
client.add(path.join(__dirname, "movie.torrent"), (t) => {
    torrent = t;
    console.log("Torrent metadata loaded:", torrent.name);
});

app.get("/stream", (req, res) => {
    if (!torrent) {
        res.status(503).send("Torrent not ready yet");
        return;
    }

    // Pick largest video file
    const file = torrent.files.reduce((a, b) =>
        a.length > b.length ? a : b
    );

    console.log(`Streaming with all audio tracks: ${file.name}`);

    // Send MP4 headers
    res.writeHead(200, {
        "Content-Type": "video/mp4",
        "Transfer-Encoding": "chunked",
    });

    const fileStream = file.createReadStream();

    // FFmpeg command: keep all streams, transcode all audio to AAC
    const ffmpeg = spawn("ffmpeg", [
        "-i", "pipe:0",                // Input from stdin
        "-map", "0:v",                  // Include video stream(s)
        "-map", "0:a",                  // Include all audio streams
        "-c:v", "libx264",              // Convert video to H.264
        "-preset", "veryfast",          // Fast encoding
        "-movflags", "frag_keyframe+empty_moov", // Enable streaming
        "-c:a", "aac",                  // Convert all audio tracks to AAC
        "-b:a", "192k",                  // Audio bitrate
        "-f", "mp4",                     // Output format
        "pipe:1"                         // Output to stdout
    ]);

    fileStream.pipe(ffmpeg.stdin);
    ffmpeg.stdout.pipe(res);

    ffmpeg.stderr.on("data", (data) => {
        console.log("FFmpeg:", data.toString());
    });

    res.on("close", () => {
        fileStream.destroy();
        ffmpeg.kill("SIGKILL");
    });
});

app.listen(3000, () => {
    console.log("Torrent server running at http://localhost:3000");
});
