export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

interface ChatJSONOptions<T> {
  model: string;
  messages: ChatMessage[];
  schema: object;
  parse: (value: unknown) => T;
  signal?: AbortSignal;
}

export class OllamaClient {
  constructor(private baseUrl: string, private numCtx: number, private think?: boolean) {}

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Ollama /api/tags returned ${res.status}`);
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name).sort();
  }

  /** Models currently loaded into memory. */
  async listLoaded(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/api/ps`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  }

  /** Frees GPU memory so image generation can use it. Models reload automatically on the next request. */
  async unloadAll(): Promise<void> {
    for (const model of await this.listLoaded()) {
      await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, keep_alive: 0 }),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => {});
    }
  }

  /** Structured output: Ollama constrains the reply to the JSON schema; we still validate with zod. */
  async chatJSON<T>(opts: ChatJSONOptions<T>): Promise<T> {
    let messages = opts.messages;
    let lastError = "";

    for (let attempt = 0; attempt < 2; attempt++) {
      const timeout = AbortSignal.timeout(300_000);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      const body: Record<string, unknown> = {
        model: opts.model,
        messages,
        stream: false,
        format: opts.schema,
        options: { temperature: 0.1, num_ctx: this.numCtx },
      };
      // Thinking models (qwen3, deepseek-r1) write long hidden reasoning first, which is very slow on CPU.
      const think = this.think ?? (/^(qwen3|deepseek-r1)/i.test(opts.model) ? false : undefined);
      if (think !== undefined) body.think = think;

      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw new Error(`Ollama error ${res.status}: ${(await res.text()).slice(0, 300)}`);

      const data = (await res.json()) as { message?: { content?: string } };
      const content = data.message?.content ?? "";
      try {
        return opts.parse(JSON.parse(content));
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        messages = [
          ...opts.messages,
          { role: "assistant", content },
          { role: "user", content: `That reply was invalid (${lastError.slice(0, 300)}). Reply again with only valid JSON matching the schema.` },
        ];
      }
    }
    throw new Error(`Model returned invalid output twice: ${lastError.slice(0, 300)}`);
  }
}