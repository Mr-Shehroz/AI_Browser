"use client";

import { useMemo, useState } from "react";
import type { PageObservation } from "@/shared/types";
import { btn, input, panel } from "./ui";

interface Props {
  observation: PageObservation | null;
  onUse: (selector: string) => void;
  onClick: (selector: string) => void;
}

export function ElementList({ observation, onUse, onClick }: Props) {
  const [filter, setFilter] = useState("");
  const items = useMemo(() => {
    const q = filter.toLowerCase();
    return (observation?.elements ?? []).filter((e) => !q || e.name.toLowerCase().includes(q) || e.role.includes(q));
  }, [observation, filter]);

  return (
    <div className={panel}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Page elements</h2>
        {observation?.blockers.length ? (
          <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
            {observation.blockers.join(", ")} — human needed
          </span>
        ) : null}
      </div>
      <input className={`${input} mb-2`} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or role" />
      {!observation ? (
        <p className="text-sm text-zinc-500">Run an action or press Observe to list elements.</p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-auto text-sm">
          {items.map((el) => (
            <li key={el.ref} className={`flex items-center gap-2 rounded px-2 py-1 hover:bg-zinc-800/60 ${el.inViewport ? "" : "opacity-60"}`}>
              <code className="w-10 shrink-0 text-xs text-zinc-500">{el.ref}</code>
              <span className="w-16 shrink-0 truncate text-xs text-zinc-400">{el.role}</span>
              <span className="min-w-0 flex-1 truncate">{el.name || <em className="text-zinc-500">unnamed</em>}</span>
              <button className={btn} onClick={() => onUse(el.selector)}>Use</button>
              <button className={btn} onClick={() => onClick(el.selector)}>Click</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}