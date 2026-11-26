import type { BrowserAction, PageObservation } from "../../shared/types";
import type { Decision } from "./schema";

export type BuiltAction = { action: BrowserAction; label?: string } | { error: string };

/** Turns a model decision into a concrete browser action, enforcing agent-side rules. */
export function toBrowserAction(d: Decision, obs: PageObservation): BuiltAction {
  const findEl = (ref?: string) => obs.elements.find((e) => e.ref === ref?.trim());

  switch (d.action) {
    case "navigate": {
      const raw = d.url?.trim();
      if (!raw) return { error: "navigate needs a url." };
      const url = raw.includes("://") ? raw : `https://${raw}`;
      return { action: { type: "navigate", url } };
    }
    case "click": {
      const el = findEl(d.ref);
      if (!el) return { error: `Unknown ref "${d.ref ?? ""}". Use a ref from the current element list.` };
      return { action: { type: "click", selector: el.selector }, label: el.name };
    }
    case "type": {
      const el = findEl(d.ref);
      if (!el) return { error: `Unknown ref "${d.ref ?? ""}". Use a ref from the current element list.` };
      if (el.type === "password") return { error: "The agent may not type into password fields. Use ask_user so the user signs in." };
      if (d.text === undefined) return { error: "type needs text." };
      return { action: { type: "type", selector: el.selector, text: d.text }, label: el.name };
    }
    case "press": {
      const key = d.key?.trim();
      if (!key || !/^[A-Za-z0-9+]{1,30}$/.test(key)) return { error: `Invalid key "${d.key ?? ""}".` };
      return { action: { type: "press", key } };
    }
    case "scroll":
      return { action: { type: "scroll", deltaY: d.direction === "up" ? -600 : 600 } };
    case "back":
      return { action: { type: "back" } };
    default:
      return { error: `Action "${d.action}" is not a browser action.` };
  }
}