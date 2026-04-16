# User Journey — The First 60 Seconds

## The Thesis

If a user doesn't see something amazing within 60 seconds, we've lost them. Period.

Every friction point — install step, config question, permission prompt — is a chance to lose them. We obsess over removing them.

---

## The User Archetypes We Design For

We have **four primary archetypes**. The experience must work for all, but we optimize for #1.

### #1 — "The Curious Explorer" (our bullseye)
- Saw Chronicle on Twitter/HN/Reddit
- Has Claude Code installed (or is willing to)
- Wants to see if it lives up to the tweet
- Not a researcher, not a hardcore gamer, just intrigued
- Will give us 5 minutes before bouncing
- If they love it, they post about it (our growth engine)

### #2 — "The Content Creator"
- Makes YouTube videos / TikToks about AI
- Wants dramatic material
- Cares about export quality
- Will use us weekly if we work

### #3 — "The Academic"
- Social scientist, economist, anthropologist
- Wants reproducible experiments
- Cares about data export + rules fidelity
- Moves slow but big contract value

### #4 — "The Writer"
- Novelist / screenwriter exploring character dynamics
- Uses us as a brainstorming tool
- Cares about character depth, not emergence statistics

---

## The First 60 Seconds — Explorer's Journey

### 0:00 — They land on chronicle.sh

Above the fold:
- Hero text: **"Describe any world. Watch AI play it out."**
- Sub: "A configurable social simulation substrate. Runs from your terminal."
- Background: a silent auto-playing loop of an actual Chronicle — desert island, characters walking, a speech bubble forming. 15 seconds on loop. No music by default.
- CTA (prominent): **"Install and run in 30 seconds"** button
- Below: "or browse what others have made →" link to public gallery

**What we DON'T have:** a signup form. Not gated. Install first, sign up maybe never.

### 0:05 — They click Install

The install page is a single block of copy-pasteable command:

```bash
curl -sSL https://chronicle.sh/install | bash
```

That's it. One command.

The installer:
1. Checks for Node 20+ (installs via `fnm` if missing, offers)
2. Installs the `chronicle` npm package globally
3. Writes a one-line hint to `~/.claude/CLAUDE.md` explaining how to use it (if Claude Code is installed; optional)
4. Prints:

```
✓ Chronicle installed (v0.1.0)

Run this to start:
    chronicle

Or, if you use Claude Code, just ask:
    "Try chronicle"
```

**Total time from landing page → install complete: ~20 seconds.**

### 0:25 — They type `chronicle`

```
$ chronicle

Welcome to Chronicle. I run AI social simulations.

I need two things from you:

  1. A scenario to simulate (one sentence is plenty)
  2. An API key (Claude/OpenAI/or local Ollama — pick one)

Let's start with the scenario. What would you like to see?

(Examples you could try:
  - "8 survivors on a desert island, one's a murderer"
  - "A group of founders trying to ship a product"
  - "Make me something weird"
  
Or press Enter to see a gallery of pre-made worlds.)

>
```

They type something — or press Enter for gallery.

### 0:35 — (If they typed a scenario)

```
> "8 people at a dinner party, secrets start coming out"

Got it. Creating the world...

  ⚙ Generating 8 characters with distinct personas...
  ⚙ Designing the dining room and surrounding rooms...
  ⚙ Identifying rules: "secrets should spread socially"...
  ⚙ Setting initial scene at the soup course...

✓ World ready: "Dinner Party of Secrets" (chr_x2p9k)
  8 characters, 4 locations, 6 rules compiled
  Estimated cost for 50 ticks: $0.30

Next: I need your API key. Paste from Anthropic (claude) or OpenAI.
(Or type 'ollama' to use local models for free.)

API key:
```

### 0:45 — They paste an API key

```
✓ Key saved (to ~/.chronicle/config — never sent anywhere else)

Starting simulation. Opening dashboard at http://localhost:7070

[dashboard opens in browser]
```

### 0:50 — The dashboard loads

