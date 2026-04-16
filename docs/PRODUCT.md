# Product Strategy

## The Thesis

**A new medium is being born.** Humans have always created stories: telling them, writing them, filming them. But directing stories and watching them play out autonomously has been impossible. With LLMs as agents + a configurable substrate, it's suddenly possible.

Chronicle is the consumer product for this new medium. Like how YouTube was for video, Twitter was for real-time text, TikTok was for vertical short-form — Chronicle is for *directed social simulations*.

That's the bet. Everything else follows from it.

---

## What Chronicle Sells

Not software. Not compute. Not "AI agents."

**We sell the ability to direct stories that nobody has seen before.**

Every run is unique. Every run is shareable. Every run could be the one that goes viral. That's the core emotional promise.

---

## ICPs (Who Actually Pays and Why)

### Tier 1 — Content Creators & Casual Creatives ($)

The biggest volume. YouTube/TikTok creators, Twitter threadposters, indie game devs, hobbyist writers.

- **Willingness to pay**: $10-30/month for unlimited runs
- **Value prop**: "My content engine. Infinite story material."
- **Churn risk**: Medium. If they don't find repeatable drama formats, they bounce.

### Tier 2 — Writers & Story Developers ($$)

Novelists, screenwriters, TTRPG game masters, worldbuilders.

- **Willingness to pay**: $30-100/month for private worlds, character depth, export
- **Value prop**: "Test-drive my characters before I commit a chapter."
- **Churn risk**: Low. This is a deep creative tool.

### Tier 3 — Researchers & Educators ($$$)

Social scientists, economists, governance researchers, sociology educators.

- **Willingness to pay**: $500-5000/year for research mode, reproducibility, data export, API access
- **Value prop**: "I can run 1000 variations of this experiment cheaper than a lab study."
- **Churn risk**: Low once adopted. Grant cycles matter.

### Tier 4 — Game Studios / Interactive Fiction (☆)

Not immediately, but eventually.

- **Willingness to pay**: per-seat or per-game licensing
- **Value prop**: "Use Chronicle to generate NPC behavior for our game."
- **Strategy**: B2B partnerships after we have platform credibility.

---

## Monetization Ladder

### Free tier

