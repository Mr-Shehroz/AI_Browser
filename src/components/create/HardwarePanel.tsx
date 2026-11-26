"use client";

import { btn, panel, panelTitle } from "@/components/agent/ui";
import type { ClientMessage, CreativeSnapshot, HardwareTier } from "@/shared/types";

const TIER_LABEL: Record<HardwareTier, string> = {
  cpu: "CPU only",
  low: "Entry GPU",
  mid: "Mid-range GPU",
  high: "High-end GPU",
  ultra: "Workstation GPU",
};

export function HardwarePanel({ snapshot, send }: { snapshot: CreativeSnapshot | null; send: (msg: ClientMessage) => void }) {
  const hw = snapshot?.hardware;
  const comfy = snapshot?.comfy;

  return (
    <div className={`${panel} space-y-4`}>
      <div className="flex items-center justify-between">
        <h2 className={panelTitle}>This machine</h2>
        <button className={btn} onClick={() => send({ kind: "creative_refresh", rescan: true })}>Rescan</button>
      </div>

      {hw ? (
        <>
          <p className="font-display text-4xl font-black leading-none text-teal">{TIER_LABEL[hw.tier]}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div className="col-span-2">
              <dt className="text-dim">GPU</dt>
              <dd className="font-semibold text-white">
                {hw.gpus.length ? hw.gpus.map((g) => `${g.name}, ${g.vramGb} GB`).join("; ") : "None detected"}
              </dd>
            </div>
            <div><dt className="text-dim">System memory</dt><dd className="font-semibold text-white">{hw.ramGb} GB</dd></div>
            <div><dt className="text-dim">Free disk</dt><dd className="font-semibold text-white">{hw.freeDiskGb ?? "Unknown"} GB</dd></div>
            <div className="col-span-2"><dt className="text-dim">CPU</dt><dd className="font-semibold text-white">{hw.cpu} ({hw.cores} threads)</dd></div>
          </dl>
        </>
      ) : (
        <p className="text-sm text-dim">Detecting…</p>
      )}

      {comfy?.reachable ? (
        <p className="flex items-center gap-2 text-xs text-haze">
          <span className="h-2 w-2 rounded-full bg-teal" aria-hidden />
          ComfyUI connected at {comfy.url}{comfy.version ? `, version ${comfy.version}` : ""}
        </p>
      ) : (
        <div className="space-y-2 rounded-lg border border-amber/40 bg-amber/5 p-3 text-xs text-haze">
          <p className="font-semibold text-amber">ComfyUI isn&apos;t running</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Install ComfyUI from comfy.org (desktop app or portable build).</li>
            <li>Put a checkpoint that suits this machine in its models/checkpoints folder.</li>
            <li>Start ComfyUI, then press Rescan.</li>
          </ol>
          <p className="text-dim">Looking at {comfy?.url || "the default addresses"}. Set COMFYUI_URL if yours runs elsewhere.</p>
        </div>
      )}

      {snapshot?.recommendation && <p className="text-sm leading-relaxed text-haze/85">{snapshot.recommendation}</p>}
      {hw?.notes.map((n) => <p key={n} className="text-xs leading-relaxed text-amber">{n}</p>)}
      <p className="text-xs leading-relaxed text-dim">
        Model licences differ. Check each model&apos;s licence before using its images commercially.
      </p>
    </div>
  );
}