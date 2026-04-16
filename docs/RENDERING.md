# Rendering — The Viral Layer

## Why This Matters Most

If Chronicle's backend is perfect but its output looks like a log file, it dies. If Chronicle's backend is mediocre but its output looks like a cinematic TV show, it wins.

**The rendering IS the product for 95% of users.**

We must design backwards from: *"What would someone screenshot and post?"*

---

## The Four Rendering Surfaces

Chronicle produces FOUR distinct visual outputs, each optimized for a different share format.

### Surface 1 — **Live 2D Map** (primary, real-time)
The main canvas while the simulation runs. Top-down view of the world, characters as expressive sprites, speech bubbles. Feels alive. Used for:
- Twitch-style live streams
- Screen-recorded clips
- Interactive "sit and watch" sessions

### Surface 2 — **Gazette** (narrative newsprint)
Auto-generated "newspaper" that covers major events in the world. Like reading a weekly paper from the simulated society. Used for:
- Reddit-ready screenshots
- Twitter threads ("Week 3 headline: Elena accuses Marcus of hoarding food")
- Summary shareable with people who don't want to watch the full run

### Surface 3 — **Whisper Stream** (private POV)
A scrolling feed of each character's inner thoughts + private messages. Like looking at their phone. Used for:
- Twitter screenshots of juicy DMs ("Chen privately messaged Priya: I know what you saw")
- Group chat style shares
- Character-level drama focus

### Surface 4 — **Highlight Reel** (auto-cut video)
The simulation produces a 30-60 second video after any run, cutting between key moments with music. Used for:
- TikTok / Reels / Shorts
- Twitter video tweets
- "Here's what happened in my Chronicle" posts

**These surfaces aren't afterthoughts. They're first-class product features.**

---

## Surface 1: The Live 2D Map

### Visual style: "Mythpunk Pixel"

Not Stardew Valley (too cute). Not Dwarf Fortress (too geeky). Something that feels literary and dramatic.

