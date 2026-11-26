"use client";

import { useEffect, useState } from "react";
import { LogPanel } from "@/components/agent/LogPanel";
import { StatusBar } from "@/components/agent/StatusBar";
import { useAgentSocket } from "@/hooks/useAgentSocket";
import { CanvasStage } from "./CanvasStage";
import { Gallery, type Selection } from "./Gallery";
import { DEFAULT_FORM, fromJob, GeneratePanel, type ImageForm } from "./GeneratePanel";
import { HardwarePanel } from "./HardwarePanel";

export default function CreateBoard() {
  const agent = useAgentSocket();
  const c = agent.creative;
  const jobs = c?.jobs ?? [];

  const [form, setForm] = useState<ImageForm>(DEFAULT_FORM);
  const [selected, setSelected] = useState<Selection | null>(null);

  const active = jobs.find((j) => j.status === "running") ?? null;
  const selectedJob = selected ? jobs.find((j) => j.id === selected.jobId) ?? null : null;

  // Show the newest finished image automatically.
  const latestDone = jobs.find((j) => j.status === "done");
  useEffect(() => {
    if (latestDone) setSelected({ jobId: latestDone.id, image: latestDone.images[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestDone?.id]);

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
          <CanvasStage
            job={selectedJob}
            image={selected?.image ?? null}
            active={active}
            onTransform={(img) => setForm((f) => ({ ...f, mode: "img2img", source: { kind: "image", name: img } }))}
            onUpscale={(img) => setForm((f) => ({ ...f, mode: "upscale", source: { kind: "image", name: img } }))}
            onReuse={(job) => setForm((f) => fromJob(job, f))}
          />
          <Gallery
            jobs={jobs}
            selected={selected}
            onSelect={setSelected}
            onCancel={(jobId) => agent.send({ kind: "image_cancel", jobId })}
          />
        </section>

        <aside className="min-w-0 space-y-5">
          <GeneratePanel snapshot={c} form={form} setForm={setForm} send={agent.send} connected={agent.connected} />
          <HardwarePanel snapshot={c} send={agent.send} />
          <LogPanel logs={agent.logs} />
        </aside>
      </main>
    </div>
  );
}