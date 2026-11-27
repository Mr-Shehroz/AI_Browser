"use client";

import { useEffect, useRef, useState } from "react";
import { btn, btnDanger, btnPrimary, input, panel, panelTitle } from "@/components/agent/ui";
import type { ChatReply } from "@/hooks/useAgentSocket";
import { AGENT_NAME } from "@/shared/persona";
import type {
  ActionRecord, AgentState, ClientMessage, GoalRun, ReplyLanguage, VoiceLanguage, VoiceStatus,
} from "@/shared/types";
import { classify } from "./intents";
import { phrases } from "./phrases";
import { useHandsFree } from "./useHandsFree";
import { useRecorder } from "./useRecorder";
import type { Speech } from "./useSpeech";
import { transcribe } from "./voice";

const LANGS: { id: VoiceLanguage; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "en", label: "English" },
  { id: "ur", label: "اردو" },
  { id: "ur2en", label: "اردو → English" },
];
const REPLY_LANGS: { id: ReplyLanguage; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ur", label: "اردو" },
];

const LANG_KEY = "nexforce.voiceLanguage";
const LANGUAGE_NAMES: Record<string, string> = { en: "English", ur: "Urdu", hi: "Hindi" };

interface LogLine { id: number; who: "you" | "agent"; text: string }

interface Props {
  goal: GoalRun | null;
  pending: ActionRecord | undefined;
  agentState: AgentState;
  voice: VoiceStatus | null;
  speech: Speech;
  connected: boolean;
  send: (msg: ClientMessage) => void;
  conversation: boolean;
  setConversation: (on: boolean) => void;
  replyLang: ReplyLanguage;
  setReplyLang: (l: ReplyLanguage) => void;
  quickMode: boolean;
  setQuickMode: (on: boolean) => void;
  chatReply: ChatReply | null;
}

