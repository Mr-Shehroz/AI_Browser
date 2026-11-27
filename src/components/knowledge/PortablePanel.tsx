"use client";

import { useState } from "react";
import { btn, btnPrimary, panel, panelTitle } from "@/components/agent/ui";
import type { ClientMessage, ConflictMode, ImportPreview, ImportSkillAction, PortableSnapshot } from "@/shared/types";
import { exportUrl, uploadPack } from "./agentHttp";

const fmtBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const actionLabel: Record<ImportSkillAction, string> = {
  new: "New",
  update: "New versions",
  same: "Already here",
  conflict: "Differs from yours",
};

const actionStyle: Record<ImportSkillAction, string> = {
  new: "text-teal",
  update: "text-teal",
  same: "text-dim",
  conflict: "text-amber",
};

function PreviewCard({ preview, send }: { preview: ImportPreview; send: (msg: ClientMessage) => void }) {
  const [mode, setMode] = useState<ConflictMode>("keep_mine");
  const conflicts = preview.skills.filter((s) => s.action === "conflict").length;
  const blocked = preview.problems.length > 0;

  return (
    <div className="space-y-3 rounded-xl border border-amber/45 bg-amber/5 p-4 text-sm">
      <div>
        <p className="font-display text-xl font-bold leading-tight text-white">Review before merging</p>
        <p className="mt-1 text-xs text-dim">
          {preview.fileName}, exported {new Date(preview.exportedAt).toLocaleString()} from version {preview.appVersion}
        </p>
      </div>

      <p className={`text-xs font-semibold ${preview.checksumsOk ? "text-teal" : "text-ember"}`}>
        {preview.checksumsOk ? "Every file matches its checksum." : "Some files are damaged or were edited after export."}
      </p>

      {preview.problems.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-ember">
          {preview.problems.slice(0, 8).map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      {preview.warnings.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber">
          {preview.warnings.slice(0, 8).map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      <div>
        <p className="text-xs font-semibold text-white">Skills ({preview.skills.length})</p>
        {preview.skills.length === 0 ? (
          <p className="text-xs text-dim">None in this pack.</p>
        ) : (
          <ul className="mt-1 max-h-40 space-y-1 overflow-auto pr-1 text-xs">
            {preview.skills.map((s) => (
              <li key={s.id} className="flex gap-2">
                <span className="min-w-0 flex-1 truncate text-haze">{s.name} (v{s.versions.join(", v")})</span>
                <span className={`shrink-0 font-semibold ${actionStyle[s.action]}`}>{actionLabel[s.action]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-haze/85">
        Sites: {preview.sites.filter((s) => s.action === "new").length} new, {preview.sites.filter((s) => s.action === "merge").length} to merge.
        Research: {preview.research.new} new, {preview.research.existing} already here.
      </p>

      {preview.preferences && (
        <p className="text-xs text-dim">
          Preferences from the other computer are shown for reference and are not applied:{" "}
          {Object.entries(preview.preferences).map(([k, v]) => `${k} ${String(v)}`).join(", ")}.
        </p>
      )}

      {conflicts > 0 && (
        <fieldset className="space-y-1.5 text-xs">
          <legend className="font-semibold text-white">
            {conflicts} skill{conflicts === 1 ? "" : "s"} differ from your copy. What should happen?
          </legend>
          <label className="flex items-start gap-2 text-haze">
            <input type="radio" name="conflict" className="mt-0.5 accent-[var(--color-teal)]" checked={mode === "keep_mine"} onChange={() => setMode("keep_mine")} />
            Keep mine and skip theirs
          </label>
          <label className="flex items-start gap-2 text-haze">
            <input type="radio" name="conflict" className="mt-0.5 accent-[var(--color-teal)]" checked={mode === "add_as_draft"} onChange={() => setMode("add_as_draft")} />
            Keep mine and add theirs as a new draft version to review
          </label>
        </fieldset>
      )}

      <p className="text-xs leading-relaxed text-dim">
        Imported skills are re-checked before their first use on this computer. Skills without documentation sources will need a new test.
      </p>

      <div className="flex justify-end gap-2">
        <button className={btn} onClick={() => send({ kind: "pack_import_discard", importId: preview.importId })}>Discard</button>
        <button
          className={btnPrimary}
          disabled={blocked}
          onClick={() => send({ kind: "pack_import_apply", importId: preview.importId, conflictMode: mode })}
        >
          Merge into this computer
        </button>
      </div>
    </div>
  );
}

export function PortablePanel({ portable, send }: { portable: PortableSnapshot | null; send: (msg: ClientMessage) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exportsList = portable?.exports ?? [];

  return (
    <div className={`${panel} space-y-4`}>
      <h2 className={panelTitle}>Move to another computer</h2>
      <p className="text-xs leading-relaxed text-dim">
        A knowledge pack carries your skills, site notes and research to another PC. Passwords, cookies, sign-ins and browser
        sessions are never included, so you sign in again on the new machine.
      </p>

      <button className={btnPrimary} onClick={() => send({ kind: "pack_export" })}>Export knowledge pack</button>

      {exportsList.length > 0 && (
        <ul className="space-y-2">
          {exportsList.slice(0, 5).map((e) => (
            <li key={e.fileName} className="frame-card flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{e.fileName}</p>
                <p className="text-[11px] text-dim">
                  {e.counts.skills} skills, {e.counts.sites} sites, {e.counts.research} research notes, {fmtBytes(e.bytes)}
                </p>
                {e.excluded.length > 0 && (
                  <p className="text-[11px] text-amber">{e.excluded.length} file(s) left out because they looked like secrets</p>
                )}
              </div>
              <a className={btn} href={exportUrl(e.fileName)}>Download</a>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 border-t border-white/5 pt-4">
        <p className="text-sm font-semibold text-white">Import a pack</p>
        <label className={`${btn} cursor-pointer`}>
          {busy ? "Checking…" : "Choose a .zip file"}
          <input
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              setError(null);
              try {
                await uploadPack(file);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Import failed.");
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {error && <p className="text-sm text-ember" role="alert">{error}</p>}
      </div>

      {portable?.preview && <PreviewCard key={portable.preview.importId} preview={portable.preview} send={send} />}
    </div>
  );
}