They see:
- A dinner party map: 8 sprites around a long table
- Their names floating above
- The first speech bubble already appearing: *"This wine is remarkable, Henri. Where on earth did you find it?"*
- Live activity indicators: a few faces looking at each other

### 0:55 — They watch

- Another speech bubble: *"I believe Margaret brought it. Didn't you, dear?"*
- Margaret's face expression shifts to `embarrassed`
- Her whisper bubble (dashed): *"[whispers to Thomas] Don't."*

**They lean in. They are hooked.**

---

## What Made the 60 Seconds Work

### Zero friction ideology

- No account to sign up
- No config file to write
- No YAML to learn
- No Python setup
- No "which model should I use?" paralysis (we default to Haiku)
- No rules to read

### Progressive disclosure

- First experience: just describe a thing, watch it happen
- Intermediate: customize characters, add rules
- Advanced: write custom tools, rule types, sprite packs

Users never see advanced things unless they go looking.

### The default scenario is CAREFULLY curated

If user presses Enter without typing, we show a gallery of 6 pre-made scenarios. **Every one is hand-tuned to produce drama in the first 20 ticks.** We've pre-tested that each scenario produces visible conflict quickly.

Pre-made scenarios (the launch gallery):

1. **Dinner Party of Secrets** — 8 people, all have secrets, 4 rooms
2. **Island Reckoning** — 6 survivors, murderer among them
3. **The Startup** — 5 founders, 90 days of runway, shared codebase
4. **High School Day** — 20 students, first day back from summer
5. **The Kingdom Succession** — the king is dying, 3 heirs
6. **Spaceship Crew** — 5 astronauts, 6 months from home, one is sick

Each one tuned to deliver a visible dramatic moment in <30 ticks.

### Cost transparency upfront

We show the estimated cost BEFORE they commit. No surprise bills. $0.30 for 50 ticks is a coffee-price experiment, easy yes.

### Local option always visible

"Or type 'ollama' to use local models for free." — this line exists specifically to reassure the cost-anxious user. Most won't use Ollama, but they feel better knowing it's there.

---

## Past the First 60 Seconds

### 1:00–5:00 — Watching their first run

- Events unfold. Speech bubbles pop. Timeline fills with ticks.
- We auto-pause at tick 20 with a subtle prompt: **"Something interesting is happening. Want to intervene, or keep watching?"**
  - Interesting = detected drama spike
  - This is a great "teachable moment" for god intervention

- If they do nothing, it keeps running
- If they click intervention, a text box appears: "Type any event that happens"
- They try something, see it affect the world
- They feel like a god for the first time
- **This is the conversion moment.** Not the first view — the moment they realize they can CHANGE the story.

### 5:00–10:00 — They want to share

Run ends (50 ticks default). A modal appears:

```
Chronicle complete.

Would you like:
  ▸ See the Gazette (auto-generated newspaper)
  ▸ See the highlight reel (30-second video)
  ▸ Share as a link (someone else can watch the replay)
  ▸ Fork (change one thing, run again)
  ▸ Export data (JSON for research)
```

Most users click Gazette or Highlight Reel. These are the viral artifacts.

