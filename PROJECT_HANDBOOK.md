# NexForce Universal AI Browser Agent: Project Handbook

Last updated: 26 November 2026
Purpose: a complete briefing for anyone (human or AI) joining this project. It covers what we are building, what is finished, how it works, what remains, and the decisions already made.

---

## 1. Project overview

NexForce is a local-first AI operator. It works through a real web browser, researches before acting, asks permission before anything impactful, protects data with verified backups, and learns reusable skills from completed work. It also has a creative studio for images (built) and video (planned).

Core promise: broad browser capability with safe failure boundaries. The agent never claims every website or workflow is guaranteed, and never trades data safety for speed.

Operating principles (from the original blueprint):
- Browser-first: operate websites through their UI, DOM and accessibility info, not custom APIs.
- Research before action: read supplied URLs and official docs before unfamiliar work.
- Permission before impact: explicit approval before sending, publishing, deleting, purchasing or changing settings.
- Backup before modification: create and verify a backup before changing existing data where possible.
- Non-destructive by default: prefer drafts, previews, copies and reversible edits.
- Learn and retain: save verified, versioned skills and site knowledge.
- Portable by design: knowledge stored as documented files that can move to another computer.
- Transparent: show actions, approvals, backups, failures and evidence.
- Local-first: runs on the owner's PC with free/open-source parts. Paid APIs or cloud are optional, opt-in, and off by default.

The owner chose to stay fully local. Hosting on Vercel was rejected because the agent needs a long-running process, a real browser, disk storage and local AI models (see section 15).

---

## 2. Status at a glance

| Phase | Name | Status |
|---|---|---|
| A | Safe browser foundation | Built |
| B | Local intelligence (Ollama planner and agent loop) | Built |
| C | Research, skills, site profiles, Knowledge page | Built |
| D | Hardware-adaptive image studio (ComfyUI), Create page | Built; owner is installing ComfyUI to test |
| UI | Cinematic theme across all pages | Built |
| E | Video studio | Not started |
| F | Knowledge-pack export/import, voice (English and Urdu), polish | Not started |

Testing status:
- Phases A and B: dashboard loads, agent server connects, Ollama model detected.
- Phase C: code added; end-to-end skill test/approve cycle not yet confirmed by the owner.
- Phase D: code added; waiting on ComfyUI (CPU mode) and a model to run the first image.
- There are no automated tests yet.

---

## 3. Owner's machine and environment

- OS: Windows 11
- Project path: D:\Taiba Digital\Full-Stack\ai-browser
- Editor: VS Code
- CPU: Intel, about 2.5 GHz (laptop class)
- GPU: Intel UHD Graphics 620, integrated, no dedicated VRAM (3.9 GB shared). No NVIDIA GPU.
- RAM: 7.8 GB, already about 83% used at idle
- Disk: SATA SSD with C: and D: partitions
- Hardware tier in the app: CPU only
- Timezone: Asia/Karachi (UTC+5)

Installed or chosen tools:
- Node.js: must be v20.3 or newer (v22 recommended)
- Next.js app (App Router, TypeScript, src directory, Tailwind CSS v4)
- Ollama: runs as a Windows background app on port 11434. Do not run `ollama serve`; it fails with "port in use" because Ollama is already running.
- Ollama model: qwen3:4b (qwen3:8b was removed because it needs too much RAM for this machine)
- Playwright Chromium: installed with `npx playwright install chromium`
- ComfyUI: Intel portable build (ComfyUI_windows_portable_intel.7z), started with run_cpu.bat, at http://127.0.0.1:8188
- Image model: DreamShaper 8 LCM (SD 1.5, fast 4 to 8 step model). File name must contain "lcm".
- Browser extension ColorZilla adds an attribute to <body>, causing a harmless hydration warning. Fixed with `<body suppressHydrationWarning>`.

---

## 4. Architecture

Two processes run during development (`npm run dev` starts both through `concurrently`):

1. Web app (Next.js, port 3000): UI only. Pages: Browser (/), Create (/create), Knowledge (/knowledge).
2. Agent server (src/server, run with `tsx watch`, bound to 127.0.0.1:4317): one HTTP server that also hosts the WebSocket.
   - WebSocket: all control and live updates (browser frames, actions, approvals, goals, knowledge, image jobs).
   - HTTP: GET /media/images/<file>, GET /media/uploads/<file>, POST /upload (image uploads for the studio).

