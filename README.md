# Craft Engine — AI Writing Quality Extension for SillyTavern

Intercepts AI responses, scores writing quality using metrics from 22 published novels, and optionally rewrites weak prose. Imports fandom wiki lore and extracts character voice profiles. Built for roleplay and fanfiction.

## Install

**Option A — Extension Installer (recommended):**
1. Open SillyTavern → Extensions panel → Install Extension
2. Paste the repo URL or the path to this folder
3. Enable Craft Engine in the extensions list

**Option B — Manual:**
1. Copy the entire `CraftEngine/` folder into your SillyTavern's `data/<user>/extensions/third-party/` directory
2. Restart SillyTavern
3. Enable Craft Engine in Extensions → Manage

## What It Does

### 1. Craft Analyzer (Zero LLM cost)
Every AI response gets scored on:
- **Rhythm** — sentence length variety, stdev, echo detection (repeated starters)
- **Sensory density** — words per sentence across 5 senses, smell bonus
- **Slop detection** — model-specific cliché patterns (Claude, GPT, DeepSeek, Gemini + universal)
- **Dialogue** — tag distribution ("said" %, line length, overused tags)
- **Repetition** — overused words, repeated bigrams/trigrams
- **Ending quality** — checks for bad patterns (fragments, questions, ellipsis)

Scores appear as letter-grade badges (A-F) on every AI message. Click the badge for a full breakdown with actionable suggestions.

### 2. Smart Rewriter (One LLM call, only when needed)
When a response scores below your threshold (default 55), the engine can auto-rewrite it using your active style preset and voice profiles. Only fires when the score is genuinely low — no wasted tokens on good prose.

Manual polish available via the ✨ Polish button on any message, or `/polish` slash command.

### 3. Style Presets (from 22-book analysis)
8 built-in presets derived from statistical analysis of published bestsellers:
- **Abercrombie Action** — cinematic, punchy, 1.18 sensory density
- **Pierce Brown Staccato** — first-person present, relentless momentum
- **Madeline Miller Literary** — flowing, immersive, poetic
- **TJ Klune Heartbeat** — fragments, repetition, raw emotion
- **Jim Butcher Noir** — urban snark, hardboiled dialogue
- **Alice Winn Devastation** — restrained prose that shatters
- **CS Pacat Power** — intimacy as political strategy
- **David Gemmell Combat** — maximum battle sensory density
- **Canon Faithful** — uses your imported lore + voice profiles

Import your own books to create custom presets.

### 4. Wiki Importer
Paste any Fandom wiki URL → browse categories or search → select pages → generates a complete SillyTavern lorebook with:
- Structured entries (characters, locations, factions, lore systems, items, events)
- Activation keywords from names and aliases
- Tiered depth settings (character facts at depth 4, voice guides at depth 2)
- Automatic character quote extraction for voice profiling

### 5. Book/File Importer
Upload .txt, .epub, .md, .html, or .json files and:
- **Extract Lore** → generates lorebook entries from source material
- **Learn Style** → analyzes writing patterns and creates a reusable style preset
- **Extract Voices** → identifies character speech patterns and generates voice guides

### 6. Voice Profiler
Extracts character speech patterns from quotes, wiki data, or imported text. Generates voice guides that get injected near the generation point (depth 2) for maximum adherence. Includes:
- Vocabulary level analysis
- Verbal tics and catchphrases
- Tone detection (aggressive, gentle, formal, casual, etc.)
- Sentence structure tendencies
- Address style (how they talk to others)

## Slash Commands
- `/craft` — Analyze the last AI message and show results
- `/polish` — Rewrite the last AI message using craft rules

## Settings

All settings persist across sessions:
- **Auto-analyze** — score every response automatically (default: on)
- **Show badges** — display quality grade on messages (default: on)
- **Model type** — Claude/GPT/DeepSeek/Gemini/All for targeted slop detection
- **Auto-rewrite** — automatically rewrite below threshold (default: off)
- **Rewrite threshold** — quality score below which auto-rewrite triggers (default: 55)
- **Active preset** — which style rules to inject and score against
- **Custom rules** — additional writing rules injected into every prompt
- **Voice profiles** — activate/deactivate per-character voice guides

## File Structure
```
CraftEngine/
├── manifest.json      — Extension metadata + interceptor declaration
├── index.js           — Main entry, event hooks, UI wiring
├── analyzer.js        — Pure JS craft analysis engine (zero LLM)
├── rewriter.js        — Smart rewriter (LLM-powered)
├── craft-rules.js     — 22-book benchmarks + style presets
├── slop-data.js       — Model-specific slop patterns
├── wiki-importer.js   — MediaWiki API integration
├── file-importer.js   — Book/file upload + digestion
├── voice-profiler.js  — Character voice extraction
├── settings.html      — Settings panel template
├── style.css          — UI styles
└── README.md
```

## How the Analysis Works

The analyzer scores text against empirically validated benchmarks from fantasy, action, and MM romance authors:

| Metric | Target Range | Source |
|--------|-------------|--------|
| Avg sentence length | 12-15 words (general) | Abercrombie, Brown, Butcher |
| Sentence stdev | 10-14 (general), 8-10 (action) | Cross-author analysis |
| Short sentences | 30-40% (general), 35-45% (action) | Brown (45%), Gemmell (35%) |
| Sensory density | 0.5-1.0/sentence (general), 0.9+ (action) | Abercrombie (1.18), Miller (0.90) |
| "Said" usage | 55-65% of dialogue tags | Cross-author consensus |
| Dialogue length | 8-12 words per line | Butcher (10), Miller (8.6) |

Scene type is auto-detected (action, romance, dialogue, general) and benchmarks adjust accordingly.
