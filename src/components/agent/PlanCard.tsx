"use client";

import { useState } from "react";
import type { ClientMessage, GoalPlan } from "@/shared/types";
import { btn, btnPrimary, input } from "./ui";

export function PlanCard({ plan, send }: { plan: GoalPlan; send: (msg: ClientMessage) => void }) {
  const [feedback, setFeedback] = useState("");
  const decide = (approved: boolean) =>
    send({ kind: "goal_plan_decision", approved, feedback: feedback.trim() || undefined });

  return (
    <div className="space-y-3 rounded-xl border border-amber/45 bg-amber/5 p-4 text-sm">
      <p className="font-display text-xl font-bold leading-tight text-white">{plan.summary}</p>
      <ol className="list-decimal space-y-1.5 pl-5 leading-relaxed text-haze marker:text-amber">
        {plan.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {plan.risks.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-amber">Needs your approval during the run</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-haze/80">{plan.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
      {plan.needsFromUser.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-teal">You may need to</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-haze/80">{plan.needsFromUser.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
      <input className={input} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Add a note or ask for changes" />
      <div className="flex flex-wrap justify-end gap-2">
        <button className={btn} onClick={() => { setFeedback(""); send({ kind: "goal_plan_decision", approved: false }); }}>Reject</button>
        <button className={btn} disabled={!feedback.trim()} onClick={() => decide(false)}>Revise plan</button>
        <button className={btnPrimary} onClick={() => decide(true)}>Approve and run</button>
      </div>
    </div>
  );
}