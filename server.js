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

  try {
    const yt = await getClient();
    const info = await yt.getInfo(videoId);
    const transcriptData = await info.getTranscript();

    const segments =
      transcriptData?.transcript?.content?.body?.initial_segments?.map((seg) => ({
        text: seg.snippet?.text ?? "",
        startMs: seg.start_ms,
        endMs: seg.end_ms,
      })) ?? [];

    if (segments.length === 0) {
      return res.status(404).json({ error: "No transcript available for this video" });
    }

    res.json({
      success: true,
      videoId,
      title: info.basic_info?.title ?? null,
      segments,
      fullText: segments.map((s) => s.text).join(" "),
    });
  } catch (err) {
    console.error("Caption fetch failed:", err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

app.get("/", (req, res) => res.send("Captions API is running."));

app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
