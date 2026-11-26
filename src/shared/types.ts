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

// ---- Phase B: goals ----
export interface GoalPlan { summary: string; steps: string[]; risks: string[]; needsFromUser: string[] }

export type GoalStatus =
  | "planning" | "awaiting_plan_approval" | "running" | "waiting_user" | "done" | "failed" | "stopped";

export interface AgentStep { index: number; thought: string; decision: string; outcome?: string; at: string }

// ---- Phase C: knowledge ----
export type SkillStatus = "draft" | "tested" | "approved" | "stale" | "retired";

export interface SkillStep { instruction: string; expected?: string }
export interface SkillSource { url: string; researchId?: string; accessedAt: string }

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
  uses: number;
  successes: number;
  derivedFromGoal?: string;
  history: { version: number; at: string; change: string }[];
}

export interface SkillRef { id: string; version: number; name: string; status: SkillStatus }

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

export interface ModelsInfo { available: boolean; models: string[]; defaultModel: string; error?: string }

// ---- Phase D: creative studio ----
export type HardwareTier = "cpu" | "low" | "mid" | "high" | "ultra";

export interface GpuInfo { name: string; vramGb: number; vramFreeGb?: number }

export interface HardwareInfo {
  os: string;
  cpu: string;
  cores: number;
  ramGb: number;
  gpus: GpuInfo[];
  freeDiskGb?: number;
  source: "comfyui" | "nvidia-smi" | "none";
  tier: HardwareTier;
  notes: string[];
  detectedAt: string;
}

export type ModelFamily = "sd15" | "sdxl" | "flux" | "unknown";

export interface CreativeModel {
  name: string;
  family: ModelFamily;
  fits: "good" | "slow" | "too_big";
  note: string;
}

export interface StylePreset { id: string; name: string; prompt: string; negative: string }

export type ImageMode = "txt2img" | "img2img" | "upscale";
export type ImageQuality = "draft" | "standard" | "high";
export type ImageAspect = "1:1" | "4:3" | "3:4" | "16:9" | "9:16";

export interface ImageJobRequest {
  mode: ImageMode;
  prompt: string;
  negative?: string;
  model?: string;
  presetId?: string;
  quality: ImageQuality;
  aspect: ImageAspect;
  batch: number;
  seed?: number;
  strength?: number;
  sourceUploadId?: string;
  sourceImage?: string;
  upscaleBy?: 2 | 4;
}

export interface ImageSettings {
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed: number;
  family: ModelFamily;
  upscaleBy?: number;
  upscaleModel?: string;
}

export type ImageJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface ImageJob {
  id: string;
  request: ImageJobRequest;
  settings: ImageSettings;
  status: ImageJobStatus;
  progress: number;
  note?: string;
  promptId?: string;
  images: string[];
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface CreativeSnapshot {
  comfy: { reachable: boolean; url: string; version?: string; error?: string };
  hardware: HardwareInfo | null;
  models: CreativeModel[];
  upscaleModels: string[];
  presets: StylePreset[];
  limits: { maxBatch: number; upscaleOptions: number[] };
  recommendation: string;
  jobs: ImageJob[];
}

// ---- Messages ----
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
  | { kind: "models_refresh" }
  | { kind: "knowledge_refresh" }
  | { kind: "research_url"; url: string }
  | { kind: "skill_draft_from_goal" }
  | { kind: "skill_test"; skillId: string; inputs: Record<string, string> }
  | { kind: "skill_approve"; skillId: string }
  | { kind: "skill_revalidate"; skillId: string }
  | { kind: "skill_retire"; skillId: string }
  | { kind: "site_note_add"; domain: string; note: string; type: "note" | "pitfall" }
  | { kind: "creative_refresh"; rescan?: boolean }
  | { kind: "image_job"; request: ImageJobRequest }
  | { kind: "image_cancel"; jobId: string };

export type ServerMessage =
  | { kind: "hello"; state: AgentState; browserOpen: boolean; taskId: string; approvalMode: ApprovalMode; records: ActionRecord[]; backups: BackupRecord[] }
  | { kind: "state"; state: AgentState; browserOpen: boolean; taskId: string }
  | { kind: "action_update"; record: ActionRecord }
  | { kind: "observation"; observation: PageObservation }
  | { kind: "backup_update"; backup: BackupRecord }
  | { kind: "frame"; data: string }
  | { kind: "log"; entry: LogEntry }
  | { kind: "goal_update"; goal: GoalRun | null }
  | { kind: "models"; info: ModelsInfo }
  | { kind: "knowledge"; snapshot: KnowledgeSnapshot }
  | { kind: "creative"; snapshot: CreativeSnapshot }
  | { kind: "image_job_update"; job: ImageJob };