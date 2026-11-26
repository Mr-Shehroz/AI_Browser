export type RiskLevel = "read_only" | "reversible" | "impactful" | "destructive" | "blocked";
export type ApprovalMode = "strict" | "standard";
export type AgentState = "idle" | "running" | "paused" | "awaiting_approval" | "stopped";

export type BrowserAction =
  | { type: "navigate"; url: string }
  | { type: "click"; selector: string }
  | { type: "type"; selector: string; text: string; secret?: boolean }
  | { type: "press"; key: string }
  | { type: "scroll"; deltaY: number }
  | { type: "back" }
  | { type: "observe" };

export type ActionStatus =
  | "queued" | "pending_approval" | "running" | "succeeded"
  | "failed" | "rejected" | "blocked" | "cancelled";

export interface ActionRecord {
  id: string;
  taskId: string;
  action: BrowserAction;
  risk: RiskLevel;
  reason: string;
  target?: string;
  status: ActionStatus;
  createdAt: string;
  finishedAt?: string;
  verification?: string;
  error?: string;
  snapshotId?: string;
}

export interface ElementInfo { name: string; role: string; type?: string }
export interface InteractiveElement extends ElementInfo { ref: string; selector: string; inViewport: boolean }

export interface PageObservation {
  url: string;
  title: string;
  text: string;
  elements: InteractiveElement[];
  blockers: string[];
  observedAt: string;
}

export interface BackupRecord {
  id: string;
  taskId: string;
  kind: "filesystem" | "page_snapshot";
  label: string;
  source: string;
  location: string;
  createdAt: string;
  fileCount: number;
  totalBytes: number;
  verified: boolean;
  restorable: boolean;
  notes: string;
}

export interface LogEntry { level: "info" | "warn" | "error"; message: string; at: string }

// ---- Phase B: goals & planning ----
export interface GoalPlan { summary: string; steps: string[]; risks: string[]; needsFromUser: string[] }

export type GoalStatus =
  | "planning" | "awaiting_plan_approval" | "running" | "waiting_user" | "done" | "failed" | "stopped";

export interface AgentStep { index: number; thought: string; decision: string; outcome?: string; at: string }

export interface GoalRun {
  id: string;
  goal: string;
  model: string;
  status: GoalStatus;
  activity?: string;
  plan?: GoalPlan;
  steps: AgentStep[];
  question?: string;
  result?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface ModelsInfo { available: boolean; models: string[]; defaultModel: string; error?: string }

export type ControlCommand = "start_browser" | "close_browser" | "pause" | "resume" | "stop" | "new_task";

export type ClientMessage =
  | { kind: "action"; action: BrowserAction }
  | { kind: "approval"; actionId: string; approved: boolean; acknowledgeNoBackup?: boolean }
  | { kind: "control"; command: ControlCommand }
  | { kind: "backup"; sourcePath: string; label: string }
  | { kind: "snapshot" }
  | { kind: "restore"; backupId: string }
  | { kind: "goal_start"; goal: string; model?: string }
  | { kind: "goal_plan_decision"; approved: boolean; feedback?: string }
  | { kind: "goal_reply"; text: string }
  | { kind: "goal_stop" }
  | { kind: "models_refresh" };

export type ServerMessage =
  | { kind: "hello"; state: AgentState; browserOpen: boolean; taskId: string; approvalMode: ApprovalMode; records: ActionRecord[]; backups: BackupRecord[] }
  | { kind: "state"; state: AgentState; browserOpen: boolean; taskId: string }
  | { kind: "action_update"; record: ActionRecord }
  | { kind: "observation"; observation: PageObservation }
  | { kind: "backup_update"; backup: BackupRecord }
  | { kind: "frame"; data: string }
  | { kind: "log"; entry: LogEntry }
  | { kind: "goal_update"; goal: GoalRun | null }
  | { kind: "models"; info: ModelsInfo };