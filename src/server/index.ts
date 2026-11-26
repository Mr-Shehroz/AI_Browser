import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import type { ModelsInfo, ServerMessage } from "../shared/types";
import { AuditLog } from "./audit/auditLog";
import { BackupManager } from "./backup/backupManager";
import { BrowserController } from "./browser/controller";
import { config } from "./config";
import { ResearchService } from "./knowledge/research";
import { SiteProfiles } from "./knowledge/sites";
import { SkillLibrary } from "./knowledge/skills";
import { OllamaClient } from "./llm/ollamaClient";
import { TaskRunner } from "./orchestrator/taskRunner";
import { GoalAgent } from "./planner/goalAgent";
import { ApprovalManager } from "./policy/approvals";

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), url: z.string().min(1).max(2048) }),
  z.object({ type: z.literal("click"), selector: z.string().min(1).max(500) }),
  z.object({ type: z.literal("type"), selector: z.string().min(1).max(500), text: z.string().max(5000), secret: z.boolean().optional() }),
  z.object({ type: z.literal("press"), key: z.string().min(1).max(40) }),
  z.object({ type: z.literal("scroll"), deltaY: z.number().min(-5000).max(5000) }),
  z.object({ type: z.literal("back") }),
  z.object({ type: z.literal("observe") }),
]);

const id = z.string().min(1).max(100);

const clientSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("action"), action: actionSchema }),
  z.object({ kind: z.literal("approval"), actionId: z.string(), approved: z.boolean(), acknowledgeNoBackup: z.boolean().optional() }),
  z.object({ kind: z.literal("control"), command: z.enum(["start_browser", "close_browser", "pause", "resume", "stop", "new_task"]) }),
  z.object({ kind: z.literal("backup"), sourcePath: z.string().min(1).max(1000), label: z.string().min(1).max(80) }),
  z.object({ kind: z.literal("snapshot") }),
  z.object({ kind: z.literal("restore"), backupId: z.string() }),
  z.object({ kind: z.literal("goal_start"), goal: z.string().min(3).max(2000), model: z.string().max(200).optional() }),
  z.object({ kind: z.literal("goal_plan_decision"), approved: z.boolean(), feedback: z.string().max(2000).optional() }),
  z.object({ kind: z.literal("goal_reply"), text: z.string().min(1).max(2000) }),
  z.object({ kind: z.literal("goal_stop") }),
  z.object({ kind: z.literal("models_refresh") }),
  z.object({ kind: z.literal("knowledge_refresh") }),
  z.object({ kind: z.literal("research_url"), url: z.string().min(1).max(2048) }),
  z.object({ kind: z.literal("skill_draft_from_goal") }),
  z.object({ kind: z.literal("skill_test"), skillId: id, inputs: z.record(z.string(), z.string().max(500)) }),
  z.object({ kind: z.literal("skill_approve"), skillId: id }),
  z.object({ kind: z.literal("skill_revalidate"), skillId: id }),
  z.object({ kind: z.literal("skill_retire"), skillId: id }),
  z.object({ kind: z.literal("site_note_add"), domain: z.string().min(1).max(253), note: z.string().min(1).max(500), type: z.enum(["note", "pitfall"]) }),
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
  const backups = new BackupManager(config.backupDir, config.backupAllowedRoots, audit);
  const llm = new OllamaClient(config.ollamaUrl, config.ollamaNumCtx, config.ollamaThink);
  const research = new ResearchService(config.researchDir, llm, audit, config.researchAllowPrivate);
  const skills = new SkillLibrary(config.skillsDir, config.skillMaxAgeDays, audit);
  const sites = new SiteProfiles(config.sitesDir);
  await Promise.all([backups.init(), research.init(), skills.init(), sites.init()]);
  const approvals = new ApprovalManager();

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

  // eslint-disable-next-line prefer-const
  let runner: TaskRunner;
  const browser = new BrowserController({
    profileDir: config.profileDir,
    headless: config.headless,
    viewport: config.viewport,
    onFrame: (data) => broadcast({ kind: "frame", data }),
    onClosed: () => runner.onBrowserClosed(),
  });
  runner = new TaskRunner({ browser, approvals, audit, backups, emit: broadcast, approvalMode: config.approvalMode });
  const goals = new GoalAgent({
    runner, browser, llm, audit, emit: broadcast, research, skills, sites,
    onKnowledgeChanged: broadcastKnowledge,
    maxSteps: config.agentMaxSteps, defaultModel: config.ollamaModel,
  });

  const refreshModels = async (): Promise<ModelsInfo> => {
    try {
      const models = await llm.listModels();
      const m = config.ollamaModel;
      const pulled = models.includes(m) || models.includes(`${m}:latest`);
      return { available: true, models, defaultModel: m, error: pulled ? undefined : `Default model "${m}" isn't pulled. Run: ollama pull ${m}` };
    } catch {
      return { available: false, models: [], defaultModel: config.ollamaModel, error: `Ollama isn't reachable at ${config.ollamaUrl}. Is it running?` };
    }
  };

  const wss = new WebSocketServer({
    host: config.host,
    port: config.port,
    maxPayload: 1_000_000,
    verifyClient: ({ origin }: { origin: string }) => config.allowedOrigins.includes(origin),
  });

  wss.on("connection", (ws) => {
    clients.add(ws);
    const sendTo = (msg: ServerMessage) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
    sendTo(runner.hello());
    sendTo({ kind: "goal_update", goal: goals.current() });
    sendTo(knowledgeMessage());
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
            if (!approvals.resolve(msg.actionId, { approved: msg.approved, acknowledgeNoBackup: msg.acknowledgeNoBackup })) {
              runner.log("warn", "No pending approval with that id.");
            }
            void audit.write("approval_decision", { actionId: msg.actionId, approved: msg.approved, acknowledgeNoBackup: !!msg.acknowledgeNoBackup });
            break;
          case "control":
            await runner.control(msg.command);
            break;
          case "backup": {
            const rec = await backups.backupPath(runner.taskId, msg.sourcePath, msg.label);
            broadcast({ kind: "backup_update", backup: rec });
            runner.log(rec.verified ? "info" : "warn", `Backup ${rec.id}: ${rec.notes}`);
            break;
          }
          case "snapshot":
            await runner.snapshotNow();
            break;
          case "restore": {
            const dest = await backups.restoreCopy(msg.backupId);
            runner.log("info", `Restored a copy to ${dest} (original untouched).`);
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

          // ---- Phase C ----
          case "knowledge_refresh":
            sendTo(knowledgeMessage());
            break;
          case "research_url": {
            runner.log("info", `Reading ${msg.url}…`);
            const note = await research.research(msg.url, { goal: "General reference for future tasks", model: config.ollamaModel });
            broadcastKnowledge();
            runner.log("info", `Saved research: ${note.title}`);
            break;
          }
          case "skill_draft_from_goal": {
            const s = await goals.draftSkillFromLastGoal();
            runner.log("info", `Draft skill saved: "${s.name}" v${s.version}. Test it on the Knowledge page before it's reused.`);
            break;
          }
          case "skill_test": {
            const s = skills.latest(msg.skillId);
            if (!s || s.status === "retired") throw new Error("That skill isn't available.");
            const missing = s.inputs.filter((i) => !msg.inputs[i]?.trim());
            if (missing.length) throw new Error(`Fill in: ${missing.join(", ")}`);
            await goals.start(`Test the saved skill "${s.name}" (v${s.version}): ${s.purpose}`, undefined, { testSkill: s, inputs: msg.inputs });
            break;
          }
          case "skill_approve": {
            const s = skills.latest(msg.skillId);
            if (!s) throw new Error("Skill not found.");
            if (s.status !== "tested") throw new Error("Only a skill that has passed a test can be approved.");
            await skills.update(s.id, { status: "approved", approvedAt: new Date().toISOString(), reviewer: "you" }, "Approved by user");
            broadcastKnowledge();
            break;
          }
          case "skill_revalidate":
            await goals.revalidate(msg.skillId);
            break;
          case "skill_retire":
            await skills.update(msg.skillId, { status: "retired" }, "Retired by user");
            broadcastKnowledge();
            break;
          case "site_note_add":
            await sites.addNote(msg.domain, msg.note, msg.type);
            broadcastKnowledge();
            break;
        }
      } catch (err) {
        runner.log("error", err instanceof Error ? err.message : String(err));
      }
    });
  });

  console.log(`[agent] ws://${config.host}:${config.port} · approvals: ${config.approvalMode} · model: ${config.ollamaModel}`);

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