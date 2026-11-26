import type { BrowserAction } from "./types";

export function describeAction(a: BrowserAction): string {
  switch (a.type) {
    case "navigate": return `Go to ${a.url}`;
    case "click": return `Click ${a.selector}`;
    case "type": return `Type ${a.secret ? "••••••" : `"${a.text}"`} into ${a.selector}`;
    case "press": return `Press ${a.key}`;
    case "scroll": return `Scroll ${a.deltaY > 0 ? "down" : "up"} ${Math.abs(a.deltaY)}px`;
    case "back": return "Go back";
    case "observe": return "Observe page";
  }
}

export function redactAction(a: BrowserAction): BrowserAction {
  return a.type === "type" && a.secret ? { ...a, text: "[REDACTED]" } : a;
}