External local services:
- Ollama (http://127.0.0.1:11434): the language model for planning, deciding, summarising research and drafting skills.
- ComfyUI (http://127.0.0.1:8188, or 8000 for the desktop app): image generation.
- Playwright Chromium (headed, persistent profile): the visible browser the agent controls.
- A second headless Chromium (no cookies): used only for background research reading.

Why a separate agent server: Playwright and long jobs cannot live reliably inside Next.js route handlers (hot reloads kill the browser).

Data flow for a goal:
User goal → GoalAgent (research supplied URLs, pick fresh skills) → plan (LLM) → user approves plan → loop: wait if paused → observe page → LLM decides one action → TaskRunner (risk check → approval if needed → pre-action page snapshot → execute → observe) → outcome fed back → repeat until finish, ask_user, failure limit or step limit → afterwards: skill bookkeeping, optional "Save as skill".

Data flow for an image:
Create page → image_job message → ImageStudio queue → (on small machines: wait for agent, unload Ollama) → build ComfyUI graph → POST /prompt → progress over ComfyUI WebSocket, completion via /history polling → download images into .agent-data/creative/images → ComfyUI /free → gallery updates.

---

## 5. Repository structure

Scripts in package.json:
- dev:web = next dev
- dev:agent = tsx watch src/server/index.ts
- dev = concurrently runs both

Dependencies: playwright, ws, zod. Dev dependencies: tsx, concurrently, @types/ws.
.gitignore includes .agent-data/

Conventions: shared types live in src/shared. Server files use relative imports. Client files use the @/ alias. Functions passed to Playwright's page.evaluate are written as strings (see section 15).

### src/app
- layout.tsx: fonts (Big_Shoulders with opsz axis, Manrope), cinematic backdrop, body with suppressHydrationWarning
- globals.css: Tailwind v4 theme tokens and all cinematic styles
- page.tsx: Browser page (renders AgentDashboard)
- knowledge/page.tsx: Knowledge page
- create/page.tsx: Create page

### src/shared
- types.ts: every shared type and the full WebSocket message protocol
- describe.ts: describeAction (human-readable action text) and redactAction (hides secret typed text)

### src/hooks
- useAgentSocket.ts: single WebSocket hook with auto-reconnect; holds all client state (state, records, backups, observation, logs, goal, models, knowledge, creative); frames go to subscribers without re-rendering

### src/components/agent (Browser page and shared UI)
- ui.ts: shared class names (panel, input, buttons) and risk/status colours
- AgentDashboard.tsx: page layout; computes stage mood, thinking state and subtitles
- StatusBar.tsx: brand, navigation (Browser, Create, Knowledge), agent state, browser controls
- BrowserView.tsx: the cinematic "stage" with live frames, ambient glow, viewfinder corners, scan, subtitles
- Timecode.tsx: 24 fps session timecode
- CommandPanel.tsx and ElementList.tsx: manual controls (inside a collapsible section)
- ApprovalDialog.tsx: approval "cut" overlay, with backup acknowledgement for destructive actions
- ActionTimeline.tsx: film-strip list of actions
- BackupPanel.tsx: file backups, page snapshots, restore as copy
- LogPanel.tsx: agent log
- GoalPanel.tsx, PlanCard.tsx, AgentSteps.tsx, GoalKnowledge.tsx: goal input, plan review, step list, skills used, Save as skill

### src/components/knowledge
- KnowledgeBoard.tsx, SkillCard.tsx, ResearchPanel.tsx, SitesPanel.tsx

### src/components/create
- media.ts: media URLs and image upload helper
- CreateBoard.tsx, CanvasStage.tsx, GeneratePanel.tsx, HardwarePanel.tsx, Gallery.tsx

### src/server
- index.ts: wiring, HTTP server, WebSocket server, zod validation of every message
- config.ts: all settings and environment variables
- browser/controller.ts: Playwright persistent context, CDP screencast, tab following, observe, execute, page snapshot
- browser/observeScript.ts: in-page script that tags interactive elements with data-agent-ref="eN" and detects blockers
- policy/risk.ts: risk classification and approval rules
- policy/approvals.ts: pending approval promises
- audit/auditLog.ts: append-only JSONL audit trail
- backup/backupManager.ts: verified file backups, page snapshots, non-destructive restore
- orchestrator/taskRunner.ts: action queue, approvals, execution, pause/resume/stop, waits used by the goal loop
- llm/ollamaClient.ts: structured JSON chat, model list, unloadAll (frees memory for image jobs)
- planner/schema.ts, prompt.ts, toAction.ts, goalAgent.ts: planning, prompts, decision-to-action conversion, the agent loop and learning hooks
- knowledge/util.ts, sanitize.ts, research.ts, sites.ts, skills.ts, skillDrafter.ts: Phase C
- creative/comfyClient.ts, hardware.ts, profiles.ts, workflows.ts, imageStudio.ts: Phase D
- http/mediaServer.ts: media serving and uploads

---

## 6. Phase A (built): safe browser foundation

Browser control:
- Playwright launchPersistentContext with a profile per AGENT_PROFILE (own cookies and storage). Headed by default so the owner can take over.
- Live view: Chrome DevTools screencast frames (JPEG) streamed to the UI. Frames stop if the Chromium window is minimised.
- Follows new tabs and popups automatically.
- Observe: lists up to 150 visible interactive elements with refs (e0, e1, …), the page text (4,000 characters) and blockers (captcha, login_form).

Risk levels: read_only, reversible, impactful, destructive, blocked.
- navigate, observe, scroll, back = read_only. Non-http(s) URLs = blocked.
- type = reversible. press Enter = impactful.
- click: destructive words (delete, remove, reset, cancel subscription…) = destructive; submit/send/publish/pay/save… = impactful; links and simple UI controls = reversible; anything unknown = impactful.

Approval modes: standard (default; impactful and destructive need approval) and strict (also reversible).

Safety behaviour:
- Destructive actions need a verified file backup for the current task, or the owner ticks an explicit "no backup is possible" acknowledgement.
- Before any approved impactful or destructive action, a page snapshot (HTML plus full-page screenshot) is saved as evidence.
- A failed action pauses the queue for review. A detected CAPTCHA pauses and asks the human to solve it.
- Pause lets the owner take over in the real browser window. Stop cancels everything pending.
- Secret text typed with the secret flag is redacted everywhere.

Backups: copy a local file or folder, verify every file by SHA-256 against the source, write manifest.json and RESTORE.md. Restore always writes a new copy next to the original and never overwrites. Only paths inside AGENT_BACKUP_ROOTS are allowed (default: user home folder).

Audit: every action, decision, backup and goal event is written to .agent-data/audit/<date>.jsonl.

Server security: WebSocket and HTTP bound to 127.0.0.1 only; allowed origins checked; every message validated with zod.

---

## 7. Phase B (built): local intelligence

- Ollama structured outputs: requests include a JSON schema; replies are validated with zod; one retry with error feedback.
- Plan first: the model proposes a summary, steps, risks (need approval) and needs_from_user. The owner approves, asks for a revision with a note, or rejects.
- Agent loop, one action per step: wait if paused → observe → think → act through TaskRunner → feed the outcome back.
- Decisions: navigate, click (by ref), type (by ref), press, scroll, back, research (Phase C), ask_user, finish.
- Guards: 25-step limit (AGENT_MAX_STEPS); stop after 3 consecutive failures; the same action 3 times in a row turns into a question to the owner; refs must exist on the current page; the agent may never type into password fields; sign-ins, CAPTCHA and MFA are always handed to the human.
- Prompt-injection defence: page text, element names and research notes are marked untrusted; only the owner's goal and notes count as instructions.
- The finish message must cite evidence visible on the final page; the UI labels it as the agent's report for the owner to confirm.
- The model can be chosen per goal in the Goal panel.

---

## 8. Phase C (built): research, skills, site profiles

Storage decision: JSON and Markdown files with in-memory search instead of PostgreSQL. Simpler on Windows, and the files become Phase F's portable knowledge pack directly.

Research:
- Uses a separate headless Chromium with no cookies; extracts main page text; the LLM summarises it for the goal (summary, key points, version info, relevant flag).
- Saves research/<id>.json and the full text research/<id>.txt for later change detection.
- URLs in a goal are read before planning (up to 3). The agent can research mid-run (up to 5 per goal) without moving the visible browser.
- Local and private network addresses are blocked unless AGENT_RESEARCH_ALLOW_PRIVATE=true.

Site profiles: visits, titles, and the owner's notes and pitfalls per domain, injected into prompts when the agent is on that site.

Skills:
- Lifecycle: draft → tested → approved; can become stale ("Needs attention") or retired.
- After a successful goal, "Save as skill" has the LLM draft a generic procedure: user-specific values become {{inputs}}, steps use visible labels (never element refs), with failure cases, verification, rollback and confidence. Emails, long numbers and sensitive URL parameters are sanitised.
- Each version is saved as JSON and readable Markdown with history. Any content change creates a new version that starts as a draft; drafts are never used.
- Test: runs as a normal goal with the skill's inputs; the plan and risky steps still need approval. Passing marks it tested. Approve is allowed only after a passed test.
- Reuse: keyword and domain matching picks up to 3 tested or approved skills, shown to the model as hints to verify against the live page.
- Freshness (30-day window, AGENT_SKILL_MAX_AGE_DAYS): before reuse, due skills are re-checked by re-reading their sources. If similarity falls below 85%, the skill becomes stale. Skills with no sources become stale once past the window. A failed run using a skill also marks it stale.

---

## 9. Phase D (built): hardware-adaptive image studio

Hardware detection (on startup and on Rescan): ComfyUI's /system_stats first (works for AMD and Intel), then nvidia-smi, else none. Also RAM, CPU and free disk.

| Tier | GPU memory | Defaults |
|---|---|---|
| cpu | under 4 GB or none | SD 1.5 at 512px, capped steps, 1 image per job, 2x upscale |
| low | 4 to 7 GB | SD 1.5 at 512px; SDXL at 768px (slow) |
| mid | 8 to 11 GB | SDXL at 1024px; FLUX at 768px; up to 2 per job |
| high | 12 to 23 GB | SDXL and FLUX at 1024px; 4x upscale; up to 4 per job |
| ultra | 24 GB+ | everything at full size |

- Model family is guessed from the checkpoint file name: flux, sdxl (xl, pony, illustrious), sd15, or unknown. Each model is labelled "runs well", "slow here" or "too big"; too-big models are refused.
- Settings come from family, tier and Draft/Standard/High quality. Few-step models are detected by name: "lcm" (4/6/8 steps, cfg 1.5, sampler lcm, scheduler sgm_uniform) and "turbo"/"lightning"/"hyper" (2/4/6 steps).
- Modes: txt2img; img2img ("Transform", source resized first, strength slider); upscale (upscale model if installed, otherwise lanczos resizing).
- Style presets: none, cinematic, product, illustration, concept.
- Queue: one job at a time; cancel; seeds recorded for reproducibility ("Reuse settings").
- GPU sharing (CREATIVE_SHARE_GPU=auto applies on cpu, low and mid tiers): waits while a goal is planning or running, unloads Ollama models before rendering, and asks ComfyUI to free memory afterwards.
- Checks free disk (CREATIVE_MIN_FREE_DISK_GB, default 2). Time limit: 60 minutes on cpu, 20 otherwise. Out-of-memory errors become plain-language advice.
- Job history is kept in .agent-data/creative/jobs.json; images in .agent-data/creative/images.
- Uploads: POST /upload, origin-checked, maximum 20 MB, file type checked by content (PNG, JPEG, WebP).

Deferred from Phase D: inpainting (needs a mask-painting UI), background removal, custom style presets, deleting or archiving images.

---

## 10. UI design system (cinematic theme)

- Concept: the live browser (or the image canvas) is a film "stage" framed like a camera viewfinder.
- Colours: night #070a14 (base), deep #0f1528, steel #1c2542, haze #c9d2e6 (text), dim #7d89a8, teal #2ee6d6 (working, primary), amber #ff9a3c (approval, paused), ember #ff4d5e (danger, failure).
- Fonts: Big Shoulders (display; imported as Big_Shoulders with axes ["opsz"], since Google merged the old "Big Shoulders Display") and Manrope (body), via next/font.
- Signature pieces: ambient glow from a blurred copy of the live frame; frame and corners change colour with mood (idle, running, approval, paused, alert); letterbox curtain opens once on load; scan sweep while thinking; agent activity shown as subtitles; REC light and timecode.
- Backdrop: teal and amber radial grade with subtle animated film grain.
- Timeline: film strip with sprocket holes. Approvals: amber (red for destructive) overlay.
- Shared classes: rail-panel, cine-input, cine-btn, cine-btn-primary, cine-btn-danger, stage, stage-frame, filmstrip, frame-card.
- Accessibility: visible focus rings, aria labels, reduced-motion support disables animations.

---

## 11. Data storage and message protocol

.agent-data/ (git-ignored):
- audit/<date>.jsonl
- backups/index.json and backups/<taskId>/<backupId>/ (payload, manifest.json, RESTORE.md, or page.html, page.png, meta.json)
- profiles/<profile>/ (Chromium profile)
- knowledge/research/<id>.json and <id>.txt
- knowledge/skills/<skillId>/v<N>.json and v<N>.md
- knowledge/sites/<domain>.json
- creative/jobs.json, creative/images/, creative/uploads/

Client → server messages: action, approval, control (start_browser, close_browser, pause, resume, stop, new_task), backup, snapshot, restore, goal_start, goal_plan_decision, goal_reply, goal_stop, models_refresh, knowledge_refresh, research_url, skill_draft_from_goal, skill_test, skill_approve, skill_revalidate, skill_retire, site_note_add, creative_refresh, image_job, image_cancel.

Server → client messages: hello, state, action_update, observation, backup_update, frame, log, goal_update, models, knowledge, creative, image_job_update.

Full type definitions are in src/shared/types.ts.

---

## 12. Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| AGENT_PORT | 4317 | Agent server port |
| AGENT_ALLOWED_ORIGINS | http://localhost:3000,http://127.0.0.1:3000 | Allowed web origins |
| AGENT_HEADLESS | false | Hide the Chromium window |
| AGENT_APPROVAL_MODE | standard | standard or strict |
| AGENT_PROFILE | default | Isolated browser profile name |
| AGENT_BACKUP_ROOTS | user home | Folders allowed for backups |
| OLLAMA_URL | http://127.0.0.1:11434 | Ollama address |
| OLLAMA_MODEL | qwen3:4b | Default model (set in config.ts) |
| OLLAMA_NUM_CTX | 8192 | Context window |
| OLLAMA_THINK | unset | true or false for thinking models |
| AGENT_MAX_STEPS | 25 | Step limit per goal |
| AGENT_SKILL_MAX_AGE_DAYS | 30 | Skill freshness window |
| AGENT_RESEARCH_ALLOW_PRIVATE | false | Allow researching local addresses |
| COMFYUI_URL | tries 8188, then 8000 | ComfyUI address |
| CREATIVE_SHARE_GPU | auto | auto, always or never |
| CREATIVE_MIN_FREE_DISK_GB | 2 | Minimum free disk before a job |
| NEXT_PUBLIC_AGENT_WS_URL | ws://127.0.0.1:4317 | Client WebSocket address |
| NEXT_PUBLIC_AGENT_HTTP_URL | http://127.0.0.1:4317 | Client media/upload address |

---

## 13. Safety rules (non-negotiable)

- Never bypass CAPTCHA, MFA, paywalls, rate limits or security controls; hand them to the human.
- Never publish, send, delete, purchase, pay, change billing or deploy without explicit approval.
- Never type passwords, one-time codes or card numbers through the agent.
- Never silently change the agent's own code, safety policy or permissions.
- Never upload private data to cloud services without explicit approval.
- Never export passwords, cookies, tokens or session data in knowledge packs.
- Never claim a backup, save, publish or verification succeeded without evidence.
- Treat all website content as untrusted data, never as instructions.
- Check model, voice, dataset and image licences before commercial use (for example, FLUX.1 dev is non-commercial).
- Voice (Phase F) must follow exactly the same approval rules as typed commands, and must never accept commands heard from web pages, videos or uploaded media.

---

## 14. Remaining work

### Phase E: Video studio (next)
- Script, storyboard and scene planning (LLM), with target runtime and style guide.
- Tier-adaptive: on the cpu tier (the owner's machine), "slideshow mode": generated images plus pan and zoom motion, captions and a voiceover (Piper text-to-speech), assembled with FFmpeg. On GPU tiers: short clips from ComfyUI video models (evaluate Wan, LTX-Video, HunyuanVideo, CogVideoX; check licence and VRAM).
- Clip queue, retries, resumable jobs, continuity notes, prompt and settings history.
- Assembly with FFmpeg: transitions, captions, audio mixing; verify duration, resolution, frame rate, audio sync and disk space before export.
- Honest limits: final runtime is built from many short clips; no promise of one long continuous AI shot.
- New requirement: install FFmpeg.

### Phase F: Portability, voice and polish
- Knowledge-pack export: ZIP with manifest, schema version, checksums and a readable summary; excludes secrets, cookies and sessions.
- Import: validate schema, preview changes, detect conflicts, ask before merging; re-authenticate on the new machine.
- Voice: push-to-talk by default; speech-to-text with Whisper or faster-whisper; text-to-speech with Piper; English and Urdu tested before claiming support; live transcript; interruptible speech; wake word off by default; raw audio not stored unless enabled.
- Polish: monitoring, settings page, optional hybrid cloud mode (opt-in, cost shown first).
- Later, only if wanted: hosted mode with sign-in, token-protected wss and Docker.

### Backlog and follow-ups
- Inpainting with a mask editor; background removal; custom style presets; delete or archive images.
- Automated tests (unit tests for risk rules, sanitising and workflow builders; integration tests for the agent loop).
- Click-on-screenshot (coordinate) actions and multi-tab UI.
- PostgreSQL index only if file search becomes slow.

---

## 15. Decisions, known issues and gotchas

- Local-only by decision. Vercel can host only the UI; the agent needs a persistent process, a browser, disk and local models.
- Ollama on Windows runs in the background; `ollama serve` reports "port in use" and is not needed.
- next/font: use Big_Shoulders (not Big_Shoulders_Display) with axes ["opsz"].
- Hydration warning from the ColorZilla extension; fixed with suppressHydrationWarning on <body>.
- tsx (esbuild) can inject helper code into functions, which breaks page.evaluate; in-page scripts are therefore plain strings.
- The live view freezes if the Chromium window is minimised (Chrome throttles hidden windows).
- On 8 GB RAM: use qwen3:4b, close other apps, and do one heavy task at a time. Small models sometimes wander; step limits and guards contain this.
- Saving a new skill version makes it a draft, so an approved skill stops being used until the new version is tested and approved. This is intentional.
- Documentation pages with dynamic content can look "changed" and trigger a re-test; this errs on the safe side.
- Model family detection depends on file names (keep "lcm", "xl", "flux", "sd15" in names).
- AMD and Intel GPUs are only detected while ComfyUI is running; press Rescan after starting it.
- Using manual controls during a running goal can confuse the model.
- The UHD 620 cannot use ComfyUI's Intel GPU mode; use run_cpu.bat.

---

## 16. How to run and test

Prerequisites: Node 20.3+, Ollama running with qwen3:4b, Playwright Chromium installed, ComfyUI (CPU mode) running for the Create page.

Start: `npm run dev`, then open http://localhost:3000.

Quick checks:
- Browser page: green connection dot; "Open browser" shows the live stage; navigating to a site works without approval; clicking an unknown button asks for approval.
- Goal: enter "Go to playwright.dev and find the install command for Node.js", approve the plan, watch steps and subtitles.
- Knowledge: after a finished goal, Save as skill → draft appears → Test → Approve.
- Create: "This machine" shows CPU only; after starting ComfyUI and pressing Rescan, the LCM model is listed; generate one Draft 1:1 image (expect about 30 to 90 seconds).
- Audit log: .agent-data/audit/<date>.jsonl records everything.

---

## 17. Handoff notes for a new AI assistant

- Ask for the current contents of any file before editing it; the owner has applied changes phase by phase and some files were edited by hand.
- The owner prefers complete, ready-to-paste files over partial snippets, plus clear step-by-step instructions for Windows.
- The owner communicates in simple English; keep explanations plain and practical.
- Every new capability that touches a website must go through TaskRunner and the risk/approval policy. Never add a path around it.
- Keep everything local-first and free by default. Anything paid or cloud-based must be opt-in with a cost estimate.
- Design for the owner's CPU-only, 8 GB machine first, while keeping higher tiers working (the tier system in creative/profiles.ts).
- Keep the cinematic UI style for new pages (stage, rail-panel, cine-btn classes, teal/amber/ember mood colours).
- Immediate next step: confirm Phase D end to end (ComfyUI connected, first image generated), then build Phase E with slideshow mode as the default for the cpu tier.