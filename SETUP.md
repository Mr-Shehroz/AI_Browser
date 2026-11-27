# NexForce with Zoya: Setup Guide

How to install and run NexForce on a Windows PC, from scratch.
Last updated: 27 November 2026

---

## 1. What you need

| Part | What it does | Required? |
|---|---|---|
| Node.js 22 LTS | Runs the web app and the agent server | Yes |
| Project packages + Playwright Chromium | The app itself and the browser Zoya controls | Yes |
| Ollama + a model (qwen3:4b) | Zoya's brain: plans, decisions, chat | Yes |
| whisper.cpp + a speech model | Turns your voice into text | For voice |
| Piper + Urdu voice | Zoya's Urdu voice | For Urdu speech |
| Microsoft Visual C++ Redistributable (x64) | Needed by Whisper and Piper on some PCs | Only if you see a missing-DLL error |
| Chrome or Edge | To open the dashboard | Yes |

Minimum PC: Windows 10/11, 8 GB RAM, about 10 GB free disk. 16 GB RAM or a GPU makes Zoya much faster and smarter.

---

## 2. Get the project

Copy the project folder **without** these folders:

| Skip | Why |
|---|---|
| `node_modules` | Rebuilt by `npm install` |
| `.next` | Rebuilt automatically |
| `.agent-data` | Contains cookies, sign-ins and logs from the old PC. Move knowledge with a knowledge pack instead (section 9) |

Easiest: use GitHub (the `.gitignore` already skips `.agent-data`), or zip the folder after removing those three.

---

## 3. Install Node.js

1. Download **Node.js 22 LTS** from https://nodejs.org and install it.
2. Check in Command Prompt:
   ~~~cmd
   node -v
   ~~~
   It must show **v20.3** or newer.

---

## 4. Install project packages and the agent's browser

Open a terminal in the project folder and run:
~~~cmd
npm install
npx playwright install chromium
~~~

---

## 5. Install Ollama and a model

1. Install Ollama from https://ollama.com. It runs in the background automatically (llama icon in the system tray).
2. Download a model that suits the PC:

| PC | Command | Then |
|---|---|---|
| 8 GB RAM, no GPU | `ollama pull qwen3:4b` | Nothing; this is the default |
| 16 GB+ RAM or a GPU with 8 GB+ | `ollama pull qwen3:8b` | Set `ollamaModel` to `"qwen3:8b"` in `src/server/config.ts` |

3. Check it works:
   ~~~cmd
   curl http://127.0.0.1:11434
   ollama list
   ~~~
   You should see "Ollama is running" and your model in the list.

Do not run `ollama serve`. Ollama is already running, so it will say the port is in use.

---

## 6. Install Whisper (speech to text)

1. Go to https://github.com/ggml-org/whisper.cpp/releases and download **`whisper-bin-x64.zip`** (the CPU version).
2. Create `D:\Tools\whisper` and extract the zip there. You should have:
   `D:\Tools\whisper\Release\whisper-cli.exe`
3. Go to https://huggingface.co/ggerganov/whisper.cpp/tree/main and download a model into `D:\Tools\whisper\models\`:

| Model | Size | Use when |
|---|---|---|
| `ggml-base.bin` | ~150 MB | Default. Best for 8 GB RAM PCs |
| `ggml-small.bin` | ~490 MB | Stronger PCs. Better Urdu, slower |

   Never use files ending in `.en.bin`; those are English only.
4. Test:
   ~~~cmd
   "D:\Tools\whisper\Release\whisper-cli.exe" --help
   ~~~

---

## 7. Install Piper (Zoya's Urdu voice)

