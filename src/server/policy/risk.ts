import type { ApprovalMode, BrowserAction, ElementInfo, RiskLevel } from "../../shared/types";

const DESTRUCTIVE = /\b(delete|remove|erase|destroy|reset|wipe|purge|terminate|deactivate|revoke|uninstall|discard|overwrite|close account|cancel subscription|empty trash)\b/i;
const IMPACTFUL = /\b(submit|send|publish|post|pay|buy|purchase|checkout|place order|order|confirm|save|update|apply|deploy|invite|transfer|subscribe|upgrade|sign up|register|share|approve|merge|go live|schedule)\b/i;
const SAFE_UI = /\b(next|previous|back|menu|open|show|expand|collapse|view|details|more|search|filter|sort|tab|close|dismiss|help|docs|learn more)\b/i;

export interface RiskAssessment { risk: RiskLevel; reason: string }

export function assessRisk(action: BrowserAction, el?: ElementInfo): RiskAssessment {
  switch (action.type) {
    case "observe":
    case "scroll":
    case "back":
      return { risk: "read_only", reason: "Does not change site data." };

    case "navigate": {
      let url: URL;
      try { url = new URL(action.url); } catch {
        return { risk: "blocked", reason: "Invalid URL." };
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { risk: "blocked", reason: `Protocol ${url.protocol} is not allowed.` };
      }
      return { risk: "read_only", reason: "Navigation only." };
    }

    case "type":
      return {
        risk: "reversible",
        reason: action.secret
          ? "Fills a field with a secret (redacted in logs). Nothing is saved until submitted."
          : "Fills a field. Nothing is saved until submitted.",
      };

    case "press":
      return action.key.toLowerCase() === "enter"
        ? { risk: "impactful", reason: "Enter may submit a form." }
        : { risk: "reversible", reason: "Keyboard input." };

    case "click": {
      if (!el) return { risk: "impactful", reason: "Target element unknown; treated as impactful." };
      const label = `${el.name} ${el.type ?? ""}`;
      if (DESTRUCTIVE.test(label)) return { risk: "destructive", reason: `"${el.name}" looks destructive.` };
      if (el.type === "submit" || IMPACTFUL.test(label)) return { risk: "impactful", reason: `"${el.name}" may submit, send or save.` };
      if (el.role === "a" || el.role === "link") return { risk: "reversible", reason: "Link (navigation)." };
      if (SAFE_UI.test(label)) return { risk: "reversible", reason: "UI navigation control." };
      return { risk: "impactful", reason: "Unrecognized control; it may change data." };
    }
  }
}

export function requiresApproval(risk: RiskLevel, mode: ApprovalMode): boolean {
  if (risk === "impactful" || risk === "destructive") return true;
  return mode === "strict" && risk === "reversible";
}