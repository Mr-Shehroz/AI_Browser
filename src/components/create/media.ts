export const AGENT_HTTP_URL = process.env.NEXT_PUBLIC_AGENT_HTTP_URL ?? "http://127.0.0.1:4317";

export const mediaUrl = (kind: "images" | "uploads", name: string) =>
  `${AGENT_HTTP_URL}/media/${kind}/${encodeURIComponent(name)}`;

export async function uploadImage(file: File): Promise<string> {
  if (file.size > 20 * 1024 * 1024) throw new Error("Images up to 20 MB only.");
  const res = await fetch(`${AGENT_HTTP_URL}/upload`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  const data = (await res.json().catch(() => ({}))) as { uploadId?: string; error?: string };
  if (!res.ok || !data.uploadId) throw new Error(data.error ?? `Upload failed (${res.status}).`);
  return data.uploadId;
}