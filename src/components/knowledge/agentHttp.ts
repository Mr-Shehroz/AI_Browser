export const AGENT_HTTP_URL = process.env.NEXT_PUBLIC_AGENT_HTTP_URL ?? "http://127.0.0.1:4317";

export const exportUrl = (fileName: string) => `${AGENT_HTTP_URL}/exports/${encodeURIComponent(fileName)}`;

/** Uploads a pack for checking. The preview arrives over the WebSocket. */
export async function uploadPack(file: File): Promise<void> {
  if (file.size > 50 * 1024 * 1024) throw new Error("Knowledge packs can be up to 50 MB.");
  const res = await fetch(`${AGENT_HTTP_URL}/import`, {
    method: "POST",
    headers: { "Content-Type": "application/zip", "X-File-Name": encodeURIComponent(file.name) },
    body: file,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Import failed (${res.status}).`);
  }
}