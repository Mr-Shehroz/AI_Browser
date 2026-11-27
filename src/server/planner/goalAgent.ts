import { randomUUID } from "node:crypto";
import { describeAction, redactAction } from "../../shared/describe";
import type {
  AgentStep,
  GoalRun,
  GoalStatus,
  PageObservation,
  ResearchNote,
  ServerMessage,
  Skill,
  SkillRef,
} from "../../shared/types";
import type { AuditLog } from "../audit/auditLog";
import type { BrowserController } from "../browser/controller";
import type { ResearchService } from "../knowledge/research";
import type { SiteProfiles } from "../knowledge/sites";
import { draftSkill } from "../knowledge/skillDrafter";
import type { SkillLibrary } from "../knowledge/skills";
import { domainOf, extractDomains, extractUrls } from "../knowledge/util";
import type { OllamaClient } from "../llm/ollamaClient";
import type { TaskRunner } from "../orchestrator/taskRunner";
import {
  buildPlanInput,
  buildStepInput,
  formatKnowledge,
  PLAN_SYSTEM_PROMPT,
  STEP_SYSTEM_PROMPT,
} from "./prompt";
import {
  decisionJsonSchema,
  decisionSchema,
  planJsonSchema,
  planSchema,
} from "./schema";
import { toBrowserAction } from "./toAction";

interface Deps {
  runner: TaskRunner;
  browser: BrowserController;
  llm: OllamaClient;
  audit: AuditLog;
  emit: (msg: ServerMessage) => void;
  research: ResearchService;
  skills: SkillLibrary;
  sites: SiteProfiles;
  onKnowledgeChanged: () => void;
  maxSteps: number;
  defaultModel: string;
  replyLanguage: () => "en" | "ur";
  quickMode: () => boolean;
}

export interface StartOptions {
  testSkill?: Skill;
  inputs?: Record<string, string>;
}

const now = () => new Date().toISOString();
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const refOf = (s: Skill): SkillRef => ({
  id: s.id,
  version: s.version,
  name: s.name,
  status: s.status,
});
const TERMINAL = new Set<GoalStatus>(["done", "failed", "stopped"]);
const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_RESEARCH = 5;

export class GoalAgent {
  private run: GoalRun | null = null;
  private notes: string[] = [];
  private researchNotes: ResearchNote[] = [];
  private skillsInUse: Skill[] = [];
  private visitedDomains = new Set<string>();
  private lastUrl = "";
  private abort = new AbortController();
  private looping = false;

  constructor(private d: Deps) {}

  current(): GoalRun | null {
    return this.run;
  }

  private publish(): void {
    this.d.emit({ kind: "goal_update", goal: this.run });
  }

  private patch(p: Partial<GoalRun>): void {
    if (!this.run) return;
    Object.assign(this.run, p);
    this.publish();
  }

  private isState(run: GoalRun, status: GoalStatus): boolean {
    return (
      this.run === run && run.status === status && !this.abort.signal.aborted
    );
  }

  private isLive(run: GoalRun): boolean {
    return this.isState(run, "running");
  }

  private knowledgeFor(obs: PageObservation | null): string {
    const domain = obs ? domainOf(obs.url) : null;
    return formatKnowledge(
      this.researchNotes,
      this.skillsInUse,
      domain ? this.d.sites.get(domain) : null,
    );
  }

  // ---------- lifecycle ----------

