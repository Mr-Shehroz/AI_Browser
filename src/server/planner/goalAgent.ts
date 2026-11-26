import { randomUUID } from "node:crypto";
import { describeAction, redactAction } from "../../shared/describe";
import type { AgentStep, GoalRun, GoalStatus, ServerMessage } from "../../shared/types";
import type { AuditLog } from "../audit/auditLog";
import type { BrowserController } from "../browser/controller";
import type { OllamaClient } from "../llm/ollamaClient";
import type { TaskRunner } from "../orchestrator/taskRunner";
import { buildPlanInput, buildStepInput, PLAN_SYSTEM_PROMPT, STEP_SYSTEM_PROMPT } from "./prompt";
import { decisionJsonSchema, decisionSchema, planJsonSchema, planSchema } from "./schema";
import { toBrowserAction } from "./toAction";

interface Deps {
  runner: TaskRunner;
  browser: BrowserController;
  llm: OllamaClient;
  audit: AuditLog;
  emit: (msg: ServerMessage) => void;
  maxSteps: number;
  defaultModel: string;
}

const now = () => new Date().toISOString();
const TERMINAL = new Set<GoalStatus>(["done", "failed", "stopped"]);
const MAX_CONSECUTIVE_FAILURES = 3;

export class GoalAgent {
  private run: GoalRun | null = null;
  private notes: string[] = [];
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

  private isLive(run: GoalRun): boolean {
    return this.run === run && run.status === "running" && !this.abort.signal.aborted;
  }

  async start(goal: string, model?: string): Promise<void> {
    if (this.run && !TERMINAL.has(this.run.status)) throw new Error("A goal is already active. Stop it first.");
    await this.d.runner.prepareForGoal();
    this.abort = new AbortController();
    this.notes = [];
    this.run = { id: randomUUID(), goal, model: model || this.d.defaultModel, status: "planning", steps: [], startedAt: now() };
    this.publish();
    void this.d.audit.write("goal_started", { goalId: this.run.id, goal, model: this.run.model, taskId: this.d.runner.taskId });
    await this.makePlan();
  }

  private async makePlan(): Promise<void> {
    const run = this.run;
    if (!run) return;
    this.patch({ status: "planning", activity: "Inspecting the page and drafting a plan", error: undefined });
    try {
      const obs = this.d.browser.isOpen ? await this.d.browser.observe().catch(() => null) : null;
      const plan = await this.d.llm.chatJSON({
        model: run.model,
        messages: [
          { role: "system", content: PLAN_SYSTEM_PROMPT },
          { role: "user", content: buildPlanInput(run.goal, obs, this.notes) },
        ],
        schema: planJsonSchema,
        parse: (v) => planSchema.parse(v),
        signal: this.abort.signal,
      });
      if (this.run !== run || run.status !== "planning") return;
      this.patch({
        status: "awaiting_plan_approval",
        activity: undefined,
        plan: { summary: plan.summary, steps: plan.steps, risks: plan.risks, needsFromUser: plan.needs_from_user },
      });
      void this.d.audit.write("goal_plan_proposed", { goalId: run.id, plan });
    } catch (err) {
      this.handleError(run, err);
    }
  }

  async decidePlan(approved: boolean, feedback?: string): Promise<void> {
    const run = this.run;
    if (!run || run.status !== "awaiting_plan_approval") throw new Error("No plan is waiting for approval.");
    const note = feedback?.trim();
    void this.d.audit.write("goal_plan_decision", { goalId: run.id, approved, feedback: note });

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
    if (!run || run.status !== "waiting_user") throw new Error("The agent isn't waiting for a reply.");
    this.notes.push(`User answered "${run.question ?? ""}": ${text}`);
    void this.d.audit.write("goal_user_reply", { goalId: run.id, question: run.question, reply: text });
    this.patch({ status: "running", question: undefined });
    void this.loop();
  }

  async stop(): Promise<void> {
    this.abort.abort();
    const run = this.run;
    if (run && !TERMINAL.has(run.status)) this.finish(run, "stopped", "Stopped by user.");
    await this.d.runner.control("stop");
  }

