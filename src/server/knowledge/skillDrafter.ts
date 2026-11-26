import { z } from "zod";
import type { GoalRun, ResearchNote, RiskLevel, Skill } from "../../shared/types";
import type { OllamaClient } from "../llm/ollamaClient";
import { sanitizeDeep, sanitizeText } from "./sanitize";
import type { SkillDraft } from "./skills";
import { slugify } from "./util";

const clip = (n: number) => z.string().transform((s) => s.slice(0, n));

const draftSchema = z.object({
  name: clip(80),
  purpose: clip(400),
  prerequisites: z.array(clip(200)).max(8),
  inputs: z.array(clip(60)).max(8),
  steps: z.array(z.object({ instruction: clip(300), expected: clip(200).optional() })).min(1).max(20),
  verification: z.array(clip(200)).max(8),
  failure_cases: z.array(clip(200)).max(8),
  rollback: clip(300),
  confidence: z.enum(["low", "medium", "high"]),
});

const draftJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    purpose: { type: "string" },
    prerequisites: { type: "array", items: { type: "string" } },
    inputs: { type: "array", items: { type: "string" } },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: { instruction: { type: "string" }, expected: { type: "string" } },
        required: ["instruction"],
      },
    },
    verification: { type: "array", items: { type: "string" } },
    failure_cases: { type: "array", items: { type: "string" } },
    rollback: { type: "string" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: ["name", "purpose", "prerequisites", "inputs", "steps", "verification", "failure_cases", "rollback", "confidence"],
};

const SKILL_PROMPT = `You turn a successful browser run into a reusable procedure (a "skill") that a careful browser agent can follow again later.

Rules:
- Make it generic. Replace values specific to this run (names, emails, search terms, IDs, amounts, typed text) with named inputs written as {{input_name}}, and list each input name in "inputs".
- Describe steps by intent and by the visible labels on the page (button text, menu names, field labels). Never mention element refs like e12; they change on every visit.
- Leave out failed or abandoned attempts, but turn what went wrong into "failure_cases".
- Never include passwords, one-time codes, tokens, cookies or personal data. Signing in is a prerequisite the human handles.
- "verification" lists what should be visible on the page once the skill has worked.
- "rollback" explains how to undo the result, or says plainly that it can't be undone.
- Use confidence "low" if the run needed many retries or help from the user, and "high" only if it went straight through.
Reply with JSON only.`;

export async function draftSkill(opts: {
  llm: OllamaClient;
  model: string;
  run: GoalRun;
  research: ResearchNote[];
  domains: string[];
  risk: RiskLevel;
  existing?: Skill;
}): Promise<SkillDraft> {
  const { run, research, existing } = opts;

  const steps = run.steps
    .filter((s) => !s.outcome?.startsWith("Not executed"))
    .map((s) => `${s.index}. ${s.decision.replace(/\[data-agent-ref="e\d+"\]/g, "element")} => ${s.outcome ?? "unknown"}`)
    .join("\n");

  const docs = research
    .filter((n) => n.relevant)
    .map((n) => `- ${n.title} (${n.url}): ${n.summary}`)
    .join("\n");

  const input = [
    `GOAL: ${run.goal}`,
    run.plan ? `PLAN SUMMARY: ${run.plan.summary}` : "",
    run.result ? `FINAL REPORT: ${run.result}` : "",
    `STEPS (in order, with outcomes):\n${steps}`,
    docs ? `DOCUMENTATION READ:\n${docs}` : "",
    existing ? `EXISTING SKILL TO IMPROVE: "${existing.name}"\n${existing.steps.map((s, i) => `${i + 1}. ${s.instruction}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");

  const d = await opts.llm.chatJSON({
    model: opts.model,
    messages: [
      { role: "system", content: SKILL_PROMPT },
      { role: "user", content: input },
    ],
    schema: draftJsonSchema,
    parse: (v) => draftSchema.parse(v),
  });

  const content = sanitizeDeep({
    name: d.name,
    purpose: d.purpose,
    prerequisites: d.prerequisites,
    inputs: d.inputs,
    steps: d.steps,
    verification: d.verification,
    failureCases: d.failure_cases,
    rollback: d.rollback,
  });

  return {
    id: existing?.id ?? (slugify(content.name) || `skill-${Date.now()}`),
    ...content,
    domains: opts.domains.slice(0, 5),
    risk: opts.risk,
    confidence: d.confidence,
    sources: research
      .filter((n) => n.relevant)
      .map((n) => ({ url: n.url, researchId: n.id, accessedAt: n.accessedAt })),
    derivedFromGoal: sanitizeText(run.goal),
  };
}