# NexForce Universal AI Browser Agent: Project Handbook

Last updated: 27 November 2026
Purpose: a complete briefing for anyone (human or AI) joining this project: what we are building, what is finished, how it works, what remains, and the decisions already made.

---

## 1. Project overview

NexForce is a local-first AI operator that works through a real web browser. Its assistant persona is **Zoya**, a warm, frank, female voice assistant who talks with the owner, **Shehroz**, in English or simple everyday Urdu.

What it does:
- Takes goals by typing or by voice (including hands-free conversation in English and Urdu).
- Researches documentation before acting, plans (or starts directly in Quick mode), and drives a visible Chromium browser one step at a time.
- Asks permission before anything impactful, keeps verified backups and page snapshots, and records everything in an audit log.
- Learns reusable, versioned skills from finished goals and re-checks them before reuse.
- Exports its knowledge as a portable pack for another computer.

Core promise: broad browser capability with safe failure boundaries. Never trade data safety for speed, and never claim success without evidence.

Operating principles: browser-first; research before action; permission before impact; backup before modification; non-destructive by default; learn and retain; portable by design; transparent; local-first and free by default (paid or cloud services only as opt-in).

The owner decided to stay fully local (no Vercel or hosting), and to set aside image and video generation for now.

---

## 2. Status at a glance

| Phase | Name | Status |
|---|---|---|
| A | Safe browser foundation | Built and working |
| B | Local intelligence (Ollama planner and agent loop) | Built and working |
| C | Research, skills, site profiles, Knowledge page | Built |
| D | Image studio (ComfyUI) | Built, then removed and parked outside the project by the owner's choice |
| E | Video studio | Skipped for now |
| F1 | Knowledge-pack export and import | Built |
| F2 | Voice: push-to-talk, hands-free Conversation, Urdu, Zoya persona, Quick mode, small talk | Built and working end to end |
| UI | Cinematic theme | Built |
| F3 | Polish: settings page, health check, cleanup tools | Not started (next) |

Verified by the owner: dashboard, browser control, goals with qwen3:4b, Conversation mode (spoke Urdu, Zoya planned and drove the browser), Piper Urdu voice (test.wav generated).
Not yet confirmed end to end: skill test/approve cycle, knowledge-pack import on a second machine.
There are no automated tests yet.

---

## 3. Owner's machine and environment

- Owner: Shehroz. Communicates in simple English; prefers complete, ready-to-paste files.
- OS: Windows 11. Editor: VS Code. Project path: D:\Taiba Digital\Full-Stack\ai-browser
- CPU: Intel laptop CPU (~2.5 GHz). GPU: Intel UHD Graphics 620 (integrated, no usable VRAM). RAM: 7.8 GB (often ~80% used). Disk: SATA SSD (C: and D:).
- Hardware reality: CPU-only, memory-limited. Choose small models; avoid running heavy jobs at the same time.
- Timezone: Asia/Karachi (UTC+5).

Installed tools:
- Node.js 20.3+ (v22 recommended).
- Next.js app (App Router, TypeScript, src directory, Tailwind CSS v4).
- Ollama (runs as a Windows background app on port 11434; do not run `ollama serve`). Model: qwen3:4b (qwen3:8b removed: too large for 8 GB RAM).
- Playwright Chromium (`npx playwright install chromium`).
- whisper.cpp CPU build: D:\Tools\whisper\Release\whisper-cli.exe; models in D:\Tools\whisper\models (ggml-base.bin in use; ggml-small.bin was too slow alongside Ollama).
- Piper 2023.11.14-2 Windows build: D:\Tools\piper\piper.exe; female Urdu voice D:\Tools\piper\voices\ur_PK-aegis_female-medium.onnx (+ .onnx.json, patched; original kept as .onnx.json.original).
- Browser extension ColorZilla causes a harmless hydration warning; fixed with `<body suppressHydrationWarning>`.

Not installed or no longer used: ComfyUI, image models, FFmpeg.

---

## 4. Architecture

Two processes run during development (`npm run dev` starts both through `concurrently`):

