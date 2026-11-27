import http from "node:http";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import type {
  ModelsInfo,
  ReplyLanguage,
  ServerMessage,
  VoiceStatus,
} from "../shared/types";
import { AuditLog } from "./audit/auditLog";
import { BackupManager } from "./backup/backupManager";
import { BrowserController } from "./browser/controller";
import { config } from "./config";
import { createPortableHandler } from "./http/portableHttp";
import { createVoiceHandler } from "./http/voiceHttp";
import { ResearchService } from "./knowledge/research";
import { SiteProfiles } from "./knowledge/sites";
import { SkillLibrary } from "./knowledge/skills";
import { OllamaClient } from "./llm/ollamaClient";
import { TaskRunner } from "./orchestrator/taskRunner";
import { GoalAgent } from "./planner/goalAgent";
import { ApprovalManager } from "./policy/approvals";
import { KnowledgePack } from "./portable/knowledgePack";
import { PiperService } from "./voice/piper";
import { WhisperService } from "./voice/whisper";
import { CompanionChat } from "./voice/companion";

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), url: z.string().min(1).max(2048) }),
  z.object({ type: z.literal("click"), selector: z.string().min(1).max(500) }),
  z.object({
    type: z.literal("type"),
    selector: z.string().min(1).max(500),
    text: z.string().max(5000),
    secret: z.boolean().optional(),
  }),
  z.object({ type: z.literal("press"), key: z.string().min(1).max(40) }),
  z.object({
    type: z.literal("scroll"),
    deltaY: z.number().min(-5000).max(5000),
  }),
  z.object({ type: z.literal("back") }),
  z.object({ type: z.literal("observe") }),
]);

const id = z.string().min(1).max(100);

const clientSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("action"), action: actionSchema }),
  z.object({
    kind: z.literal("approval"),
    actionId: z.string(),
    approved: z.boolean(),
    acknowledgeNoBackup: z.boolean().optional(),
    via: z.enum(["click", "voice"]).optional(),
  }),
  z.object({
    kind: z.literal("control"),
    command: z.enum([
      "start_browser",
      "close_browser",
      "pause",
      "resume",
      "stop",
      "new_task",
    ]),
  }),
  z.object({
    kind: z.literal("backup"),
    sourcePath: z.string().min(1).max(1000),
    label: z.string().min(1).max(80),
  }),
  z.object({ kind: z.literal("snapshot") }),
  z.object({ kind: z.literal("restore"), backupId: z.string() }),
  z.object({
    kind: z.literal("goal_start"),
    goal: z.string().min(3).max(2000),
    model: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal("goal_plan_decision"),
    approved: z.boolean(),
    feedback: z.string().max(2000).optional(),
  }),
  z.object({
    kind: z.literal("goal_reply"),
    text: z.string().min(1).max(2000),
  }),
  z.object({ kind: z.literal("goal_stop") }),
  z.object({ kind: z.literal("models_refresh") }),
  z.object({ kind: z.literal("knowledge_refresh") }),
  z.object({
    kind: z.literal("research_url"),
    url: z.string().min(1).max(2048),
  }),
  z.object({ kind: z.literal("skill_draft_from_goal") }),
  z.object({
    kind: z.literal("skill_test"),
    skillId: id,
    inputs: z.record(z.string(), z.string().max(500)),
  }),
  z.object({ kind: z.literal("skill_approve"), skillId: id }),
  z.object({ kind: z.literal("skill_revalidate"), skillId: id }),
  z.object({ kind: z.literal("skill_retire"), skillId: id }),
  z.object({
    kind: z.literal("site_note_add"),
    domain: z.string().min(1).max(253),
    note: z.string().min(1).max(500),
    type: z.enum(["note", "pitfall"]),
  }),
  z.object({
    kind: z.literal("set_reply_language"),
    language: z.enum(["en", "ur"]),
  }),
  z.object({ kind: z.literal("set_quick_mode"), enabled: z.boolean() }),
  z.object({
    kind: z.literal("chat"),
    text: z.string().min(1).max(2000),
    requestId: z.string().min(1).max(60),
  }),
  z.object({ kind: z.literal("portable_refresh") }),
  z.object({ kind: z.literal("pack_export") }),
  z.object({
    kind: z.literal("pack_import_apply"),
    importId: id,
    conflictMode: z.enum(["keep_mine", "add_as_draft"]),
  }),
  z.object({ kind: z.literal("pack_import_discard"), importId: id }),
]);

