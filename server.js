const express = require("express");
const { Innertube } = require("youtubei.js");

const app = express();
const PORT = process.env.PORT || 3000;

let ytClient = null;
async function getClient() {
  if (!ytClient) ytClient = await Innertube.create();
  return ytClient;
}

function extractVideoId(input) {
  if (/^[\w-]{11}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.hostname === "youtu.be") return url.pathname.slice(1);
    if (url.searchParams.has("v")) return url.searchParams.get("v");
    const shortsMatch = url.pathname.match(/\/shorts\/([\w-]{11})/);
    if (shortsMatch) return shortsMatch[1];
  } catch {}
  return null;
}

app.get("/api/captions", async (req, res) => {
  const input = req.query.video || req.query.url || req.query.v;
  if (!input) return res.status(400).json({ error: "Missing ?video= (URL or ID)" });

  const videoId = extractVideoId(input);
  if (!videoId) return res.status(400).json({ error: "Could not parse a video ID" });

  const lang = req.query.lang || "en";

  try {
    const yt = await getClient();
    const info = await yt.getInfo(videoId);

    const tracks = info.captions?.caption_tracks ?? [];
    if (tracks.length === 0) {
      return res.status(404).json({ error: "No captions found for this video" });
    }

    // Prefer requested language, fall back to the first available track
    const track = tracks.find((t) => t.language_code === lang) ?? tracks[0];

    const xmlRes = await yt.session.http.fetch(track.base_url);
    if (!xmlRes.ok) {
      return res.status(502).json({ error: `Caption track fetch failed: ${xmlRes.status}` });
    }
    const xml = await xmlRes.text();
    const debugInfo = {
      baseUrl: track.base_url,
      status: xmlRes.status,
      contentLength: xmlRes.headers.get("content-length"),
      contentType: xmlRes.headers.get("content-type"),
      bodyLength: xml.length,
    };

    // Parse the timedtext XML: <text start="1.2" dur="3.4">Hello there</text>
    const segments = [...xml.matchAll(/<text start="([\d.]+)" dur="([\d.]+)"[^>]*>(.*?)<\/text>/gs)].map(
      (m) => ({
        startMs: Math.round(parseFloat(m[1]) * 1000),
        durMs: Math.round(parseFloat(m[2]) * 1000),
        text: m[3]
          .replace(/&amp;/g, "&")
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .trim(),
      })
    );

    res.json({
      success: true,
      videoId,
      title: info.basic_info?.title ?? null,
      language: track.language_code,
      availableLanguages: tracks.map((t) => t.language_code),
      segments,
      fullText: segments.map((s) => s.text).join(" "),
      _debug: segments.length === 0 ? debugInfo : undefined, // TEMP
    });
  } catch (err) {
    console.error("Caption fetch failed:", err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

app.get("/", (req, res) => res.send("Captions API is running."));

app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