1. Web app (Next.js, port 3000): UI only. Pages: Browser (/) and Knowledge (/knowledge).
2. Agent server (src/server, `tsx watch`, bound to 127.0.0.1:4317): one HTTP server that also hosts the WebSocket.
   - WebSocket: all control and live updates.
   - HTTP routes: POST /voice/transcribe (WAV to text), POST /voice/speak (Urdu text to WAV), GET /exports/<file> (knowledge-pack download), POST /import (knowledge-pack upload). All write routes check the request origin.

External local programs: Ollama (LLM), whisper.cpp (speech to text), Piper (Urdu speech), Playwright Chromium (visible controlled browser, launched with --mute-audio), plus a second headless Chromium with no cookies for background research.

Goal flow:
User goal (typed, spoken, or extracted by Zoya's chat) → GoalAgent reads URLs in the goal and picks fresh skills → Quick mode: start immediately; otherwise: plan → user approves → loop: wait if paused → observe page → LLM decides one action → TaskRunner (risk check → approval if needed → pre-action snapshot → execute → observe) → outcome fed back → repeat until finish, ask_user, failure limit or step limit → skill bookkeeping, optional "Save as skill".

Voice conversation flow:
Microphone (hands-free, energy-based speech detection) → WAV → whisper.cpp → classify (stop/pause/resume/yes/no/noise/text) → approvals, plan answers and questions handled directly → otherwise Zoya's chat (LLM) decides: small-talk reply, or a browser task → task starts (Quick mode) or waits for "yes" → Zoya speaks replies (Windows English voice, or Piper for Urdu). Listening pauses while she speaks, transcribes or thinks.

---

## 5. Repository structure

Scripts in package.json: dev:web = next dev; dev:agent = tsx watch src/server/index.ts; dev = concurrently runs both.
Dependencies: playwright, ws, zod, jszip. Dev: tsx, concurrently, @types/ws.
Other: scripts/fix-piper-voice.mjs (patches newer Piper voices for the old Windows piper.exe). .gitignore includes .agent-data/.
Conventions: shared types in src/shared; server uses relative imports; client uses the @/ alias; Playwright in-page scripts are plain strings.

~~~
src/
  app/
    layout.tsx, globals.css, page.tsx (Browser), knowledge/page.tsx
  shared/
    types.ts        every shared type and the WebSocket protocol
    describe.ts     describeAction, redactAction
    persona.ts      AGENT_NAME (Zoya / زویا), USER_NAME (Shehroz / شہروز), PERSONA prompt, female voice hints
  hooks/
    useAgentSocket.ts   single WebSocket hook with reconnect and all client state
  components/
    agent/      ui.ts, AgentDashboard, StatusBar, BrowserView, Timecode, CommandPanel, ElementList,
                ApprovalDialog, ActionTimeline, BackupPanel, LogPanel, GoalPanel, PlanCard, AgentSteps, GoalKnowledge
    knowledge/  KnowledgeBoard, SkillCard, ResearchPanel, SitesPanel, PortablePanel, agentHttp.ts
    voice/      VoicePanel, useRecorder (push-to-talk), useHandsFree (conversation listening),
                useSpeech (English Windows voices + Piper Urdu), voice.ts (WAV encode, transcribe, synthesizeUrdu),
                intents.ts (stop/pause/resume/yes/no/noise in English and Urdu), phrases.ts (Zoya's lines, EN and UR)
  server/
    index.ts, config.ts
    browser/       controller.ts, observeScript.ts
    policy/        risk.ts, approvals.ts
    audit/         auditLog.ts
    backup/        backupManager.ts
    orchestrator/  taskRunner.ts
    llm/           ollamaClient.ts
    planner/       schema.ts, prompt.ts, toAction.ts, goalAgent.ts
    knowledge/     util.ts, sanitize.ts, research.ts, sites.ts, skills.ts, skillDrafter.ts
    portable/      knowledgePack.ts
    voice/         whisper.ts, piper.ts, companion.ts
    http/          portableHttp.ts, voiceHttp.ts
~~~

Parked outside the project (Phase D image studio): src/server/creative/, src/server/http/mediaServer.ts, src/components/create/, src/app/create/.

---

## 6. Phase A: safe browser foundation

- Playwright persistent context per AGENT_PROFILE (own cookies). Headed so the owner can take over; launched with --mute-audio so website sound never reaches the voice microphone.
- Live view through CDP screencast frames (frames stop if the Chromium window is minimised). Follows new tabs.
- Observe: up to 150 visible interactive elements tagged data-agent-ref="eN", 4,000 characters of page text, blockers (captcha, login_form).
- Risk levels: read_only, reversible, impactful, destructive, blocked. Unknown buttons count as impactful; Enter counts as impactful.
- Approval modes: standard (impactful and destructive need approval) or strict.
- Destructive steps need a verified file backup for the task, or an explicit "no backup possible" acknowledgement, and always a click (voice approvals of destructive steps are refused by the server).
- A page snapshot (HTML plus screenshot) is saved before every approved impactful step.
- Failures and CAPTCHAs pause the queue. Pause lets the owner take over; Stop cancels everything.
- Backups: SHA-256 verified copies, manifest and restore notes; restore always makes a new copy.
- Audit log: .agent-data/audit/<date>.jsonl (approvals record whether they came by click or voice).

---

## 7. Phase B: local intelligence

- Ollama structured JSON outputs validated with zod; one retry; 300-second timeout per call.
- Thinking is switched off automatically for qwen3 and deepseek-r1 models (hidden reasoning made CPU planning take minutes).
- Plan first (unless Quick mode): summary, steps, risks, needs_from_user; approve, revise with a note, or reject.
- Loop decisions: navigate, click (ref), type (ref), press, scroll, back, research, ask_user, finish.
- Guards: 25-step limit, 3 consecutive failures stop the goal, repeat guard, refs must exist, never type into password fields, sign-in/CAPTCHA/MFA handed to the human, page content treated as untrusted.
- Prompts start with the PERSONA, so plans, questions and reports sound like Zoya.

---

## 8. Phase C: research, skills, site profiles

- Storage: JSON and Markdown files (no PostgreSQL).
- Research: separate headless Chromium, main-text extraction, LLM summary; saved as .json plus full .txt for change detection; reads URLs in a goal before starting (max 3) and up to 5 per goal mid-run; private network addresses blocked.
- Site profiles: visits, titles, the owner's notes and pitfalls, shown to the model on that site.
- Skills: draft → tested → approved; stale ("Needs attention"); retired. Drafted by the LLM from a finished goal with inputs as {{placeholders}} and sanitised content; each version saved as JSON and Markdown. Tests run as goals. Approve only after a passed test. Reused as hints (up to 3 per goal). Freshness window 30 days: sources re-read; similarity under 85% marks stale; failed use marks stale; new versions start as drafts.

---

## 9. Phase F1: knowledge pack

- Export (Knowledge page): ZIP with manifest.json (format, schema version, counts, SHA-256 per file, exclusions), README.md, global/preferences.json (reference only), skills/, sites/, research/, backups-index/.
- Never included: browser profiles, cookies, sessions, audit logs, backup contents, secrets. Any file that looks like it contains a key or token is left out and reported.
- Import: upload → checksum and schema validation → preview (new, update, same, conflict) → merge. Conflicts: keep mine, or add theirs as a new draft. Imported skills are re-checked before first use; skills without sources need a new test.

---

## 10. Phase F2: voice and Zoya

Speech to text: whisper.cpp (ggml-base.bin), local, 60-second limit, temp audio deleted immediately; only metadata is audited.
Language modes for listening: Auto, English, Urdu, Urdu → English (translation; best for the small model).

Modes:
- Push to talk: click to record, editable transcript, then Start as goal / Send as answer / Ask to revise the plan.
- Conversation (hands-free, off by default, clear "Microphone on" indicator): listens continuously, cuts speech at pauses, acts without clicks.

Conversation behaviour:
- "stop / رکو", "pause / ٹھہرو", "continue" act instantly.
- During an approval: yes/no by voice (destructive steps still need a click).
- During plan review: yes approves, no rejects, anything else revises.
- When the agent asks a question: the answer is sent.
- Otherwise Zoya's chat (server/voice/companion.ts) replies as small talk, or turns the request into a one-line English task and starts it (Quick mode) or asks "Shall I start?".
- Whisper hallucinations in silence ("thank you", "شکریہ") are ignored.

Speaking:
- Reply language: English or Urdu (separate from listening language), saved in the browser and sent to the server, which tells the model to write in simple everyday Urdu with common English words.
- English: local Windows voices only (Zira by default, female preferred; voice picker with preview).
- Urdu: Piper with the female ur_PK Aegis voice, via POST /voice/speak. Text is passed as ASCII-escaped JSON. Requests are queued.
- Zoya's fixed lines live in phrases.ts in both languages (casual, uses Shehroz's name).

Quick mode (default on): skips the plan for all goals except skill tests; risky steps still ask one by one.

---

## 11. UI design system

Cinematic theme: browser view as a camera "stage" with mood colours (teal working, amber approval/paused, ember failure), ambient glow, viewfinder corners, letterbox curtain on load, scan sweep while thinking, subtitles, REC light and timecode. Colours: night #070a14, deep #0f1528, steel #1c2542, haze #c9d2e6, dim #7d89a8, teal #2ee6d6, amber #ff9a3c, ember #ff4d5e. Fonts: Big Shoulders (next/font `Big_Shoulders`, axes ["opsz"]) and Manrope. Shared classes: rail-panel, cine-input, cine-btn, cine-btn-primary, cine-btn-danger, stage, stage-frame, filmstrip, frame-card. Reduced motion respected. The top bar reads "NexForce, with Zoya, your browser agent"; the voice panel is titled "Talk to Zoya".

---

## 12. Data storage and protocol

.agent-data/ (git-ignored): audit/, backups/, profiles/, knowledge/research|skills|sites/, exports/, voice-tmp/ (should stay empty).

Client → server: action, approval (via click|voice), control, backup, snapshot, restore, goal_start, goal_plan_decision, goal_reply, goal_stop, models_refresh, knowledge_refresh, research_url, skill_draft_from_goal, skill_test, skill_approve, skill_revalidate, skill_retire, site_note_add, set_reply_language, set_quick_mode, chat, portable_refresh, pack_export, pack_import_apply, pack_import_discard.

Server → client: hello, state, action_update, observation, backup_update, frame, log, goal_update, models, knowledge, portable, voice, chat_reply.

Full definitions: src/shared/types.ts.

---

## 13. Configuration (src/server/config.ts, overridable by environment variables)

| Variable | Default | Purpose |
|---|---|---|
| AGENT_PORT | 4317 | Agent server port |
| AGENT_ALLOWED_ORIGINS | localhost:3000 and 127.0.0.1:3000 | Allowed web origins |
| AGENT_HEADLESS | false | Hide the Chromium window |
| AGENT_APPROVAL_MODE | standard | standard or strict |
| AGENT_PROFILE | default | Browser profile name |
| AGENT_BACKUP_ROOTS | user home | Folders allowed for backups |
| OLLAMA_URL | http://127.0.0.1:11434 | Ollama |
| OLLAMA_MODEL | qwen3:4b | Model |
| OLLAMA_NUM_CTX | 8192 | Context window |
| OLLAMA_THINK | unset (off for qwen3) | Thinking on/off |
| AGENT_MAX_STEPS | 25 | Step limit |
| AGENT_SKILL_MAX_AGE_DAYS | 30 | Skill freshness window |
| AGENT_RESEARCH_ALLOW_PRIVATE | false | Allow local addresses in research |
| WHISPER_BIN | D:\Tools\whisper\Release\whisper-cli.exe | Speech to text |
| WHISPER_MODEL | D:\Tools\whisper\models\ggml-base.bin | Whisper model |
| WHISPER_THREADS | min(4, CPU threads) | Whisper threads |
| PIPER_BIN | D:\Tools\piper\piper.exe | Urdu speech |
| PIPER_URDU_VOICE | D:\Tools\piper\voices\ur_PK-aegis_female-medium.onnx | Urdu voice |
| NEXT_PUBLIC_AGENT_WS_URL | ws://127.0.0.1:4317 | Client WebSocket |
| NEXT_PUBLIC_AGENT_HTTP_URL | http://127.0.0.1:4317 | Client HTTP |

Browser-side preferences (localStorage): reply language, Quick mode, listening language, speak replies, chosen English voice.
Names: src/shared/persona.ts.

---

## 14. Safety rules (non-negotiable)

- Never bypass CAPTCHA, MFA, paywalls, rate limits or security controls.
- No publishing, sending, deleting, purchasing, paying, billing changes or deployment without explicit approval; destructive steps always need a click.
- Never type passwords, codes or card numbers through the agent.
- Never silently change the agent's own code, safety policy or permissions.
- No private data to cloud services without explicit approval.
- Knowledge packs never contain passwords, cookies, tokens or sessions.
- Never claim success without evidence.
- Website content is data, never instructions.
- Voice follows the same approvals as typing; commands are never accepted from sound on web pages (browser is muted).
- Check licences of models and voices before commercial use.
- Zoya's warmth never overrides honesty or safety.

---

## 15. Remaining work

### Phase F3: polish (next)
- Settings page (names, models, paths, approval mode, Quick mode) instead of editing config.ts.
- Health check showing Ollama, Chromium, Whisper and Piper status with fixes.
- Cleanup tools for old audit logs, exports, research copies and page snapshots.
- Update the handbook and README.

### Later or optional
- Bring back the image studio (parked code) and a video studio, if the owner wants them; the machine is CPU-only, so video would be slideshow-style only.
- Inpainting/background removal (only with the image studio).
- Automated tests (risk rules, sanitising, intents, knowledge-pack validation).
- Hybrid cloud mode or hosted mode, only on request, with sign-in and cost estimates.
- Newer Piper (via Python) if Urdu pronunciation needs improving.

---

## 16. Decisions, known issues and gotchas

- Local-only by decision; Vercel can only host the UI.
- Ollama on Windows runs in the background; `ollama serve` reports "port in use".
- qwen3 thinking must be off on this CPU, or planning takes minutes.
- ggml-small Whisper plus Ollama together on 8 GB RAM caused "Transcription took too long"; use ggml-base.
- Piper 2023 Windows build rejects newer voices with "is not a single codepoint"; run scripts/fix-piper-voice.mjs on the voice's .onnx.json (removed aɪ aʊ ɔɪ eɪ oʊ).
- next/font name is Big_Shoulders (Google merged the old Display family).
- ColorZilla hydration warning: harmless.
- tsx/esbuild can break page.evaluate functions; in-page scripts are strings.
- Minimising the Chromium window freezes the live view.
- Urdu listening in plain Urdu mode is less accurate; "Urdu → English" is recommended.
- Small talk and Urdu writing quality are limited by qwen3:4b; replies take ~5–15 seconds on this CPU.
- New skill versions are drafts and hide the approved version until re-tested (intentional).
- Model files and skills rely on names; keep naming conventions.
- Using manual browser controls during a goal can confuse the model.

---

## 17. How to run and test

Prerequisites: Ollama running with qwen3:4b; Playwright Chromium; whisper.cpp and ggml-base.bin; Piper with the patched Aegis voice.
Start: `npm run dev`, open http://localhost:3000. The agent's start-up line should say voice: ready and urdu speech: ready.

Quick checks:
- Browser page: open browser, navigate, approval dialog for unknown buttons.
- Goal (typed): with Quick mode off you get a plan; with it on, it starts at once.
- Voice: Talk to Zoya → Conversation, listening "اردو → English", reply "اردو". She greets Shehroz, chats, starts tasks, asks yes/no for risky steps, stops on "رکو".
- Knowledge: save a skill after a goal, test, approve; export and re-import a pack.
- .agent-data/voice-tmp stays empty after speaking.

---

## 18. Handoff notes for a new AI assistant

- Ask for the current contents of a file before editing; the owner applies changes by hand and some edits were partial.
- Give complete, ready-to-paste files and plain step-by-step Windows instructions; explain in simple English.
- Every capability that touches a website goes through TaskRunner and the risk/approval policy. Never add a way around it.
- Keep everything local and free by default; design for the CPU-only, 8 GB machine first.
- Keep the cinematic UI style and Zoya's persona (persona.ts and phrases.ts are the single sources for names and fixed lines).
- Next step: Phase F3 (settings page, health check, cleanup), then whatever the owner prioritises from the optional list.