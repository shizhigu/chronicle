# Export & Share — The Viral Layer

## The Problem with Most AI Demos

A user sees something cool, wants to show their friend. They:
1. Take a screenshot → loses the dynamic feel
2. Record their screen → quality varies, friend has to watch 5 minutes
3. Copy-paste text → feels dead, no visuals
4. Link to the tool → friend has to install and replicate (won't)

**99% of potential shares die at this friction.**

Chronicle fixes this by generating share-ready artifacts automatically.

---

## The Five Share Formats

Every Chronicle run produces (or can produce on demand) five export formats. Each optimized for a specific destination.

### 1. Replay Link — for Discord / DMs
A URL that plays back the entire Chronicle for whoever clicks it.

```
chronicle.sh/r/abc123
```

- One-tap share
- Receiver sees full run as it happened
- Can scrub timeline, inspect characters, optionally fork
- No login required to watch
- Lives forever (or until creator deletes)

### 2. Gazette PDF — for Reddit / blogs
The auto-generated newspaper, exported as PDF or long-form image.

- Looks like a real newspaper
- Gets top-of-feed on Reddit
- Individual articles can be pulled as standalone PNG tiles

### 3. Highlight Reel Video — for TikTok / Reels / Twitter
30-60 second video, 1080p (or 1080×1920 vertical for TikTok).

- Auto-cut from drama highlights
- Music bed (royalty-free, ship with a few options)
- Watermarked "chronicle.sh" in corner
- Downloadable mp4

### 4. Whisper Stream Screenshots — for Twitter / Instagram
Character POV message feed, styled as screenshots.

- Looks like leaked iMessage or Discord DMs
- Perfect for the "what your AI characters are saying behind your back" format
- User can pick a range to export (e.g. "Day 1 only")

### 5. Chronicle File (.chronicle) — for fellow creators
Portable config + event log + state snapshots.

- Anyone with Chronicle installed can import + replay + fork
- Perfect for forums / Discord shares
- Compressed: typical file ~1-5 MB
- Includes seed → reproducible replay

---

## The Share Flow

After any run completes, the dashboard shows:

```
┌──────────────────────────────────────────────────┐
│  🎬 Your Chronicle is complete                    │
│                                                   │
│  50 ticks · 8 characters · 127 events            │
│                                                   │
│  What would you like to do?                      │
│                                                   │
│  [ ▶ Replay ]   [ 🔀 Fork and run again ]        │
│                                                   │
│  Share:                                           │
│  [ 🔗 Copy link ]  [ 📰 Download Gazette ]       │
│  [ 🎥 Highlight reel ]  [ 💬 Whisper stream ]    │
│  [ 📁 Export .chronicle ]                         │
│                                                   │
│  Or auto-share to:                               │
│  [ 🐦 Twitter ]  [ 📱 TikTok ]  [ 💬 Discord ]   │
│                                                   │
└──────────────────────────────────────────────────┘
```

One-click anywhere. No forms.

---

## Technical Implementation

### Replay Link

```
chronicle.sh/r/<short_id>

  ├── loads /api/chronicles/<id>
  ├── streams the event log
  ├── renders in the same dashboard (read-only mode)
  └── anonymous view OK (no account needed)
```

**Storage**: public chronicles stored in our cloud (S3 + DB). Private chronicles need auth.

**Scaling**: events are ~200KB compressed per 100 ticks. Cheap to serve.

### Gazette PDF

Generated on-demand:
1. Collect all events in the run
2. Group by "day" (24 ticks or as configured)
3. For each day, call LLM to generate newspaper articles (using our templates)
4. Render as HTML → pass through Puppeteer → PDF
5. Cache, return URL

Cost per gazette: ~$0.10 in LLM calls.

### Highlight Reel Video

The hardest artifact. Process:

1. **Score every event** by drama value
   - Rule violations: +50
   - Relationship flip: +40
   - Death/birth: +100
   - Novel vocabulary: +10
   - User interventions: +30
   - (Custom scoring model fine-tuned on user-marked "interesting" moments)

2. **Pick top 10-15 moments**, each ~3-5 seconds wide

3. **For each moment**:
   - Use our 2D map renderer offline (headless Canvas via `canvas` + `node-canvas`)
   - Record 60fps frames showing the moment
   - Overlay subtitle of key speech

4. **Stitch with ffmpeg**:
   - Crossfade between clips (300ms)
   - Background music track (royalty-free)
   - Opening title: "Chronicle: [World Name]"
   - Ending card: "Made with chronicle.sh"

5. **Output**: mp4 (H.264) 1080p or 1080×1920 for vertical

Generation time: ~30 seconds. Done on-server when user requests.

### Whisper Stream Screenshots

HTML template styled like iMessage / Discord:
- User picks character + time range
- Server renders HTML → Puppeteer → PNG
- Long scrolling screenshots for Twitter's image format

Free, instant.

### .chronicle File

Export format (zip):

```
my-world.chronicle/
├── manifest.json       (world ID, creator, version, rating, seed)
├── config.json         (world config: agents, rules, actions, locations)
├── events.ndjson       (event log, one per line)
├── snapshots/          (tick snapshots for fast seek)
│   ├── tick-0.json
│   ├── tick-50.json
│   └── tick-100.json
└── assets/             (any custom sprites or gazette templates used)
    └── ...
```

Import: `chronicle import file.chronicle` reconstructs world.

---

## The Auto-Tweet Integration

Most powerful feature for viral growth.

After a run, user clicks [🐦 Twitter]:
- Chronicle generates a 4-tweet thread:
  - Tweet 1: Title card + 1-sentence summary (+ highlight video attached)
  - Tweet 2: Screenshot of the gazette's top headline
  - Tweet 3: Screenshot of a juicy whisper stream
  - Tweet 4: "Made with chronicle.sh · [replay link]"

User can preview + edit before posting. One-click OAuth to Twitter.

Why this works:
- Lowers friction from "I should share this" to "posted"
- Generates high-quality share media automatically
- Every post has a replay link → converts watchers to creators

### Same for TikTok

- Auto-export vertical video
- Pre-filled caption: "Describe a world, watch it unfold. Made with @chronicle"
- Hashtags: #AI #AgentSimulation #Chronicle
- User reviews, posts.

---

## The Public Gallery

The biggest share surface. chronicle.sh/gallery.

### Feed UX

TikTok-style vertical scroll. Each Chronicle preview is:
- Highlight reel autoplays muted on scroll-in
- Tap to unmute
- Title + creator name
- 🔀 Fork button (big, obvious)
- ▶ Open replay
- ❤ Like, 💬 Comment, 🔔 Follow creator

Infinite scroll. Personalized ranking (after we have data).

### Discovery
- **For You**: algorithmic (based on watched, liked, forked)
- **Trending**: last 24h high-engagement
- **Fresh**: newest first
- **Genre filters**: Drama, Mystery, Comedy, Historical, Sci-Fi, Educational
- **Rating filter**: E / T / M / AO

### Social layer (later)
- Follow creators
- Notification when followed creator publishes
- DM-style share a chronicle to a friend
- Comments on Chronicles
- Chronicle "collections" (like Spotify playlists)

### Featured
Staff-curated front page. We feature 10 Chronicles weekly. Appearing in Featured = major traffic boost. Creators optimize for it.

---

## Cross-Chronicle Forking

The genius move: every public Chronicle is a remix-able primitive.

**Example**:
1. Alice makes "Dinner Party of Secrets"
2. Bob forks with the change: "Add a character: a detective arrives uninvited"
3. Carol forks Bob's with: "What if it's Y2K?"
4. David forks Carol's with: "Everyone is a musical theater character"

Each fork is a separate Chronicle. All linked in a family tree. Fork trees become community artifacts.

**UX**:
- Every public Chronicle has a [🔀 Fork] button
- Click → opens fork dialog with text box: "What's one thing you want to change?"
- Submitted as a "delta" over the parent config
- Runs immediately, tracked in lineage

Chronicle page shows:
- Parent (if this is a fork)
- Children (other forks of this one)
- "Fork tree" visualization for branching history

This is the engagement engine.

---

## Attribution and Credit

Forking preserves attribution:

```
"Dinner Party of Secrets" by @alice
└── forked by @bob as "Dinner Party with Detective"
    └── forked by @carol as "Y2K Dinner Party"
        └── forked by @david as "Musical Dinner Party"
```

Every fork surfaces the full chain. Original creator always credited.

**Fork royalties?**
Interesting idea. If original creators could earn % of revenue when forks of their work are paid (e.g. in Chronicle Cloud), that's a creator economy.

Not v1, but something to keep in mind. It would make Chronicle the first "open source fiction" platform.

---

## Embeds

External sites can embed a Chronicle:

```html
<iframe src="https://chronicle.sh/embed/abc123"
        width="600" height="400"></iframe>
```

Supports:
- Replay mode (plays from start to end, autoplay optional)
- Live mode (if Chronicle is still running)
- Snippet mode (start at specific tick)

Use cases:
- Blog post showing an interesting Chronicle
- Research paper with a live demo
- Substack article
- Custom dashboards

Each embed includes "Open in Chronicle.sh" button → driver of new traffic.

---

## The Data We Show

When someone lands on a shared Chronicle:

```
┌───────────────────────────────────────────────────────┐
│ Dinner Party of Secrets                         ⭐ 2.4K│
│ by @alice · 3 days ago                                │
├───────────────────────────────────────────────────────┤
│                                                        │
│          [highlight reel playing]                      │
│                                                        │
├───────────────────────────────────────────────────────┤
│ 8 characters · 50 ticks · 127 events · Rating: T     │
│ Forks: 47 · Views: 12,483                             │
├───────────────────────────────────────────────────────┤
│ [▶ Watch Replay]  [🔀 Fork]  [❤ 2.4K]  [💬 83]      │
├───────────────────────────────────────────────────────┤
│ Description:                                           │
│ "8 people at a dinner party, each has a secret..."    │
│                                                        │
│ Compiled characters:                                   │
│  • Henri, 52, the host                                │
│  • Margaret, 48, his wife                             │
│  • Thomas, 45, business partner                       │
│  • ... (see all)                                      │
│                                                        │
│ Rules: 6  •  Locations: 4                             │
├───────────────────────────────────────────────────────┤
│ Forks of this Chronicle:                              │
│  • "Detective Dinner" by @bob (2.1K ⭐)                │
│  • "Y2K Dinner" by @carol (1.3K ⭐)                   │
│  • "Musical Dinner" by @david (800 ⭐)                │
│  ... and 44 more                                      │
└───────────────────────────────────────────────────────┘
```

All key data visible. Makes it browsable. Makes forks obvious.

---

## Privacy Controls

Not everyone wants to share. Defaults and options:

### Default: Private (for paid users)
- New Chronicles are private
- Only the creator can view
- Sharing requires explicit action

### Public with link
- Accessible to anyone with the URL
- Not in gallery
- Fork-able if creator allows

### Public in gallery
- Full discoverability
- Appears in feeds
- Fork-able (forcibly — part of the deal)

### Public but anonymous
- No creator name shown
- Can't fork
- "Ghost" Chronicle for when creator doesn't want attribution

Settings accessible per-Chronicle and as user default.

---

## Data Export for Research

Chronicle Lab users get:
- Full event log (CSV, JSON, Parquet)
- Agent decision traces (what each agent "saw" and "chose")
- Token usage breakdown
- Reproducibility seed
- Model version fingerprints

Papers can cite a specific Chronicle by DOI:
- We partner with DataCite for academic DOIs
- Citation: "Smith, J. (2026). *The Origins of Gossip in Small Groups* [Chronicle]. chronicle.sh/r/abc123. DOI:10.xxxx/xxx"

Makes Chronicle reproducibly cite-able. Serious academic credibility.

---

## Key Design Decisions

### Why auto-generate vs manual?
Manual sharing (screenshot, edit, post) has 95% drop-off. Automation is non-negotiable.

### Why four+ formats?
Different platforms favor different content. TikTok wants vertical video. Reddit wants image-heavy long-form. Twitter wants threads. Discord wants links. We cover them all.

### Why include .chronicle files?
Viral growth within a user community. Discord servers about creative coding/AI will pass .chronicle files around like memes. It's a native format for discussion.

### Why public by default for free users?
The free tier pays by becoming distribution. Private worlds are a Pro feature.

### Why no account required to watch?
Watching is our acquisition funnel. Gate it → lose half the growth. Watch first, sign up maybe never.

---

## Success Metrics

- **Shares per run**: target >40%
- **Gallery click-through**: target >15% of gallery visitors fork something
- **Inbound from shares**: 50%+ of new users come from a replay link or social post
- **Highlight video view-through**: >60% of opens reach end of video
- **Fork depth**: avg 3+ forks per popular Chronicle

If we hit these, Chronicle grows without paid marketing.

---

## The Viral Test

Every design choice gets this test: **"Would someone actually share this?"**

Not "would they find it interesting." Not "would they screenshot it for themselves."

**Would they put this in front of their friends, knowing their friends will judge them by it?**

That's the bar. Gazettes pass. Highlight reels pass. Whisper screenshots pass. Walls of log text? Fail.

We cut anything that doesn't pass.
