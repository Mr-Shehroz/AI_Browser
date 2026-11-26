"use client";

import { useState } from "react";
import type { BackupRecord, ClientMessage } from "@/shared/types";
import { btn, btnPrimary, input, panel } from "./ui";

interface Props {
  backups: BackupRecord[];
  send: (msg: ClientMessage) => void;
  browserOpen: boolean;
}

const fmtBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

export function BackupPanel({ backups, send, browserOpen }: Props) {
  const [sourcePath, setSourcePath] = useState("");
  const [label, setLabel] = useState("pre-change");

  return (
    <div className={`${panel} space-y-3`}>
      <h2 className="text-sm font-semibold">Backups</h2>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (sourcePath.trim()) send({ kind: "backup", sourcePath: sourcePath.trim(), label: label.trim() || "backup" });
        }}
      >
        <input className={input} value={sourcePath} onChange={(e) => setSourcePath(e.target.value)} placeholder="Local file or folder path" />
        <div className="flex gap-2">
          <input className={input} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
          <button className={btnPrimary} disabled={!sourcePath.trim()}>Back up</button>
        </div>
      </form>
      <button className={btn} disabled={!browserOpen} onClick={() => send({ kind: "snapshot" })}>Snapshot current page</button>

      <ul className="max-h-64 space-y-2 overflow-auto">
        {backups.map((b) => (
          <li key={b.id} className="rounded-lg border border-zinc-800 p-2 text-xs">
            <div className="flex items-center gap-2">
              <span className={b.verified ? "text-emerald-300" : "text-red-300"}>{b.verified ? "verified" : "unverified"}</span>
              <span className="text-zinc-400">{b.kind === "filesystem" ? "files" : "page evidence"}</span>
              <span className="ml-auto text-zinc-500">{fmtBytes(b.totalBytes)}</span>
            </div>
            <p className="mt-1 truncate" title={b.source}>{b.label} — {b.source}</p>
            <p className="truncate text-zinc-500" title={b.location}>{b.location}</p>
            {b.restorable && (
              <button className={`${btn} mt-2`} onClick={() => send({ kind: "restore", backupId: b.id })}>
                Restore as copy
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}