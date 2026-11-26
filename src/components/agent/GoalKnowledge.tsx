"use client";

import Link from "next/link";
import { useState } from "react";
import type { ClientMessage, GoalRun } from "@/shared/types";
import { btnPrimary } from "./ui";

export function GoalKnowledge({ goal, send }: { goal: GoalRun; send: (msg: ClientMessage) => void }) {
  const [saving, setSaving] = useState(false);
  const used = goal.usedSkills ?? [];
  const skipped = goal.skippedSkills ?? [];
  const researchCount = goal.researchIds?.length ?? 0;
  const canSave = goal.status === "done" && !goal.savedSkill && !goal.testOfSkill;

  return (
    <div className="space-y-3 text-xs">
      {goal.testOfSkill && (
        <p className="text-teal">Testing the skill “{goal.testOfSkill.name}” v{goal.testOfSkill.version}</p>
      )}

      {used.length > 0 && (
        <div>
          <p className="font-semibold text-teal">Following saved skills</p>
          <ul className="mt-1 list-disc pl-5 text-haze/85">
            {used.map((s) => <li key={s.id}>{s.name} v{s.version} ({s.status})</li>)}
          </ul>
        </div>
      )}

      {skipped.length > 0 && (
        <div>
          <p className="font-semibold text-amber">Skipped skills that need attention</p>
          <ul className="mt-1 list-disc pl-5 text-haze/85">
            {skipped.map((s) => <li key={s.name}>{s.name}: {s.reason}</li>)}
          </ul>
        </div>
      )}

      {researchCount > 0 && (
        <p className="text-dim">
          Read {researchCount} documentation {researchCount === 1 ? "page" : "pages"} for this goal.{" "}
          <Link href="/knowledge" className="text-teal underline-offset-2 hover:underline">View research</Link>
        </p>
      )}

      {canSave && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-teal/30 bg-teal/5 p-3">
          <p className="leading-relaxed text-haze/85">
            Save this as a draft skill. After you test and approve it, the agent will reuse it on similar goals.
          </p>
          <button
            className={btnPrimary}
            disabled={saving}
            onClick={() => {
              setSaving(true);
              send({ kind: "skill_draft_from_goal" });
            }}
          >
            {saving ? "Drafting…" : "Save as skill"}
          </button>
        </div>
      )}

      {goal.savedSkill && (
        <p className="text-teal">
          Saved as the draft skill “{goal.savedSkill.name}” v{goal.savedSkill.version}.{" "}
          <Link href="/knowledge" className="underline underline-offset-2">Test it on the Knowledge page</Link>
        </p>
      )}
    </div>
  );
}