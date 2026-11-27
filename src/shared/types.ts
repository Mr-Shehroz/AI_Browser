export type RiskLevel =
  | "read_only"
  | "reversible"
  | "impactful"
  | "destructive"
  | "blocked";
export type ApprovalMode = "strict" | "standard";
export type AgentState =
  | "idle"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "stopped";

export type BrowserAction =
  | { type: "navigate"; url: string }
  | { type: "click"; selector: string }
  | { type: "type"; selector: string; text: string; secret?: boolean }
  | { type: "press"; key: string }
  | { type: "scroll"; deltaY: number }
  | { type: "back" }
  | { type: "observe" };

export type ActionStatus =
  | "queued"
  | "pending_approval"
  | "running"
  | "succeeded"
  | "failed"
  | "rejected"
  | "blocked"
  | "cancelled";

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

export interface ElementInfo {
  name: string;
  role: string;
  type?: string;
}
export interface InteractiveElement extends ElementInfo {
  ref: string;
  selector: string;
  inViewport: boolean;
}

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

export interface LogEntry {
  level: "info" | "warn" | "error";
  message: string;
  at: string;
}

// ---- Phase B: goals ----
export interface GoalPlan {
  summary: string;
  steps: string[];
  risks: string[];
  needsFromUser: string[];
}

export type GoalStatus =
  | "planning"
  | "awaiting_plan_approval"
  | "running"
  | "waiting_user"
  | "done"
  | "failed"
  | "stopped";

export interface AgentStep {
  index: number;
  thought: string;
  decision: string;
  outcome?: string;
  at: string;
}

// ---- Phase C: knowledge ----
export type SkillStatus = "draft" | "tested" | "approved" | "stale" | "retired";

export interface SkillStep {
  instruction: string;
  expected?: string;
}
export interface SkillSource {
  url: string;
  researchId?: string;
  accessedAt: string;
}

export interface Skill {
  id: string;
  version: number;
  name: string;
  purpose: string;
  domains: string[];
  prerequisites: string[];
  inputs: string[];
  steps: SkillStep[];
  verification: string[];
  failureCases: string[];
  rollback: string;
  risk: RiskLevel;
  sources: SkillSource[];
  status: SkillStatus;
  confidence: "low" | "medium" | "high";
  createdAt: string;
  updatedAt: string;
  testedAt?: string;
  testEvidence?: string;
  approvedAt?: string;
  reviewer?: string;
  lastValidatedAt?: string;
  staleReason?: string;
  lastUsedAt?: string;
  importedAt?: string;
  uses: number;
  successes: number;
  derivedFromGoal?: string;
  history: { version: number; at: string; change: string }[];
}

export interface SkillRef {
  id: string;
  version: number;
  name: string;
  status: SkillStatus;
}

export interface ResearchNote {
  id: string;
  url: string;
  title: string;
  accessedAt: string;
  contentHash: string;
  relevant: boolean;
  summary: string;
  keyPoints: string[];
  versionInfo?: string;
  goalId?: string;
}

export interface SiteProfile {
  domain: string;
  firstSeen: string;
  lastVisited: string;
  visits: number;
  titles: string[];
  notes: string[];
  pitfalls: string[];
  skillIds: string[];
}

export interface KnowledgeSnapshot {
  skills: Skill[];
  research: ResearchNote[];
  sites: SiteProfile[];
  maxAgeDays: number;
}

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
  usedSkills: SkillRef[];
  skippedSkills: { name: string; reason: string }[];
  researchIds: string[];
  testOfSkill?: SkillRef;
  savedSkill?: SkillRef;
}

export interface ModelsInfo {
  available: boolean;
  models: string[];
  defaultModel: string;
  error?: string;
}

// ---- Phase F1: portable knowledge pack ----
export interface PackCounts {
  skills: number;
  skillVersions: number;
  sites: number;
  research: number;
}

export interface PackManifest {
  format: "nexforce-knowledge-pack";
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  counts: PackCounts;
  files: { path: string; sha256: string; bytes: number }[];
  excluded: string[];
}

