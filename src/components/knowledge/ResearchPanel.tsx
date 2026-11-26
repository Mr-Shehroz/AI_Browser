"use client";

import { useState } from "react";
import { btnPrimary, input, panel, panelTitle } from "@/components/agent/ui";
import type { ClientMessage, ResearchNote } from "@/shared/types";

export function ResearchPanel({ research, send }: { research: ResearchNote[]; send: (msg: ClientMessage) => void }) {
  const [url, setUrl] = useState("");

  return (
    <div className={`${panel} space-y-3`}>
      <h2 className={panelTitle}>Research</h2>
      <p className="text-xs leading-relaxed text-dim">
        Pages the agent has read, with the date it read them. Re-reading them later is how skills are checked for changes.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!url.trim()) return;
          send({ kind: "research_url", url: url.trim() });
          setUrl("");
        }}
      >
        <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://playwright.dev/docs/intro" />
        <button className={btnPrimary} disabled={!url.trim()}>Read</button>
      </form>

      {research.length === 0 ? (
        <p className="text-sm text-dim">Nothing read yet. Paste a documentation link, or include one in a goal.</p>
      ) : (
        <ul className="max-h-[28rem] space-y-2 overflow-auto pr-1">
          {research.map((n) => (
            <li key={n.id} className="frame-card">
              <a href={n.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-white hover:text-teal">
                {n.title}
              </a>
              <p className="break-all text-[11px] text-dim">{n.url}, read {new Date(n.accessedAt).toLocaleString()}</p>
              {!n.relevant && <p className="mt-1 text-[11px] text-amber">Not relevant to the goal it was read for</p>}
              <p className="mt-1 text-xs leading-relaxed text-haze/85">{n.summary}</p>
              {n.versionInfo && <p className="mt-1 text-[11px] text-teal/80">{n.versionInfo}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}