  private finish(run: GoalRun, status: GoalStatus, result?: string, error?: string): void {
    if (this.run !== run || TERMINAL.has(run.status)) return;
    this.patch({ status, result, error, activity: undefined, finishedAt: now() });
    void this.d.audit.write("goal_finished", { goalId: run.id, status, result, error, steps: run.steps.length });
  }

  private handleError(run: GoalRun, err: unknown): void {
    if (this.abort.signal.aborted || this.d.runner.getState() === "stopped") {
      this.finish(run, "stopped", "Stopped.");
    } else {
      this.finish(run, "failed", undefined, err instanceof Error ? err.message : String(err));
    }
  }

  private askUser(run: GoalRun, question: string): void {
    this.patch({ status: "waiting_user", question, activity: undefined });
  }

  /** Observe → Think → Act → Verify, one action per iteration. */
  private async loop(): Promise<void> {
    if (this.looping || !this.run) return;
    this.looping = true;
    const run = this.run;
    let failures = 0;

    try {
      while (this.isLive(run)) {
        if (run.steps.length >= this.d.maxSteps) {
          this.finish(run, "failed", undefined, `Reached the ${this.d.maxSteps}-step limit without finishing.`);
          break;
        }

        // Respect pause / human takeover / CAPTCHA pause.
        if (this.d.runner.getState() === "paused") this.patch({ activity: "Paused — press Resume to continue" });
        await this.d.runner.waitUntilActive(this.abort.signal);
        if (!this.isLive(run)) break;

        // Observe
        const obs = await this.d.browser.observe();

        // Think
        this.patch({ activity: `Thinking (step ${run.steps.length + 1})` });
        const decision = await this.d.llm.chatJSON({
          model: run.model,
          messages: [
            { role: "system", content: STEP_SYSTEM_PROMPT },
            { role: "user", content: buildStepInput(run.goal, run.plan, run.steps, this.notes, obs) },
          ],
          schema: decisionJsonSchema,
          parse: (v) => decisionSchema.parse(v),
          signal: this.abort.signal,
        });
        if (!this.isLive(run)) break;

        const step: AgentStep = { index: run.steps.length + 1, thought: decision.thought, decision: decision.action, at: now() };

        if (decision.action === "finish") {
          step.outcome = "finished";
          run.steps.push(step);
          const message = decision.message?.trim() || "Finished.";
          this.finish(run, "done", `${message}\n\nFinal page: "${obs.title}" — ${obs.url}`);
          break;
        }

        if (decision.action === "ask_user") {
          step.outcome = "asked the user";
          run.steps.push(step);
          this.askUser(run, decision.message?.trim() || decision.thought);
          break;
        }

        // Act (through the Phase A safety layer)
        const built = toBrowserAction(decision, obs);
        if ("error" in built) {
          step.decision = `invalid ${decision.action}`;
          step.outcome = `Not executed: ${built.error}`;
          run.steps.push(step);
          this.publish();
          if (++failures >= MAX_CONSECUTIVE_FAILURES) {
            this.finish(run, "failed", undefined, "The model produced invalid actions repeatedly.");
            break;
          }
          continue;
        }

        step.decision = describeAction(redactAction(built.action)) + (built.label ? ` ("${built.label}")` : "");

        const previous = run.steps.slice(-2);
        if (built.action.type !== "scroll" && previous.length === 2 && previous.every((s) => s.decision === step.decision)) {
          step.outcome = "Not executed: same action repeated 3 times";
          run.steps.push(step);
          this.askUser(run, `I keep trying "${step.decision}" without progress. How should I proceed?`);
          break;
        }

        run.steps.push(step);
        this.patch({ activity: `Executing: ${step.decision}` });

        const rec = await this.d.runner.enqueue(built.action);

        // Verify (evidence comes from the runner's post-action observation)
        if (!rec || rec.status === "cancelled") {
          step.outcome = "cancelled";
          this.finish(run, "stopped", "Stopped before the action ran.");
          break;
        }
        step.outcome = [rec.status, rec.verification, rec.error].filter(Boolean).join(": ");
        this.publish();

        if (rec.status === "failed" || rec.status === "blocked") failures++;
        else failures = 0;

        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          this.finish(run, "failed", undefined, `${MAX_CONSECUTIVE_FAILURES} actions failed in a row.`);
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