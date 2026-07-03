import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Bot,
  CheckCircle2,
  Clock3,
  Headphones,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  PhoneCall,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Timer,
  TrendingUp,
  UserRound,
  Volume2,
  VolumeX,
  WalletCards,
  Zap
} from "lucide-react";
import "./styles.css";

const API_BASE =
  window.__VOICE_API_BASE__ ||
  (["5173", "5174", "5175"].includes(window.location.port) ? "http://127.0.0.1:8787" : "");

const flows = [
  {
    id: "bill",
    label: "Bill & Payment",
    icon: WalletCards,
    chips: ["ബിൽ എത്രയാണ്?", "പേയ്‌മെന്റ് സ്റ്റാറ്റസ്", "അവസാന തീയതി"],
    keywords: ["bill", "payment", "amount", "ബിൽ", "പേയ്", "തുക", "കുടിശ്ശിക", "due"]
  },
  {
    id: "complaint",
    label: "Service Complaint",
    icon: ShieldCheck,
    chips: ["നെറ്റ്‌വർക്ക് പ്രശ്നം", "പരാതി നൽകണം", "സർവീസ് ഇല്ല"],
    keywords: ["complaint", "issue", "problem", "network", "service", "പരാതി", "പ്രശ്നം", "സർവീസ്", "നെറ്റ്"]
  },
  {
    id: "appointment",
    label: "Appointment",
    icon: Clock3,
    chips: ["അപ്പോയിന്റ്മെന്റ് വേണം", "നാളെ സമയം ഉണ്ടോ?", "ബുക്കിംഗ് മാറ്റണം"],
    keywords: ["appointment", "booking", "schedule", "book", "അപ്പോ", "ബുക്ക", "നാളെ", "സമയം", "സ്ലോട്ട്"]
  },
  {
    id: "agent",
    label: "Agent Handoff",
    icon: Headphones,
    chips: ["ഓപ്പറേറ്ററോട് സംസാരിക്കണം", "മാനേജറെ തരൂ", "ഹ്യൂമൻ ഏജന്റ്"],
    keywords: ["agent", "operator", "human", "manager", "ഓപ്പറേറ്റർ", "മാനേജർ", "ഏജന്റ്", "മനുഷ്യൻ"]
  }
];

const demoUtterances = [
  "എന്റെ ബിൽ എത്രയാണ്?",
  "നെറ്റ്‌വർക്ക് രണ്ടു ദിവസമായി ലഭിക്കുന്നില്ല",
  "നാളെ വൈകിട്ട് ഒരു അപ്പോയിന്റ്മെന്റ് വേണം",
  "എനിക്ക് ഓപ്പറേറ്ററോട് സംസാരിക്കണം"
];

const initialMessages = [
  {
    speaker: "assistant",
    text: "നമസ്കാരം. ഞാൻ മലയാളത്തിൽ സംസാരിക്കുന്ന AI വോയ്സ് അസിസ്റ്റന്റാണ്. മൈക്ക് അമർത്തി മലയാളത്തിൽ സംസാരിക്കൂ."
  }
];