1. Go to https://github.com/rhasspy/piper/releases, open release **2023.11.14-2**, and download **`piper_windows_amd64.zip`**.
2. Extract it and put the **contents** of its `piper` folder in `D:\Tools\piper`, so you have:
   `D:\Tools\piper\piper.exe` and `D:\Tools\piper\espeak-ng-data\`
3. Go to https://huggingface.co/rhasspy/piper-voices/tree/main/ur/ur_PK → `aegis_female` → `medium` and download **both**:
   - `ur_PK-aegis_female-medium.onnx`
   - `ur_PK-aegis_female-medium.onnx.json`

   Put them in `D:\Tools\piper\voices\`. (Backup source: https://huggingface.co/mahwizzzz/piper-voice-ur-aegis-female)
4. **Run the fix script.** The 2023 Windows Piper can't load this newer voice without it. In the project folder:
   ~~~cmd
   node scripts\fix-piper-voice.mjs D:\Tools\piper\voices\ur_PK-aegis_female-medium.onnx.json
   ~~~
   It should say "Done. Removed 5 multi-character phoneme(s)". The original is kept as `.onnx.json.original`.
5. Test:
   ~~~cmd
   cd /d D:\Tools\piper
   echo hello | piper.exe --model voices\ur_PK-aegis_female-medium.onnx --output_file test.wav
   ~~~
   Open `test.wav`. You should hear the voice.

Check the voice's MODEL_CARD for its licence before any commercial use.

---

## 8. Windows settings

1. **Settings → Privacy & security → Microphone**: turn on **Microphone access** and **Let desktop apps access your microphone**.
2. Optional: **Settings → Time & language → Speech → Manage voices** to see or add English voices for Zoya.
3. If Whisper or Piper says a DLL is missing (for example `VCRUNTIME140.dll`), install **Microsoft Visual C++ Redistributable (x64)** from Microsoft.

---

## 9. Bring your knowledge from another PC (optional)

1. Old PC: open **Knowledge → Export knowledge pack → Download**.
2. New PC: open **Knowledge → Import a pack**, choose the ZIP, check the preview, then **Merge into this computer**.

Website sign-ins and cookies never transfer. Sign in again in Zoya's browser when she asks. Imported skills are re-checked before their first use.

---

## 10. Using different folders (no D: drive, or another location)

The `D:\Tools\...` paths are only defaults. Choose one option:

**Option A: edit `src/server/config.ts`** (write each backslash twice):
~~~ts
whisperBin: process.env.WHISPER_BIN ?? "C:\\Tools\\whisper\\Release\\whisper-cli.exe",
whisperModel: process.env.WHISPER_MODEL ?? "C:\\Tools\\whisper\\models\\ggml-base.bin",
piperBin: process.env.PIPER_BIN ?? "C:\\Tools\\piper\\piper.exe",
piperUrduVoice: process.env.PIPER_URDU_VOICE ?? "C:\\Tools\\piper\\voices\\ur_PK-aegis_female-medium.onnx",
~~~

**Option B: Windows environment variables** (no code changes):
~~~cmd
setx WHISPER_BIN "C:\Tools\whisper\Release\whisper-cli.exe"
setx WHISPER_MODEL "C:\Tools\whisper\models\ggml-base.bin"
setx PIPER_BIN "C:\Tools\piper\piper.exe"
setx PIPER_URDU_VOICE "C:\Tools\piper\voices\ur_PK-aegis_female-medium.onnx"
~~~
Then close and reopen VS Code and the terminal.

Other settings you can change the same way:

| Variable | Default | Meaning |
|---|---|---|
| OLLAMA_MODEL | qwen3:4b | Zoya's brain model |
| AGENT_APPROVAL_MODE | standard | `strict` asks before more steps |
| AGENT_MAX_STEPS | 25 | Steps per goal |
| WHISPER_THREADS | up to 4 | CPU threads for speech recognition |
| AGENT_PORT | 4317 | Agent server port |

Names (Zoya, Shehroz) are in `src/shared/persona.ts`.

---

## 11. Start the app

In the project folder:
~~~cmd
npm run dev
~~~
Wait until the agent's start-up line appears in the terminal. It should end with:
~~~
voice: ready · urdu speech: ready
~~~
Then open **http://localhost:3000** in Chrome or Edge.

---

## 12. First-run check

1. Top bar shows a **green dot** (agent connected).
2. Click **Open browser**: a Chromium window opens and appears on the stage. Move it aside, but don't minimise it.
3. The Goal panel shows your model with no warning.
4. **Talk to Zoya** → choose **Conversation** and allow the microphone. Set **You speak: اردو → English** and **Zoya replies in: اردو**. She greets you by name.
5. Say "Wikipedia کھولو اور لاہور سرچ کرو". She replies and starts working.
6. Say **"رکو"** or **"stop"** to stop her at any time.

---

## 13. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `ollama serve`: "Only one usage of each socket address" | Ollama is already running | Nothing to fix; don't run `ollama serve` |
| Goal stuck on "Planning" for minutes | Model thinking on a slow CPU, or too-big model | Make sure `ollamaClient.ts` turns thinking off for qwen3; use `qwen3:4b`; close heavy apps |
| "Default model … isn't pulled" | Model not downloaded | `ollama pull qwen3:4b` (or change `ollamaModel`) |
| "Transcription took too long" | Whisper and Ollama competing for CPU/RAM | Use `ggml-base.bin`; close other apps |
| Voice panel: "Speech recognition isn't set up" | Wrong Whisper path | Check section 6 and section 10 |
| Piper: "is not a single codepoint" | Newer voice, old Piper | Run the fix script (section 7, step 4) |
| No Urdu sound, red message under "Hear Zoya" | Piper path or voice problem | Run the Piper test in section 7; check paths |
| "Chrome blocked the sound" | Browser autoplay rule | Click anywhere on the page once, then try again |
| "Microphone access is blocked" | Permission denied | Click the icon left of the address bar → allow microphone; check Windows settings |
| Missing DLL error | Visual C++ runtime missing | Install Visual C++ Redistributable (x64) |
| Live view frozen | Chromium window minimised | Restore the window; move it aside instead |
| Red dot / "Agent server offline" | Agent server not running or crashed | Check the terminal for errors; restart `npm run dev` |
| Hydration warning mentioning `cz-shortcut-listen` | ColorZilla browser extension | Harmless; already handled in `layout.tsx` |
| "Failed to find font override values for Big Shoulders" | Next.js font notice | Harmless |
| Zoya mishears Urdu | Plain Urdu listening is less accurate | Use **اردو → English**; speak close to the mic |

---

## 14. Updating later

- After pulling new code: run `npm install` again.
- New Ollama model: `ollama pull <name>`, then set `OLLAMA_MODEL` or `ollamaModel` in `config.ts`.
- New Piper voice: download both files, run the fix script on its `.onnx.json`, then set `PIPER_URDU_VOICE`.
- Keep a knowledge pack export as a backup of Zoya's skills and notes.