"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Free, browser-native voice — no Retell, no paid service.
 *  - Speech-to-text: the Web Speech API (SpeechRecognition), when available.
 *  - Text-to-speech: window.speechSynthesis.
 * You ask for an update out loud (or type), Jarvis answers, and the
 * browser reads the answer back.
 */
export default function VoiceBriefing() {
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState("");
  const [supportsSTT, setSupportsSTT] = useState(true);
  const [briefing, setBriefing] = useState<string | null>(null);
  const recogRef = useRef<any>(null);

  // The worker generates the morning briefing on schedule; pick it up so
  // "Daily briefing" plays instantly (and free) instead of re-asking Claude.
  useEffect(() => {
    fetch("/api/briefing")
      .then((r) => r.json())
      .then((d) => setBriefing(d.briefing?.content || null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const SR =
      (typeof window !== "undefined" && (window as any).SpeechRecognition) ||
      (typeof window !== "undefined" && (window as any).webkitSpeechRecognition);
    if (!SR) {
      setSupportsSTT(false);
      return;
    }
    const r = new SR();
    r.lang = "en-US";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e: any) => {
      const text = e.results[0][0].transcript;
      setTranscript(text);
      ask(text);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recogRef.current = r;
  }, []);

  function speak(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    u.pitch = 1;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    // Prefer a crisp English voice if one is installed.
    const voices = window.speechSynthesis.getVoices();
    const pref =
      voices.find((v) => /Google US English|Samantha|Daniel|Microsoft/i.test(v.name)) ||
      voices.find((v) => v.lang?.startsWith("en"));
    if (pref) u.voice = pref;
    window.speechSynthesis.speak(u);
  }

  async function ask(question: string) {
    setThinking(true);
    setAnswer("");
    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      const text = data.answer || "I couldn't put that together right now.";
      setAnswer(text);
      speak(text);
    } catch {
      setAnswer("Something went wrong reaching Jarvis.");
    } finally {
      setThinking(false);
    }
  }

  async function playBriefing() {
    // Stored briefing → speak immediately. Otherwise generate one now.
    if (briefing) {
      setTranscript("");
      setAnswer(briefing);
      speak(briefing);
      return;
    }
    setThinking(true);
    setAnswer("");
    try {
      const res = await fetch("/api/briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      const text = data.briefing?.content;
      if (text) {
        setBriefing(text);
        setAnswer(text);
        speak(text);
      } else {
        // No Claude key / error — fall back to the live voice endpoint.
        ask("Give me my morning briefing across all my businesses.");
      }
    } catch {
      ask("Give me my morning briefing across all my businesses.");
    } finally {
      setThinking(false);
    }
  }

  function startListening() {
    if (!recogRef.current) return;
    setTranscript("");
    setAnswer("");
    setListening(true);
    try {
      recogRef.current.start();
    } catch {
      /* already started */
    }
  }

  return (
    <div className="card bg-gradient-to-br from-panel to-panel2">
      <div className="flex items-center justify-between">
        <div className="card-title">Ask Jarvis</div>
        <div className="pill">{speaking ? "speaking…" : thinking ? "thinking…" : "voice · free"}</div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={playBriefing} className="btn btn-primary" disabled={thinking}>
          ▶︎ {briefing ? "Play today's briefing" : "Daily briefing"}
        </button>

        {supportsSTT && (
          <button
            onClick={startListening}
            className={`btn ${listening ? "border-accent2/60 text-accent2" : ""}`}
            disabled={thinking}
          >
            {listening ? "● listening…" : "🎤 Ask out loud"}
          </button>
        )}

        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const input = (e.currentTarget.elements.namedItem("q") as HTMLInputElement);
            if (input.value.trim()) ask(input.value.trim());
          }}
        >
          <input name="q" className="input" placeholder="…or type: How's Lenne doing this month?" />
        </form>
      </div>

      {transcript && <p className="mt-3 text-sm text-muted">You: “{transcript}”</p>}
      {answer && <p className="mt-2 text-[15px] leading-relaxed text-white/90">{answer}</p>}
      {!supportsSTT && (
        <p className="mt-3 text-xs text-muted">
          Voice input isn’t supported in this browser — typing still works, and answers are read aloud.
        </p>
      )}
    </div>
  );
}
