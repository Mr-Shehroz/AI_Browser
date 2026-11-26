"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActionRecord, AgentState, ApprovalMode, BackupRecord, ClientMessage, GoalRun,
  LogEntry, ModelsInfo, PageObservation, ServerMessage,
} from "@/shared/types";

const AGENT_WS_URL = process.env.NEXT_PUBLIC_AGENT_WS_URL ?? "ws://127.0.0.1:4317";

export function useAgentSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const frameListeners = useRef(new Set<(data: string) => void>());

  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<AgentState>("idle");
  const [browserOpen, setBrowserOpen] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("standard");
  const [records, setRecords] = useState<ActionRecord[]>([]);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [observation, setObservation] = useState<PageObservation | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [goal, setGoal] = useState<GoalRun | null>(null);
  const [models, setModels] = useState<ModelsInfo | null>(null);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const ws = new WebSocket(AGENT_WS_URL);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!disposed) timer = setTimeout(connect, 1500);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as ServerMessage;
        switch (msg.kind) {
          case "frame":
            frameListeners.current.forEach((fn) => fn(msg.data));
            break;
          case "hello":
            setState(msg.state);
            setBrowserOpen(msg.browserOpen);
            setTaskId(msg.taskId);
            setApprovalMode(msg.approvalMode);
            setRecords(msg.records);
            setBackups(msg.backups);
            break;
          case "state":
            setState(msg.state);
            setBrowserOpen(msg.browserOpen);
            setTaskId(msg.taskId);
            break;
          case "action_update":
            setRecords((prev) => {
              const i = prev.findIndex((r) => r.id === msg.record.id);
              if (i === -1) return [...prev, msg.record];
              const next = prev.slice();
              next[i] = msg.record;
              return next;
            });
            break;
          case "observation":
            setObservation(msg.observation);
            break;
          case "backup_update":
            setBackups((prev) => [msg.backup, ...prev.filter((b) => b.id !== msg.backup.id)]);
            break;
          case "log":
            setLogs((prev) => [...prev.slice(-199), msg.entry]);
            break;
          case "goal_update":
            setGoal(msg.goal ? { ...msg.goal, steps: [...msg.goal.steps] } : null);
            break;
          case "models":
            setModels(msg.info);
            break;
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
  }, []);

  const subscribeFrames = useCallback((fn: (data: string) => void) => {
    frameListeners.current.add(fn);
    return () => { frameListeners.current.delete(fn); };
  }, []);

  return {
    connected, state, browserOpen, taskId, approvalMode, records, backups,
    observation, logs, goal, models, send, subscribeFrames,
  };
}