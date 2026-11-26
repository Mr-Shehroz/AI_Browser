"use client";

import { describeAction } from "@/shared/describe";
import type { ActionRecord } from "@/shared/types";
import { panel, panelTitle, riskStyle, statusStyle } from "./ui";

export function ActionTimeline({ records }: { records: ActionRecord[] }) {
  const items = [...records].reverse();

  return (
    <div className={panel}>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className={panelTitle}>Timeline</h2>
        <span className="text-xs text-dim">{records.length} {records.length === 1 ? "action" : "actions"}</span>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-dim">Every action the agent takes lands here as a frame, newest first.</p>
      ) : (
        <div className="filmstrip">
          <ol className="max-h-96 space-y-2 overflow-auto pr-1">
            {items.map((r) => (
              <li key={r.id} className="frame-card" data-status={r.status}>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${riskStyle[r.risk]}`}>
                    {r.risk.replace("_", " ")}
                  </span>
                  <span className={`text-xs font-semibold ${statusStyle[r.status]}`}>{r.status.replace("_", " ")}</span>
                  <time className="ml-auto text-[11px] tabular-nums text-dim">{new Date(r.createdAt).toLocaleTimeString()}</time>
                </div>
                <p className="mt-1.5 break-all text-[13px] text-white">{describeAction(r.action)}</p>
                {r.verification && <p className="mt-1 break-all text-xs text-teal/80">{r.verification}</p>}
                {r.error && <p className="mt-1 break-all text-xs text-ember">{r.error}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}