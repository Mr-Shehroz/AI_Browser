"use client";

import { useState } from "react";
import { describeAction } from "@/shared/describe";
import type { ActionRecord } from "@/shared/types";
import { btn, btnDanger, btnPrimary, riskStyle } from "./ui";

interface Props {
  record: ActionRecord;
  hasVerifiedBackup: boolean;
  onDecide: (approved: boolean, acknowledgeNoBackup?: boolean) => void;
}

export function ApprovalDialog({ record, hasVerifiedBackup, onDecide }: Props) {
  const [ack, setAck] = useState(false);
  const destructive = record.risk === "destructive";
  const needsAck = destructive && !hasVerifiedBackup;

  return (
    <div className="approval-cut" data-risk={record.risk}>
      <div role="dialog" aria-modal="true" aria-labelledby="approval-title" className="approval-card">
        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${riskStyle[record.risk]}`}>
          {record.risk.replace("_", " ")}
        </span>
        <h2 id="approval-title" className="mt-3 font-display text-4xl font-black leading-none text-white">
          {destructive ? "This can't easily be undone" : "Approve this step?"}
        </h2>

        <p className="mt-4 break-all rounded-lg bg-night/70 px-3 py-2 text-sm text-white">{describeAction(record.action)}</p>
        {record.target && <p className="mt-2 text-sm text-haze">Target: “{record.target}”</p>}
        <p className="mt-3 text-sm leading-relaxed text-haze">{record.reason}</p>
        <p className="mt-2 text-xs text-dim">A snapshot of the page is saved before it runs.</p>

        {destructive && (
          <div className={`mt-4 rounded-lg border p-3 text-sm ${hasVerifiedBackup ? "border-teal/50 text-teal" : "border-ember/60 text-ember"}`}>
            {hasVerifiedBackup ? (
              "A verified backup exists for this task."
            ) : (
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1 accent-[var(--color-ember)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                No verified backup exists for this task. I confirm a backup isn&apos;t possible here and I accept the risk.
              </label>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button className={btn} onClick={() => onDecide(false)}>Reject</button>
          <button
            className={destructive ? btnDanger : btnPrimary}
            disabled={needsAck && !ack}
            onClick={() => onDecide(true, needsAck ? ack : undefined)}
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}