const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const sarvamBaseUrl = "https://api.sarvam.ai";
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const appVersion = "sarvam-manglish-v2";
const distDir = path.join(process.cwd(), "dist");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg"
};

loadEnvFile();

function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(body);
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": data.length
    });
    res.end(data);
  });
}

function serveStatic(req, res) {
  if (!fs.existsSync(distDir)) {
    sendJson(res, 404, { error: "Frontend build not found. Run npm.cmd run build first." });
    return;
  }

  const requestPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const safePath = path
    .normalize(requestPath === "/" ? "/index.html" : requestPath)
    .replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(distDir, safePath);

  if (!filePath.startsWith(distDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.stat(filePath, (error, stat) => {
    if (!error && stat.isFile()) {
      sendFile(res, filePath);
      return;
    }
    sendFile(res, path.join(distDir, "index.html"));
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error("Multipart boundary is missing.");

  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const raw = buffer.toString("latin1");
  const parts = raw.split(`--${boundary}`);
  const fields = {};
  const files = {};

  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headerText = part.slice(0, headerEnd);
    let content = part.slice(headerEnd + 4);
    if (content.endsWith("\r\n")) content = content.slice(0, -2);
    if (content.endsWith("--")) content = content.slice(0, -2);

    const name = headerText.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;

    const filename = headerText.match(/filename="([^"]*)"/)?.[1];
    const contentTypeMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);

    if (filename !== undefined) {
      files[name] = {
        filename,
        type: contentTypeMatch?.[1] || "application/octet-stream",
        buffer: Buffer.from(content, "latin1")
      };
    } else {
      fields[name] = Buffer.from(content, "latin1").toString("utf8");
    }
  }

  return { fields, files };
}

function requireApiKey() {
  if (!process.env.SARVAM_API_KEY) {
    const error = new Error("SARVAM_API_KEY is missing. Create .env from .env.example and add your key.");
    error.status = 401;
    throw error;
  }
}

async function sarvamFetch(pathname, options) {
  requireApiKey();
  const response = await fetch(`${sarvamBaseUrl}${pathname}`, {
    ...options,
    headers: {
      "api-subscription-key": process.env.SARVAM_API_KEY,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`Sarvam request failed: ${response.status} ${detail}`);
    error.status = response.status;
    throw error;
  }

  return response;
}

async function transcribeAudio(file) {
  const form = new FormData();
  // Strip codec suffix — browser sends "audio/webm;codecs=opus" but Sarvam only accepts "audio/webm"
  const mimeType = (file.type || "audio/webm").split(";")[0].trim();
  const blob = new Blob([file.buffer], { type: mimeType });
  form.append("file", blob, file.filename || "caller-audio.webm");
  form.append("model", process.env.SARVAM_STT_MODEL || "saaras:v3");
  form.append("language_code", process.env.SARVAM_LANGUAGE_CODE || "ml-IN");
  form.append("mode", "transcribe");

  const response = await sarvamFetch("/speech-to-text", {
    method: "POST",
    body: form
  });
  const data = await response.json();
  return data.transcript || "";
}

function normalizeHistory(history = []) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((message) => message && ["user", "assistant"].includes(message.role) && message.content)
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: String(message.content).slice(0, 1000)
    }));
}

