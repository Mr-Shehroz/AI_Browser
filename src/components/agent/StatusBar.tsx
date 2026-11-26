"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AgentState, ApprovalMode, ClientMessage, ControlCommand } from "@/shared/types";
import { btn, btnDanger, btnPrimary } from "./ui";

interface Props {
  connected: boolean;
  state: AgentState;
  browserOpen: boolean;
  taskId: string;
  approvalMode: ApprovalMode;
  send: (msg: ClientMessage) => void;
}

const stateLabel: Record<AgentState, string> = {
  idle: "Idle",
  running: "Working",
  awaiting_approval: "Needs approval",
  paused: "Paused",
  stopped: "Stopped",
};

const stateColor: Record<AgentState, string> = {
  idle: "bg-dim",
  running: "bg-teal shadow-[0_0_10px_var(--color-teal)]",
  awaiting_approval: "bg-amber shadow-[0_0_10px_var(--color-amber)]",
  paused: "bg-amber",
  stopped: "bg-ember",
};

const nav = [
  { href: "/", label: "Browser" },
  { href: "/create", label: "Create" },
  { href: "/knowledge", label: "Knowledge" },
];

export function StatusBar({ connected, state, browserOpen, taskId, approvalMode, send }: Props) {
  const control = (command: ControlCommand) => send({ kind: "control", command });
  const pathname = usePathname();

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-3xl font-black leading-none tracking-wide text-white">NexForce</span>
        <span className="text-sm text-dim">Browser agent</span>
      </div>

      <nav aria-label="Main" className="flex gap-1 rounded-full border border-steel bg-deep/70 p-1">
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={pathname === n.href ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm font-semibold transition-colors ${
              pathname === n.href ? "bg-teal text-[#04201d]" : "text-haze hover:text-white"
            }`}
          >
            {n.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-2 rounded-full border border-steel bg-deep/70 px-3 py-1">
        <span className={`h-2 w-2 rounded-full ${connected ? stateColor[state] : "bg-ember"}`} aria-hidden />
        <span className="text-sm font-semibold text-white">{connected ? stateLabel[state] : "Agent server offline"}</span>
      </div>

      <span className="hidden text-xs text-dim md:inline" title="Task ID and approval mode">
        {taskId}, {approvalMode} approvals
      </span>

      <div className="ml-auto flex flex-wrap gap-2">
        {browserOpen ? (
          <button className={btn} onClick={() => control("close_browser")}>Close browser</button>
        ) : (
          <button className={btnPrimary} disabled={!connected} onClick={() => control("start_browser")}>Open browser</button>
        )}
        {state === "paused" ? (
          <button className={btn} onClick={() => control("resume")}>Resume</button>
        ) : (
          <button className={btn} disabled={!connected || state === "stopped"} onClick={() => control("pause")}>Pause and take over</button>
        )}
        <button className={btnDanger} disabled={!connected || state === "stopped"} onClick={() => control("stop")}>Stop</button>
        <button className={btn} disabled={!connected} onClick={() => control("new_task")}>New task</button>
      </div>
    </header>
  );
}