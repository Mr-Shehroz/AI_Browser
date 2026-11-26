"use client";

import { LogPanel } from "@/components/agent/LogPanel";
import { StatusBar } from "@/components/agent/StatusBar";
import { panel, panelTitle } from "@/components/agent/ui";
import { useAgentSocket } from "@/hooks/useAgentSocket";
import { ResearchPanel } from "./ResearchPanel";
import { SitesPanel } from "./SitesPanel";
import { SkillCard } from "./SkillCard";

export default function KnowledgeBoard() {
  const agent = useAgentSocket();
  const k = (agent as typeof agent & {
    knowledge?: {
      skills?: Array<Parameters<typeof SkillCard>[0]["skill"]>;
      maxAgeDays?: number;
      research?: Parameters<typeof ResearchPanel>[0]["research"];
      sites?: Parameters<typeof SitesPanel>[0]["sites"];
    };
  }).knowledge;
  const skills = k?.skills ?? [];
  const active = skills.filter((s) => s.status !== "retired");
  const retired = skills.filter((s) => s.status === "retired");
  const maxAgeDays = k?.maxAgeDays ?? 30;

  return (
    <div className="min-h-screen">
      <StatusBar
        connected={agent.connected}
        state={agent.state}
        browserOpen={agent.browserOpen}
        taskId={agent.taskId}
        approvalMode={agent.approvalMode}
        send={agent.send}
      />

      <main className="grid gap-6 px-5 pb-8 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="min-w-0 space-y-5">
          <div>
            <h1 className="font-display text-6xl font-black leading-none text-white sm:text-7xl">Skills</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-haze/80">
              Procedures learned from finished goals. Test one to prove it works, then approve it. The agent follows approved
              and tested skills on similar goals, and re-checks their documentation once they&apos;re older than {maxAgeDays} days.
            </p>
          </div>

          {active.length === 0 ? (
            <div className={panel}>
              <h2 className={panelTitle}>Teach it your first skill</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-haze/80">
                Run a goal in the Studio. When it finishes, choose Save as skill and it appears here as a draft, ready to test.
              </p>
            </div>
          ) : (
            active.map((s) => <SkillCard key={s.id} skill={s} maxAgeDays={maxAgeDays} send={agent.send} />)
          )}

          {retired.length > 0 && (
            <details className={panel}>
              <summary className="cursor-pointer font-display text-xl font-bold text-white">Retired ({retired.length})</summary>
              <ul className="mt-3 space-y-1 text-sm text-dim">
                {retired.map((s) => <li key={s.id}>{s.name} v{s.version}</li>)}
              </ul>
            </details>
          )}
        </section>

        <aside className="min-w-0 space-y-5">
          <ResearchPanel research={k?.research ?? []} send={agent.send} />
          <SitesPanel sites={k?.sites ?? []} send={agent.send} />
          <LogPanel logs={agent.logs} />
        </aside>
      </main>
    </div>
  );
}