function isProbablyRomanizedMalayalam(text) {
  return /^[\x00-\x7F\s.,?!'"-]+$/.test(text) && /[a-z]/i.test(text);
}

function getManglishHint(text) {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const hints = [];

  if (/\b(sukham|sugham|sukhamano|sughamano|sukham aano|sugham aano)\b/.test(normalized)) {
    hints.push("User is asking 'സുഖമാണോ?' meaning 'Are you fine?'.");
  }
  if (/\b(entha|enthanu|enthokke|enthokkeya|enthoke|enthokka)\b/.test(normalized)) {
    hints.push("User is casually asking 'എന്തൊക്കെയാ?' or 'എന്താണ്?' meaning 'What's up?' or 'What can you do?'.");
  }
  if (/\b(namaskaram|halo|hello|hi)\b/.test(normalized)) {
    hints.push("User is greeting the assistant.");
  }
  if (/\b(bill|payment|amount|due|cash)\b/.test(normalized)) {
    hints.push("User may be asking about bill or payment.");
  }
  if (/\b(refund|refunded|return|paisa|money|amount|aayilla|ayilla|kittiyilla|kitiyilla|eppol|eppo|epol|aavum|avum)\b/.test(normalized)) {
    hints.push("User is likely asking about refund status in Manglish. Examples: 'enikk ithuvere refund aayilla' means 'I have not received the refund yet', and 'paisa eppol refund aavum' means 'when will the money be refunded?'. Reply as a customer support assistant in Malayalam and ask for order ID or registered mobile number if needed.");
  }
  if (/\b(net|network|internet|range|data|slow|complaint|problem|issue)\b/.test(normalized)) {
    hints.push("User may be reporting a network or service complaint.");
  }
  if (/\b(appointment|booking|book|slot|nale|naale|tomorrow|ravile|vaikitt)\b/.test(normalized)) {
    hints.push("User may be asking for an appointment or booking.");
  }
  if (/\b(agent|operator|manager|human|aal|orale)\b/.test(normalized)) {
    hints.push("User may want a human agent handoff.");
  }

  if (!hints.length && isProbablyRomanizedMalayalam(text)) {
    hints.push("User may be typing romanized Malayalam, also called Manglish. Understand it as Malayalam and reply in Malayalam script.");
  }

  return hints.join(" ");
}

// Local reply shortcut removed — all messages now go to the AI for real answers

async function generateReply(text, history) {
  const hint = getManglishHint(text);
  const userContent = hint ? `${text}\n\nContext: ${hint}` : text;
  const messages = [
    {
      role: "system",
      content:
        "CRITICAL RULE — MUST FOLLOW: You must ALWAYS write your reply using Malayalam Unicode script characters (ഇംഗ്ലീഷ് അക്ഷരങ്ങൾ ഉപയോഗിക്കരുത്). Do NOT use Roman letters (a-z, A-Z) in your response. Do NOT write Manglish or transliterated Malayalam. Your response must be 100% Malayalam script, like this example: 'നമസ്കാരം! എന്ത് സഹായം വേണം?' — never like 'Namaskaram! Enthu sahaayam venam?'. Even if the user writes in English or Manglish, you must reply in Malayalam script only. You are a helpful AI assistant who can answer any question — general knowledge, math, science, customer support, etc. For customer support topics (billing, refunds, complaints, appointments), ask for order ID or mobile number when needed. Keep answers concise, 1-4 sentences. This is a demo."
    },
    ...normalizeHistory(history),
    { role: "user", content: userContent }
  ];

  const response = await sarvamFetch("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.SARVAM_CHAT_MODEL || "sarvam-30b",
      messages,
      temperature: 0.4,
      max_tokens: 2000
    })
  });
  const data = await response.json();
  const choice = data.choices?.[0]?.message;
  const reply = choice?.content?.trim();
  if (reply) return reply;

  // sarvam-30b is a reasoning model — if content is null but reasoning_content has the answer, extract it
  const reasoning = choice?.reasoning_content?.trim();
  if (reasoning) {
    console.warn("[sarvam-chat] content was null, extracting from reasoning_content");
    // The last meaningful paragraph of reasoning usually contains the final answer
    const lines = reasoning.split("\n").map(l => l.trim()).filter(Boolean);
    const answerLine = lines.slice(-3).join(" ");
    if (answerLine) return answerLine;
  }

  console.error("[sarvam-chat] empty reply, full response:", JSON.stringify(data).slice(0, 500));
  return "ക്ഷമിക്കണം, വീണ്ടും പറയാമോ?";
}

