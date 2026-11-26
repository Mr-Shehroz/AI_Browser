"use client";

import type { AgentStep } from "@/shared/types";

const outcomeColor = (o?: string) =>
  !o ? "text-dim"
  : o.startsWith("succeeded") || o.startsWith("researched") || o === "finished" ? "text-teal/80"
  : o.startsWith("rejected") || o.startsWith("Not executed") ? "text-amber"
  : o.startsWith("failed") || o.startsWith("blocked") ? "text-ember"
  : "text-haze/70";

export function AgentSteps({ steps }: { steps: AgentStep[] }) {
  return (
    <div className="border-t border-white/5 pt-4">
      <ol className="max-h-80 space-y-3 overflow-auto pr-1">
        {[...steps].reverse().map((s) => (
          <li key={s.index} className="grid grid-cols-[2.25rem_1fr] gap-2 text-xs">
            <span className="font-display text-2xl font-black leading-none text-steel">{s.index}</span>
            <div className="min-w-0">
              <p className="leading-relaxed text-haze/80">{s.thought}</p>
              <p className="mt-0.5 break-all font-semibold text-white">{s.decision}</p>
              <p className={`mt-0.5 break-all ${outcomeColor(s.outcome)}`}>{s.outcome ?? "…"}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}