function detectIntent(text) {
  const normalized = text.toLowerCase();
  const scored = flows
    .map((flow) => ({
      ...flow,
      score: flow.keywords.reduce((s, w) => s + (normalized.includes(w.toLowerCase()) ? 1 : 0), 0)
    }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0] : null;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function toApiHistory(messages) {
  return messages
    .filter((m) => m.text && m !== initialMessages[0])
    .map((m) => ({ role: m.speaker === "assistant" ? "assistant" : "user", content: m.text }))
    .slice(-8);
}

function getBestMimeType() {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/wav"];
  return options.find((t) => window.MediaRecorder?.isTypeSupported(t)) || "";
}

function App() {
  const [messages, setMessages] = useState(initialMessages);
  const [typedText, setTypedText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [activeIntent, setActiveIntent] = useState(null);
  const [callState, setCallState] = useState("ready");
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [serverStatus, setServerStatus] = useState("checking");
  const [lastSource, setLastSource] = useState("");
  const [pendingAudio, setPendingAudio] = useState(null);
  const [sessionStats, setSessionStats] = useState({ turns: 0, wordCount: 0, avgResponseMs: 0, lastResponseMs: 0, sessionStart: null });
  const responseTimerRef = useRef(null);
  const [sessionElapsed, setSessionElapsed] = useState(0);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const transcriptRef = useRef(null);
  const messagesRef = useRef(initialMessages);
  const audioUrlRef = useRef("");

  const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

  const stats = useMemo(() => {
    const callsPerDay = 6000;
    const avgMinutes = 3;
    const automationRate = 0.68;
    const totalMinutes = callsPerDay * avgMinutes;
    return {
      callsPerDay,
      totalHours: Math.round(totalMinutes / 60),
      automatedCalls: Math.round(callsPerDay * automationRate),
      agentHoursSaved: Math.round((totalMinutes * automationRate) / 60)
    };
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => r.json())
      .then((d) => setServerStatus(d.hasApiKey ? "ready" : "missing-key"))
      .catch(() => setServerStatus("offline"));
  }, []);

  // Session elapsed timer
  useEffect(() => {
    if (!sessionStats.sessionStart) return;
    const id = setInterval(() => setSessionElapsed(Math.floor((Date.now() - sessionStats.sessionStart) / 1000)), 1000);
    return () => clearInterval(id);
  }, [sessionStats.sessionStart]);

  function createAudioUrl(audioBase64, audioMimeType) {
    const binary = atob(audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const blob = new Blob([bytes], { type: audioMimeType || "audio/wav" });
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = URL.createObjectURL(blob);
    return audioUrlRef.current;
  }

  async function playAudioUrl(url) {
    const audio = new Audio(url);
    audio.playsInline = true;
    await audio.play();
  }

  function playApiAudio(audioBase64, audioMimeType) {
    if (!audioBase64) return;
    const url = createAudioUrl(audioBase64, audioMimeType);
    setPendingAudio({ url, mimeType: audioMimeType || "audio/wav" });
    if (muted) return;
    playAudioUrl(url)
      .then(() => setPendingAudio(null))
      .catch(() => {
        setError("Mobile browser blocked automatic audio. Tap 'Play latest reply' below.");
      });
  }

  function playPendingAudio() {
    if (!pendingAudio?.url) return;
    setError("");
    playAudioUrl(pendingAudio.url)
      .then(() => setPendingAudio(null))
      .catch(() => setError("Could not play audio. Check phone volume/silent mode and try again."));
  }

  function updateConversation(transcript, reply, audioBase64, audioMimeType) {
    const intent = detectIntent(`${transcript} ${reply}`);
    setActiveIntent(intent);
    const elapsed = responseTimerRef.current ? Date.now() - responseTimerRef.current : 0;
    responseTimerRef.current = null;
    const words = (transcript + " " + reply).split(/\s+/).filter(Boolean).length;
    setSessionStats((prev) => {
      const turns = prev.turns + 1;
      const totalMs = prev.avgResponseMs * prev.turns + elapsed;
      return {
        turns,
        wordCount: prev.wordCount + words,
        avgResponseMs: Math.round(totalMs / turns),
        lastResponseMs: elapsed,
        sessionStart: prev.sessionStart || Date.now()
      };
    });
    setMessages((cur) => [
      ...cur,
      { speaker: "caller", text: transcript },
      { speaker: "assistant", text: reply }
    ]);
    playApiAudio(audioBase64, audioMimeType);
  }

  async function sendVoice(blob) {
    setIsThinking(true);
    setCallState("active");
    setError("");
    responseTimerRef.current = Date.now();
    try {
      const form = new FormData();
      form.append("audio", blob, "caller-audio.webm");
      form.append("history", JSON.stringify(toApiHistory(messagesRef.current)));
      const res = await fetch(`${API_BASE}/api/voice-chat`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Voice request failed.");
      setLastSource(data.source || "");
      updateConversation(data.transcript, data.reply, data.audioBase64, data.audioMimeType);
    } catch (e) {
      setError(e.message);
    } finally {
      setIsThinking(false);
    }
  }

  async function sendText(text) {
    setIsThinking(true);
    setCallState("active");
    setError("");
    responseTimerRef.current = Date.now();
    const history = toApiHistory(messagesRef.current);
    // Optimistically show the user's message
    setMessages((cur) => [...cur, { speaker: "caller", text }]);
    try {
      const res = await fetch(`${API_BASE}/api/text-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, history })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Text request failed.");
      setLastSource(data.source || "");
      // Track intent and update stats + add assistant reply
      const intent = detectIntent(`${text} ${data.reply}`);
      setActiveIntent(intent);
      const elapsed = responseTimerRef.current ? Date.now() - responseTimerRef.current : 0;
      responseTimerRef.current = null;
      const words = (text + " " + data.reply).split(/\s+/).filter(Boolean).length;
      setSessionStats((prev) => {
        const turns = prev.turns + 1;
        const totalMs = prev.avgResponseMs * prev.turns + elapsed;
        return {
          turns,
          wordCount: prev.wordCount + words,
          avgResponseMs: Math.round(totalMs / turns),
          lastResponseMs: elapsed,
          sessionStart: prev.sessionStart || Date.now()
        };
      });
      setMessages((cur) => [...cur, { speaker: "assistant", text: data.reply }]);
      playApiAudio(data.audioBase64, data.audioMimeType);
    } catch (e) {
      setError(e.message);
    } finally {
      setIsThinking(false);
    }
  }


  async function startRecording() {
    if (!canRecord || isThinking) return;
    setError("");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    audioChunksRef.current = [];
    const mimeType = getBestMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = recorder;
    recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (blob.size < 1000) {
        // Less than 1KB means no real audio was captured
        setError("Recording too short or microphone not capturing audio. Hold the button while speaking.");
        setIsThinking(false);
        return;
      }
      sendVoice(blob);
    };
    recorder.start();
    setIsRecording(true);
    setCallState("active");
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }

  function toggleRecording() {
    if (isRecording) { stopRecording(); return; }
    startRecording().catch((e) => setError(e.message));
  }

  function submitTypedText(e) {
    e.preventDefault();
    const text = typedText.trim();
    if (!text || isThinking) return;
    setTypedText("");
    sendText(text);
  }

  function resetCall() {
    mediaRecorderRef.current?.state === "recording" && mediaRecorderRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    messagesRef.current = initialMessages;
    setMessages(initialMessages);
    setActiveIntent(null);
    setCallState("ready");
    setTypedText("");
    setIsRecording(false);
    setIsThinking(false);
    setError("");
    setLastSource("");
    setPendingAudio(null);
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }
    setSessionStats({ turns: 0, wordCount: 0, avgResponseMs: 0, lastResponseMs: 0, sessionStart: null });
    setSessionElapsed(0);
    responseTimerRef.current = null;
  }

  const statusLabel = isThinking ? "Processing" : isRecording ? "Recording" : callState === "active" ? "Live" : "Ready";

  return (
    <div className="app-shell">
      {/* ── Top Navigation ── */}
      <nav className="top-nav">
        <div className="nav-logo">
          <div className="nav-logo-icon"><Zap size={16} /></div>
          <div className="nav-logo-text">Voice<span>AI</span></div>
        </div>
        <div className="nav-divider" />
        <div className="nav-badge">
          <span className="nav-badge-dot" />
          Malayalam · ml-IN
        </div>
        <div className="nav-right">
          <div className={`status-pill ${callState === "active" || isRecording ? "active" : "ready"}`}>
            {isThinking ? <Loader2 size={14} className="spin" /> : <Activity size={14} />}
            {statusLabel}
          </div>
        </div>
      </nav>

      {/* ── Left: Call Panel ── */}
      <main className="call-panel">
        {/* Header */}
        <div className="hero-strip">
          <p className="eyebrow">AI Voice Assistant · Demo</p>
          <h1>Malayalam <span>Call AI</span></h1>
          <p className="hero-sub">
            Speak Malayalam naturally. The AI transcribes, understands, and replies in spoken Malayalam.
          </p>
        </div>

        {/* AI Orb Stage */}
        <div className="assistant-stage">
          <div className="grid-overlay" />
          <div className="orbital-visual">
            <div className={`voice-core ${isRecording ? "recording" : ""}`}>
              {isThinking ? <Loader2 size={28} className="spin" /> : isRecording ? <MicOff size={28} /> : <Volume2 size={28} />}
            </div>
            <span className="wave wave-one" />
            <span className="wave wave-two" />
            <span className="wave wave-three" />
          </div>
          <div className="stage-copy">
            <h2>Speak Malayalam.<br />Hear Malayalam back.</h2>
            <p>
              Press Record, speak your query in Malayalam or Manglish. The AI understands and responds with natural spoken Malayalam audio.
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="control-row">
          <button
            className={`primary-action ${isRecording ? "recording" : ""}`}
            onClick={toggleRecording}
            disabled={!canRecord || isThinking}
            id="record-btn"
          >
            {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
            {isRecording ? "Stop & Send" : isThinking ? "Processing…" : "Record Malayalam"}
          </button>
          <button
            className={`icon-action ${muted ? "active" : ""}`}
            onClick={() => setMuted((v) => !v)}
            title={muted ? "Unmute" : "Mute audio"}
            id="mute-btn"
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <button className="icon-action" onClick={resetCall} title="Reset conversation" id="reset-btn">
            <RotateCcw size={18} />
          </button>
        </div>

        {/* Server status warnings */}
        {serverStatus === "offline" && (
          <div className="support-note">
            Backend offline — run <code>npm run server</code> in a terminal.
          </div>
        )}
        {serverStatus === "missing-key" && (
          <div className="support-note">
            Backend running but <code>SARVAM_API_KEY</code> is missing in <code>.env</code>.
          </div>
        )}
        {!canRecord && (
          <div className="support-note info">
            Microphone unavailable in this browser. Use Chrome or Edge, or type below.
          </div>
        )}
        {error && <div className="support-note" id="error-note">{error}</div>}
        {pendingAudio && (
          <button className="manual-play-action" type="button" onClick={playPendingAudio}>
            <Volume2 size={17} />
            Play latest reply
          </button>
        )}

        {/* Quick demo buttons */}
        <div className="quick-grid">
          {demoUtterances.map((u) => (
            <button key={u} onClick={() => sendText(u)} disabled={isThinking} id={`demo-${u.slice(0, 8)}`}>
              <Play size={13} />
              {u}
            </button>
          ))}
        </div>

        {/* Text input */}
        <form className="type-box" onSubmit={submitTypedText}>
          <input
            id="text-input"
            value={typedText}
            onChange={(e) => setTypedText(e.target.value)}
            placeholder="Type in Malayalam or Manglish…"
            disabled={isThinking}
          />
          <button type="submit" id="send-btn" title="Send" disabled={isThinking}>
            <Send size={17} />
          </button>
        </form>
      </main>

      {/* ── Right: Insight Panel ── */}
      <aside className="insight-panel">
        {/* Metrics */}
        <div className="metric-band" aria-label="Business impact">
          <div>
            <span>Daily Calls</span>
            <strong>{formatNumber(stats.callsPerDay)}</strong>
          </div>
          <div>
            <span>Agent Hours/Day</span>
            <strong>{stats.totalHours}</strong>
          </div>
          <div>
            <span>Automated Calls</span>
            <strong>{formatNumber(stats.automatedCalls)}</strong>
          </div>
          <div>
            <span>Hours Saved/Day</span>
            <strong>{stats.agentHoursSaved}</strong>
          </div>
        </div>

        {/* Intent Detection */}
        <div className="section-block">
          <div className="section-heading">
            <Sparkles size={15} />
            <h2>Detected Intent</h2>
          </div>
          <div className="intent-list">
            {flows.map((flow) => {
              const Icon = flow.icon;
              const active = activeIntent?.id === flow.id;
              return (
                <div className={`intent-item ${active ? "active" : ""}`} key={flow.id}>
                  <Icon size={17} />
                  <div>
                    <strong>{flow.label}</strong>
                    <span>{flow.chips.join(" · ")}</span>
                  </div>
                  {active && <CheckCircle2 size={16} className="check-icon" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Session Stats */}
        <div className="section-block">
          <div className="section-heading">
            <TrendingUp size={15} />
            <h2>Live Session Stats</h2>
          </div>
          <div className="session-stats-grid">
            <div className="stat-card">
              <div className="stat-icon"><Timer size={15} /></div>
              <div className="stat-value">
                {sessionStats.sessionStart
                  ? `${Math.floor(sessionElapsed / 60)}:${String(sessionElapsed % 60).padStart(2, "0")}`
                  : "0:00"}
              </div>
              <div className="stat-label">Session Time</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon"><MessageSquare size={15} /></div>
              <div className="stat-value">{sessionStats.turns}</div>
              <div className="stat-label">Turns</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon"><Activity size={15} /></div>
              <div className="stat-value">
                {sessionStats.avgResponseMs > 0 ? `${(sessionStats.avgResponseMs / 1000).toFixed(1)}s` : "—"}
              </div>
              <div className="stat-label">Avg Response</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon"><Sparkles size={15} /></div>
              <div className="stat-value">{sessionStats.wordCount}</div>
              <div className="stat-label">Words</div>
            </div>
          </div>
          {sessionStats.lastResponseMs > 0 && (
            <div className="response-bar-wrap">
              <div className="response-bar-label">
                <span>Last response</span>
                <span className="response-bar-time">{(sessionStats.lastResponseMs / 1000).toFixed(1)}s</span>
              </div>
              <div className="response-bar-track">
                <div
                  className="response-bar-fill"
                  style={{ width: `${Math.min(100, (sessionStats.lastResponseMs / 8000) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Live Transcript */}
        <div className="transcript-card">
          <div className="section-heading">
            <PhoneCall size={15} />
            <h2>Live Transcript</h2>
          </div>
          <div className="transcript" ref={transcriptRef}>
            {messages.map((msg, i) => (
              <div className={`message ${msg.speaker}`} key={`${msg.speaker}-${i}`}>
                <div className="avatar">
                  {msg.speaker === "assistant" ? <Bot size={14} /> : <UserRound size={14} />}
                </div>
                <p>{msg.text}</p>
              </div>
            ))}
            {isThinking && (
              <div className="message assistant">
                <div className="avatar"><Bot size={14} /></div>
                <div className="thinking-dots">
                  <span /><span /><span />
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