async function synthesizeSpeech(text) {
  // Sarvam bulbul:v3 speaker names must be lowercase.
  // temperature (0.01-2.0) controls expressiveness — higher = more natural, less robotic.
  // enable_preprocessing and pitch/loudness are NOT supported in v3.
  const response = await sarvamFetch("/text-to-speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      target_language_code: process.env.SARVAM_LANGUAGE_CODE || "ml-IN",
      model: process.env.SARVAM_TTS_MODEL || "bulbul:v3",
      speaker: process.env.SARVAM_TTS_SPEAKER || "ritu",
      pace: 1.1,
      temperature: 0.75,
      speech_sample_rate: 44100,
      output_audio_codec: "wav"
    })
  });
  const data = await response.json();
  if (data.audios?.[0]) return data.audios[0];
  console.error("[sarvam-tts] failed:", JSON.stringify(data).slice(0, 300));
  return "";
}

async function answerTurn(text, history) {
  const reply = await generateReply(text, history);
  const audioBase64 = await synthesizeSpeech(reply);
  return {
    transcript: text,
    reply,
    audioBase64,
    audioMimeType: "audio/wav",
    source: "sarvam-chat",
    version: appVersion
  };
}

async function handleVoiceChat(req, res) {
  try {
    const body = await readBody(req);
    const { fields, files } = parseMultipart(body, req.headers["content-type"] || "");

    if (!files.audio) {
      console.error("[voice-chat] No audio field in multipart body.");
      sendJson(res, 400, { error: "No audio file uploaded." });
      return;
    }

    const audioSize = files.audio.buffer?.length || 0;
    console.log(`[voice-chat] Received audio: ${audioSize} bytes, type: ${files.audio.type}`);

    if (audioSize === 0) {
      sendJson(res, 400, { error: "Audio file is empty — recording was too short." });
      return;
    }

    const history = JSON.parse(fields.history || "[]");
    const transcript = await transcribeAudio(files.audio);
    console.log(`[voice-chat] Transcript: "${transcript}"`);

    // If STT returns empty (silence / too short / unclear), reply gracefully
    if (!transcript.trim()) {
      const silenceReply = "ക്ഷമിക്കണം, ശബ്ദം ശരിയായി കേൾക്കാനായില്ല. ദയവായി വീണ്ടും സംസാരിക്കൂ.";
      const audioBase64 = await synthesizeSpeech(silenceReply);
      sendJson(res, 200, {
        transcript: "",
        reply: silenceReply,
        audioBase64,
        audioMimeType: "audio/wav",
        source: "silence-guard",
        version: appVersion
      });
      return;
    }

    const result = await answerTurn(transcript, history);
    sendJson(res, 200, result);
  } catch (err) {
    console.error("[voice-chat] Error:", err.message);
    throw err; // re-throw so outer handler sends the error JSON
  }
}

async function handleTextChat(req, res) {
  const body = await readBody(req);
  const payload = JSON.parse(body.toString("utf8") || "{}");
  const text = String(payload.text || "").trim();
  if (!text) {
    sendJson(res, 400, { error: "Text is required." });
    return;
  }

  const result = await answerTurn(text, payload.history || []);
  sendJson(res, 200, result);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        version: appVersion,
        provider: "sarvam",
        hasApiKey: Boolean(process.env.SARVAM_API_KEY),
        transcribeModel: process.env.SARVAM_STT_MODEL || "saaras:v3",
        chatModel: process.env.SARVAM_CHAT_MODEL || "sarvam-30b",
        ttsModel: process.env.SARVAM_TTS_MODEL || "bulbul:v3",
        languageCode: process.env.SARVAM_LANGUAGE_CODE || "ml-IN"
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/debug-local-reply") {
      const body = await readBody(req);
      const payload = JSON.parse(body.toString("utf8") || "{}");
      const text = String(payload.text || "").trim();
      sendJson(res, 200, {
        text,
        matched: false,
        reply: "(local reply shortcut removed — all messages go to AI)",
        version: appVersion
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/voice-chat") {
      await handleVoiceChat(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/api/text-chat") {
      await handleTextChat(req, res);
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    sendJson(res, error.status || 500, { error: error.message || "Server error" });
  }
});

server.listen(port, host, () => {
  const localUrl = host === "0.0.0.0" ? `http://127.0.0.1:${port}` : `http://${host}:${port}`;
  console.log(`Voice assistant API running at ${localUrl}`);
});
