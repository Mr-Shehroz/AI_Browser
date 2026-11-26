"use client";

import { useState } from "react";
import { useAgentSocket } from "@/hooks/useAgentSocket";
import { ActionTimeline } from "./ActionTimeline";
import { ApprovalDialog } from "./ApprovalDialog";
import { BackupPanel } from "./BackupPanel";
import { BrowserView, type StageMood } from "./BrowserView";
import { CommandPanel } from "./CommandPanel";
import { ElementList } from "./ElementList";
import { GoalPanel } from "./GoalPanel";
import { LogPanel } from "./LogPanel";
import { StatusBar } from "./StatusBar";

export default function AgentDashboard() {
  const agent = useAgentSocket();
  const [selector, setSelector] = useState("");

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
            agent.send({ kind: "approval", actionId: pending.id, approved, acknowledgeNoBackup })
          }
        />
      )}
    </div>
  );
}