**Reference aesthetic:**
- 32×32 pixel character sprites with expressive faces (4-8 face variants per character)
- Soft-limit palette: 32 colors total across the world (gives it a unified, storybook feel)
- Subtle lighting: day/night shifts tint the whole scene
- Atmospheric particles: rain, smoke, dust — all sprite-based
- Hand-drawn-feeling fonts for speech bubbles

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  TOP BAR                                                     │
│  [⏸] Tick 127/500  [🔥] High drama  [💰] $1.23 used         │
├──────────────────────┬──────────────────────────────────────┤
│                      │                                       │
│                      │  AGENT INSPECTOR (when clicked)       │
│                      │  ┌──────────────────────┐            │
│                      │  │ Marcus                │            │
│                      │  │ 😤 Angry              │            │
│    THE MAP           │  │ Energy: 42/100        │            │
│    (2D top-down)     │  │ Location: Beach Camp  │            │
│                      │  │ Current thought:      │            │
│  [characters walk]   │  │ "Elena is hiding      │            │
│  [speech bubbles]    │  │  something about      │            │
│  [resources]         │  │  medicine supplies"   │            │
│  [relationship lines]│  │                       │            │
│                      │  │ Relationships:        │            │
│                      │  │ → Elena  (trust -0.3) │            │
│                      │  │ → Chen   (unknown)    │            │
│                      │  │ → Amara  (trust +0.6) │            │
│                      │  └──────────────────────┘            │
├──────────────────────┴──────────────────────────────────────┤
│  TIMELINE (scrubbable)                                       │
│  ━━━●━━━●━━━●━━━●━━━●━━━◆━━━●━━━●━━━━━                    │
│        ↑                    ↑  ↑ current tick                │
│   "Marcus accuses     "Storm hits"                          │
│    Elena" (tick 42)                                          │
├─────────────────────────────────────────────────────────────┤
│  GOD INPUT                                                   │
│  [Type an event to inject...]                          [↵]  │
└─────────────────────────────────────────────────────────────┘
```

### Map animation details

**Character movement**: tween smoothly between tiles (0.5s ease-out). Never teleport.

**Speech bubbles**:
- Fade in with typewriter effect (200ms per 30 chars)
- Stay for 8 seconds or until next message
- Fade out smoothly
- Bubble position: above head, flips to below if near top of screen
- Tone-colored outlines: neutral gray, whisper dashed, shout thick red, angry jagged

**Face expressions**:
- Base face per character (4–8 sprite variants)
- Change based on `mood` field, animated transition
- Mood inferred by engine from recent actions + explicit `set_mood` tool

**Relationship visualization** (toggleable overlay):
- Faint line connects agents with meaningful relationships
- Color: green friendly, gray neutral, red hostile, pink romantic
- Thickness = relationship strength
- Line pulses when interaction happens between those two

**Environmental mood**:
- Overall color grading shifts with world tension
- Calm: warm gold tint
- Tense: cool blue
- Violence: desaturated red
- Transitions over 20+ ticks for subtlety

**Resource glow**:
- Resource nodes (food, water, treasure) have a slight glow
- Dimmer as they deplete
- Empty nodes become gray stumps / dry wells

---

## Surface 2: The Gazette

Every N ticks (configurable, default 24 = "one day"), Chronicle generates a newspaper page.

### Layout (looks like a real newspaper)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            THE BEACH CAMP GAZETTE
        Day 3  •  Isle of Deliverance  •  Free
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  ┃  ACCUSATIONS AT DAWN                ┃
  ┃  Tensions flared this morning as    ┃
  ┃  Marcus (55, former officer)        ┃
  ┃  publicly accused Elena of          ┃
  ┃  hoarding medical supplies...       ┃
  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

  ┏━━━━━━━━━━━━━━━━━━━┓ ┏━━━━━━━━━━━━━━━━━━┓
  ┃ STORM WARNING      ┃ ┃ SUPPLIES COUNT    ┃
  ┃ Finn reports dark  ┃ ┃ Food: 12 rations  ┃
  ┃ clouds building    ┃ ┃ Water: 8L         ┃
  ┃ to the south.      ┃ ┃ Down from Day 2   ┃
  ┗━━━━━━━━━━━━━━━━━━━┛ ┗━━━━━━━━━━━━━━━━━━┛

  ━━━ OVERHEARD ━━━

  "I've been watching him. He has a
  knife in his boot." — Priya, to Amara,
  in private

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Week 3 outlook:  ▂▃▅▇█  Tension rising
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Generation

LLM-generated per-day. Prompt:

```
You are a journalist covering a small isolated community.
These are the events of Day 3:

[structured event list from the tick range]

Write a newspaper page (3 articles + 1 sidebar "overheard" section).
Tone: detached, observational, slightly dramatic.
Max 300 words total.
Format as markdown with headings.
```

Styled in a faux-newsprint CSS template. Beautifully shareable.

### Variations by world

The gazette style adapts to world genre:
- Medieval: "The Kingdom Herald" parchment style
- Startup: "TechCrunch: Startup News" modern blog style
- Space: "Earth Dispatch — Colony Ship Chronicle"
- High School: "The Westbrook Gazette" with yearbook aesthetic

World's `atmosphere_tag` drives the gazette's CSS theme. Auto-selected from user's natural-language description.

---

## Surface 3: The Whisper Stream

A private, character-centered feed. Like reading someone's diary + DMs.

### Layout

Mobile-first vertical layout. Looks like a modern messaging app.

```
─────────────────────────────
 ← Back              Marcus ⓘ
─────────────────────────────
                             
  😤 11:47  — Day 3
  Marcus thought:
  "Elena is hiding something.
  I saw her count the pills twice."
                             
  💬 11:52 — to Elena (public)
  "We need to talk about the supplies."
                             
  😐 11:53 — Elena replied
  "I'm keeping inventory. Don't
   accuse me of something you
   don't understand."
                             
  🤫 12:14 — Marcus whispered to Finn
  "Keep watch tonight."
                             
  🤫 12:14 — Finn replied
  "Aye."
                             
─────────────────────────────
  Marcus is currently: angry
  Location: Beach Camp
