"use client";

import { useState } from "react";
import { btn, btnPrimary, input, panel, panelTitle } from "@/components/agent/ui";
import type { ClientMessage, SiteProfile } from "@/shared/types";

export function SitesPanel({ sites, send }: { sites: SiteProfile[]; send: (msg: ClientMessage) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [type, setType] = useState<"note" | "pitfall">("note");

  return (
    <div className={`${panel} space-y-3`}>
      <h2 className={panelTitle}>Sites</h2>
      <p className="text-xs leading-relaxed text-dim">
        Sites the agent has worked on. Your notes and pitfalls are shown to the agent whenever it&apos;s on that site.
      </p>

      {sites.length === 0 ? (
        <p className="text-sm text-dim">No sites yet. They appear after the agent visits them during a goal.</p>
      ) : (
        <ul className="max-h-[28rem] space-y-2 overflow-auto pr-1">
          {sites.map((s) => (
            <li key={s.domain} className="frame-card space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-semibold text-white">{s.domain}</span>
                <span className="shrink-0 text-[11px] text-dim">
                  {s.visits} {s.visits === 1 ? "visit" : "visits"}, last {new Date(s.lastVisited).toLocaleDateString()}
                </span>
              </div>
              {s.notes.length > 0 && (
                <ul className="list-disc pl-5 text-xs text-haze/85">{s.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
              )}
              {s.pitfalls.length > 0 && (
                <ul className="list-disc pl-5 text-xs text-amber">{s.pitfalls.map((n, i) => <li key={i}>Pitfall: {n}</li>)}</ul>
              )}

              {editing === s.domain ? (
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!note.trim()) return;
                    send({ kind: "site_note_add", domain: s.domain, note: note.trim(), type });
                    setNote("");
                    setEditing(null);
                  }}
                >
                  <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="The export button is under Settings, not Tools" />
                  <div className="flex items-center gap-2">
                    <select className={`${input} w-auto`} value={type} onChange={(e) => setType(e.target.value as "note" | "pitfall")} aria-label="Note type">
                      <option value="note">Note</option>
                      <option value="pitfall">Pitfall</option>
                    </select>
                    <button type="button" className={`${btn} ml-auto`} onClick={() => setEditing(null)}>Cancel</button>
                    <button className={btnPrimary} disabled={!note.trim()}>Add</button>
                  </div>
                </form>
              ) : (
                <button className={btn} onClick={() => { setEditing(s.domain); setNote(""); setType("note"); }}>Add note</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}