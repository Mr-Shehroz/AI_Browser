import { mkdir } from "node:fs/promises";
import { chromium, type BrowserContext, type CDPSession, type Page } from "playwright";
import type { BrowserAction, ElementInfo, InteractiveElement, PageObservation } from "../../shared/types";
import { OBSERVE_SCRIPT } from "./observeScript";

interface Options {
  profileDir: string;
  headless: boolean;
  viewport: { width: number; height: number };
  onFrame: (base64Jpeg: string) => void;
  onClosed: () => void;
}

export interface PageSnapshot { url: string; title: string; html: string; png: Buffer }

export class BrowserController {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdp: CDPSession | null = null;
  private elements = new Map<string, InteractiveElement>();

  constructor(private opts: Options) {}

  get isOpen(): boolean {
    return this.page !== null && !this.page.isClosed();
  }

  async start(): Promise<void> {
    if (this.isOpen) return;
    await mkdir(this.opts.profileDir, { recursive: true });
    // Persistent context = isolated profile per AGENT_PROFILE (own cookies, storage).
    this.context = await chromium.launchPersistentContext(this.opts.profileDir, {
      headless: this.opts.headless,
      viewport: this.opts.viewport,
      acceptDownloads: false,
    });
    this.context.on("close", () => {
      this.context = null;
      this.page = null;
      this.cdp = null;
      this.elements.clear();
      this.opts.onClosed();
    });
    this.context.on("page", (p) => void this.attach(p)); // follow new tabs/popups
    await this.attach(this.context.pages()[0] ?? (await this.context.newPage()));
  }

  private async attach(page: Page): Promise<void> {
    if (!this.context) return;
    await this.cdp?.detach().catch(() => {});
    this.page = page;
    this.elements.clear();

    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) this.elements.clear(); // old refs are now stale
    });
    page.on("close", () => {
      if (this.page !== page) return;
      const others = this.context?.pages().filter((p) => !p.isClosed()) ?? [];
      if (others.length) void this.attach(others[others.length - 1]);
      else this.page = null;
    });

    const cdp = await this.context.newCDPSession(page);
    this.cdp = cdp;
    cdp.on("Page.screencastFrame", (frame) => {
      this.opts.onFrame(frame.data);
      void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 60,
      maxWidth: this.opts.viewport.width,
      maxHeight: this.opts.viewport.height,
    });
  }

  private requirePage(): Page {
    if (!this.page || this.page.isClosed()) throw new Error("Browser is not open.");
    return this.page;
  }

  async describe(selector: string): Promise<ElementInfo | undefined> {
    const ref = /^\[data-agent-ref="(e\d+)"\]$/.exec(selector)?.[1];
    const known = ref ? this.elements.get(ref) : undefined;
    if (known) return { name: known.name, role: known.role, type: known.type };
    if (!this.page) return undefined;
    try {
      const loc = this.page.locator(selector).first();
      await loc.waitFor({ state: "attached", timeout: 2000 });
      const [aria, text, type, role, value] = await Promise.all([
        loc.getAttribute("aria-label"),
        loc.innerText().catch(() => ""),
        loc.getAttribute("type"),
        loc.getAttribute("role"),
        loc.getAttribute("value"),
      ]);
      return {
        name: (aria || text || value || "").replace(/\s+/g, " ").trim().slice(0, 100),
        role: role ?? "unknown",
        type: type ?? undefined,
      };
    } catch {
      return undefined;
    }
  }

  /** Executes one action and returns observed post-action state as evidence. */
  async execute(action: BrowserAction): Promise<string> {
    const page = this.requirePage();
    switch (action.type) {
      case "navigate":
        await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        break;
      case "click":
        await page.locator(action.selector).first().click({ timeout: 10_000 });
        break;
      case "type":
        await page.locator(action.selector).first().fill(action.text, { timeout: 10_000 });
        break;
      case "press":
        await page.keyboard.press(action.key);
        break;
      case "scroll":
        await page.mouse.wheel(0, action.deltaY);
        break;
      case "back":
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 });
        break;
      case "observe":
        break;
    }
    await this.settle();
    const current = this.requirePage(); // may have switched to a new tab
    return `Now on "${await current.title()}" — ${current.url()}`;
  }

  private async settle(): Promise<void> {
    const page = this.page;
    if (!page) return;
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  }

  async observe(): Promise<PageObservation> {
    const page = this.requirePage();
    const raw = (await page.evaluate(OBSERVE_SCRIPT)) as Omit<PageObservation, "observedAt">;
    this.elements = new Map(raw.elements.map((e) => [e.ref, e]));
    return { ...raw, observedAt: new Date().toISOString() };
  }

  async pageSnapshot(): Promise<PageSnapshot> {
    const page = this.requirePage();
    return {
      url: page.url(),
      title: await page.title(),
      html: await page.content(),
      png: await page.screenshot({ fullPage: true }),
    };
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => {});
  }
}