─────────────────────────────
```

### What's here

- Character's internal thoughts (from `think()` calls)
- Their public speech (from `speak()`)
- Their private whispers (from `speak(to='whisper:X')`)
- Emotional state labels
- Timestamps in world-time

**Filter views:**
- "Their POV" — only what they said/thought/heard
- "About them" — things others said about them
- "With Elena" — just conversations between these two

**The juicy share:**
A character's entire whisper stream is naturally group-chat-leak-style content. Perfect for Twitter.

---

## Surface 4: The Highlight Reel

Auto-generated video. Produced on-demand or automatically after a run.

### Structure

- 30-60 seconds
- Opens with a title card: world name, X characters, Y ticks
- Cuts between 5-10 "high drama" moments
- Each cut: 3-5 seconds showing a dramatic speech/action on the map
- Character faces zoom in during emotional moments
- Ends with a closing card: "That's what happened on the island. Want to run your own? chronicle.sh"

### Technical approach

- Use the map sprite renderer + record 60fps frames at 512×512
- Use ffmpeg to stitch
- Royalty-free music bed (we ship a few tracks)
- Optional: LLM-generated opening text card ("An isle of 8. They didn't all survive.")

### Drama detection

Which moments make the cut? Heuristics:
- Any rule violation event
- Any relationship flip (friendly→hostile)
- Any agreement signing/breaking
- Any death or birth
- Any intervention from god
- Top 3 highest-"importance" memories per character

Each event has a **drama_score** (computed by engine + optional LLM judge). We pick top N events by score, get the surrounding 5-second window, concatenate.

---

## Technical Architecture

### Frontend stack

- **React Router v7 (Remix)** — file-based routing, nested layouts, loaders/actions, streaming SSR. Keeps rendering close to data. Simpler deploy story than Next.js (no Vercel lock-in, just a Node or edge runtime).
- **Canvas** (for 2D map — HTML5 Canvas via `konva.js` or plain Canvas API)
- **Framer Motion** (UI transitions, bubbles, etc.)
- **Tailwind CSS** (styling)
- **WebSocket** (live event stream from engine) — `ws` on server, native `WebSocket` in browser
- **Zustand** (state mgmt for client-side map + event buffer)

Why React Router v7 over Next.js:
- Loader/action model maps cleanly to our CRUD (list chronicles, fork, intervene)
- Streaming + nested routing for dashboard tabs (map / gazette / whisper / reel) without full navigation
- Vite-based dev server — fast HMR
- Not locked to one deployment target (Vercel, Cloudflare, self-hosted, all fine)

Why not WebGL: simpler. Pixel art works beautifully on 2D canvas with image scaling disabled.

### Live data flow

```
Engine (Node.js)
  │
  ├─► WebSocket broadcast on every event
  │
  ▼
Browser (Next.js client)
  │
  ├─► Zustand store updated
  │
  ▼
React renders:
  - Map canvas re-draws on state change
  - Speech bubbles animate in
  - Timeline adds new event tick
  - Inspector updates if relevant character changed
```

Events are diffs, not full state. Canvas knows how to apply a diff efficiently (move character, spawn bubble, etc.).

### Sprite assets

Ship with a curated default set:
- 16 character sprite templates (each with mood variants)
- 8 location biome backgrounds
- 32 resource icons
- UI chrome (buttons, borders, etc.)

Store as PNG spritesheets, load via Canvas `drawImage`.

**Extensibility:** advanced users can upload custom sprite packs. World config references sprite pack ID.

### Gazette styling

CSS templates that mimic specific publication types. We ship ~10 themes:
- `newspaper-classic` (1920s broadsheet)
- `newspaper-modern` (USA Today)
- `blog-tech` (Medium-ish)
- `parchment-medieval` (scroll & quill)
- `terminal-scifi` (green phosphor)
- `magazine-fashion`
- `tabloid-gossip`
- `zine-punk`
- `corporate-memo`
- `diary-handwritten`

World auto-selects based on atmosphere. User can override.

### Theme compiler

When compiling a world from natural language, the LLM classifier also picks:
- Map biome (beach, forest, city, starship, office, ...)
- Gazette theme
- Music mood for highlight reel
- Color palette base (warm, cool, neutral, vibrant, muted)

All overridable in `world.config_json`.

---

## The Dashboard Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Chronicle — chr_7f3p2q — Desert Island                  ⚙  │
├─────────┬───────────────────────────────────────────────────┤
│         │                                                    │
│ SIDEBAR │              LIVE MAP                              │
│ ─────── │       (or Gazette / Whisper when tabbed)           │
│ [Map]   │                                                    │
│ [Gazet] │         (main visual)                              │
│ [Whisp] │                                                    │
│ [Reel]  │                                                    │
│         │                                                    │
│ ─────── │                                                    │
│ AGENTS  │                                                    │
│ • Marc  │                                                    │
│ • Elena │                                                    │
│ • Chen  │                                                    │
│ • Raj   │                                                    │
│ ...     │                                                    │
│         │                                                    │
├─────────┴───────────────────────────────────────────────────┤
│ TIMELINE + EVENT LOG (scrubbable)                            │
│ ━━━●━━━●━━━●━━━●━━━●━━━◆━━━━━                              │
├──────────────────────────────────────────────────────────────┤
│ GOD INPUT                                                    │
│ [Inject an event: ___________________________] [Send]       │
└──────────────────────────────────────────────────────────────┘
```