async function main() {
  const clients = new Set<WebSocket>();
  const broadcast = (msg: ServerMessage) => {
    const data = JSON.stringify(msg);
    for (const c of clients) {
      if (c.readyState !== WebSocket.OPEN) continue;
      if (msg.kind === "frame" && c.bufferedAmount > 2_000_000) continue;
      c.send(data);
    }
  };

  const audit = new AuditLog(config.auditDir);
  const backups = new BackupManager(
    config.backupDir,
    config.backupAllowedRoots,
    audit,
  );
  const llm = new OllamaClient(
    config.ollamaUrl,
    config.ollamaNumCtx,
    config.ollamaThink,
  );
  const research = new ResearchService(
    config.researchDir,
    llm,
    audit,
    config.researchAllowPrivate,
  );
  const skills = new SkillLibrary(
    config.skillsDir,
    config.skillMaxAgeDays,
    audit,
  );
  const sites = new SiteProfiles(config.sitesDir);
  await Promise.all([
    backups.init(),
    research.init(),
    skills.init(),
    sites.init(),
  ]);
  const approvals = new ApprovalManager();

  const whisper = new WhisperService({
    bin: config.whisperBin,
    model: config.whisperModel,
    threads: config.whisperThreads,
    tmpDir: config.voiceTmpDir,
    audit,
  });
  const piper = new PiperService({
    bin: config.piperBin,
    voice: config.piperUrduVoice,
    tmpDir: config.voiceTmpDir,
  });
  const voiceStatus = (): VoiceStatus => {
    const p = piper.status();
    return { ...whisper.status(), urduTts: p.available, urduTtsError: p.error };
  };

  let replyLanguage: ReplyLanguage = "en";
  let quickMode = true;
  const companion = new CompanionChat(llm, config.ollamaModel);

  const knowledgeMessage = (): ServerMessage => ({
    kind: "knowledge",
    snapshot: {
      skills: skills.list(),
      research: research.list().slice(0, 100),
      sites: sites.list().slice(0, 100),
      maxAgeDays: config.skillMaxAgeDays,
    },
  });
  const broadcastKnowledge = () => broadcast(knowledgeMessage());

  const pack = new KnowledgePack({
    skills,
    sites,
    research,
    audit,
    skillsDir: config.skillsDir,
    sitesDir: config.sitesDir,
    researchDir: config.researchDir,
    backupsIndexFile: path.join(config.backupDir, "index.json"),
    exportsDir: config.exportsDir,
    appVersion: config.appVersion,
    preferences: {
      approvalMode: config.approvalMode,
      ollamaModel: config.ollamaModel,
      agentMaxSteps: config.agentMaxSteps,
      skillMaxAgeDays: config.skillMaxAgeDays,
    },
  });
  const broadcastPortable = async () =>
    broadcast({ kind: "portable", snapshot: await pack.snapshot() });

  // eslint-disable-next-line prefer-const
  let runner: TaskRunner;
  const browser = new BrowserController({
    profileDir: config.profileDir,
    headless: config.headless,
    viewport: config.viewport,
    onFrame: (data) => broadcast({ kind: "frame", data }),
    onClosed: () => runner.onBrowserClosed(),
  });
  runner = new TaskRunner({
    browser,
    approvals,
    audit,
    backups,
    emit: broadcast,
    approvalMode: config.approvalMode,
  });
  const goals = new GoalAgent({
    runner,
    browser,
    llm,
    audit,
    emit: broadcast,
    research,
    skills,
    sites,
    onKnowledgeChanged: broadcastKnowledge,
    maxSteps: config.agentMaxSteps,
    defaultModel: config.ollamaModel,
    replyLanguage: () => replyLanguage,
    quickMode: () => quickMode,
  });

  const refreshModels = async (): Promise<ModelsInfo> => {
    try {
      const models = await llm.listModels();
      const m = config.ollamaModel;
      const pulled = models.includes(m) || models.includes(`${m}:latest`);
      return {
        available: true,
        models,
        defaultModel: m,
        error: pulled
          ? undefined
          : `Default model "${m}" isn't pulled. Run: ollama pull ${m}`,
      };
    } catch {
      return {
        available: false,
        models: [],
        defaultModel: config.ollamaModel,
        error: `Ollama isn't reachable at ${config.ollamaUrl}. Is it running?`,
      };
    }
  };

  const portableHandler = createPortableHandler({
    exportsDir: config.exportsDir,
    allowedOrigins: config.allowedOrigins,
    onImport: async (buf, fileName) => {
      const preview = await pack.previewImport(buf, fileName);
      await broadcastPortable();
      return preview;
    },
  });
  const voiceHandler = createVoiceHandler({
    allowedOrigins: config.allowedOrigins,
    whisper,
    piper,
  });

  const httpServer = http.createServer((req, res) => {
    if ((req.url ?? "").startsWith("/voice/")) void voiceHandler(req, res);
    else void portableHandler(req, res);
  });

  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: 1_000_000,
    verifyClient: ({ origin }: { origin: string }) =>
      config.allowedOrigins.includes(origin),
  });

  wss.on("connection", (ws) => {
    clients.add(ws);
    const sendTo = (msg: ServerMessage) =>
      ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
    sendTo(runner.hello());
    sendTo({ kind: "goal_update", goal: goals.current() });
    sendTo(knowledgeMessage());
    sendTo({ kind: "voice", status: voiceStatus() });
    void pack
      .snapshot()
      .then((snapshot) => sendTo({ kind: "portable", snapshot }));
    void refreshModels().then((info) => sendTo({ kind: "models", info }));
    ws.on("close", () => clients.delete(ws));

    ws.on("message", async (raw) => {
      let msg: z.infer<typeof clientSchema>;
      try {
        msg = clientSchema.parse(JSON.parse(raw.toString()));
      } catch {
        return runner.log("warn", "Rejected malformed message.");
      }
      try {
        switch (msg.kind) {
          case "action":
            await runner.enqueue(msg.action);
            break;
          case "approval":
            if (
              msg.via === "voice" &&
              msg.approved &&
              runner.riskOf(msg.actionId) === "destructive"
            ) {
              throw new Error(
                "Steps that can't easily be undone need a click, not a voice command.",
              );
            }
            if (
              !approvals.resolve(msg.actionId, {
                approved: msg.approved,
                acknowledgeNoBackup: msg.acknowledgeNoBackup,
              })
            ) {
              runner.log("warn", "No pending approval with that id.");
            }
            void audit.write("approval_decision", {
              actionId: msg.actionId,
              approved: msg.approved,
              acknowledgeNoBackup: !!msg.acknowledgeNoBackup,
              via: msg.via ?? "click",
            });
            break;
          case "control":
            await runner.control(msg.command);
            break;
          case "backup": {
            const rec = await backups.backupPath(
              runner.taskId,
              msg.sourcePath,
              msg.label,
            );
            broadcast({ kind: "backup_update", backup: rec });
            runner.log(
              rec.verified ? "info" : "warn",
              `Backup ${rec.id}: ${rec.notes}`,
            );
            break;
          }
          case "snapshot":
            await runner.snapshotNow();
            break;
          case "restore": {
            const dest = await backups.restoreCopy(msg.backupId);
            runner.log(
              "info",
              `Restored a copy to ${dest} (original untouched).`,
            );
            break;
          }
          case "goal_start":
            await goals.start(msg.goal, msg.model);
            break;
          case "goal_plan_decision":
            await goals.decidePlan(msg.approved, msg.feedback);
            break;
          case "goal_reply":
            goals.reply(msg.text);
            break;
          case "goal_stop":
            await goals.stop();
            break;
          case "models_refresh":
            broadcast({ kind: "models", info: await refreshModels() });
            break;
          case "set_reply_language":
            replyLanguage = msg.language;
            break;
          case "set_quick_mode":
            quickMode = msg.enabled;
            break;
          case "chat": {
            const r = await companion.reply(msg.text, replyLanguage);
            sendTo({
              kind: "chat_reply",
              requestId: msg.requestId,
              reply: r.reply,
              task: r.task,
            });
            break;
          }

          // ---- Phase C ----
          case "knowledge_refresh":
            sendTo(knowledgeMessage());
            break;
          case "research_url": {
            runner.log("info", `Reading ${msg.url}…`);
            const note = await research.research(msg.url, {
              goal: "General reference for future tasks",
              model: config.ollamaModel,
            });
            broadcastKnowledge();
            runner.log("info", `Saved research: ${note.title}`);
            break;
          }
          case "skill_draft_from_goal": {
            const s = await goals.draftSkillFromLastGoal();
            runner.log(
              "info",
              `Draft skill saved: "${s.name}" v${s.version}. Test it on the Knowledge page before it's reused.`,
            );
            break;
          }
          case "skill_test": {
            const s = skills.latest(msg.skillId);
            if (!s || s.status === "retired")
              throw new Error("That skill isn't available.");
            const missing = s.inputs.filter((i) => !msg.inputs[i]?.trim());
            if (missing.length)
              throw new Error(`Fill in: ${missing.join(", ")}`);
            await goals.start(
              `Test the saved skill "${s.name}" (v${s.version}): ${s.purpose}`,
              undefined,
              { testSkill: s, inputs: msg.inputs },
            );
            break;
          }
          case "skill_approve": {
            const s = skills.latest(msg.skillId);
            if (!s) throw new Error("Skill not found.");
            if (s.status !== "tested")
              throw new Error(
                "Only a skill that has passed a test can be approved.",
              );
            await skills.update(
              s.id,
              {
                status: "approved",
                approvedAt: new Date().toISOString(),
                reviewer: "you",
              },
              "Approved by user",
            );
            broadcastKnowledge();
            break;
          }
          case "skill_revalidate":
            await goals.revalidate(msg.skillId);
            break;
          case "skill_retire":
            await skills.update(
              msg.skillId,
              { status: "retired" },
              "Retired by user",
            );
            broadcastKnowledge();
            break;
          case "site_note_add":
            await sites.addNote(msg.domain, msg.note, msg.type);
            broadcastKnowledge();
            break;

          // ---- Phase F1 ----
          case "portable_refresh":
            await broadcastPortable();
            break;
          case "pack_export": {
            runner.log("info", "Building knowledge pack…");
            const result = await pack.exportPack();
            await broadcastPortable();
            runner.log(
              result.excluded.length ? "warn" : "info",
              `Knowledge pack ready: ${result.fileName}${result.excluded.length ? ` (${result.excluded.length} file(s) left out because they looked like secrets)` : ""}`,
            );
            break;
          }
          case "pack_import_apply": {
            const s = await pack.apply(msg.importId, msg.conflictMode);
            broadcastKnowledge();
            await broadcastPortable();
            runner.log(
              "info",
              `Imported: ${s.skillsAdded} skill version(s), ${s.skillDrafts} as drafts, ${s.skillsSkipped} skipped; ${s.sitesNew} new and ${s.sitesMerged} merged site(s); ${s.researchAdded} research note(s).`,
            );
            break;
          }
          case "pack_import_discard":
            pack.discard(msg.importId);
            await broadcastPortable();
            break;
        }
      } catch (err) {
        runner.log("error", err instanceof Error ? err.message : String(err));
      }
    });
  });

  httpServer.listen(config.port, config.host, () => {
    const v = voiceStatus();
    console.log(
      `[agent] http+ws://${config.host}:${config.port} · approvals: ${config.approvalMode} · model: ${config.ollamaModel} · voice: ${v.available ? "ready" : "unavailable"} · urdu speech: ${v.urduTts ? "ready" : "unavailable"}`,
    );
  });

  const shutdown = async () => {
    await Promise.all([browser.close(), research.close()]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
