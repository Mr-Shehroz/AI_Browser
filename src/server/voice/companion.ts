import { z } from "zod";
import { PERSONA, USER_NAME } from "../../shared/persona";
import type { ReplyLanguage } from "../../shared/types";
import type { ChatMessage, OllamaClient } from "../llm/ollamaClient";

const replySchema = z.object({
  reply: z.string().transform((s) => s.slice(0, 600)),
  task: z.string().transform((s) => s.slice(0, 500)),
});
const replyJsonSchema = {
  type: "object",
  properties: { reply: { type: "string" }, task: { type: "string" } },
  required: ["reply", "task"],
};

const LANGUAGE_RULE: Record<ReplyLanguage, string> = {
  en: "Write \"reply\" in English.",
  ur: "Write \"reply\" in simple, everyday spoken Urdu in Urdu script, freely mixing common English words (website, page, search, click, OK, plan) the way people in Pakistan talk. Avoid formal or literary Urdu.",
};

const systemPrompt = (lang: ReplyLanguage) => `${PERSONA}

Right now you're chatting with ${USER_NAME} by voice. Work out what he wants from his latest message:
- If he wants something done in the web browser (open, search, find, check, read, fill in or buy something on a website), put a clear one-line English instruction for your browser agent in "task". In "reply", say briefly what you're about to do, so he can stop you if you misheard.
- Otherwise it's just conversation: set "task" to "" and talk with him in "reply".
"reply" is spoken aloud: 1 to 3 short sentences, no lists, no emoji. Never claim you've already done something in the browser.
${LANGUAGE_RULE[lang]}
Reply with JSON only.`;

/** Small talk, plus spotting when what he said is really a browser task. */
export class CompanionChat {
  private history: ChatMessage[] = [];

  constructor(private llm: OllamaClient, private model: string) {}

  async reply(text: string, lang: ReplyLanguage): Promise<{ reply: string; task: string | null }> {
    try {
      const r = await this.llm.chatJSON({
        model: this.model,
        messages: [{ role: "system", content: systemPrompt(lang) }, ...this.history, { role: "user", content: text }],
        schema: replyJsonSchema,
        parse: (v) => replySchema.parse(v),
      });
      this.history.push({ role: "user", content: text }, { role: "assistant", content: JSON.stringify(r) });
      this.history = this.history.slice(-12);
      return { reply: r.reply.trim() || this.fallback(lang), task: r.task.trim() || null };
    } catch {
      return { reply: this.fallback(lang), task: null };
    }
  }

  private fallback(lang: ReplyLanguage): string {
    return lang === "ur"
      ? "سوری، ایک سیکنڈ کے لیے دماغ اٹک گیا۔ دوبارہ بولو؟"
      : `Sorry ${USER_NAME}, my brain froze for a second. Say that again?`;
  }
}