- BYO API key (we don't pay for your inference)
- Unlimited local runs
- Public worlds only (anything you make is fork-able by others)
- Max 50 ticks per run
- Max 10 characters
- Gallery: browse + fork others' work
- Default sprite set + 3 gazette themes

**The free tier must be genuinely usable.** It's our distribution engine.

### Chronicle Plus — $12/month (for Creators)

- Private worlds (optional; public stays fork-able)
- Unlimited ticks
- 50 characters per world
- Full sprite set (16 templates × mood variants)
- All gazette themes (10+)
- Highlight reel export (1080p video)
- Priority support
- Early access to new features

### Chronicle Pro — $29/month (for Writers / Power Users)

Everything in Plus, plus:
- Custom sprite upload
- Custom gazette templates
- Multi-world dashboards (watch 5+ at once)
- Advanced rule tools (multi-step propositions, emergent norm detection)
- Detailed analytics per Chronicle (drama arcs, character development curves)

### Chronicle Cloud — Usage-based (for those who don't want to manage API keys)

- $0.05/credit
- Cloud-hosted inference (we proxy; you don't bring your own key)
- Same tier access based on plan

**Pricing psychology**:
- $12/mo is Netflix/Spotify range — habitual
- $29/mo is Adobe range — professional tool positioning
- The free tier is ALWAYS usable. No dark patterns.

### Chronicle Lab — $500/year (Academic)

For researchers. Includes:
- Unlimited runs
- All data export formats (JSON, CSV, arrow)
- Reproducibility guarantee (pinned model versions available 2 years back)
- Private team workspace (5 seats included; $100/seat after)
- Direct API access
- Priority feature requests for research needs
- Citation kit (paper-ready exports, doi-linkable runs)

Distributed through university purchase cards + grants. Sold at academic conferences (ASA, AEA, CSCW).

### Chronicle Enterprise — Starting at $30K/year

For game studios, training companies, consulting firms.

- Self-hosted option
- Custom rule compilers / domain-specific packs
- Dedicated support / SLAs
- Non-standard integrations

Sales-led, not self-serve.

---

## Distribution Strategy (The First 90 Days After Launch)

### Phase 1: The Launch (Week 1)

**Hacker News post** (Tuesday morning, PT):
- Title: "Chronicle: Describe a world, watch AI agents play it out (demo)"
- Show HN format
- Attach a link to chronicle.sh + a 60-second demo video
- Be responsive in comments for 24 hours

**Twitter thread by founder**:
- 10-tweet thread walking through one Chronicle run
- Show the drama arc visually (screenshots, short videos)
- CTA at end: chronicle.sh
- Tag relevant people (Andrej Karpathy, Swyx, Simon Willison, etc.)

**Product Hunt launch** (same week):
- All gallery examples pre-populated and tested
- Offer free Chronicle Plus for PH upvoters (30 days)

### Phase 2: Content Flywheel (Weeks 2-6)

**Seed 100 high-quality chronicles in the gallery.** These are our content moat. We curate them to be genuinely dramatic.

**Partner with 10 mid-size AI YouTubers.** Give them early access + credits. Their reaction videos = our growth.

**TikTok account**: @chronicle.sh posts highlight reels daily from interesting runs.

**Reddit**: soft-seed in r/artificial, r/LocalLLaMA, r/ChatGPT. Don't spam. Answer questions, link contextually.

### Phase 3: Community (Weeks 6-12)

**Discord launch.** Channels for:
- #share-your-chronicles
- #help
- #scenario-ideas
- #research (academic users)
- #dev-chat (plugin / extension devs)

**Weekly Chronicle of the Week.** Staff picks, featured on homepage + social.

**Hosted prompt drops.** Weekly theme: "This week's prompt: Monday morning at a new job." Community submits, we feature top 3.

### Phase 4: Platform (Months 4+)

**Chronicle Exchange.** Users can publish sprite packs, rule packs, scenario templates. Free or paid. We take 20% of paid.

**Chronicle for Education.** Curriculum kits for high school sociology, college economics, grad-level political science.

**Chronicle API.** Embed Chronicle simulations in third-party sites. Weirdos on the internet find wild use cases. We monetize via compute.

---

## The Moat

After 12 months, competitors will show up. Why do users stay with us?

### 1. Content gravity

The public gallery has tens of thousands of curated Chronicles. No competitor can replicate that fast. Users come to browse; stay to create.

### 2. Brand + trust

"Chronicle" = AI social simulation. Like how "Roblox" = user-generated 3D experiences. Hard to dislodge once established.

### 3. Quality of default experience

Our rule compiler, our sprite set, our gazette templates, our scenario presets — all refined by iterating on millions of real user runs. A clone has to restart this.

### 4. Platform lock-in (creators)

Users build up portfolios of Chronicles. Sprites they uploaded. Templates they crafted. All lives at chronicle.sh. Switching cost real.

### 5. Research credibility

Peer-reviewed papers citing Chronicle. Once established, academia is sticky.

### 6. Integrations (eventually)

Discord bot. Twitch extension. Twitter bot. Obsidian plugin. Every integration raises switching cost.

---

## The Risks (Ordered by Severity)

### Risk 1: LLM cost inflation or rate limit tightening

If model prices 10x or rate limits tighten, cost model breaks.

**Mitigation**: Multi-provider from day 1 (pi-ai). Local models (Ollama) always available. Cache aggressively. Work with providers directly at scale.

### Risk 2: Anthropic/OpenAI ships a competing product

"ChatGPT Societies" or "Claude Simulator" launches. We get crushed.

**Mitigation**:
- Be faster. Ship before they notice.
- Be better at the weird edges they won't bother with (rule compilation, custom scenarios, research tooling).
- Be the place creators go, not the place AI companies host their own demos.
- Build network effects (gallery) they can't easily replicate.

### Risk 3: Emergence is unimpressive

Users try Chronicle, find the AI behavior boring / predictable / samey. Bounce.

**Mitigation**:
- Invest heavily in scenario design. First 6 presets MUST produce drama.
- Drama detection + catalyst injection (see USER_JOURNEY.md).
- Run quality benchmarks weekly. Track "drama score" over time.
- Character persona templates that promote conflict (contradictions, secrets, desires).

### Risk 4: Legal / safety issues

User creates a "simulate Donald Trump and Joe Biden fighting" Chronicle. Or "simulate a real mass shooter." Defamation, safety concerns, press disaster.

**Mitigation**: see GOVERNANCE.md.

### Risk 5: The users don't come

We ship, it's quiet. Chicken-and-egg gallery problem.

**Mitigation**:
- Seed 100 great Chronicles before launch. Gallery looks alive from day 1.
- Partner outreach pre-launch.
- Paid acquisition budget if needed (creator-funded UGC campaigns).

### Risk 6: We ship and people love it but can't convert to paid

Free users forever, no $.

**Mitigation**: 
- Make sure Pro features genuinely matter (video export, private worlds, analytics)
- Cloud inference is a compelling upsell for non-technical users
- Enterprise and Lab contracts carry us

---

## The Long-Term Vision (3-5 years)

**Chronicle becomes the medium.**

- High school students assigned to "run an industrial revolution Chronicle" for history class
- Screenwriters use Chronicle to break stories
- Economists run policy experiments in Chronicle before publishing
- Netflix has a "Chronicle Unscripted" show where AI chronicles become episodic dramas
- Dating shows are literally Chronicles broadcast live

At that point, Chronicle is infrastructure. Like YouTube or Substack.

**We aim for $100M ARR in 5 years.** Plausible if the medium catches on.

---

## North Star Metrics

- **Weekly Active Creators**: people who ran ≥1 Chronicle this week
- **Chronicle Share Rate**: % of runs that generate a shared artifact
- **Fork Depth**: avg generations a Chronicle gets forked
- **Paid Conversion**: % of free → paid
- **ARR growth**: 20% MoM early, settling to 10% MoM

These aren't vanity metrics. They directly measure "is Chronicle a medium people use."

---

## The First Hire

Not an engineer. A **cinematographer / creator-type**.

Someone who can make the demo reel jaw-dropping. Someone who understands why a 15-second clip goes viral and another one doesn't. Someone who can curate the gallery ruthlessly.

The product is technical. The breakthrough is narrative. Most startups get these roles flipped.

---

## Positioning Statement

**For** creators, writers, researchers, and the curious
**Who** want to direct stories they've never seen
**Chronicle is** a configurable social simulation framework
**That** lets anyone run AI agents through a world described in plain English
**Unlike** chatbots (static) or simulation demos (fixed scenarios)
**We** are infinitely configurable, naturally shareable, and improve with use

One line: **"Chronicle: describe a world, watch it unfold."**

---

## What We Explicitly Don't Do

- We don't build game engines. We're not Unity.
- We don't do 3D right now. Pixel art forever (until we have enough money to do 3D WELL).
- We don't pretend to be a research tool only. We're a consumer product with research features.
- We don't gate the free tier into uselessness. Free must be genuinely great.
- We don't let the simulation run without user visibility into cost. No surprise bills.
- We don't allow anonymous simulation of real named living people without consent.

---

## Exit / Acquisition Considerations (realistic)

Plausible acquirers in 3-4 years:
- **Netflix / Disney** (they'd love AI-generated story infrastructure)
- **Anthropic / OpenAI** (if they want a consumer surface)
- **Roblox** (creator platform fit)
- **Adobe** (creator tool portfolio)
- **Unity / Epic Games** (if we expand to game NPC integration)

Strategic value > financial multiple for most of these. Could be $1B+ at scale.

Independent path: $100M ARR at 80% margin = profitable standalone. Acquisition optional.

---

## The Hardest Product Decision Still Open

**How public is the public gallery?**

Scenario A — Fully public (default):
- Pros: maximum viral, every user becomes content
- Cons: trolls, low-quality spam, moderation nightmare

Scenario B — Curated only:
- Pros: quality, brand protection
- Cons: less organic growth, community feels gated

Scenario C — Hybrid (our current plan):
- Default public with reasonable moderation
- "Featured" section is staff-curated
- "All" section is user-voted (with downvoting + flag system)
- NSFW / sensitive content allowed but behind opt-in filter

We'll learn by running it. Lean curated initially, open up as moderation tooling matures.

---

## What Success Looks Like at Each Stage

**Month 3**: 10K free users, 200 paid, #1 on HN on launch day, 1 viral Chronicle hit >1M views  
**Month 6**: 50K free, 2K paid, 3 YouTube videos with 100K+ views, 1 academic paper using Chronicle  
**Month 12**: 250K free, 10K paid, $1M ARR, press coverage in The Atlantic / NYT, first enterprise deal  
**Month 24**: 1M free, 50K paid, $8M ARR, Series A, several Chronicle-based TikTok trends  
**Month 48**: "Chronicle" is a verb (as in "I Chronicled it and here's what happened")
