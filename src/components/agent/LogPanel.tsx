"use client";

import type { LogEntry } from "@/shared/types";
import { panel } from "./ui";

const color = { info: "text-zinc-300", warn: "text-amber-300", error: "text-red-300" } as const;

export function LogPanel({ logs }: { logs: LogEntry[] }) {
  return (
    <div className={panel}>
      <h2 className="mb-2 text-sm font-semibold">Agent log</h2>
      <ul className="max-h-48 space-y-1 overflow-auto font-mono text-xs">
        {[...logs].reverse().map((l, i) => (
          <li key={`${l.at}-${i}`} className={color[l.level]}>
            <span className="text-zinc-600">{new Date(l.at).toLocaleTimeString()} </span>{l.message}
          </li>
        ))}
      </ul>
    </div>
  );
}