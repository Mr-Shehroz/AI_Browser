"use client";

import { useState } from "react";
import type { ClientMessage, GoalRun, GoalStatus, ModelsInfo } from "@/shared/types";
import { AgentSteps } from "./AgentSteps";
import { PlanCard } from "./PlanCard";
import { btn, btnDanger, btnPrimary, input, panel, panelTitle } from "./ui";

interface Props {
  goal: GoalRun | null;
  models: ModelsInfo | null;
  connected: boolean;
  send: (msg: ClientMessage) => void;
}

const ACTIVE: GoalStatus[] = ["planning", "awaiting_plan_approval", "running", "waiting_user"];

const statusLabel: Record<GoalStatus, string> = {
  planning: "Planning",
  awaiting_plan_approval: "Plan ready",
  running: "Running",
  waiting_user: "Needs you",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

const statusStyle: Record<GoalStatus, string> = {
  planning: "bg-teal/10 text-teal",
  awaiting_plan_approval: "bg-amber/15 text-amber",
  running: "bg-teal/10 text-teal",
  waiting_user: "bg-amber/15 text-amber",
  done: "bg-teal/15 text-teal",
  failed: "bg-ember/15 text-ember",
  stopped: "bg-dim/15 text-dim",
};

export function GoalPanel({ goal, models, connected, send }: Props) {
  const [text, setText] = useState("");
  const [model, setModel] = useState("");
  const [reply, setReply] = useState("");

  const active = !!goal && ACTIVE.includes(goal.status);
  const selected = model || models?.defaultModel || "";
  const options = Array.from(new Set([...(models?.models ?? []), ...(models?.defaultModel ? [models.defaultModel] : [])]));

  return (
    <div className={`${panel} space-y-4`}>
      <div className="flex items-center justify-between">
        <h2 className={panelTitle}>Goal</h2>
        {goal && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyle[goal.status]}`}>
            {statusLabel[goal.status]}
          </span>
        )}
      </div>

      {models?.error && <p className="text-xs text-amber">{models.error}</p>}

      <textarea
        className={`${input} min-h-24 resize-y text-[15px] leading-relaxed`}
        value={text}
        disabled={active}
        onChange={(e) => setText(e.target.value)}
        placeholder="Open playwright.dev and find the install command for Node.js"
      />

      <div className="flex gap-2">
        <select className={input} value={selected} disabled={active} onChange={(e) => setModel(e.target.value)} aria-label="Model">
          {options.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button className={btn} aria-label="Refresh models" onClick={() => send({ kind: "models_refresh" })}>↻</button>
        {active ? (
          <button className={btnDanger} onClick={() => send({ kind: "goal_stop" })}>Stop</button>
        ) : (
          <button
            className={`${btnPrimary} px-6`}
            disabled={!connected || !models?.available || text.trim().length < 3}
            onClick={() => send({ kind: "goal_start", goal: text.trim(), model: selected })}
          >
            Start
          </button>
        )}
      </div>

      {active && goal?.activity && (
        <p className="flex items-center gap-2 text-xs text-teal">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" aria-hidden />
          {goal.activity}…
        </p>
      )}

      {goal?.status === "awaiting_plan_approval" && goal.plan && <PlanCard plan={goal.plan} send={send} />}

      {goal?.status === "waiting_user" && (
        <form
          className="space-y-2 rounded-lg border border-amber/50 bg-amber/5 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reply.trim()) return;
            send({ kind: "goal_reply", text: reply.trim() });
            setReply("");
          }}
        >
          <p className="text-sm font-semibold text-white">{goal.question}</p>
          <p className="text-xs text-dim">If it needs a sign-in or CAPTCHA, do that in the browser window first, then reply.</p>
          <div className="flex gap-2">
            <input className={input} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Your answer (never paste passwords here)" />
            <button className={btnPrimary}>Send</button>
          </div>
        </form>
      )}

      {goal?.result && (
        <div className="whitespace-pre-wrap rounded-lg border border-teal/40 bg-teal/5 p-3 text-sm leading-relaxed text-white">
          <p className="mb-1 text-xs text-dim">Agent report. Check the screen to confirm.</p>
          {goal.result}
        </div>
      )}
      {goal?.error && <p className="rounded-lg border border-ember/50 bg-ember/5 p-3 text-sm text-ember">{goal.error}</p>}

      {goal && goal.steps.length > 0 && <AgentSteps steps={goal.steps} />}
    </div>
  );
}