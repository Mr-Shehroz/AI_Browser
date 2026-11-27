import { randomUUID } from "node:crypto";
import { redactAction } from "../../shared/describe";
import type {
  ActionRecord, ActionStatus, AgentState, ApprovalMode, BrowserAction, ControlCommand, LogEntry, RiskLevel, ServerMessage,
} from "../../shared/types";
import type { AuditLog } from "../audit/auditLog";
import type { BackupManager } from "../backup/backupManager";
import type { BrowserController } from "../browser/controller";
import type { ApprovalManager } from "../policy/approvals";
import { assessRisk, requiresApproval } from "../policy/risk";


interface Deps {
  browser: BrowserController;
  approvals: ApprovalManager;
  audit: AuditLog;
  backups: BackupManager;
  emit: (msg: ServerMessage) => void;
  approvalMode: ApprovalMode;
}

const now = () => new Date().toISOString();
const newTaskId = () => `task-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 6)}`;
const TERMINAL = new Set<ActionStatus>(["succeeded", "failed", "rejected", "blocked", "cancelled"]);

export class TaskRunner {
  taskId = newTaskId();
  private state: AgentState = "idle";
  private queue: { record: ActionRecord; action: BrowserAction }[] = [];
  private records = new Map<string, ActionRecord>();
  private processing = false;
  private settleWaiters = new Map<string, (r: ActionRecord) => void>();
  private activeWaiters = new Set<{ resolve: () => void; reject: (e: Error) => void }>();

  constructor(private d: Deps) {}

  getState(): AgentState {
    return this.state;
  }


    riskOf(actionId: string): RiskLevel | undefined {
    return this.records.get(actionId)?.risk;
  }


    /** Highest risk level among actions that actually ran since a point in time. */
  highestRiskSince(iso: string): RiskLevel {
    const order: RiskLevel[] = ["read_only", "reversible", "impactful", "destructive"];
    let max = 0;
    for (const r of this.records.values()) {
      if (r.createdAt >= iso && r.status === "succeeded") max = Math.max(max, order.indexOf(r.risk));
    }
    return order[max];
  }

  hello(): ServerMessage {
    return {
      kind: "hello", state: this.state, browserOpen: this.d.browser.isOpen, taskId: this.taskId,
      approvalMode: this.d.approvalMode, records: [...this.records.values()], backups: this.d.backups.list(),
    };
  }

  log(level: LogEntry["level"], message: string): void {
    console[level === "info" ? "log" : level](`[agent] ${message}`);
    this.d.emit({ kind: "log", entry: { level, message, at: now() } });
  }

  private setState(state: AgentState): void {
    this.state = state;
    if (state !== "paused") {
      for (const w of this.activeWaiters) {
        if (state === "stopped") w.reject(new Error("Task is stopped."));
        else w.resolve();
      }
      this.activeWaiters.clear();
    }
    this.d.emit({ kind: "state", state, browserOpen: this.d.browser.isOpen, taskId: this.taskId });
  }