  async start(
    goal: string,
    model?: string,
    opts: StartOptions = {},
  ): Promise<void> {
    if (this.run && !TERMINAL.has(this.run.status))
      throw new Error("A goal is already active. Stop it first.");
    await this.d.runner.prepareForGoal();

    this.abort = new AbortController();
    this.notes = [];
    this.researchNotes = [];
    this.skillsInUse = [];
    this.visitedDomains = new Set();
    this.lastUrl = "";
    if (this.d.replyLanguage() === "ur") {
      this.notes.push(
        "Reply language: write every plan summary, ask_user message and finish message in simple, everyday spoken Urdu (Urdu script), mixing common English words like website, page, click, search and OK the way people in Pakistan talk. Avoid formal or literary Urdu. Keep website names and button labels in English.",
      );
    }
    if (opts.inputs && Object.keys(opts.inputs).length) {
      this.notes.push(
        `Inputs for this run: ${Object.entries(opts.inputs)
          .map(([k, v]) => `${k} = ${v}`)
          .join("; ")}`,
      );
    }

    const run: GoalRun = {
      id: randomUUID(),
      goal,
      model: model || this.d.defaultModel,
      status: "planning",
      steps: [],
      usedSkills: [],
      skippedSkills: [],
      researchIds: [],
      testOfSkill: opts.testSkill ? refOf(opts.testSkill) : undefined,
      startedAt: now(),
    };
    this.run = run;
    this.publish();
    void this.d.audit.write("goal_started", {
      goalId: run.id,
      goal,
      model: run.model,
      taskId: this.d.runner.taskId,
      testOfSkill: run.testOfSkill,
    });

    await this.prepareKnowledge(run, opts.testSkill);
    if (!this.isState(run, "planning")) return;
    if (this.d.quickMode() && !opts.testSkill) {
      // Quick mode: no plan. Risky steps still need approval one by one.
      this.patch({ status: "running", activity: undefined });
      void this.d.audit.write("goal_plan_skipped", { goalId: run.id });
      void this.loop();
      return;
    }
    await this.makePlan();
  }

  /** Research supplied URLs, then pick saved skills that are still fresh. */
  private async prepareKnowledge(
    run: GoalRun,
    testSkill?: Skill,
  ): Promise<void> {
    for (const url of extractUrls(run.goal).slice(0, 3)) {
      if (!this.isState(run, "planning")) return;
      this.patch({ activity: `Reading ${url}` });
      try {
        await this.doResearch(run, url);
      } catch (err) {
        this.d.runner.log("warn", `Couldn't read ${url}: ${errMsg(err)}`);
      }
    }

    const candidates = testSkill
      ? [testSkill]
      : this.d.skills.find(run.goal, extractDomains(run.goal));
    for (const c of candidates) {
      if (!this.isState(run, "planning")) return;
      if (!testSkill && this.d.skills.isDue(c)) {
        this.patch({ activity: `Checking "${c.name}" is still current` });
        await this.revalidate(c.id).catch((err) =>
          this.d.runner.log("warn", `Freshness check failed: ${errMsg(err)}`),
        );
      }
      const fresh = this.d.skills.latest(c.id) ?? c;
      if (
        !testSkill &&
        (fresh.status === "stale" || this.d.skills.isDue(fresh))
      ) {
        run.skippedSkills.push({
          name: fresh.name,
          reason: fresh.staleReason ?? "Needs a new test before reuse",
        });
        continue;
      }
      this.skillsInUse.push(fresh);
      run.usedSkills.push(refOf(fresh));
    }
    this.publish();
  }

  private async doResearch(run: GoalRun, url: string): Promise<ResearchNote> {
    const note = await this.d.research.research(url, {
      goal: run.goal,
      model: run.model,
      goalId: run.id,
    });
    this.researchNotes.push(note);
    run.researchIds.push(note.id);
    this.d.onKnowledgeChanged();
    return note;
  }

  private async makePlan(): Promise<void> {
    const run = this.run;
    if (!run) return;
    this.patch({
      status: "planning",
      activity: "Inspecting the page and drafting a plan",
      error: undefined,
    });
    try {
      const obs = this.d.browser.isOpen
        ? await this.d.browser.observe().catch(() => null)
        : null;
      const plan = await this.d.llm.chatJSON({
        model: run.model,
        messages: [
          { role: "system", content: PLAN_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildPlanInput(
              run.goal,
              obs,
              this.notes,
              this.knowledgeFor(obs),
            ),
          },
        ],
        schema: planJsonSchema,
        parse: (v) => planSchema.parse(v),
        signal: this.abort.signal,
      });
      if (!this.isState(run, "planning")) return;
      this.patch({
        status: "awaiting_plan_approval",
        activity: undefined,
        plan: {
          summary: plan.summary,
          steps: plan.steps,
          risks: plan.risks,
          needsFromUser: plan.needs_from_user,
        },
      });
      void this.d.audit.write("goal_plan_proposed", { goalId: run.id, plan });
    } catch (err) {
      this.handleError(run, err);
    }
  }