export interface PackExportResult {
  fileName: string;
  bytes: number;
  counts: PackCounts;
  excluded: string[];
  createdAt: string;
}

export type ImportSkillAction = "new" | "update" | "same" | "conflict";

export interface ImportPreview {
  importId: string;
  fileName: string;
  exportedAt: string;
  appVersion: string;
  checksumsOk: boolean;
  problems: string[];
  warnings: string[];
  skills: {
    id: string;
    name: string;
    versions: number[];
    action: ImportSkillAction;
  }[];
  sites: { domain: string; action: "new" | "merge" }[];
  research: { new: number; existing: number };
  preferences?: Record<string, unknown>;
}

export interface PortableSnapshot {
  exports: PackExportResult[];
  preview: ImportPreview | null;
}

export type ConflictMode = "keep_mine" | "add_as_draft";

// ---- Phase F2: voice ----
export type VoiceLanguage = "auto" | "en" | "ur" | "ur2en";

export type ReplyLanguage = "en" | "ur";

export interface VoiceStatus {
  available: boolean;
  bin: string;
  model: string;
  error?: string;
  urduTts?: boolean;
  urduTtsError?: string;
}

export interface TranscriptResult {
  text: string;
  language: string;
  translated: boolean;
  audioSeconds: number;
  durationMs: number;
}

// ---- Messages ----
export type ControlCommand =
  | "start_browser"
  | "close_browser"
  | "pause"
  | "resume"
  | "stop"
  | "new_task";

export type ClientMessage =
  | { kind: "action"; action: BrowserAction }
  | {
      kind: "approval";
      actionId: string;
      approved: boolean;
      acknowledgeNoBackup?: boolean;
      via?: "click" | "voice";
    }
  | { kind: "control"; command: ControlCommand }
  | { kind: "backup"; sourcePath: string; label: string }
  | { kind: "snapshot" }
  | { kind: "restore"; backupId: string }
  | { kind: "goal_start"; goal: string; model?: string }
  | { kind: "goal_plan_decision"; approved: boolean; feedback?: string }
  | { kind: "goal_reply"; text: string }
  | { kind: "goal_stop" }
  | { kind: "models_refresh" }
  | { kind: "knowledge_refresh" }
  | { kind: "research_url"; url: string }
  | { kind: "skill_draft_from_goal" }
  | { kind: "skill_test"; skillId: string; inputs: Record<string, string> }
  | { kind: "skill_approve"; skillId: string }
  | { kind: "skill_revalidate"; skillId: string }
  | { kind: "skill_retire"; skillId: string }
  | {
      kind: "site_note_add";
      domain: string;
      note: string;
      type: "note" | "pitfall";
    }
  | { kind: "set_reply_language"; language: ReplyLanguage }
  | { kind: "set_quick_mode"; enabled: boolean }
  | { kind: "chat"; text: string; requestId: string }
  | { kind: "portable_refresh" }
  | { kind: "pack_export" }
  | { kind: "pack_import_apply"; importId: string; conflictMode: ConflictMode }
  | { kind: "pack_import_discard"; importId: string };

export type ServerMessage =
  | {
      kind: "hello";
      state: AgentState;
      browserOpen: boolean;
      taskId: string;
      approvalMode: ApprovalMode;
      records: ActionRecord[];
      backups: BackupRecord[];
    }
  | { kind: "state"; state: AgentState; browserOpen: boolean; taskId: string }
  | { kind: "action_update"; record: ActionRecord }
  | { kind: "observation"; observation: PageObservation }
  | { kind: "backup_update"; backup: BackupRecord }
  | { kind: "frame"; data: string }
  | { kind: "log"; entry: LogEntry }
  | { kind: "goal_update"; goal: GoalRun | null }
  | { kind: "models"; info: ModelsInfo }
  | { kind: "knowledge"; snapshot: KnowledgeSnapshot }
  | { kind: "portable"; snapshot: PortableSnapshot }
  | { kind: "voice"; status: VoiceStatus }
  | { kind: "chat_reply"; requestId: string; reply: string; task: string | null };
