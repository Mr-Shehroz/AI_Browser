"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { btn, btnPrimary, input, panel } from "@/components/agent/ui";
import type { ClientMessage, Skill, SkillStatus } from "@/shared/types";

const statusLabel: Record<SkillStatus, string> = {
  draft: "Draft",
  tested: "Tested",
  approved: "Approved",
  stale: "Needs attention",
  retired: "Retired",
};

const statusStyle: Record<SkillStatus, string> = {
  draft: "bg-haze/10 text-haze",
  tested: "bg-teal/10 text-teal",
  approved: "bg-teal/20 text-teal",
  stale: "bg-amber/15 text-amber",
  retired: "bg-dim/15 text-dim",
};

function ago(iso?: string): string {
  if (!iso) return "Never";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-white">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-haze/85">
        {items.map((i, n) => <li key={n}>{i}</li>)}
      </ul>
    </div>
  );
}

interface Props {
  skill: Skill;
  maxAgeDays: number;
  send: (msg: ClientMessage) => void;
}

export function SkillCard({ skill, maxAgeDays, send }: Props) {
  const router = useRouter();
  const [testing, setTesting] = useState(false);
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const ref = skill.lastValidatedAt ?? skill.testedAt;
  const due = !ref || Date.now() - Date.parse(ref) > maxAgeDays * 86_400_000;
  const missing = skill.inputs.filter((i) => !inputs[i]?.trim());

  return (
    <article className={`${panel} space-y-4`}>
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-3xl font-bold leading-none text-white">{skill.name}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-haze/85">{skill.purpose}</p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyle[skill.status]}`}>
          {statusLabel[skill.status]}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <div><dt className="text-dim">Version</dt><dd className="font-semibold text-white">v{skill.version}</dd></div>
        <div><dt className="text-dim">Last tested</dt><dd className="font-semibold text-white">{ago(skill.testedAt)}</dd></div>
        <div>
          <dt className="text-dim">Freshness check</dt>
          <dd className={`font-semibold ${due ? "text-amber" : "text-white"}`}>{due ? "Due now" : ago(ref)}</dd>
        </div>
        <div><dt className="text-dim">Runs</dt><dd className="font-semibold text-white">{skill.successes} of {skill.uses} succeeded</dd></div>
      </dl>

      {skill.staleReason && (
        <p className="rounded-lg border border-amber/40 bg-amber/5 p-2.5 text-xs leading-relaxed text-amber">{skill.staleReason}</p>
      )}
      {skill.status === "draft" && skill.testEvidence && (
        <p className="text-xs text-ember">{skill.testEvidence}</p>
      )}

      <details>
        <summary className="cursor-pointer text-sm font-semibold text-teal">Procedure, checks and sources</summary>
        <div className="mt-3 space-y-3">
          <List title="Inputs" items={skill.inputs} />
          <List title="Before you start" items={skill.prerequisites} />
          <div>
            <p className="text-xs font-semibold text-white">Steps</p>
            <ol className="mt-1 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-haze marker:text-amber">
              {skill.steps.map((s, i) => (
                <li key={i}>
                  {s.instruction}
                  {s.expected && <span className="block text-xs text-dim">Expect: {s.expected}</span>}
                </li>
              ))}
            </ol>
          </div>
          <List title="How to verify" items={skill.verification} />
          <List title="Known failure cases" items={skill.failureCases} />
          {skill.rollback && (
            <p className="text-xs leading-relaxed text-haze/85"><span className="font-semibold text-white">Undo: </span>{skill.rollback}</p>
          )}
          {skill.sources.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-white">Sources</p>
              <ul className="mt-1 space-y-1 text-xs">
                {skill.sources.map((s) => (
                  <li key={s.url} className="break-all">
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-teal underline-offset-2 hover:underline">{s.url}</a>
                    <span className="text-dim">, read {ago(s.accessedAt).toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-dim">
            Highest risk: {skill.risk.replace("_", " ")}. Confidence: {skill.confidence}. Sites: {skill.domains.join(", ") || "any"}.
          </p>
        </div>
      </details>

      {testing ? (
        <form
          className="space-y-3 rounded-lg border border-teal/30 bg-teal/5 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (missing.length) return;
            send({ kind: "skill_test", skillId: skill.id, inputs });
            router.push("/");
          }}
        >
          {skill.inputs.length === 0 ? (
            <p className="text-xs text-haze/85">This skill needs no inputs.</p>
          ) : (
            skill.inputs.map((name) => (
              <label key={name} className="block text-xs font-semibold text-white">
                {name}
                <input
                  className={`${input} mt-1`}
                  value={inputs[name] ?? ""}
                  onChange={(e) => setInputs((p) => ({ ...p, [name]: e.target.value }))}
                />
              </label>
            ))
          )}
          <p className="text-xs text-dim">The test runs in the Studio like any goal: you approve the plan and every risky step.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className={btn} onClick={() => setTesting(false)}>Cancel</button>
            <button className={btnPrimary} disabled={missing.length > 0}>Run test</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button className={skill.status === "tested" ? btn : btnPrimary} onClick={() => setTesting(true)}>Test</button>
          {skill.status === "tested" && (
            <button className={btnPrimary} onClick={() => send({ kind: "skill_approve", skillId: skill.id })}>Approve</button>
          )}
          <button className={btn} onClick={() => send({ kind: "skill_revalidate", skillId: skill.id })}>Check freshness</button>
          <button className={`${btn} ml-auto`} onClick={() => send({ kind: "skill_retire", skillId: skill.id })}>Retire</button>
        </div>
      )}
    </article>
  );
}