Tabs at left switch the main panel between 4 surfaces. Bottom bar is always-on for god intervention. Right side panel (collapsible) shows agent detail when clicked.

---

## Polish Details That Matter

### Subtle things that make it feel alive

- **Idle animations**: characters breathe, sway slightly even when not acting
- **Look-at**: when two characters are interacting, their sprites turn to face each other
- **Grouping**: when >3 characters are close, they clump naturally (no overlap)
- **Time of day tint**: 10% saturation shift every 6 world-hours
- **Ambient audio**: wind on beach, crackle in forest (off by default, toggleable)
- **Weather particles**: rain drops, snow flakes, dust — all from world events

### Accessibility

- Full keyboard nav
- Screen reader support (each character has an ARIA label; events announced)
- High contrast mode (disables color-based info like relationship lines, uses patterns)
- Subtitle mode for all speech (text log alongside map)
- Colorblind-safe palettes available

### Loading states

- Pre-render first 10 ticks in background so map starts with motion
- Skeleton placeholders for late-loading sprite packs
- Smooth fade-in for new speech bubbles (no jank)

### Error states

- Engine disconnection: show ghostly "Connection lost, reconnecting..." overlay with retry
- API outage: characters freeze with "..." above their heads
- Budget exceeded: world dims, modal appears "You've hit the budget. Refill or pause?"

---

## The Screenshot Test

Every design decision passes through this filter: **"Would someone screenshot this?"**

Examples of decisions that passed:
- ✅ Gazette layout — looks like a real paper, naturally shareable
- ✅ Whisper stream — looks like DMs, Twitter format
- ✅ Speech bubbles with tone-based outlines — recognizable in a screenshot
- ✅ Relationship lines — explains drama in one image

Examples that failed:
- ❌ Log-style event stream (looks like a terminal, not a story)
- ❌ Node-graph of relationships (cool but not visual)
- ❌ Pie charts of resources (no drama)

When in doubt, we choose the visually-narrative option over the analytically-clean one.

---

## Why This is The Moat

Anyone can build a multi-agent simulation. Few build one with four parallel rendering surfaces each optimized for a different share format.

Every run becomes natural content for someone's feed. Users don't have to think about how to share — the product generates share-ready artifacts automatically.

**The dashboard is a content studio, not a visualization.**

---

## Open Questions (for next iteration)

1. **Is the highlight reel achievable in v0.1?** Video generation has friction. Maybe v0.2.
2. **How do we handle worlds with no physical space (pure chat)?** Map view gracefully degrades to "chat room" view with avatars in a circle.
3. **Do sprites get AI-generated per character?** Expensive but magical. Maybe as "premium" feature — default is curated set.
4. **Should god interventions be visible on the map?** Brief visual effect ("a hand from the clouds") — yes, for drama + clarity.
5. **Multi-world cross-fade view?** If a user has 5 running, can they watch them all in a tiled view? Cool but scope creep.