  async decidePlan(approved: boolean, feedback?: string): Promise<void> {
    const run = this.run;
    if (!run || run.status !== "awaiting_plan_approval")
      throw new Error("No plan is waiting for approval.");
    const note = feedback?.trim();
    void this.d.audit.write("goal_plan_decision", {
      goalId: run.id,
      approved,
      feedback: note,
    });

    if (approved) {
      if (note) this.notes.push(`Note on the plan: ${note}`);
      this.patch({ status: "running" });
      void this.loop();
    } else if (note) {
      this.notes.push(`Revise the plan: ${note}`);
      await this.makePlan();
    } else {
      this.finish(run, "stopped", "Plan rejected.");
    }
  }

  reply(text: string): void {
    const run = this.run;
    if (!run || run.status !== "waiting_user")
      throw new Error("The agent isn't waiting for a reply.");
    this.notes.push(`User answered "${run.question ?? ""}": ${text}`);
    void this.d.audit.write("goal_user_reply", {
      goalId: run.id,
      question: run.question,
      reply: text,
    });
    this.patch({ status: "running", question: undefined });
    void this.loop();
  }

  async stop(): Promise<void> {
    this.abort.abort();
    const run = this.run;
    if (run && !TERMINAL.has(run.status))
      this.finish(run, "stopped", "Stopped by user.");
    await this.d.runner.control("stop");
  }

  private finish(
    run: GoalRun,
    status: GoalStatus,
    result?: string,
    error?: string,
  ): void {
    if (this.run !== run || TERMINAL.has(run.status)) return;
    this.patch({
      status,
      result,
      error,
      activity: undefined,
      finishedAt: now(),
    });
    void this.d.audit.write("goal_finished", {
      goalId: run.id,
      status,
      result,
      error,
      steps: run.steps.length,
    });
    void this.afterFinish(run);
  }

  private handleError(run: GoalRun, err: unknown): void {
    if (this.abort.signal.aborted || this.d.runner.getState() === "stopped") {
      this.finish(run, "stopped", "Stopped.");
    } else {
      this.finish(run, "failed", undefined, errMsg(err));
    }
  }

  private askUser(question: string): void {
    this.patch({ status: "waiting_user", question, activity: undefined });
  }

  // ---------- learning ----------

  /** Records test results and downgrades skills that failed in use. */
  private async afterFinish(run: GoalRun): Promise<void> {
    try {
      const date = now().slice(0, 10);
      if (run.testOfSkill) {
        const s = this.d.skills.latest(run.testOfSkill.id);
        if (!s || s.version !== run.testOfSkill.version) return; // a newer version exists; leave it alone
        if (run.status === "done") {
          await this.d.skills.update(
            s.id,
            {
              status: "tested",
              testedAt: now(),
              lastValidatedAt: now(),
              staleReason: undefined,
              testEvidence: run.result?.slice(0, 600),
            },
            `Test passed (goal ${run.id})`,
          );
        } else if (run.status === "failed") {
          await this.d.skills.update(
            s.id,
            s.status === "draft"
              ? {
                  testEvidence: `Last test failed on ${date}: ${run.error ?? ""}`,
                }
              : {
                  status: "stale",
                  staleReason: `Failed a test on ${date}: ${run.error ?? ""}`,
                },
            "Test failed",
          );
        }
      } else {
        for (const used of this.skillsInUse) {
          const s = this.d.skills.latest(used.id);
          if (!s || s.version !== used.version) continue;
          if (run.status === "done") {
            await this.d.skills.update(
              s.id,
              {
                uses: s.uses + 1,
                successes: s.successes + 1,
                lastUsedAt: now(),
              },
              "Used successfully",
            );
          } else if (run.status === "failed") {
            await this.d.skills.update(
              s.id,
              {
                uses: s.uses + 1,
                lastUsedAt: now(),
                status: "stale",
                staleReason: `A run using this skill failed on ${date}: ${run.error ?? ""}`,
              },
              "Downgraded after a failed run",
            );
          }
        }
      }
      this.d.onKnowledgeChanged();
    } catch (err) {
      this.d.runner.log(
        "warn",
        `Couldn't update skills after the run: ${errMsg(err)}`,
      );
    }
  }

