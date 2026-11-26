"use client";

import { useState } from "react";
import type { BrowserAction, ClientMessage } from "@/shared/types";
import { btn, btnPrimary, input, panel } from "./ui";

interface Props {
  send: (msg: ClientMessage) => void;
  selector: string;
  setSelector: (s: string) => void;
  disabled: boolean;
}

export function CommandPanel({ send, selector, setSelector, disabled }: Props) {
  const [url, setUrl] = useState("https://example.com");
  const [text, setText] = useState("");
  const [secret, setSecret] = useState(false);
  const [key, setKey] = useState("Enter");

  const act = (action: BrowserAction) => send({ kind: "action", action });

  return (
    <div className={`${panel} space-y-3`}>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); act({ type: "navigate", url }); }}>
        <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        <button className={btnPrimary} disabled={disabled}>Go</button>
      </form>

      <div className="flex flex-wrap gap-2">
        <button className={btn} disabled={disabled} onClick={() => act({ type: "observe" })}>Observe</button>
        <button className={btn} disabled={disabled} onClick={() => act({ type: "back" })}>Back</button>
        <button className={btn} disabled={disabled} onClick={() => act({ type: "scroll", deltaY: -600 })}>Scroll up</button>
        <button className={btn} disabled={disabled} onClick={() => act({ type: "scroll", deltaY: 600 })}>Scroll down</button>
      </div>

      <div className="space-y-2 border-t border-zinc-800 pt-3">
        <div className="flex gap-2">
          <input
            className={input}
            value={selector}
            onChange={(e) => setSelector(e.target.value)}
            placeholder='Selector, e.g. [data-agent-ref="e3"] or button:has-text("Next")'
          />
          <button className={btn} disabled={disabled || !selector} onClick={() => act({ type: "click", selector })}>Click</button>
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act({ type: "type", selector, text, secret });
            if (secret) setText("");
          }}
        >
          <input className={input} type={secret ? "password" : "text"} value={text} onChange={(e) => setText(e.target.value)} placeholder="Text to type into the selector" />
          <label className="flex shrink-0 items-center gap-1 text-xs text-zinc-400">
            <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} /> secret
          </label>
          <button className={btn} disabled={disabled || !selector}>Type</button>
        </form>

        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); act({ type: "press", key }); }}>
          <input className={input} value={key} onChange={(e) => setKey(e.target.value)} placeholder="Key, e.g. Enter, Tab, Escape" />
          <button className={btn} disabled={disabled || !key}>Press</button>
        </form>
      </div>
    </div>
  );
}