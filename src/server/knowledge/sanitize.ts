const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LONG_DIGITS = /\b(?:\d[ -]?){8,}\b/g; // card, phone and account-like numbers
const SENSITIVE_PARAM = /^(token|access_token|id_token|refresh_token|key|api_key|apikey|auth|code|session|sid|sig|signature|password|secret|otp)$/i;

export function sanitizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.username = "";
    u.password = "";
    for (const k of [...u.searchParams.keys()]) {
      if (SENSITIVE_PARAM.test(k)) u.searchParams.set(k, "REDACTED");
    }
    if (/token|code=/i.test(u.hash)) u.hash = "";
    return u.toString();
  } catch {
    return raw;
  }
}

export function sanitizeText(s: string): string {
  return s
    .replace(/https?:\/\/[^\s"')]+/g, (m) => sanitizeUrl(m))
    .replace(EMAIL, "{{email}}")
    .replace(LONG_DIGITS, "{{number}}");
}

/** Apply only to model-written content fields, never to timestamps or IDs. */
export function sanitizeDeep<T>(v: T): T {
  if (typeof v === "string") return sanitizeText(v) as T;
  if (Array.isArray(v)) return v.map((x) => sanitizeDeep(x)) as T;
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sanitizeDeep(x)])) as T;
  }
  return v;
}