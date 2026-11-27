import os from "node:os";
import path from "node:path";
import type { ApprovalMode } from "../shared/types";

const dataDir = path.join(process.cwd(), ".agent-data");
const knowledgeDir = path.join(dataDir, "knowledge");

export const config = {
  host: "127.0.0.1",
  port: Number(process.env.AGENT_PORT ?? 4317),
  allowedOrigins: (process.env.AGENT_ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000").split(","),
  headless: process.env.AGENT_HEADLESS === "true",
  approvalMode: (process.env.AGENT_APPROVAL_MODE === "strict" ? "strict" : "standard") as ApprovalMode,
  viewport: { width: 1280, height: 800 },
  dataDir,
  auditDir: path.join(dataDir, "audit"),
  backupDir: path.join(dataDir, "backups"),
  profileDir: path.join(dataDir, "profiles", process.env.AGENT_PROFILE ?? "default"),
  backupAllowedRoots: (process.env.AGENT_BACKUP_ROOTS ?? os.homedir()).split(path.delimiter),

  // Phase B
  ollamaUrl: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "qwen3:4b",
  ollamaNumCtx: Number(process.env.OLLAMA_NUM_CTX ?? 8192),
  ollamaThink: process.env.OLLAMA_THINK === undefined ? undefined : process.env.OLLAMA_THINK === "true",
  agentMaxSteps: Number(process.env.AGENT_MAX_STEPS ?? 25),

  // Phase C
  researchDir: path.join(knowledgeDir, "research"),
  skillsDir: path.join(knowledgeDir, "skills"),
  sitesDir: path.join(knowledgeDir, "sites"),
  skillMaxAgeDays: Number(process.env.AGENT_SKILL_MAX_AGE_DAYS ?? 30),
  researchAllowPrivate: process.env.AGENT_RESEARCH_ALLOW_PRIVATE === "true",

  // Phase F1
  exportsDir: path.join(dataDir, "exports"),
  appVersion: process.env.npm_package_version ?? "0.1.0",

  // Phase F2: speech to text (whisper.cpp)
  whisperBin: process.env.WHISPER_BIN ?? "D:\\Tools\\whisper\\Release\\whisper-cli.exe",
  whisperModel: process.env.WHISPER_MODEL ?? "D:\\Tools\\whisper\\models\\ggml-base.bin",
  whisperThreads: Number(process.env.WHISPER_THREADS ?? Math.max(1, Math.min(4, os.cpus().length))),
  voiceTmpDir: path.join(dataDir, "voice-tmp"),

  // Phase F2: Urdu text to speech (Piper)
  piperBin: process.env.PIPER_BIN ?? "D:\\Tools\\piper\\piper.exe",
  piperUrduVoice: process.env.PIPER_URDU_VOICE ?? "D:\\Tools\\piper\\voices\\ur_PK-aegis_female-medium.onnx",
};