Share link (if they click):
- `chronicle.sh/r/abc123` (if they're logged in; login optional)
- Or: `chronicle.sh/import/<base64-blob>` (no login needed, data in URL, 500KB limit)

Now their friend can click the link and see the same Chronicle replayed.

### 10:00+ — The fork loop

"Fork" is the killer feature. They loved the dinner party, want to see what happens if they change one thing:

```
Fork of "Dinner Party of Secrets"

One-line change:
> "What if Margaret is not ashamed — she's actually proud of the affair?"

Forking... Done. Running 'Dinner Party of Secrets (Fork 1)' now.
```

The world re-runs with the tweak. Different story emerges.

**Fork culture is virally strong.** "Look at MY version" is a powerful share.

---

## The Second Session (Day 2+)

If we've gotten them to come back:

```
$ chronicle

Welcome back. Your worlds:

  chr_x2p9k  Dinner Party of Secrets         (complete, 50 ticks)
  chr_x2p9k_fork1  Fork 1: Proud Margaret    (complete)
  chr_9x2mn  High School Day                  (created, not run)

What now?
  ▸ resume  (pick up where you left off)
  ▸ new     (create a new world)
  ▸ gallery (see what others shared)

>
```

- **Resume**: they can pick up any world and run more ticks. It persists exactly.
- **Gallery**: seeded with staff-curated chronicles + top-voted community ones.

The gallery is the #2 viral surface (after share links). It's a TikTok-style vertical feed of highlight reels. Infinite scroll. If a Chronicle catches their eye, one click to fork it and make their own.

---

## Metrics We Obsess Over

| Metric | Target | Why |
|---|---|---|
| Time from `curl install` to first tick rendered | <45 seconds | First impression |
| % of installs that reach tick 10 | >80% | "Did they watch any of it?" |
| % of runs that trigger a fork | >25% | Engagement depth |
| % of runs that produce a share | >40% | Viral loop |
| % who return on day 2 | >30% | Retention |
| Avg chronicles per active user/week | 3+ | Usage depth |

If we nail these, it grows organically. If we don't, we need to find why and fix.

---

## The Onboarding for Each Archetype

### #1 Curious Explorer — default path (above)

### #2 Content Creator
After first run, they see:
```
Pro tip: Add --record to any run to save a 1080p video.
Add --format=tiktok for vertical.

chronicle run chr_x2p9k --record --format=tiktok
```

### #3 Academic
In settings, enable "Research mode":
```
✓ Research mode on
  - All events exported as JSON
  - Reproducibility seed locked
  - Statistical summaries available
  - Rule compilation transparency mode on
```

### #4 Writer
Templates gallery has a "Story Seed" category:
- "Rival Lovers" — two characters with a forbidden attraction
- "The Confession" — one character knows something explosive
- "Eight Strangers" — classic ensemble
- "The Reunion" — 20 years later, old tensions surface

Writers treat these as Chekhov's gun setups.

---

## The Fail Modes to Prevent

### Fail mode 1: "What am I looking at?"

User runs it, sees abstract stuff happening, confused. Fix: **every run has a welcome card** overlaid at start:

```
"Dinner Party of Secrets"
8 guests. 4 rooms. 50 ticks to watch them unravel.

Click any character to inspect them.
Click the bubble at bottom-right to intervene.

[Got it] [Never show again]
```

### Fail mode 2: "This is boring"

Watched 30 ticks, nothing dramatic. Fix:
- Engine detects low-drama stretches, tells us
- Auto-inject a "catalyst event" if drama score < threshold for 10 ticks
- Catalyst examples: "a bird flies in the window", "thunder rumbles outside", "one character receives a letter"
- User didn't do this — but it feels natural

### Fail mode 3: "It cost me too much"

$10 later they feel ripped off. Fix:
- Default budget ceiling: $1 per world unless they raise it
- Pause at 80% of budget with clear dialog
- Cost counter always visible in top-right

### Fail mode 4: "It crashed"

Engine hits an error mid-run. Fix:
- Every tick is an autosave point
- Crashes show a "Resume from tick 47?" prompt, never lose progress
- Errors include a one-click "Report with log" button

### Fail mode 5: "The AI said weird stuff"

Character outputs problematic content. Fix:
- `beforeToolCall` hook includes content moderation check
- Content flagged → shown redacted + offer to retry or skip
- All production prompts include safety instructions + negative examples

---

## The Invisible Guide

Throughout, there's an invisible "AI co-host" narrating next steps. This is their Claude Code (or any AI assistant) reading our `NEXT_STEPS` output and naturally suggesting what to try.

User never thinks about it. But every moment they're unsure, their AI assistant is proactively suggesting: "Try adding a twist?" "Want to see a different character's view?" "Here's what forking does."

The user has a personal product tour. Every time. Without us scripting it.

---

## The "North Star" User Sentence

After their first run, we want them to say:

> **"Holy shit, I just made something I've never seen before."**

Not "neat tech demo". Not "interesting research tool".

*They made a story. That's what we sell.*