function Segmented<T extends string>(props: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={props.label} className="flex flex-wrap gap-1 rounded-full border border-steel bg-night/60 p-1">
      {props.options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={props.value === o.id}
          onClick={() => props.onChange(o.id)}
          disabled={props.disabled}
          className={`flex-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
            props.value === o.id ? "bg-teal text-[#04201d]" : "text-haze hover:text-white"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function VoicePanel({
  goal, pending, agentState, voice, speech, connected, send, conversation, setConversation,
  replyLang, setReplyLang, quickMode, setQuickMode, chatReply,
}: Props) {
  const recorder = useRecorder(60);
  const [lang, setLangState] = useState<VoiceLanguage>("ur2en");
  const [text, setText] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [pendingGoal, setPendingGoal] = useState<string | null>(null);
  const nextId = useRef(0);
  const awaiting = useRef<string | null>(null);
  const P = phrases(replyLang);

  // Remember the spoken language between visits.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved && LANGS.some((l) => l.id === saved)) setLangState(saved as VoiceLanguage);
    } catch {
      // storage unavailable
    }
  }, []);
  const setLang = (l: VoiceLanguage) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      // ignore
    }
  };

  const status = goal?.status;
  const goalActive = !!goal && ["planning", "awaiting_plan_approval", "running", "waiting_user"].includes(goal.status);
  const busy = status === "planning" || status === "running";
  const ready = connected && !!voice?.available;

  const addLog = (who: LogLine["who"], line: string) =>
    setLog((prev) => [...prev.slice(-9), { id: nextId.current++, who, text: line }]);
  const respond = (line: string, force = false) => {
    addLog("agent", line);
    speech.speak(line, force);
  };

  const startGoal = (goalText: string, announce = true) => {
    send({ kind: "goal_start", goal: goalText });
    setPendingGoal(null);
    if (announce) respond(P.onIt);
  };

  // Ask Zoya's "brain": is this small talk, or a task for the browser?
  const askCompanion = (heard: string) => {
    const requestId = `c${Date.now()}`;
    awaiting.current = requestId;
    setThinking(true);
    send({ kind: "chat", text: heard, requestId });
    setTimeout(() => {
      if (awaiting.current === requestId) {
        awaiting.current = null;
        setThinking(false);
      }
    }, 90_000);
  };

  useEffect(() => {
    if (!chatReply || chatReply.requestId !== awaiting.current) return;
    awaiting.current = null;
    setThinking(false);
    if (!chatReply.task) {
      respond(chatReply.reply);
    } else if (quickMode) {
      respond(chatReply.reply);
      startGoal(chatReply.task, false);
    } else {
      setPendingGoal(chatReply.task);
      respond(`${chatReply.reply} ${P.shallIStart}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatReply]);

  // ---------- Conversation mode ----------
  const handleConversation = (heard: string) => {
    const intent = classify(heard);
    if (intent === "noise") return;
    addLog("you", heard);

    if (intent === "stop") {
      setPendingGoal(null);
      send(goalActive ? { kind: "goal_stop" } : { kind: "control", command: "stop" });
      return respond(P.stopped);
    }
    if (intent === "pause") {
      send({ kind: "control", command: "pause" });
      return respond(P.paused);
    }
    if (intent === "resume") {
      if (agentState !== "paused") return respond(P.notPaused);
      send({ kind: "control", command: "resume" });
      return respond(P.resumed);
    }

    if (pending) {
      if (pending.risk === "destructive") return respond(P.destructiveVoice);
      if (intent === "yes") {
        send({ kind: "approval", actionId: pending.id, approved: true, via: "voice" });
        return respond(P.approved);
      }
      if (intent === "no") {
        send({ kind: "approval", actionId: pending.id, approved: false, via: "voice" });
        return respond(P.skipped);
      }
      return respond(P.sayYesNo);
    }

    if (status === "awaiting_plan_approval") {
      if (intent === "yes") {
        send({ kind: "goal_plan_decision", approved: true });
        return respond(P.planStart);
      }
      if (intent === "no") {
        send({ kind: "goal_plan_decision", approved: false });
        return respond(P.planDropped);
      }
      send({ kind: "goal_plan_decision", approved: false, feedback: heard });
      return respond(P.planRework);
    }

    if (status === "waiting_user") {
      send({ kind: "goal_reply", text: heard });
      return respond(P.replyThanks);
    }

    if (busy) return respond(P.busy);

    if (pendingGoal) {
      if (intent === "yes") return startGoal(pendingGoal);
      if (intent === "no") {
        setPendingGoal(null);
        return respond(P.scratch);
      }
    }

    askCompanion(heard);
  };

  const processSegment = async (wav: Blob) => {
    setTranscribing(true);
    setError(null);
    try {
      const r = await transcribe(wav, lang);
      handleConversation(r.text);
    } catch (err) {
      const m = err instanceof Error ? err.message : "Transcription failed.";
      if (!/didn't catch any words|too short/i.test(m)) setError(m);
    } finally {
      setTranscribing(false);
    }
  };

  const handsFree = useHandsFree({
    enabled: conversation && ready,
    paused: transcribing || thinking || speech.speaking,
    onSegment: (wav) => void processSegment(wav),
    onError: (m) => {
      setError(m);
      setConversation(false);
    },
  });

  // ---------- Push-to-talk mode: review before sending ----------
  const handlePushToTalk = (heard: string, language: string, translated: boolean) => {
    const intent = classify(heard);
    if (intent === "stop") {
      send(goalActive ? { kind: "goal_stop" } : { kind: "control", command: "stop" });
      setNotice(`Heard "${heard}", so I stopped.`);
      return;
    }
    if (intent === "pause") {
      send({ kind: "control", command: "pause" });
      setNotice(`Heard "${heard}", so I paused. Press Resume when you're ready.`);
      return;
    }
    setText((prev) => (prev ? `${prev} ${heard}` : heard));
    setNotice(
      translated
        ? "Translated from Urdu. Check the wording, then choose what to do."
        : `Heard (${LANGUAGE_NAMES[language] ?? language}). Check the wording, then choose what to do.`,
    );
  };

  const toggleMic = async () => {
    setError(null);
    if (recorder.recording) {
      recorder.stop();
      return;
    }
    speech.cancel();
    setNotice(null);
    try {
      await recorder.start(async (wav) => {
        if (!wav) {
          setError("That was too short. Click the microphone, speak, then click it again.");
          return;
        }
        setTranscribing(true);
        try {
          const r = await transcribe(wav, lang);
          handlePushToTalk(r.text, r.language, r.translated);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Transcription failed.");
        } finally {
          setTranscribing(false);
        }
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "Microphone access is blocked. Click the icon at the left of Chrome's address bar, allow the microphone, then try again."
          : name === "NotFoundError"
            ? "No microphone was found. Plug one in or check Windows sound settings."
            : "Couldn't start the microphone.",
      );
    }
  };

  const submit = (msg: ClientMessage) => {
    send(msg);
    setText("");
    setNotice(null);
  };

  const chooseMode = (on: boolean) => {
    setError(null);
    if (on && !conversation) {
      if (recorder.recording) recorder.stop();
      speech.setEnabled(true);
      setLog([]);
      setPendingGoal(null);
      respond(P.greeting, true);
    }
    if (!on) setPendingGoal(null);
    setConversation(on);
  };

  const trimmed = text.trim();
  const mins = Math.floor(recorder.seconds / 60);
  const secs = String(Math.floor(recorder.seconds % 60)).padStart(2, "0");

  const convoLabel = speech.speaking
    ? `${AGENT_NAME} is talking`
    : thinking
      ? `${AGENT_NAME} is thinking…`
      : transcribing
        ? "Working out what you said…"
        : handsFree.inSpeech
          ? "Hearing you…"
          : handsFree.listening
            ? "Listening. Just talk."
            : "Starting the microphone…";
  const convoColor = speech.speaking
    ? "bg-steel text-haze"
    : thinking || transcribing
      ? "bg-amber text-[#2a1600]"
      : handsFree.inSpeech
        ? "bg-ember text-white shadow-[0_0_30px_-4px_var(--color-ember)]"
        : "bg-teal text-[#04201d]";

  return (
    <div className={`${panel} space-y-4`}>
      <div className="flex items-center justify-between">
        <h2 className={panelTitle}>Talk to {AGENT_NAME}</h2>
        {conversation && handsFree.listening && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-ember">
            <span className="h-2 w-2 animate-pulse rounded-full bg-ember" aria-hidden />
            Microphone on
          </span>
        )}
      </div>

      {voice && !voice.available ? (
        <div className="space-y-1 rounded-lg border border-amber/40 bg-amber/5 p-3 text-xs text-haze">
          <p className="font-semibold text-amber">Speech recognition isn&apos;t set up</p>
          <p>{voice.error}</p>
        </div>
      ) : (
        <>
          <Segmented
            label="Voice mode"
            options={[
              { id: "on", label: "Conversation" },
              { id: "off", label: "Push to talk" },
            ]}
            value={conversation ? "on" : "off"}
            onChange={(v) => chooseMode(v === "on")}
            disabled={!ready}
          />

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-white">You speak</p>
            <Segmented label="Language you speak" options={LANGS} value={lang} onChange={setLang} disabled={recorder.recording || transcribing} />
            {lang === "ur" && (
              <p className="text-xs text-amber">
                Tip: &quot;اردو → English&quot; is usually more accurate. {AGENT_NAME} can still reply in Urdu.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-white">{AGENT_NAME} replies in</p>
            <Segmented label={`${AGENT_NAME} replies in`} options={REPLY_LANGS} value={replyLang} onChange={setReplyLang} />
            {replyLang === "ur" && !speech.canSpeakUrdu && (
              <p className="text-xs text-amber">
                {voice?.urduTtsError ?? "No Urdu voice is set up yet, so Urdu replies are shown but not spoken."}
              </p>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm text-white">
            <input
              type="checkbox"
              className="mt-1 accent-[var(--color-teal)]"
              checked={quickMode}
              onChange={(e) => setQuickMode(e.target.checked)}
            />
            <span>
              Quick mode
              <span className="block text-xs text-dim">No plan: {AGENT_NAME} starts right away. Risky steps still ask you first.</span>
            </span>
          </label>

          {conversation ? (
            <>
              <div className="flex items-center gap-4">
                <div className={`grid h-16 w-16 shrink-0 place-items-center rounded-full transition-all ${convoColor}`} aria-hidden>
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-sm font-semibold text-white" aria-live="polite">{convoLabel}</p>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
                    <div className="h-full bg-teal transition-[width] duration-100" style={{ width: `${Math.round(handsFree.level * 100)}%` }} />
                  </div>
                  <p className="text-xs text-dim">Chat with her or ask for something. Pause for a second when you finish.</p>
                </div>
              </div>

              {pendingGoal && (
                <div className="space-y-2 rounded-lg border border-amber/45 bg-amber/5 p-3">
                  <p className="text-xs font-semibold text-amber">Waiting for your yes</p>
                  <p dir="auto" className="text-sm text-white">{pendingGoal}</p>
                  <div className="flex gap-2">
                    <button className={btnPrimary} onClick={() => startGoal(pendingGoal)}>Start</button>
                    <button className={btn} onClick={() => setPendingGoal(null)}>Cancel</button>
                  </div>
                </div>
              )}

              {log.length > 0 && (
                <ol className="max-h-64 space-y-1.5 overflow-auto pr-1 text-sm" aria-label="Conversation">
                  {log.map((l) => (
                    <li key={l.id} dir="auto" className={l.who === "you" ? "text-white" : "text-teal"}>
                      <span className="mx-1.5 text-xs font-semibold text-dim">{l.who === "you" ? "You" : AGENT_NAME}</span>
                      {l.text}
                    </li>
                  ))}
                </ol>
              )}

              {error && <p className="text-sm text-ember" role="alert">{error}</p>}

              <button className={`${btnDanger} w-full`} onClick={() => chooseMode(false)}>Stop listening</button>
              <p className="text-xs leading-relaxed text-dim">
                The microphone stays on while Conversation is selected. Steps that can&apos;t easily be undone still need a click.
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={toggleMic}
                  disabled={!ready || transcribing}
                  aria-pressed={recorder.recording}
                  aria-label={recorder.recording ? "Stop recording" : "Start recording"}
                  className={`grid h-16 w-16 shrink-0 place-items-center rounded-full transition-all disabled:opacity-40 ${
                    recorder.recording
                      ? "bg-ember text-white shadow-[0_0_30px_-4px_var(--color-ember)]"
                      : "bg-teal text-[#04201d] hover:shadow-[0_0_26px_-4px_var(--color-teal)]"
                  }`}
                >
                  {recorder.recording ? (
                    <span className="h-5 w-5 rounded-sm bg-white" aria-hidden />
                  ) : (
                    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <rect x="9" y="3" width="6" height="11" rx="3" />
                      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-sm font-semibold text-white">
                    {recorder.recording
                      ? `Listening ${mins}:${secs}. Click again when you're done.`
                      : transcribing
                        ? "Turning speech into text…"
                        : "Click the microphone and speak."}
                  </p>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
                    <div className="h-full bg-teal transition-[width] duration-100" style={{ width: `${Math.round(recorder.level * 100)}%` }} />
                  </div>
                </div>
              </div>

              {error && <p className="text-sm text-ember" role="alert">{error}</p>}
              {notice && <p className="text-xs text-teal" aria-live="polite">{notice}</p>}

              <textarea
                dir="auto"
                className={`${input} min-h-20 resize-y text-[15px] leading-relaxed`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Your words appear here. Fix anything misheard before sending."
                aria-label="Transcript"
              />

              <div className="flex flex-wrap gap-2">
                {status === "waiting_user" ? (
                  <button className={btnPrimary} disabled={!trimmed} onClick={() => submit({ kind: "goal_reply", text: trimmed })}>
                    Send as answer
                  </button>
                ) : status === "awaiting_plan_approval" ? (
                  <button className={btnPrimary} disabled={!trimmed} onClick={() => submit({ kind: "goal_plan_decision", approved: false, feedback: trimmed })}>
                    Ask to revise the plan
                  </button>
                ) : (
                  <button className={btnPrimary} disabled={!trimmed || busy || trimmed.length < 3} onClick={() => submit({ kind: "goal_start", goal: trimmed })}>
                    Start as goal
                  </button>
                )}
                <button className={btn} disabled={!text} onClick={() => { setText(""); setNotice(null); }}>Clear</button>
              </div>
            </>
          )}
        </>
      )}

      <div className="space-y-2 border-t border-white/5 pt-3">
        <label className="flex items-center gap-2 text-sm text-white">
          <input
            type="checkbox"
            className="accent-[var(--color-teal)]"
            checked={speech.enabled}
            disabled={conversation}
            onChange={(e) => speech.setEnabled(e.target.checked)}
          />
          {AGENT_NAME} speaks her replies{conversation ? " (always on in Conversation)" : ""}
        </label>

        {replyLang === "en" && speech.englishVoices.length > 0 && (
          <select
            className={input}
            value={speech.currentEnglishVoice ?? ""}
            onChange={(e) => speech.setVoiceName(e.target.value)}
            aria-label={`${AGENT_NAME}'s English voice`}
          >
            {speech.englishVoices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name.replace(/^Microsoft\s+/, "").replace(/\s+-\s+.*$/, "")} ({v.lang})
              </option>
            ))}
          </select>
        )}
        <div className="flex flex-wrap gap-2">
          <button className={btn} onClick={() => speech.preview(replyLang)}>Hear {AGENT_NAME}</button>
          {speech.speaking && <button className={btn} onClick={speech.cancel}>Stop speaking</button>}
        </div>
        {speech.error && <p className="text-xs text-ember" role="alert">Couldn&apos;t play {AGENT_NAME}&apos;s voice: {speech.error}</p>}
      </div>

      <p className="text-xs leading-relaxed text-dim">
        Speech is turned into text, and Urdu speech is made, on this computer. Recordings are deleted right after.
      </p>
    </div>
  );
}