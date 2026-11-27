"use client";

import { useEffect, useRef, useState } from "react";
import { phrases } from "@/components/voice/phrases";
import { VoicePanel } from "@/components/voice/VoicePanel";
import { useSpeech } from "@/components/voice/useSpeech";
import { useAgentSocket } from "@/hooks/useAgentSocket";
import type { ReplyLanguage } from "@/shared/types";
import { ActionTimeline } from "./ActionTimeline";
import { ApprovalDialog } from "./ApprovalDialog";
import { BackupPanel } from "./BackupPanel";
import { BrowserView, type StageMood } from "./BrowserView";
import { CommandPanel } from "./CommandPanel";
import { ElementList } from "./ElementList";
import { GoalPanel } from "./GoalPanel";
import { LogPanel } from "./LogPanel";
import { StatusBar } from "./StatusBar";

const REPLY_KEY = "nexforce.replyLanguage";
const QUICK_KEY = "nexforce.quickMode";

export default function AgentDashboard() {
  const agent = useAgentSocket();
  const speech = useSpeech({ urduTts: !!agent.voice?.urduTts });
  const [selector, setSelector] = useState("");
  const [conversation, setConversation] = useState(false); // hands-free is always opt-in per session
  const [replyLang, setReplyLangState] = useState<ReplyLanguage>("en");
  const [quickMode, setQuickModeState] = useState(true);

  // Remember preferences, and tell the server so the model follows them.
  useEffect(() => {
    try {
      if (localStorage.getItem(REPLY_KEY) === "ur") setReplyLangState("ur");
      if (localStorage.getItem(QUICK_KEY) === "0") setQuickModeState(false);
    } catch {
      // storage unavailable
    }
  }, []);
  const setReplyLang = (l: ReplyLanguage) => {
    setReplyLangState(l);
    try {
      localStorage.setItem(REPLY_KEY, l);
    } catch {
      // ignore
    }
  };
  const setQuickMode = (on: boolean) => {
    setQuickModeState(on);
    try {
      localStorage.setItem(QUICK_KEY, on ? "1" : "0");
    } catch {
      // ignore
    }
  };
  const { connected, send } = agent;
  useEffect(() => {
    if (!connected) return;
    send({ kind: "set_reply_language", language: replyLang });
    send({ kind: "set_quick_mode", enabled: quickMode });
  }, [connected, replyLang, quickMode, send]);

  const pending = agent.records.find((r) => r.status === "pending_approval");
  const hasVerifiedBackup = agent.backups.some(
    (b) => b.taskId === agent.taskId && b.kind === "filesystem" && b.verified,
  );

  const goal = agent.goal;
  const lastFailed = agent.records.at(-1)?.status === "failed";
  const mood: StageMood = pending
    ? "approval"
    : goal?.status === "failed" || (agent.state === "paused" && lastFailed)
      ? "alert"
      : agent.state === "paused"
        ? "paused"
        : agent.state === "running" || goal?.status === "running" || goal?.status === "planning"
          ? "running"
          : "idle";

  const thinking = goal?.status === "planning" || !!goal?.activity?.startsWith("Thinking");
  const subtitle =
    goal?.status === "waiting_user"
      ? goal.question
      : goal?.status === "planning" || goal?.status === "running"
        ? goal.activity
        : undefined;

  // Spoken announcements in the chosen reply language. Each event is spoken once.
  const spoken = useRef(new Set<string>());
  const { enabled: speakOn, speak } = speech;
  useEffect(() => {
    if (!speakOn) return;
    const P = phrases(replyLang);
    const say = (key: string, text?: string) => {
      if (!text || spoken.current.has(key)) return;
      spoken.current.add(key);
      speak(text);
    };

    if (pending) {
      say(
        `approval:${pending.id}`,
        pending.risk === "destructive" ? P.destructiveAnnounce(pending.target) : P.approvalNeeded(pending.target, conversation),
      );
    }
    if (goal) {
      if (goal.status === "awaiting_plan_approval" && goal.plan) {
        say(`plan:${goal.id}:${goal.plan.summary}`, P.plan(goal.plan.summary, goal.plan.steps.length, conversation));
      }
      if (goal.status === "waiting_user") say(`ask:${goal.id}:${goal.question}`, goal.question);
      if (goal.status === "done") say(`done:${goal.id}`, P.done(goal.result?.split("\n\nFinal page")[0] ?? ""));
      if (goal.status === "failed") say(`failed:${goal.id}`, P.failed(goal.error ?? ""));
    }
  }, [speakOn, speak, goal, pending, conversation, replyLang]);

  return (
    <div className="min-h-screen">
      <StatusBar
        connected={agent.connected}
        state={agent.state}
        browserOpen={agent.browserOpen}
        taskId={agent.taskId}
        approvalMode={agent.approvalMode}
        send={agent.send}
      />

      <main className="grid gap-6 px-5 pb-8 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="min-w-0 space-y-5">
          <BrowserView
            subscribe={agent.subscribeFrames}
            browserOpen={agent.browserOpen}
            connected={agent.connected}
            url={agent.observation?.url}
            mood={mood}
            thinking={thinking}
            subtitle={subtitle}
            onStart={() => agent.send({ kind: "control", command: "start_browser" })}
          />

          <details className="rail-panel group">
            <summary className="cursor-pointer select-none font-display text-xl font-bold tracking-wide text-white">
              Manual controls
            </summary>
            <div className="mt-4 space-y-4">
              <CommandPanel send={agent.send} selector={selector} setSelector={setSelector} disabled={!agent.browserOpen} />
              <ElementList
                observation={agent.observation}
                onUse={setSelector}
                onClick={(sel) => agent.send({ kind: "action", action: { type: "click", selector: sel } })}
              />
            </div>
          </details>
        </section>

        <aside className="min-w-0 space-y-5">
          <VoicePanel
            goal={goal}
            pending={pending}
            agentState={agent.state}
            voice={agent.voice}
            speech={speech}
            connected={agent.connected}
            send={agent.send}
            conversation={conversation}
            setConversation={setConversation}
            replyLang={replyLang}
            setReplyLang={setReplyLang}
            quickMode={quickMode}
            setQuickMode={setQuickMode}
            chatReply={agent.chatReply}
          />
          <GoalPanel goal={goal} models={agent.models} connected={agent.connected} send={agent.send} />
          <ActionTimeline records={agent.records} />
          <BackupPanel backups={agent.backups} send={agent.send} browserOpen={agent.browserOpen} />
          <LogPanel logs={agent.logs} />
        </aside>
      </main>

      {pending && (
        <ApprovalDialog
          key={pending.id}
          record={pending}
          hasVerifiedBackup={hasVerifiedBackup}
          onDecide={(approved, acknowledgeNoBackup) =>
            agent.send({ kind: "approval", actionId: pending.id, approved, acknowledgeNoBackup, via: "click" })
          }
        />
      )}
    </div>
  );
}