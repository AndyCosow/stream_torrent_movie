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

    // Set headers for streaming
    res.writeHead(200, {
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        "Connection": "keep-alive",
        "Transfer-Encoding": "chunked"
    });

    // Create a read stream from the torrent file
    const fileStream = file.createReadStream();

    // FFmpeg command: handle EAC3 audio and start from 31 minutes
    const ffmpeg = spawn("ffmpeg", [
        "-i", "pipe:0",                // Input from stdin
        "-ss", "00:00:00",             // Start at 31 minutes (after input)
        "-map", "0:v",                 // Include video stream(s)
        "-map", "0:a",                 // Include audio stream(s)
        "-c:v", "copy",                // Copy video stream without re-encoding
        "-c:a", "aac",                 // Convert audio to AAC
        "-b:a", "192k",                // Audio bitrate
        "-ac", "2",                    // Convert to stereo (simpler for streaming)
        "-ar", "44100",                // Sample rate
        "-f", "mp4",                   // Output format
        "-movflags", "frag_keyframe+empty_moov+faststart", // Enable streaming
        "-avoid_negative_ts", "make_zero", // Handle timestamp issues
        "-fflags", "+nobuffer",        // Reduce buffering
        "-flush_packets", "1",         // Flush packets immediately
        "pipe:1"                       // Output to stdout
    ]);

    // Debug: Track data flow
    let bytesReceived = 0;
    let bytesSent = 0;
    let ffmpegStarted = false;

    // Track data from FFmpeg
    ffmpeg.stdout.on('data', (chunk) => {
        if (!ffmpegStarted) {
            console.log("FFmpeg started sending data!");
            ffmpegStarted = true;
        }
        bytesSent += chunk.length;
        res.write(chunk);
        if (bytesSent % 1000000 === 0) { // Log every 1MB
            console.log(`Sent ${bytesSent} bytes to client`);
        }
    });

    // Track FFmpeg stderr
    ffmpeg.stderr.on("data", (data) => {
        const message = data.toString();
        console.log("FFmpeg:", message);

        // Check for specific errors
        if (message.includes("Error") || message.includes("error")) {
            console.error("FFmpeg error detected:", message);
        }
    });

    // Track data from torrent
    fileStream.on('data', (chunk) => {
        bytesReceived += chunk.length;
        if (bytesReceived % 10000000 === 0) { // Log every 10MB
            console.log(`Received ${bytesReceived} bytes from torrent`);
        }
    });

    // When FFmpeg finishes
    ffmpeg.on('close', (code) => {
        console.log(`FFmpeg process exited with code ${code}`);
        console.log(`Total bytes received: ${bytesReceived}, Total bytes sent: ${bytesSent}`);
        if (!ffmpegStarted) {
            console.error("FFmpeg never started sending data!");
        }
        res.end();
    });

    // Handle FFmpeg errors
    ffmpeg.on('error', (err) => {
        console.error('FFmpeg process error:', err);
        res.status(500).send("Error processing video");
    });

    // Pipe the torrent file to FFmpeg
    fileStream.pipe(ffmpeg.stdin);

    // Handle client disconnect
    res.on("close", () => {
        console.log("Client disconnected");
        fileStream.destroy();
        ffmpeg.kill("SIGKILL");
    });
});

app.listen(3000, () => {
    console.log("Torrent server running at http://localhost:3000");
});