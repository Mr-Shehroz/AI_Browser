import { AGENT_NAME, AGENT_NAME_URDU, USER_NAME, USER_NAME_URDU } from "@/shared/persona";
import type { ReplyLanguage } from "@/shared/types";

/** Everything Zoya says herself, in both languages. Chat, plans and results come from the model. */
export interface Phrases {
  greeting: string;
  preview: string;
  stopped: string;
  paused: string;
  resumed: string;
  notPaused: string;
  destructiveVoice: string;
  approved: string;
  skipped: string;
  sayYesNo: string;
  planStart: string;
  planDropped: string;
  planRework: string;
  replyThanks: string;
  busy: string;
  onIt: string;
  scratch: string;
  shallIStart: string;
  approvalNeeded: (target: string | undefined, conversation: boolean) => string;
  destructiveAnnounce: (target: string | undefined) => string;
  plan: (summary: string, steps: number, conversation: boolean) => string;
  done: (result: string) => string;
  failed: (error: string) => string;
}

const english: Phrases = {
  greeting: `Hey ${USER_NAME}! It's ${AGENT_NAME}. How are you doing? What are we up to today?`,
  preview: `Hi ${USER_NAME}, it's ${AGENT_NAME}. How do I sound?`,
  stopped: "Okay, I've stopped.",
  paused: "Okay, paused. The browser's all yours. Just say continue when you're ready.",
  resumed: "Alright, carrying on.",
  notPaused: "I'm not paused, silly. Nothing to resume.",
  destructiveVoice: "This one can't be undone, so please check it on screen and click yourself.",
  approved: "Okay, doing it.",
  skipped: "Fine, I'll skip that.",
  sayYesNo: "Just say yes or no.",
  planStart: "Great, starting now.",
  planDropped: "Okay, dropped it.",
  planRework: "Got it, let me change the plan.",
  replyThanks: "Thanks, carrying on.",
  busy: `Hang on ${USER_NAME}, I'm still on it. Say stop if you want me to stop.`,
  onIt: "Okay, doing it now.",
  scratch: "Okay, forget that. Tell me again?",
  shallIStart: "Shall I start?",
  approvalNeeded: (target, conversation) => {
    const what = target ? `: ${target}` : "";
    return conversation ? `Quick check before I go on${what}. Should I? Yes or no?` : `I need your OK for the next step${what}.`;
  },
  destructiveAnnounce: (target) =>
    `Careful, the next step can't be undone${target ? `: ${target}` : ""}. Please check it on screen and click.`,
  plan: (summary, steps, conversation) =>
    conversation
      ? `Here's my plan. ${summary} That's ${steps} step${steps === 1 ? "" : "s"}. Shall I start?`
      : `Plan's ready. ${summary} Have a look on screen.`,
  done: (result) => `Done, ${USER_NAME}! ${result}`,
  failed: (error) => `Sorry ${USER_NAME}, I couldn't get this one done. ${error}`,
};

const urdu: Phrases = {
  greeting: `ہائے ${USER_NAME_URDU}! میں ${AGENT_NAME_URDU}۔ آپ کیسے ہو؟ بتاؤ، آج کیا کرنا ہے؟`,
  preview: `ہائے ${USER_NAME_URDU}، میں ${AGENT_NAME_URDU} ہوں۔ میری آواز کیسی لگی؟`,
  stopped: "اوکے، رک گئی۔",
  paused: "اوکے، پاز کر دیا۔ اب براؤزر آپ کے پاس ہے۔ جب کہو، پھر سے شروع کر دوں گی۔",
  resumed: "چلو، پھر سے شروع کرتی ہوں۔",
  notPaused: "میں تو رکی ہی نہیں ہوں۔",
  destructiveVoice: "یہ والا کام واپس نہیں ہو سکتا، اس لیے پلیز اسکرین پر دیکھ کے خود کلک کرو۔",
  approved: "اوکے، کر رہی ہوں۔",
  skipped: "ٹھیک ہے، نہیں کرتی۔",
  sayYesNo: "بس ہاں یا نہیں بول دو۔",
  planStart: "زبردست، شروع کرتی ہوں۔",
  planDropped: "اوکے، چھوڑ دیا۔",
  planRework: "سمجھ گئی، پلان تھوڑا بدلتی ہوں۔",
  replyThanks: "تھینک یو، اب آگے چلتی ہوں۔",
  busy: `ایک منٹ ${USER_NAME_URDU}، ابھی اسی پر لگی ہوں۔ رکوانا ہو تو بولو، رکو۔`,
  onIt: "اوکے، ابھی کرتی ہوں۔",
  scratch: "اوکے، چھوڑو۔ دوبارہ بتاؤ کیا چاہیے؟",
  shallIStart: "شروع کروں؟",
  approvalNeeded: (target, conversation) => {
    const what = target ? ` (${target})` : "";
    return conversation
      ? `آگے جانے سے پہلے ایک بار پوچھ لوں${what}۔ کر دوں؟ ہاں یا نہیں؟`
      : `اگلے اسٹیپ کے لیے آپ کی اوکے چاہیے${what}۔`;
  },
  destructiveAnnounce: (target) =>
    `دھیان سے، اگلا اسٹیپ واپس نہیں ہو سکتا${target ? ` (${target})` : ""}۔ پلیز اسکرین پر دیکھ کے کلک کرو۔`,
  plan: (summary, steps, conversation) =>
    conversation
      ? `میرا پلان یہ ہے۔ ${summary} ٹوٹل ${steps} اسٹیپ ہیں۔ شروع کروں؟`
      : `پلان ریڈی ہے۔ ${summary} اسکرین پر دیکھ لو۔`,
  done: (result) => `ہو گیا ${USER_NAME_URDU}! ${result}`,
  failed: (error) => `سوری ${USER_NAME_URDU}، یہ والا نہیں ہو پایا۔ ${error}`,
};

export const phrases = (lang: ReplyLanguage): Phrases => (lang === "ur" ? urdu : english);