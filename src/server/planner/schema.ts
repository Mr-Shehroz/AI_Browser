import { z } from "zod";

export const DECISION_ACTIONS = ["navigate", "click", "type", "press", "scroll", "back", "ask_user", "finish"] as const;

const clip = (n: number) => z.string().transform((s) => s.slice(0, n));

export const decisionSchema = z.object({
  thought: clip(600),
  action: z.enum(DECISION_ACTIONS),
  url: z.string().optional(),
  ref: z.string().optional(),
  text: z.string().max(5000).optional(),
  key: z.string().optional(),
  direction: z.enum(["up", "down"]).optional(),
  message: clip(2000).optional(),
});
export type Decision = z.infer<typeof decisionSchema>;

// Flat schema: small local models follow this far more reliably than oneOf unions.
export const decisionJsonSchema = {
  type: "object",
  properties: {
    thought: { type: "string" },
    action: { type: "string", enum: [...DECISION_ACTIONS] },
    url: { type: "string" },
    ref: { type: "string" },
    text: { type: "string" },
    key: { type: "string" },
    direction: { type: "string", enum: ["up", "down"] },
    message: { type: "string" },
  },
  required: ["thought", "action"],
};

export const planSchema = z.object({
  summary: clip(800),
  steps: z.array(clip(300)).min(1).max(12),
  risks: z.array(clip(300)).max(8),
  needs_from_user: z.array(clip(300)).max(6),
});

export const planJsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    steps: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    needs_from_user: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "steps", "risks", "needs_from_user"],
};