  /** Freshness check: re-reads documentation sources and compares them with saved copies. */
  async revalidate(skillId: string): Promise<Skill> {
    const s = this.d.skills.latest(skillId);
    if (!s) throw new Error("Skill not found.");
    if (s.status === "retired") throw new Error("This skill is retired.");

    const sources = s.sources.filter((x) => x.researchId);
    let updated: Skill;

    if (!sources.length) {
      if (!this.d.skills.isDue(s)) {
        this.d.runner.log(
          "info",
          `"${s.name}" has no documentation sources; it stays valid until ${this.d.skills.maxAgeDays} days after its last test.`,
        );
        return s;
      }
      updated = await this.d.skills.update(
        s.id,
        {
          status: "stale",
          staleReason:
            "No documentation sources to compare, and the last test is older than the freshness window. Test it again.",
        },
        "Marked stale: too old to trust without sources",
      );
    } else {
      const changed: string[] = [];
      for (const src of sources) {
        try {
          const r = await this.d.research.checkChanged(src.researchId!);
          if (r.changed)
            changed.push(
              `${r.url} (${Math.round(r.similarity * 100)}% the same)`,
            );
        } catch (err) {
          changed.push(`${src.url} (couldn't re-read: ${errMsg(err)})`);
        }
      }
      updated = changed.length
        ? await this.d.skills.update(
            s.id,
            {
              status: "stale",
              staleReason: `Documentation changed: ${changed.join("; ")}`,
            },
            "Marked stale after freshness check",
          )
        : await this.d.skills.update(
            s.id,
            { lastValidatedAt: now(), staleReason: undefined },
            "Freshness check passed: sources unchanged",
          );
    }

    this.d.runner.log(
      updated.status === "stale" ? "warn" : "info",
      `Freshness check for "${s.name}": ${updated.status === "stale" ? updated.staleReason : "still current"}`,
    );
    this.d.onKnowledgeChanged();
    return updated;
  }

  async draftSkillFromLastGoal(): Promise<Skill> {
    const run = this.run;
    if (!run || run.status !== "done")
      throw new Error("Finish a goal before saving it as a skill.");
    if (run.testOfSkill)
      throw new Error(
        "This run was a test of an existing skill, and its result is already recorded.",
      );
    if (run.savedSkill)
      throw new Error(`Already saved as "${run.savedSkill.name}".`);

    this.d.runner.log("info", "Drafting a skill from the finished goal…");
    const base = run.usedSkills[0]
      ? this.d.skills.latest(run.usedSkills[0].id)
      : undefined;
    const domains = [
      ...new Set([...this.visitedDomains, ...extractDomains(run.goal)]),
    ];
    const draft = await draftSkill({
      llm: this.d.llm,
      model: run.model,
      run,
      research: this.researchNotes,
      domains,
      risk: this.d.runner.highestRiskSince(run.startedAt),
      existing: base,
    });
    const skill = await this.d.skills.addVersion(draft);
    for (const domain of skill.domains)
      await this.d.sites.linkSkill(domain, skill.id);
    this.patch({ savedSkill: refOf(skill) });
    this.d.onKnowledgeChanged();
    return skill;
  }

  // ---------- Observe → Think → Act → Verify ----------