  /** Resolves when the runner is not paused. Rejects if stopped or aborted. */
  waitUntilActive(signal?: AbortSignal): Promise<void> {
    if (this.state === "stopped") return Promise.reject(new Error("Task is stopped."));
    if (this.state !== "paused") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const w = { resolve, reject };
      this.activeWaiters.add(w);
      signal?.addEventListener("abort", () => {
        this.activeWaiters.delete(w);
        reject(new Error("Aborted."));
      }, { once: true });
    });
  }

  async prepareForGoal(): Promise<void> {
    if (this.state === "stopped") await this.control("new_task");
    if (!this.d.browser.isOpen) await this.control("start_browser");
  }

  private update(rec: ActionRecord, patch: Partial<ActionRecord>): void {
    Object.assign(rec, patch);
    this.d.emit({ kind: "action_update", record: rec });
    void this.d.audit.write(`action_${rec.status}`, {
      taskId: rec.taskId, actionId: rec.id, action: rec.action, risk: rec.risk,
      reason: rec.reason, target: rec.target, verification: rec.verification, error: rec.error,
    });
    if (TERMINAL.has(rec.status)) {
      const waiter = this.settleWaiters.get(rec.id);
      if (waiter) {
        this.settleWaiters.delete(rec.id);
        waiter({ ...rec });
      }
    }
  }

  /** Queues an action. Resolves with the final record, or null if it couldn't be queued. */
  async enqueue(action: BrowserAction): Promise<ActionRecord | null> {
    if (this.state === "stopped") { this.log("warn", "Task is stopped. Start a new task first."); return null; }
    if (!this.d.browser.isOpen) { this.log("warn", "Start the browser first."); return null; }

    const el = action.type === "click" ? await this.d.browser.describe(action.selector) : undefined;
    const { risk, reason } = assessRisk(action, el);
    const rec: ActionRecord = {
      id: randomUUID(), taskId: this.taskId, action: redactAction(action),
      risk, reason, target: el?.name, status: "queued", createdAt: now(),
    };
    const settled = new Promise<ActionRecord>((resolve) => this.settleWaiters.set(rec.id, resolve));
    this.records.set(rec.id, rec);
    this.queue.push({ record: rec, action });
    this.update(rec, {});
    void this.process();
    return settled;
  }

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0 && this.state !== "paused" && this.state !== "stopped") {
        const item = this.queue.shift()!;
        await this.runOne(item.record, item.action);
      }
    } finally {
      this.processing = false;
      if (this.state === "running" || this.state === "awaiting_approval") this.setState("idle");
    }
  }

  private async runOne(rec: ActionRecord, action: BrowserAction): Promise<void> {
    if (rec.risk === "blocked") return this.update(rec, { status: "blocked", finishedAt: now() });

    if (requiresApproval(rec.risk, this.d.approvalMode)) {
      this.setState("awaiting_approval");
      this.update(rec, { status: "pending_approval" });
      const decision = await this.d.approvals.request(rec.id);

      if (this.state === "stopped") return this.update(rec, { status: "cancelled", finishedAt: now() });
      if (!decision.approved) return this.update(rec, { status: "rejected", finishedAt: now() });
      if (this.state === "paused") {
        this.queue.unshift({ record: rec, action });
        this.update(rec, { status: "queued" });
        return this.log("info", "Paused before execution; approval will be asked again on resume.");
      }
      if (rec.risk === "destructive" && !this.d.backups.hasVerified(this.taskId) && !decision.acknowledgeNoBackup) {
        return this.update(rec, {
          status: "rejected", finishedAt: now(),
          error: "Destructive action needs a verified backup for this task, or explicit acknowledgement that none is possible.",
        });
      }
      try {
        const snap = await this.d.backups.snapshotPage(this.taskId, await this.d.browser.pageSnapshot(), `before-${rec.id.slice(0, 8)}`);
        this.d.emit({ kind: "backup_update", backup: snap });
        rec.snapshotId = snap.id;
      } catch (err) {
        this.log("warn", `Pre-action snapshot failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    this.setState("running");
    this.update(rec, { status: "running" });
    try {
      const verification = await this.d.browser.execute(action);
      this.update(rec, { status: "succeeded", verification, finishedAt: now() });
      const obs = await this.d.browser.observe();
      this.d.emit({ kind: "observation", observation: obs });
      if (obs.blockers.includes("captcha")) {
        this.setState("paused");
        this.log("warn", "CAPTCHA detected. Paused — solve it yourself in the browser window, then Resume.");
      }
    } catch (err) {
      this.update(rec, { status: "failed", error: err instanceof Error ? err.message : String(err), finishedAt: now() });
      this.setState("paused");
      this.log("error", "Action failed. Paused so you can review before continuing.");
    }
  }

  private cancelAll(reason: string): void {
    for (const { record } of this.queue) this.update(record, { status: "cancelled", error: reason, finishedAt: now() });
    this.queue = [];
    this.d.approvals.rejectAll();
  }

  async control(cmd: ControlCommand): Promise<void> {
    switch (cmd) {
      case "start_browser":
        await this.d.browser.start();
        this.setState(this.state);
        this.log("info", "Browser started.");
        break;
      case "close_browser":
        this.cancelAll("Browser closed");
        await this.d.browser.close();
        this.setState("idle");
        break;
      case "pause":
        if (this.state !== "stopped") { this.setState("paused"); this.log("info", "Paused. You can take over in the browser window."); }
        break;
      case "resume":
        if (this.state === "paused") { this.setState("idle"); void this.process(); }
        break;
      case "stop":
        this.cancelAll("Stopped by user");
        this.setState("stopped");
        this.log("warn", "Task stopped.");
        break;
      case "new_task":
        this.cancelAll("New task started");
        this.taskId = newTaskId();
        this.records.clear();
        this.setState("idle");
        this.d.emit(this.hello());
        void this.d.audit.write("task_started", { taskId: this.taskId });
        break;
    }
  }

  async snapshotNow(): Promise<void> {
    const snap = await this.d.backups.snapshotPage(this.taskId, await this.d.browser.pageSnapshot(), "manual");
    this.d.emit({ kind: "backup_update", backup: snap });
    this.log("info", `Page snapshot saved: ${snap.location}`);
  }

  onBrowserClosed(): void {
    this.cancelAll("Browser window closed");
    if (this.state !== "stopped") this.setState("idle");
    this.log("warn", "Browser window was closed.");
  }
}