  private async loop(): Promise<void> {
    if (this.looping || !this.run) return;
    this.looping = true;
    const run = this.run;
    let failures = 0;

    try {
      while (this.isLive(run)) {
        if (run.steps.length >= this.d.maxSteps) {
          this.finish(
            run,
            "failed",
            undefined,
            `Reached the ${this.d.maxSteps}-step limit without finishing.`,
          );
          break;
        }

        if (this.d.runner.getState() === "paused")
          this.patch({ activity: "Paused. Press Resume to continue" });
        await this.d.runner.waitUntilActive(this.abort.signal);
        if (!this.isLive(run)) break;

        // Observe
        const obs = await this.d.browser.observe();
        if (obs.url !== this.lastUrl) {
          this.lastUrl = obs.url;
          const site = await this.d.sites
            .recordVisit(obs.url, obs.title)
            .catch(() => null);
          if (site) {
            this.visitedDomains.add(site.domain);
            this.d.onKnowledgeChanged();
          }
        }

        // Think
        this.patch({ activity: `Thinking (step ${run.steps.length + 1})` });
        const decision = await this.d.llm.chatJSON({
          model: run.model,
          messages: [
            { role: "system", content: STEP_SYSTEM_PROMPT },
            {
              role: "user",
              content: buildStepInput(
                run.goal,
                run.plan,
                run.steps,
                this.notes,
                this.knowledgeFor(obs),
                obs,
              ),
            },
          ],
          schema: decisionJsonSchema,
          parse: (v) => decisionSchema.parse(v),
          signal: this.abort.signal,
        });
        if (!this.isLive(run)) break;

        const step: AgentStep = {
          index: run.steps.length + 1,
          thought: decision.thought,
          decision: decision.action,
          at: now(),
        };

        if (decision.action === "finish") {
          step.outcome = "finished";
          run.steps.push(step);
          this.finish(
            run,
            "done",
            `${decision.message?.trim() || "Finished."}\n\nFinal page: "${obs.title}" (${obs.url})`,
          );
          break;
        }

        if (decision.action === "ask_user") {
          step.outcome = "asked the user";
          run.steps.push(step);
          this.askUser(decision.message?.trim() || decision.thought);
          break;
        }

        if (decision.action === "research") {
          const raw = decision.url?.trim() ?? "";
          step.decision = `research ${raw}`;
          run.steps.push(step);
          if (!raw) {
            step.outcome = "Not executed: research needs a url";
            failures++;
          } else if (run.researchIds.length >= MAX_RESEARCH) {
            step.outcome = `Not executed: research limit (${MAX_RESEARCH}) reached for this goal`;
            failures++;
          } else {
            this.patch({ activity: `Reading ${raw}` });
            try {
              const note = await this.doResearch(
                run,
                raw.includes("://") ? raw : `https://${raw}`,
              );
              step.outcome = `researched: ${note.relevant ? note.summary.slice(0, 180) : "not relevant to the goal"}`;
              failures = 0;
            } catch (err) {
              step.outcome = `failed: ${errMsg(err)}`;
              failures++;
            }
          }
          this.publish();
          if (failures >= MAX_CONSECUTIVE_FAILURES) {
            this.finish(
              run,
              "failed",
              undefined,
              `${MAX_CONSECUTIVE_FAILURES} steps failed in a row.`,
            );
            break;
          }
          continue;
        }

        // Act (through the Phase A safety layer)
        const built = toBrowserAction(decision, obs);
        if ("error" in built) {
          step.decision = `invalid ${decision.action}`;
          step.outcome = `Not executed: ${built.error}`;
          run.steps.push(step);
          this.publish();
          if (++failures >= MAX_CONSECUTIVE_FAILURES) {
            this.finish(
              run,
              "failed",
              undefined,
              "The model produced invalid actions repeatedly.",
            );
            break;
          }
          continue;
        }

        step.decision =
          describeAction(redactAction(built.action)) +
          (built.label ? ` ("${built.label}")` : "");

        const previous = run.steps.slice(-2);
        if (
          built.action.type !== "scroll" &&
          previous.length === 2 &&
          previous.every((s) => s.decision === step.decision)
        ) {
          step.outcome = "Not executed: same action repeated 3 times";
          run.steps.push(step);
          this.askUser(
            `I keep trying "${step.decision}" without progress. How should I proceed?`,
          );
          break;
        }

        run.steps.push(step);
        this.patch({ activity: `Executing: ${step.decision}` });

        const rec = await this.d.runner.enqueue(built.action);

        // Verify
        if (!rec || rec.status === "cancelled") {
          step.outcome = "cancelled";
          this.finish(run, "stopped", "Stopped before the action ran.");
          break;
        }
        step.outcome = [rec.status, rec.verification, rec.error]
          .filter(Boolean)
          .join(": ");
        this.publish();

        if (rec.status === "failed" || rec.status === "blocked") failures++;
        else failures = 0;

        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          this.finish(
            run,
            "failed",
            undefined,
            `${MAX_CONSECUTIVE_FAILURES} actions failed in a row.`,
          );
          break;
        }
      }
    } catch (err) {
      this.handleError(run, err);
    } finally {
      this.looping = false;
    }
  }
}
